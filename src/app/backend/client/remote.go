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
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/emicklei/go-restful/v3"
	authorizationv1 "k8s.io/api/authorization/v1"
	v1 "k8s.io/api/core/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metaV1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"

	"github.com/kubernetes/dashboard/src/app/backend/args"
	clientapi "github.com/kubernetes/dashboard/src/app/backend/client/api"
	"github.com/kubernetes/dashboard/src/app/backend/errors"
)

// Remote clusters: any API request carrying '?cluster=<name>' is served by a client built from the kubeconfig
// stored in the local cluster, in the Secret 'kubeconfig-<name>' (or a Secret labelled
// 'dashboard.k8s.io/cluster=<name>') of the namespace given by --remote-kubeconfig-namespace. This is the layout
// Flux uses for 'kubeConfig.secretRef', so the same Secrets serve both. The Secret is read with the caller's own
// credentials, which is the whole authorization model: whoever may read the kubeconfig may use it, nobody else.
const (
	// RemoteClusterQueryParam is the query parameter naming the remote cluster a request targets.
	RemoteClusterQueryParam = "cluster"
	// RemoteKubeconfigSecretPrefix prefixes the name of the Secret holding the kubeconfig of a remote cluster.
	RemoteKubeconfigSecretPrefix = "kubeconfig-"
	// RemoteClusterLabel names a remote cluster on Secrets that do not follow the prefix convention.
	RemoteClusterLabel = "dashboard.k8s.io/cluster"
)

// remoteKubeconfigSecretKeys are the Secret data keys looked up for the kubeconfig, in order (Flux accepts both).
var remoteKubeconfigSecretKeys = []string{"value", "value.yaml"}

// remoteClusterEntry is a parsed remote kubeconfig, cached under the resourceVersion of its Secret so a rotated
// kubeconfig is picked up by the next request.
type remoteClusterEntry struct {
	resourceVersion string
	config          *rest.Config
}

// remoteClusterCache caches parsed remote kubeconfigs by cluster name.
type remoteClusterCache struct {
	lock    sync.Mutex
	entries map[string]remoteClusterEntry
}

// remoteClusterName returns the 'cluster' query parameter of the request, empty for the local cluster.
func remoteClusterName(req *restful.Request) string {
	if req == nil || req.Request == nil || req.Request.URL == nil {
		return ""
	}

	return req.QueryParameter(RemoteClusterQueryParam)
}

// remoteConfig returns the rest config of the named remote cluster, after reading its kubeconfig Secret with
// the caller's credentials.
func (self *clientManager) remoteConfig(req *restful.Request, name string) (*rest.Config, error) {
	client, err := self.localClient(req)
	if err != nil {
		return nil, err
	}

	return self.remoteConfigFrom(client, name)
}

// remoteConfigFrom looks the kubeconfig Secret of the named cluster up with the given client and returns the
// (cached) rest config parsed from it. Errors of the lookup, forbidden included, are returned as they are.
func (self *clientManager) remoteConfigFrom(client kubernetes.Interface, name string) (*rest.Config, error) {
	secret, err := lookupRemoteKubeconfigSecret(client, args.Holder.GetRemoteKubeconfigNamespace(), name)
	if err != nil {
		return nil, err
	}

	return self.remoteClusters.config(name, secret, self.initConfig)
}

func (self *clientManager) remoteClient(req *restful.Request, name string) (kubernetes.Interface, error) {
	cfg, err := self.remoteConfig(req, name)
	if err != nil {
		return nil, err
	}

	return kubernetes.NewForConfig(cfg)
}

// RemoteClusters lists the remote clusters whose kubeconfig Secrets live in the configured namespace. The
// Secrets are listed with the dashboard service account and, when that is not allowed, with the caller's
// credentials; 'accessible' tells whether the caller may read a Secret, i.e. use that cluster.
func (self *clientManager) RemoteClusters(req *restful.Request) (*clientapi.RemoteClusterList, error) {
	namespace := args.Holder.GetRemoteKubeconfigNamespace()
	secrets, err := listRemoteKubeconfigSecrets(self.InsecureClient(), namespace)
	if err != nil {
		client, clientErr := self.localClient(req)
		if clientErr != nil {
			return nil, clientErr
		}

		if secrets, err = listRemoteKubeconfigSecrets(client, namespace); err != nil {
			return nil, err
		}
	}

	return buildRemoteClusterList(secrets, func(secretName string) bool {
		return self.canI(req, self.localClient, canGetSecret(namespace, secretName))
	}), nil
}

