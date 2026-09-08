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
	"context"
	"fmt"

	"github.com/kubernetes/dashboard/src/app/backend/api"
	"github.com/kubernetes/dashboard/src/app/backend/plugin/apis/v1alpha1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
)

// globalPluginGVR is the cluster-scoped GlobalPlugin resource. It shares the
// dashboard.k8s.io/v1alpha1 group with the namespaced Plugin; being cluster-scoped
// it is the proper model for a "global" plugin (no namespace, no per-object flag).
// It is read via the dynamic client so no second generated clientset is needed.
var globalPluginGVR = schema.GroupVersionResource{
	Group:    "dashboard.k8s.io",
	Version:  "v1alpha1",
	Resource: "globalplugins",
}

// globalPluginSpec extracts the shared PluginSpec from an unstructured GlobalPlugin.
func globalPluginSpec(item *unstructured.Unstructured) (v1alpha1.PluginSpec, error) {
	var wrapper struct {
		Spec v1alpha1.PluginSpec `json:"spec"`
	}
	if err := runtime.DefaultUnstructuredConverter.FromUnstructured(item.Object, &wrapper); err != nil {
		return v1alpha1.PluginSpec{}, err
	}
	return wrapper.Spec, nil
}

// GetGlobalPlugins lists cluster-scoped GlobalPlugins as Plugin views (Global=true,
// no namespace). Their source is served from /api/v1/globalplugin/{name}.js.
func GetGlobalPlugins(client dynamic.Interface) ([]Plugin, error) {
	list, err := client.Resource(globalPluginGVR).List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	result := make([]Plugin, 0, len(list.Items))
	for i := range list.Items {
		item := &list.Items[i]
		spec, err := globalPluginSpec(item)
		if err != nil {
			continue
		}
		name := item.GetName()
		result = append(result, Plugin{
			ObjectMeta:   api.NewObjectMeta(objectMetaFromUnstructured(item)),
			TypeMeta:     api.NewTypeMeta(api.ResourceKindPlugin),
			Name:         name,
			// resourceVersion in the query: the frontend's module loader caches by
			// URL, so a re-applied plugin becomes a new URL (no page reload).
			Path:         fmt.Sprintf("/api/v1/globalplugin/%s.js?v=%s", name, item.GetResourceVersion()),
			Dependencies: append([]string{}, spec.Dependencies...),
			Global:       true,
			Description:  spec.Description,
			Icon:         spec.Icon,
			NavHidden:    spec.NavHidden,
			Nav:          spec.Nav,
		})
	}
	return result, nil
}

// GetGlobalPluginSource returns the JS for a cluster-scoped GlobalPlugin. Cluster-scoped
// plugins cannot reference a namespaced ConfigMap, so they must embed inline source.
func GetGlobalPluginSource(client dynamic.Interface, name string) ([]byte, error) {
	item, err := client.Resource(globalPluginGVR).Get(context.TODO(), name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}
	spec, err := globalPluginSpec(item)
	if err != nil {
		return nil, err
	}
	if spec.Source.Inline == nil {
		return nil, fmt.Errorf("global plugin %q must use source.inline", name)
	}
	return decodeInlineSource(spec.Source.Inline)
}

func objectMetaFromUnstructured(item *unstructured.Unstructured) metav1.ObjectMeta {
	return metav1.ObjectMeta{
		Name:              item.GetName(),
		CreationTimestamp: item.GetCreationTimestamp(),
		Labels:            item.GetLabels(),
		Annotations:       item.GetAnnotations(),
		UID:               item.GetUID(),
	}
}
