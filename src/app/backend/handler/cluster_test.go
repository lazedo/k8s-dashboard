// Copyright 2026 The Kubernetes Authors.
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

package handler

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	restful "github.com/emicklei/go-restful/v3"
	authenticationv1 "k8s.io/api/authentication/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/rest"
	k8stesting "k8s.io/client-go/testing"

	"github.com/kubernetes/dashboard/src/app/backend/args"
	clientapi "github.com/kubernetes/dashboard/src/app/backend/client/api"
	"github.com/kubernetes/dashboard/src/app/backend/errors"
)

// routerManager fakes the remote config lookup, the one client manager call the cluster router makes besides
// building the caller's client (faked separately, see testRouter). The embedded nil interface is never reached.
type routerManager struct {
	clientapi.ClientManager
	configs map[string]*rest.Config
	err     error
}

// testRouter is a cluster router whose SelfSubjectReviews go to the given fake client.
func testRouter(manager *routerManager, client kubernetes.Interface, next http.Handler) http.Handler {
	clientFor := func(req *http.Request) (kubernetes.Interface, error) { return client, nil }
	return &clusterRouter{cManager: manager, identities: newIdentityCache(clientFor), next: next}
}

func (m *routerManager) RemoteConfig(req *restful.Request, name string) (*rest.Config, error) {
	if m.err != nil {
		return nil, m.err
	}

	cfg, ok := m.configs[name]
	if !ok {
		return nil, errors.NewNotFound(fmt.Sprintf("remote cluster %q not found in namespace flux-system", name))
	}

	return rest.CopyConfig(cfg), nil
}

// reviewingClient answers SelfSubjectReviews with the given identity, counting the calls.
func reviewingClient(username string, groups []string, calls *int) kubernetes.Interface {
	client := fake.NewSimpleClientset()
	client.PrependReactor("create", "selfsubjectreviews", func(action k8stesting.Action) (bool, runtime.Object, error) {
		*calls++
		return true, &authenticationv1.SelfSubjectReview{
			Status: authenticationv1.SelfSubjectReviewStatus{UserInfo: authenticationv1.UserInfo{Username: username, Groups: groups}},
		}, nil
	})

	return client
}

// legacyClient has no SelfSubjectReview API, as apiservers before Kubernetes 1.28.
func legacyClient() kubernetes.Interface {
	client := fake.NewSimpleClientset()
	client.PrependReactor("create", "selfsubjectreviews", func(action k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, k8serrors.NewNotFound(schema.GroupResource{Group: "authentication.k8s.io", Resource: "selfsubjectreviews"}, "")
	})

	return client
}

// idToken is an unsigned JWT with the given claims; the router only reads its payload.
func idToken(claims map[string]interface{}) string {
	payload, _ := json.Marshal(claims)
	return "eyJhbGciOiJub25lIn0." + base64.RawURLEncoding.EncodeToString(payload) + ".sig"
}

// dispatched is what the wrapped container saw for a request.
type dispatched struct {
	path        string
	rawPath     string
	cluster     string
	host        string
	impersonate rest.ImpersonationConfig
}

func recordingHandler(seen *dispatched) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		*seen = dispatched{path: req.URL.Path, rawPath: req.URL.RawPath}
		if name, cfg := clientapi.RemoteClusterFrom(req.Context()); cfg != nil {
			seen.cluster = name
			seen.host = cfg.Host
			seen.impersonate = cfg.Impersonate
		}
		w.WriteHeader(http.StatusOK)
	})
}