// config returns the cached rest config of the cluster when it was parsed from the same Secret revision,
// otherwise parses the Secret, applies the dashboard client defaults and caches the result. A copy is returned
// so callers may tweak their config without affecting the cache.
func (self *remoteClusterCache) config(name string, secret *v1.Secret, initConfig func(*rest.Config)) (*rest.Config, error) {
	self.lock.Lock()
	defer self.lock.Unlock()

	entry, ok := self.entries[name]
	if !ok || entry.resourceVersion != secret.ResourceVersion {
		cfg, err := remoteConfigFromSecret(secret)
		if err != nil {
			return nil, err
		}

		initConfig(cfg)
		entry = remoteClusterEntry{resourceVersion: secret.ResourceVersion, config: cfg}
		self.entries[name] = entry
	}

	return rest.CopyConfig(entry.config), nil
}

// remoteConfigFromSecret parses the kubeconfig stored in the Secret into a rest config.
func remoteConfigFromSecret(secret *v1.Secret) (*rest.Config, error) {
	for _, key := range remoteKubeconfigSecretKeys {
		if data := secret.Data[key]; len(data) > 0 {
			cfg, err := clientcmd.RESTConfigFromKubeConfig(data)
			if err != nil {
				return nil, errors.NewInvalid(fmt.Sprintf("secret %s/%s: invalid kubeconfig: %s",
					secret.Namespace, secret.Name, err.Error()))
			}

			return cfg, nil
		}
	}

	return nil, errors.NewInvalid(fmt.Sprintf("secret %s/%s: no kubeconfig under key %s",
		secret.Namespace, secret.Name, strings.Join(remoteKubeconfigSecretKeys, " or ")))
}

// lookupRemoteKubeconfigSecret returns the kubeconfig Secret of the named cluster: 'kubeconfig-<name>' first,
// then the first Secret labelled 'dashboard.k8s.io/cluster=<name>'.
func lookupRemoteKubeconfigSecret(client kubernetes.Interface, namespace, name string) (*v1.Secret, error) {
	secrets := client.CoreV1().Secrets(namespace)
	secret, err := secrets.Get(context.TODO(), RemoteKubeconfigSecretPrefix+name, metaV1.GetOptions{})
	if err == nil {
		return secret, nil
	}

	if !k8serrors.IsNotFound(err) {
		return nil, err
	}

	list, err := secrets.List(context.TODO(), metaV1.ListOptions{LabelSelector: RemoteClusterLabel + "=" + name})
	if err != nil {
		return nil, err
	}

	if len(list.Items) == 0 {
		return nil, errors.NewNotFound(fmt.Sprintf("remote cluster %q not found in namespace %s", name, namespace))
	}

	return &list.Items[0], nil
}

// listRemoteKubeconfigSecrets returns the Secrets of the namespace that hold a remote cluster kubeconfig.
func listRemoteKubeconfigSecrets(client kubernetes.Interface, namespace string) ([]v1.Secret, error) {
	list, err := client.CoreV1().Secrets(namespace).List(context.TODO(), metaV1.ListOptions{})
	if err != nil {
		return nil, err
	}

	result := []v1.Secret{}
	for _, secret := range list.Items {
		if len(remoteClusterNameOf(&secret)) > 0 {
			result = append(result, secret)
		}
	}

	return result, nil
}

// remoteClusterNameOf returns the cluster name a kubeconfig Secret is registered under: its label when set,
// otherwise its name without the 'kubeconfig-' prefix. Empty for Secrets that are neither.
func remoteClusterNameOf(secret *v1.Secret) string {
	if name := secret.Labels[RemoteClusterLabel]; len(name) > 0 {
		return name
	}

	if strings.HasPrefix(secret.Name, RemoteKubeconfigSecretPrefix) {
		return strings.TrimPrefix(secret.Name, RemoteKubeconfigSecretPrefix)
	}

	return ""
}

// buildRemoteClusterList describes the given kubeconfig Secrets; 'accessible' is asked per Secret name.
func buildRemoteClusterList(secrets []v1.Secret, accessible func(secretName string) bool) *clientapi.RemoteClusterList {
	result := &clientapi.RemoteClusterList{Clusters: []clientapi.RemoteCluster{}}
	for i := range secrets {
		secret := &secrets[i]
		server := ""
		if cfg, err := remoteConfigFromSecret(secret); err == nil {
			server = cfg.Host
		}

		result.Clusters = append(result.Clusters, clientapi.RemoteCluster{
			Name:       remoteClusterNameOf(secret),
			Server:     server,
			Accessible: accessible(secret.Name),
		})
	}

	return result
}

// canGetSecret is the access review that gates the use of a remote cluster.
func canGetSecret(namespace, name string) *authorizationv1.SelfSubjectAccessReview {
	return &authorizationv1.SelfSubjectAccessReview{
		Spec: authorizationv1.SelfSubjectAccessReviewSpec{
			ResourceAttributes: &authorizationv1.ResourceAttributes{
				Verb:      "get",
				Resource:  "secrets",
				Namespace: namespace,
				Name:      name,
			},
		},
	}
}
