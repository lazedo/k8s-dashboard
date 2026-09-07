// Copyright 2017 The Kubernetes Authors.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package client

import (
	"fmt"
	"net/http"
	"net/url"
	"testing"

	restful "github.com/emicklei/go-restful/v3"
	v1 "k8s.io/api/core/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metaV1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	"github.com/kubernetes/dashboard/src/app/backend/args"
	"github.com/kubernetes/dashboard/src/app/backend/errors"
)

const testRemoteNamespace = "flux-system"

func kubeconfigFor(server string) []byte {
	return []byte(fmt.Sprintf(`apiVersion: v1
kind: Config
clusters:
- name: remote
  cluster:
    server: %s
    insecure-skip-tls-verify: true
contexts:
- name: remote
  context:
    cluster: remote
    user: admin
current-context: remote
users:
- name: admin
  user:
    token: remote-sa-token
`, server))
}

func kubeconfigSecret(name, resourceVersion, server string) *v1.Secret {
	return &v1.Secret{
		ObjectMeta: metaV1.ObjectMeta{Name: name, Namespace: testRemoteNamespace, ResourceVersion: resourceVersion},
		Data:       map[string][]byte{"value": kubeconfigFor(server)},
	}
}

func remoteRequest(cluster string) *restful.Request {
	return restful.NewRequest(&http.Request{
		Header: http.Header{},
		URL:    &url.URL{Path: "/api/v1/pod", RawQuery: url.Values{"cluster": {cluster}}.Encode()},
	})
}

func TestRemoteConfigFromSecret(t *testing.T) {
	cases := []struct {
		secret         *v1.Secret
		expectedServer string
		expectedError  bool
	}{
		{kubeconfigSecret("kubeconfig-west", "1", "https://west.example:6443"), "https://west.example:6443", false},
		{&v1.Secret{Data: map[string][]byte{"value.yaml": kubeconfigFor("https://east.example:6443")}},
			"https://east.example:6443", false},
		{&v1.Secret{Data: map[string][]byte{"other": kubeconfigFor("https://east.example:6443")}}, "", true},
		{&v1.Secret{Data: map[string][]byte{"value": []byte("not: [a kubeconfig")}}, "", true},
		{&v1.Secret{}, "", true},
	}

	for _, c := range cases {
		cfg, err := remoteConfigFromSecret(c.secret)
		if c.expectedError {
			if err == nil {
				t.Errorf("remoteConfigFromSecret(%v): expected error, got config for %s", c.secret.Data, cfg.Host)
			}
			continue
		}

		if err != nil {
			t.Fatalf("remoteConfigFromSecret(%v): unexpected error %s", c.secret.Data, err.Error())
		}

		if cfg.Host != c.expectedServer {
			t.Errorf("remoteConfigFromSecret: expected server %s, got %s", c.expectedServer, cfg.Host)
		}

		if cfg.BearerToken != "remote-sa-token" {
			t.Errorf("remoteConfigFromSecret: expected the kubeconfig token, got %q", cfg.BearerToken)
		}
	}
}

func TestRemoteClusterCache(t *testing.T) {
	manager := NewClientManager("", "http://localhost:8080").(*clientManager)

	first, err := manager.remoteClusters.config("west", kubeconfigSecret("kubeconfig-west", "1", "https://west.example:6443"), manager.initConfig)
	if err != nil {
		t.Fatalf("config(): unexpected error %s", err.Error())
	}

	if first.UserAgent != DefaultUserAgent+"/"+Version {
		t.Errorf("config(): expected dashboard defaults to be applied, got user agent %q", first.UserAgent)
	}

	cached := manager.remoteClusters.entries["west"].config
	// Same resourceVersion: served from the cache, even if the Secret content differs.
	second, err := manager.remoteClusters.config("west", kubeconfigSecret("kubeconfig-west", "1", "https://changed.example:6443"), manager.initConfig)
	if err != nil {
		t.Fatalf("config(): unexpected error %s", err.Error())
	}

	if second.Host != "https://west.example:6443" || manager.remoteClusters.entries["west"].config != cached {
		t.Errorf("config(): expected the cached config for an unchanged resourceVersion, got %s", second.Host)
	}

	if second == cached {
		t.Errorf("config(): expected a copy of the cached config, got the cached pointer")
	}

	// New resourceVersion: parsed again.
	third, err := manager.remoteClusters.config("west", kubeconfigSecret("kubeconfig-west", "2", "https://rotated.example:6443"), manager.initConfig)
	if err != nil {
		t.Fatalf("config(): unexpected error %s", err.Error())
	}

	if third.Host != "https://rotated.example:6443" || manager.remoteClusters.entries["west"].resourceVersion != "2" {
		t.Errorf("config(): expected the rotated kubeconfig to be picked up, got %s", third.Host)
	}

	if _, err := manager.remoteClusters.config("broken", &v1.Secret{}, manager.initConfig); err == nil {
		t.Errorf("config(): expected an error for a Secret without kubeconfig")
	}

	if _, ok := manager.remoteClusters.entries["broken"]; ok {
		t.Errorf("config(): expected nothing to be cached for a broken Secret")
	}
}

