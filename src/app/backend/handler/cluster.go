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
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	restful "github.com/emicklei/go-restful/v3"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/client-go/rest"

	clientapi "github.com/kubernetes/dashboard/src/app/backend/client/api"
	"github.com/kubernetes/dashboard/src/app/backend/errors"
)

// Multi-cluster routing. Every 'api/v1/<rest>' endpoint is also reachable as 'api/v1/cluster/<name>/<rest>',
// in which case it is served by the named cluster:
//
//   - 'local' or the --cluster-name value: the local cluster, exactly as without the prefix;
//   - any other name: the remote cluster whose kubeconfig Secret 'kubeconfig-<name>' the caller may read (see
//     client/remote.go), with the caller's identity impersonated on it (see identity.go). Unknown name: 404,
//     no identity on the request: 401, kubeconfig Secret not readable by the caller: 403.
//
// The prefix is resolved by a plain http.Handler wrapped around the go-restful container rather than by a
// catch-all route inside it: the request is re-dispatched through the container once, with its path rewritten
// to 'api/v1/<rest>' and the resolved cluster stored in its context, so the web service filters (logging,
// metrics, CSRF, restricted resources) and the response compression run exactly once, on the rewritten
// request, and every route matches as it does today. The client manager then builds the clients of that
// request from the config found in the context (client/manager.go).
const (
	// apiV1Path is the mount point of the API served by the container.
	apiV1Path = "/api/v1/"
	// clusterPathPrefix is the route prefix naming the cluster a request targets.
	clusterPathPrefix = apiV1Path + "cluster/"
)

// hubOnlyResources are the top-level 'api/v1' resources that describe this dashboard rather than a cluster's
// workload: plugin registry and sources, settings, auth, the clusters list itself. They are never served under
// the cluster prefix (404), otherwise a remote page would take its plugins, settings or login from the remote.
var hubOnlyResources = map[string]bool{
	"plugin":       true,
	"globalplugin": true,
	"settings":     true,
	"login":        true,
	"token":        true,
	"csrftoken":    true,
	"systembanner": true,
	"clusters":     true,
	"me":           true,
}

// clusterRouter resolves the cluster prefix in front of the API container.
type clusterRouter struct {
	cManager   clientapi.ClientManager
	identities *identityCache
	next       http.Handler
}

// newClusterRouter wraps the API container with the cluster prefix resolution.
func newClusterRouter(cManager clientapi.ClientManager, next http.Handler) http.Handler {
	return &clusterRouter{cManager: cManager, identities: newIdentityCache(callerClient(cManager)), next: next}
}

func (router *clusterRouter) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	if !strings.HasPrefix(req.URL.Path, clusterPathPrefix) {
		router.next.ServeHTTP(w, req)
		return
	}

	name, rest, err := splitClusterPath(req.URL)
	if err != nil {
		writeClusterError(w, err)
		return
	}

	if resource := strings.SplitN(rest, "/", 2)[0]; hubOnlyResources[resource] {
		writeClusterError(w, errors.NewNotFound(fmt.Sprintf("%s is served by this dashboard only, not under a cluster prefix", resource)))
		return
	}

	rewritten, err := rewriteClusterPath(req, rest)
	if err != nil {
		writeClusterError(w, errors.NewBadRequest(err.Error()))
		return
	}

	if clientapi.IsLocalCluster(name) {
		router.next.ServeHTTP(w, rewritten)
		return
	}

	cfg, err := router.remoteConfig(req, name)
	if err != nil {
		writeClusterError(w, err)
		return
	}

	router.next.ServeHTTP(w, rewritten.WithContext(clientapi.WithRemoteCluster(rewritten.Context(), name, cfg)))
}

// remoteConfig returns the config the request is served with on the named remote cluster: the remote
// kubeconfig read with the caller's credentials, impersonating the caller.
func (router *clusterRouter) remoteConfig(req *http.Request, name string) (*rest.Config, error) {
	identity, err := router.identities.resolve(req)
	if err != nil {
		return nil, err
	}

	cfg, err := router.cManager.RemoteConfig(restful.NewRequest(req), name)
	if err != nil {
		if errors.IsNotFoundError(err) {
			return nil, errors.NewNotFound(fmt.Sprintf("unknown cluster %s", name))
		}

		return nil, err
	}

	cfg.Impersonate = rest.ImpersonationConfig{UserName: identity.Username, Groups: identity.Groups}
	return cfg, nil
}

// splitClusterPath returns the cluster name and the rest of the path (unescaped form, without the leading
// slash) of a request under the cluster prefix. Both must be non-empty.
func splitClusterPath(u *url.URL) (name string, rest string, err error) {
	tail := strings.TrimPrefix(u.Path, clusterPathPrefix)
	parts := strings.SplitN(tail, "/", 2)
	name = parts[0]
	if len(parts) == 2 {
		rest = parts[1]
	}

	if len(name) == 0 {
		return "", "", errors.NewNotFound("unknown cluster")
	}

	if len(rest) == 0 {
		return "", "", errors.NewNotFound(fmt.Sprintf("cluster %s: no request given after the cluster name", name))
	}

	return name, rest, nil
}

// rewriteClusterPath returns a shallow copy of the request whose URL points at 'api/v1/<rest>', keeping the
// escaped form of the path (a namespace given as '%20', say) so the routes see what they see today.
func rewriteClusterPath(req *http.Request, rest string) (*http.Request, error) {
	escaped := req.URL.EscapedPath()
	escapedTail := strings.TrimPrefix(escaped, clusterPathPrefix)
	escapedParts := strings.SplitN(escapedTail, "/", 2)
	if len(escapedParts) != 2 {
		return nil, fmt.Errorf("cannot rewrite path %s", escaped)
	}

	rawPath := apiV1Path + escapedParts[1]
	path, err := url.PathUnescape(rawPath)
	if err != nil {
		return nil, err
	}

	if path != apiV1Path+rest {
		return nil, fmt.Errorf("cannot rewrite path %s", escaped)
	}

	// As net/url does: RawPath is only kept when it differs from the default escaping of Path.
	u := *req.URL
	u.Path = path
	u.RawPath = ""
	if (&url.URL{Path: path}).EscapedPath() != rawPath {
		u.RawPath = rawPath
	}

	rewritten := req.WithContext(req.Context())
	rewritten.URL = &u
	return rewritten, nil
}

// writeClusterError answers a request the router could not route, as JSON: {"message": "..."} with the status
// of the error (404 unknown cluster, 401 no identity, 403 kubeconfig not readable, 500 otherwise).
func writeClusterError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	if statusErr, ok := err.(*k8serrors.StatusError); ok && statusErr.ErrStatus.Code > 0 {
		status = int(statusErr.ErrStatus.Code)
	}

	w.Header().Set("Content-Type", restful.MIME_JSON)
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"message": err.Error()})
}
