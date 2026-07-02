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

package plugin

import (
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/kubernetes/dashboard/src/app/backend/handler/parser"

	"github.com/emicklei/go-restful/v3"
	clientapi "github.com/kubernetes/dashboard/src/app/backend/client/api"
	"github.com/kubernetes/dashboard/src/app/backend/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/dynamic"
)

const (
	contentTypeHeader = "Content-Type"
	jsContentType     = "text/javascript; charset=utf-8"
)

// Handler manages all endpoints related to plugin use cases, such as list and get.
type Handler struct {
	cManager clientapi.ClientManager
}

// Install creates new endpoints for plugins. All information that any plugin would want
// to expose by creating new endpoints should be kept here, i.e. plugin service might want to
// create endpoint to list available proxy paths to another backend.
//
// By default, endpoint for getting and listing plugins is installed. It allows user
// to list the installed plugins and get the source code for a plugin.
func (h *Handler) Install(ws *restful.WebService) {
	ws.Route(
		ws.GET("/plugin/config").
			To(h.handleConfig),
	)

	ws.Route(
		ws.GET("/plugin/{namespace}").
			To(h.handlePluginList).
			Writes(PluginList{}))

	ws.Route(
		ws.GET("/plugin/{namespace}/{pluginName}").
			To(h.servePluginSource))

	ws.Route(
		ws.GET("/globalplugin/{pluginName}").
			To(h.serveGlobalPluginSource))

	ws.Route(
		ws.GET("/globalplugin/{pluginName}/proxy/{route}/{subpath:*}").
			To(h.handleGlobalPluginProxy))
}

// globalPluginClient builds a dynamic client (per-request auth) to read the
// cluster-scoped GlobalPlugin resource. Returns nil if a client can't be built,
// so callers can degrade gracefully (namespaced plugins still work).
func (h *Handler) globalPluginClient(request *restful.Request) dynamic.Interface {
	cfg, err := h.cManager.Config(request)
	if err != nil {
		return nil
	}
	client, err := dynamic.NewForConfig(cfg)
	if err != nil {
		return nil
	}
	return client
}

// NewPluginHandler creates plugin.Handler.
func NewPluginHandler(cManager clientapi.ClientManager) *Handler {
	return &Handler{cManager: cManager}
}

func (h *Handler) handlePluginList(request *restful.Request, response *restful.Response) {
	pluginClient, err := h.cManager.PluginClient(request)
	if err != nil {
		errors.HandleInternalError(response, err)
		return
	}
	// The dashboard sends a single space as the "all namespaces" sentinel; the
	// generic resource handlers translate it, but this one passed it through, so
	// "All namespaces" listed plugins in a namespace literally named " " (none).
	// Trim it so blank/space => "" => list across all namespaces.
	namespace := strings.TrimSpace(request.PathParameter("namespace"))
	dataSelect := parser.ParseDataSelectPathParameter(request)

	result, err := GetPluginList(pluginClient, namespace, dataSelect)
	if err != nil {
		errors.HandleInternalError(response, err)
		return
	}
	// Availability: cluster-scoped GlobalPlugins are available in every namespace,
	// so append them to any namespace view (including all-namespaces).
	if dynClient := h.globalPluginClient(request); dynClient != nil {
		if globals, gErr := GetGlobalPlugins(dynClient); gErr == nil {
			result.Items = append(result.Items, globals...)
			result.ListMeta.TotalItems += len(globals)
		}
	}
	response.WriteHeaderAndEntity(http.StatusOK, result)
}

func (h *Handler) serveGlobalPluginSource(request *restful.Request, response *restful.Response) {
	// SystemJS can't send auth headers, so use the insecure config (like servePluginSource).
	dynClient, err := dynamic.NewForConfig(h.cManager.InsecureConfig())
	if err != nil {
		errors.HandleInternalError(response, err)
		return
	}

	pluginName := request.PathParameter("pluginName")
	name := strings.TrimSuffix(pluginName, filepath.Ext(pluginName))

	result, err := GetGlobalPluginSource(dynClient, name)
	if err != nil {
		errors.HandleInternalError(response, err)
		return
	}
	response.AddHeader(contentTypeHeader, jsContentType)
	response.Write(result)
}

// handleGlobalPluginProxy forwards GET requests to an external API declared in
// the plugin's spec.proxy — a per-plugin allow-list (à la Grafana app plugin
// routes) so browser-side plugin code can reach CORS-restricted upstreams
// (e.g. artifacthub.io) without the dashboard becoming an open proxy. GET
// only; the target is spec.proxy[route].url + subpath + query.
func (h *Handler) handleGlobalPluginProxy(request *restful.Request, response *restful.Response) {
	dynClient, err := dynamic.NewForConfig(h.cManager.InsecureConfig())
	if err != nil {
		errors.HandleInternalError(response, err)
		return
	}

	item, err := dynClient.Resource(globalPluginGVR).Get(request.Request.Context(), request.PathParameter("pluginName"), metav1.GetOptions{})
	if err != nil {
		errors.HandleInternalError(response, err)
		return
	}

	route := request.PathParameter("route")
	base := ""
	proxies, _, _ := unstructured.NestedSlice(item.Object, "spec", "proxy")
	for _, p := range proxies {
		if m, ok := p.(map[string]interface{}); ok && m["name"] == route {
			base, _ = m["url"].(string)
		}
	}
	if base == "" {
		response.WriteHeaderAndEntity(http.StatusNotFound, "no such proxy route declared in spec.proxy")
		return
	}

	target := strings.TrimSuffix(base, "/") + "/" + request.PathParameter("subpath")
	if query := request.Request.URL.RawQuery; query != "" {
		target += "?" + query
	}

	upstreamReq, err := http.NewRequestWithContext(request.Request.Context(), http.MethodGet, target, nil)
	if err != nil {
		errors.HandleInternalError(response, err)
		return
	}
	if accept := request.Request.Header.Get("Accept"); accept != "" {
		upstreamReq.Header.Set("Accept", accept)
	}

	client := &http.Client{Timeout: 30 * time.Second}
	upstream, err := client.Do(upstreamReq)
	if err != nil {
		errors.HandleInternalError(response, err)
		return
	}
	defer upstream.Body.Close()

	if contentType := upstream.Header.Get(contentTypeHeader); contentType != "" {
		response.AddHeader(contentTypeHeader, contentType)
	}
	response.WriteHeader(upstream.StatusCode)
	io.Copy(response, upstream.Body)
}

func (h *Handler) servePluginSource(request *restful.Request, response *restful.Response) {
	// TODO: Change these to secure clients once SystemJS can send proper auth headers.
	pluginClient := h.cManager.InsecurePluginClient()
	k8sClient := h.cManager.InsecureClient()

	namespace := request.PathParameter("namespace")
	// Removes .js extension if it's present
	pluginName := request.PathParameter("pluginName")
	name := strings.TrimSuffix(pluginName, filepath.Ext(pluginName))

	result, err := GetPluginSource(pluginClient, k8sClient, namespace, name)
	if err != nil {
		errors.HandleInternalError(response, err)
		return
	}
	response.AddHeader(contentTypeHeader, jsContentType)
	response.Write(result)
}