func TestLookupRemoteKubeconfigSecret(t *testing.T) {
	prefixed := kubeconfigSecret("kubeconfig-west", "1", "https://west.example:6443")
	labelled := kubeconfigSecret("east-admin", "1", "https://east.example:6443")
	labelled.Labels = map[string]string{RemoteClusterLabel: "east"}
	client := fake.NewSimpleClientset(prefixed, labelled)

	cases := []struct {
		name           string
		expectedSecret string
	}{
		{"west", "kubeconfig-west"},
		{"east", "east-admin"},
		{"central", ""},
	}

	for _, c := range cases {
		secret, err := lookupRemoteKubeconfigSecret(client, testRemoteNamespace, c.name)
		if len(c.expectedSecret) == 0 {
			if err == nil || !errors.IsNotFoundError(err) {
				t.Errorf("lookupRemoteKubeconfigSecret(%s): expected not found, got %v, %v", c.name, secret, err)
			}
			continue
		}

		if err != nil {
			t.Fatalf("lookupRemoteKubeconfigSecret(%s): unexpected error %s", c.name, err.Error())
		}

		if secret.Name != c.expectedSecret {
			t.Errorf("lookupRemoteKubeconfigSecret(%s): expected secret %s, got %s", c.name, c.expectedSecret, secret.Name)
		}
	}
}

// forbiddenSecretsClient returns a client whose secrets API answers 403 to everything, as the apiserver does for
// a user without RBAC on the kubeconfig Secrets.
func forbiddenSecretsClient(objects ...runtime.Object) *fake.Clientset {
	client := fake.NewSimpleClientset(objects...)
	client.PrependReactor("*", "secrets", func(action k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, k8serrors.NewForbidden(schema.GroupResource{Resource: "secrets"}, "kubeconfig-west",
			fmt.Errorf("user cannot get secrets"))
	})
	return client
}

func TestRemoteConfigDeniedWithoutSecretAccess(t *testing.T) {
	args.GetHolderBuilder().SetRemoteKubeconfigNamespace(testRemoteNamespace)
	manager := NewClientManager("", "http://localhost:8080").(*clientManager)

	// The Secret exists but the caller may not read it: no config, nothing cached.
	_, err := manager.remoteConfigFrom(forbiddenSecretsClient(kubeconfigSecret("kubeconfig-west", "1", "https://west.example:6443")), "west")
	if err == nil || !errors.IsForbiddenError(err) {
		t.Fatalf("remoteConfigFrom(): expected forbidden, got %v", err)
	}

	if len(manager.remoteClusters.entries) != 0 {
		t.Errorf("remoteConfigFrom(): expected nothing cached after a denied lookup")
	}

	// A caller allowed to read the Secret gets the remote config.
	cfg, err := manager.remoteConfigFrom(fake.NewSimpleClientset(kubeconfigSecret("kubeconfig-west", "1", "https://west.example:6443")), "west")
	if err != nil {
		t.Fatalf("remoteConfigFrom(): unexpected error %s", err.Error())
	}

	if cfg.Host != "https://west.example:6443" {
		t.Errorf("remoteConfigFrom(): expected the remote server, got %s", cfg.Host)
	}

	// End to end: the local apiserver is unreachable, so the Secret cannot be read and no remote client is built.
	for _, get := range []func(*restful.Request) (interface{}, error){
		func(req *restful.Request) (interface{}, error) { return manager.Client(req) },
		func(req *restful.Request) (interface{}, error) { return manager.Config(req) },
		func(req *restful.Request) (interface{}, error) { return manager.APIExtensionsClient(req) },
		func(req *restful.Request) (interface{}, error) { return manager.PluginClient(req) },
	} {
		if _, err := get(remoteRequest("west")); err == nil {
			t.Errorf("expected an error when the kubeconfig Secret cannot be read")
		}
	}

	// Without the parameter the local client is served as before.
	if _, err := manager.Client(remoteRequest("")); err != nil {
		t.Errorf("Client(): unexpected error without cluster parameter: %s", err.Error())
	}
}

func TestBuildRemoteClusterList(t *testing.T) {
	west := kubeconfigSecret("kubeconfig-west", "1", "https://west.example:6443")
	east := kubeconfigSecret("east-admin", "1", "https://east.example:6443")
	east.Labels = map[string]string{RemoteClusterLabel: "east"}
	broken := &v1.Secret{ObjectMeta: metaV1.ObjectMeta{Name: "kubeconfig-central", Namespace: testRemoteNamespace}}
	other := &v1.Secret{ObjectMeta: metaV1.ObjectMeta{Name: "sops-age", Namespace: testRemoteNamespace}}

	secrets, err := listRemoteKubeconfigSecrets(fake.NewSimpleClientset(west, east, broken, other), testRemoteNamespace)
	if err != nil {
		t.Fatalf("listRemoteKubeconfigSecrets(): unexpected error %s", err.Error())
	}

	list := buildRemoteClusterList(secrets, func(secretName string) bool { return secretName == "kubeconfig-west" })
	if len(list.Clusters) != 3 {
		t.Fatalf("buildRemoteClusterList(): expected 3 clusters, got %+v", list.Clusters)
	}

	expected := map[string]struct {
		server     string
		accessible bool
	}{
		"west":    {"https://west.example:6443", true},
		"east":    {"https://east.example:6443", false},
		"central": {"", false},
	}

	for _, cluster := range list.Clusters {
		e, ok := expected[cluster.Name]
		if !ok {
			t.Errorf("buildRemoteClusterList(): unexpected cluster %+v", cluster)
			continue
		}

		if cluster.Server != e.server || cluster.Accessible != e.accessible {
			t.Errorf("buildRemoteClusterList(): cluster %s: expected %+v, got %+v", cluster.Name, e, cluster)
		}
	}

	if _, err := listRemoteKubeconfigSecrets(forbiddenSecretsClient(), testRemoteNamespace); err == nil || !errors.IsForbiddenError(err) {
		t.Errorf("listRemoteKubeconfigSecrets(): expected forbidden, got %v", err)
	}
}