func TestClusterRouter(t *testing.T) {
	args.GetHolderBuilder().SetClusterName("hub")
	defer args.GetHolderBuilder().SetClusterName("")

	calls := 0
	client := reviewingClient("dex#alice", []string{"system:authenticated", "dex#myorg:admins"}, &calls)
	manager := &routerManager{configs: map[string]*rest.Config{"west": {Host: "https://west.example:6443"}}}

	cases := []struct {
		name           string
		path           string
		authenticated  bool
		expectedStatus int
		expectedBody   string
		expected       dispatched
	}{
		{"no prefix", "/api/v1/pod/kube-system", false, http.StatusOK, "",
			dispatched{path: "/api/v1/pod/kube-system"}},
		{"local alias", "/api/v1/cluster/local/pod/kube-system", false, http.StatusOK, "",
			dispatched{path: "/api/v1/pod/kube-system"}},
		{"local name", "/api/v1/cluster/hub/pod/kube-system", false, http.StatusOK, "",
			dispatched{path: "/api/v1/pod/kube-system"}},
		{"remote", "/api/v1/cluster/west/crd/%20/kazoos.cluster.kazoo.io/object", true, http.StatusOK, "",
			dispatched{
				path:        "/api/v1/crd/ /kazoos.cluster.kazoo.io/object",
				cluster:     "west",
				host:        "https://west.example:6443",
				impersonate: rest.ImpersonationConfig{UserName: "dex#alice", Groups: []string{"dex#myorg:admins"}},
			}},
		{"remote without identity", "/api/v1/cluster/west/pod", false, http.StatusUnauthorized,
			`{"message":"a remote cluster needs an authenticated caller to impersonate"}`, dispatched{}},
		{"unknown cluster", "/api/v1/cluster/nowhere/pod", true, http.StatusNotFound,
			`{"message":"unknown cluster nowhere"}`, dispatched{}},
		{"hub-only resource", "/api/v1/cluster/west/plugin/config", true, http.StatusNotFound,
			`{"message":"plugin is served by this dashboard only, not under a cluster prefix"}`, dispatched{}},
		{"hub-only resource on the local name", "/api/v1/cluster/hub/clusters", false, http.StatusNotFound,
			`{"message":"clusters is served by this dashboard only, not under a cluster prefix"}`, dispatched{}},
		{"no request after the name", "/api/v1/cluster/west", true, http.StatusNotFound,
			`{"message":"cluster west: no request given after the cluster name"}`, dispatched{}},
		{"empty name", "/api/v1/cluster//pod", true, http.StatusNotFound,
			`{"message":"unknown cluster"}`, dispatched{}},
	}

	// One router for all cases: its identity cache must serve every remote request of the same caller.
	seen := dispatched{}
	router := testRouter(manager, client, recordingHandler(&seen))
	for _, c := range cases {
		seen = dispatched{}
		req := httptest.NewRequest(http.MethodGet, c.path, nil)
		if c.authenticated {
			req.Header.Set("Authorization", "Bearer "+idToken(map[string]interface{}{"sub": "alice"}))
		}

		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, req)

		if recorder.Code != c.expectedStatus {
			t.Errorf("%s: expected status %d, got %d (%s)", c.name, c.expectedStatus, recorder.Code, recorder.Body.String())
		}

		if body := strings.TrimSpace(recorder.Body.String()); body != c.expectedBody {
			t.Errorf("%s: expected body %s, got %s", c.name, c.expectedBody, body)
		}

		if !reflect.DeepEqual(seen, c.expected) {
			t.Errorf("%s: expected the container to see %+v, got %+v", c.name, c.expected, seen)
		}
	}

	// The identity was resolved once for the same credentials, not per request.
	if calls != 1 {
		t.Errorf("expected one SelfSubjectReview for the same credentials, got %d", calls)
	}
}

func TestClusterRouterForbiddenKubeconfig(t *testing.T) {
	calls := 0
	manager := &routerManager{err: k8serrors.NewForbidden(schema.GroupResource{Resource: "secrets"}, "kubeconfig-west",
		fmt.Errorf("user cannot get secrets"))}

	seen := dispatched{}
	router := testRouter(manager, reviewingClient("dex#alice", nil, &calls), recordingHandler(&seen))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/cluster/west/pod", nil)
	req.Header.Set("Authorization", "Bearer "+idToken(map[string]interface{}{"sub": "alice"}))
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusForbidden {
		t.Errorf("expected status 403 when the caller may not read the kubeconfig, got %d (%s)", recorder.Code, recorder.Body.String())
	}

	if seen.path != "" {
		t.Errorf("expected nothing to be dispatched, got %+v", seen)
	}
}

func TestIdentityFallsBackToClaims(t *testing.T) {
	cache := newIdentityCache(func(req *http.Request) (kubernetes.Interface, error) { return legacyClient(), nil })

	req := httptest.NewRequest(http.MethodGet, "/api/v1/cluster/west/pod", nil)
	req.Header.Set("Authorization", "Bearer "+idToken(map[string]interface{}{
		"sub":    "CgY3alice",
		"email":  "alice@example.com",
		"groups": []string{"myorg:admins", "system:authenticated"},
	}))

	identity, err := cache.resolve(req)
	if err != nil {
		t.Fatalf("resolve(): unexpected error %s", err.Error())
	}

	expected := &Identity{Username: "CgY3alice", Groups: []string{"myorg:admins"}}
	if !reflect.DeepEqual(identity, expected) {
		t.Errorf("resolve(): expected %+v from the claims, got %+v", expected, identity)
	}

	// A token without a subject is no identity.
	req.Header.Set("Authorization", "Bearer "+idToken(map[string]interface{}{"email": "alice@example.com"}))
	if _, err := cache.resolve(req); err == nil || !strings.Contains(err.Error(), "no usable token claims") {
		t.Errorf("resolve(): expected an unauthorized error without a subject claim, got %v", err)
	}
}
