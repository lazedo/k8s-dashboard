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

package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"bytes"
	"reflect"
	"strings"

	restful "github.com/emicklei/go-restful/v3"
	"github.com/kubernetes/dashboard/src/app/backend/args"
	"github.com/kubernetes/dashboard/src/app/backend/auth"
	authApi "github.com/kubernetes/dashboard/src/app/backend/auth/api"
	"github.com/kubernetes/dashboard/src/app/backend/auth/jwe"
	"github.com/kubernetes/dashboard/src/app/backend/client"
	clientapi "github.com/kubernetes/dashboard/src/app/backend/client/api"
	"github.com/kubernetes/dashboard/src/app/backend/errors"
	"github.com/kubernetes/dashboard/src/app/backend/settings"
	"github.com/kubernetes/dashboard/src/app/backend/sync"
	"github.com/kubernetes/dashboard/src/app/backend/systembanner"
	"k8s.io/client-go/kubernetes/fake"
)

func getTokenManager() authApi.TokenManager {
	c := fake.NewSimpleClientset()
	syncManager := sync.NewSynchronizerManager(c)
	holder := jwe.NewRSAKeyHolder(syncManager.Secret("", ""))
	return jwe.NewJWETokenManager(holder)
}

func TestCreateHTTPAPIHandler(t *testing.T) {
	cManager := client.NewClientManager("", "http://localhost:8080")
	authManager := auth.NewAuthManager(cManager, getTokenManager(), authApi.AuthenticationModes{}, true)
	sManager := settings.NewSettingsManager()
	sbManager := systembanner.NewSystemBannerManager("Hello world!", "INFO")
	_, err := CreateHTTPAPIHandler(nil, cManager, authManager, sManager, sbManager)
	if err != nil {
		t.Fatal("CreateHTTPAPIHandler() cannot create HTTP API handler")
	}
}

func TestShouldDoCsrfValidation(t *testing.T) {
	cases := []struct {
		request  *restful.Request
		expected bool
	}{
		{
			&restful.Request{
				Request: &http.Request{
					Method: "PUT",
				},
			},
			false,
		},
		{
			&restful.Request{
				Request: &http.Request{
					Method: "POST",
				},
			},
			true,
		},
	}
	for _, c := range cases {
		actual := shouldDoCsrfValidation(c.request)
		if actual != c.expected {
			t.Errorf("shouldDoCsrfValidation(%#v) returns %#v, expected %#v", c.request, actual, c.expected)
		}
	}
}

func TestMapUrlToResource(t *testing.T) {
	cases := []struct {
		url, expected string
	}{
		{
			"/api/v1/pod",
			"pod",
		},
		{
			"/api/v1/node",
			"node",
		},
	}
	for _, c := range cases {
		actual := mapUrlToResource(c.url)
		if !reflect.DeepEqual(actual, &c.expected) {
			t.Errorf("mapUrlToResource(%#v) returns %#v, expected %#v", c.url, actual, c.expected)
		}
	}
}

func TestFormatRequestLog(t *testing.T) {
	cases := []struct {
		method      string
		uri         string
		content     map[string]string
		expected    string
		apiLogLevel string
	}{
		{
			"PUT",
			"/api/v1/pod",
			map[string]string{},
			"Incoming HTTP/1.1 PUT /api/v1/pod request",
			"DEFAULT",
		},
		{
			"PUT",
			"/api/v1/pod",
			map[string]string{},
			"",
			"NONE",
		},
		{
			"POST",
			"/api/v1/login",
			map[string]string{"password": "abc123"},
			"Incoming HTTP/1.1 POST /api/v1/login request from : { contents hidden }",
			"DEFAULT",
		},
		{
			"POST",
			"/api/v1/login",
			map[string]string{},
			"",
			"NONE",
		},
		{
			"POST",
			"/api/v1/login",
			map[string]string{"password": "abc123"},
			"Incoming HTTP/1.1 POST /api/v1/login request from : {\"password\":\"abc123\"}",
			"DEBUG",
		},
	}

	for _, c := range cases {
		jsonValue, _ := json.Marshal(c.content)

		req, err := http.NewRequest(c.method, c.uri, bytes.NewReader(jsonValue))
		req.Header.Set("Content-Type", "application/json")

		if err != nil {
			t.Error("Cannot mockup request")
		}

		builder := args.GetHolderBuilder()
		builder.SetAPILogLevel(c.apiLogLevel)

		var restfulRequest restful.Request
		restfulRequest.Request = req

		actual := formatRequestLog(&restfulRequest)
		if !strings.Contains(actual, c.expected) {
			t.Errorf("formatRequestLog(%#v) returns %#v, expected to contain %#v", req, actual, c.expected)
		}
	}
}

// clustersManager overrides only Clusters; the embedded nil interface is never reached.
type clustersManager struct {
	clientapi.ClientManager
	list *clientapi.ClusterList
	err  error
}

func (m *clustersManager) Clusters(req *restful.Request) (*clientapi.ClusterList, error) {
	return m.list, m.err
}

func TestHandleGetClusters(t *testing.T) {
	cases := []struct {
		manager        *clustersManager
		expectedStatus int
	}{
		{
			&clustersManager{list: &clientapi.ClusterList{Clusters: []clientapi.Cluster{
				{Name: "hub", Local: true, Server: "https://hub.example:6443", Accessible: true},
				{Name: "west", Server: "https://west.example:6443", Accessible: true},
				{Name: "east", Server: "https://east.example:6443", Accessible: false},
			}}},
			http.StatusOK,
		},
		{
			&clustersManager{list: &clientapi.ClusterList{Clusters: []clientapi.Cluster{{Name: "local", Local: true, Accessible: true}}}},
			http.StatusOK,
		},
		{
			&clustersManager{err: errors.NewUnauthorized(errors.MsgLoginUnauthorizedError)},
			http.StatusUnauthorized,
		},
	}

	for _, c := range cases {
		apiHandler := APIHandler{cManager: c.manager}
		httpReq, _ := http.NewRequest(http.MethodGet, "/api/v1/clusters", nil)
		httpReq.Header.Set("Accept", restful.MIME_JSON)
		recorder := httptest.NewRecorder()
		response := restful.NewResponse(recorder)
		response.SetRequestAccepts(restful.MIME_JSON)

		apiHandler.handleGetClusters(restful.NewRequest(httpReq), response)

		if recorder.Code != c.expectedStatus {
			t.Errorf("handleGetClusters(): expected status %d, got %d (%s)", c.expectedStatus, recorder.Code, recorder.Body.String())
		}

		if c.manager.err != nil {
			continue
		}

		if !strings.Contains(recorder.Body.String(), `"clusters"`) {
			t.Errorf("handleGetClusters(): expected a clusters list, got %s", recorder.Body.String())
		}

		result := &clientapi.ClusterList{}
		if err := json.Unmarshal(recorder.Body.Bytes(), result); err != nil {
			t.Fatalf("handleGetClusters(): invalid JSON %s: %s", recorder.Body.String(), err.Error())
		}

		if !reflect.DeepEqual(result, c.manager.list) {
			t.Errorf("handleGetClusters(): expected %+v, got %+v", c.manager.list, result)
		}
	}
}
