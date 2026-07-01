// Copyright 2024 The Kubernetes Authors.
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

// Package verticalpodautoscaler browses the optional VerticalPodAutoscaler CRD
// (autoscaling.k8s.io) through the shared dynamic-CRD read path, so it shows up
// only when VPA is installed and needs no generated clientset.
package verticalpodautoscaler

import (
	"log"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/dynamic"

	"github.com/kubernetes/dashboard/src/app/backend/api"
	"github.com/kubernetes/dashboard/src/app/backend/resource/common"
	"github.com/kubernetes/dashboard/src/app/backend/resource/dataselect"
	"github.com/kubernetes/dashboard/src/app/backend/resource/dynamicresource"
)

// descriptor of the optional VerticalPodAutoscaler CRD. v1 is the current stable
// version; v1beta2 is tried as a fallback for older installs.
var descriptor = dynamicresource.Descriptor{
	Group:    "autoscaling.k8s.io",
	Versions: []string{"v1", "v1beta2"},
	Resource: "verticalpodautoscalers",
	Kind:     api.ResourceKindVerticalPodAutoscaler,
}

// VerticalPodAutoscalerList is a list of VPAs (object-meta only, like the other
// simple browsable resources).
type VerticalPodAutoscalerList = dynamicresource.List

// CrossVersionObjectReference identifies the workload a VPA targets.
type CrossVersionObjectReference struct {
	APIVersion string `json:"apiVersion,omitempty"`
	Kind       string `json:"kind,omitempty"`
	Name       string `json:"name,omitempty"`
}

// ContainerRecommendation is a VPA's computed recommendation for one container.
// Resource maps mirror the CRD (e.g. {"cpu":"250m","memory":"256Mi"}).
type ContainerRecommendation struct {
	ContainerName  string            `json:"containerName,omitempty"`
	Target         map[string]string `json:"target,omitempty"`
	LowerBound     map[string]string `json:"lowerBound,omitempty"`
	UpperBound     map[string]string `json:"upperBound,omitempty"`
	UncappedTarget map[string]string `json:"uncappedTarget,omitempty"`
}

// VerticalPodAutoscalerDetail is the projected detail of a single VPA.
type VerticalPodAutoscalerDetail struct {
	dynamicresource.Object `json:",inline"`
	TargetRef              *CrossVersionObjectReference `json:"targetRef,omitempty"`
	UpdateMode             string                       `json:"updateMode,omitempty"`
	Recommendations        []ContainerRecommendation    `json:"recommendations,omitempty"`
	Errors                 []error                      `json:"errors"`
}

// GetVerticalPodAutoscalerList lists VPAs from the given namespace. Returns an
// empty list when the VPA CRD is not installed.
func GetVerticalPodAutoscalerList(client dynamic.Interface, namespace *common.NamespaceQuery,
	dsQuery *dataselect.DataSelectQuery) (*VerticalPodAutoscalerList, error) {
	return dynamicresource.GetList(client, descriptor, namespace, dsQuery)
}

// GetVerticalPodAutoscalerDetail returns the projected detail of a single VPA.
func GetVerticalPodAutoscalerDetail(client dynamic.Interface, namespace, name string) (*VerticalPodAutoscalerDetail, error) {
	log.Printf("Getting details of %s vertical pod autoscaler in %s namespace", name, namespace)

	item, err := dynamicresource.GetObject(client, descriptor, namespace, name)
	if err != nil {
		return nil, err
	}

	return toDetail(item), nil
}

func toDetail(item *unstructured.Unstructured) *VerticalPodAutoscalerDetail {
	detail := &VerticalPodAutoscalerDetail{
		Object: dynamicresource.Object{
			ObjectMeta: api.NewObjectMeta(dynamicresource.ObjectMetaFromUnstructured(item)),
			TypeMeta:   api.NewTypeMeta(api.ResourceKindVerticalPodAutoscaler),
		},
	}

	var wrapper struct {
		Spec struct {
			TargetRef    *CrossVersionObjectReference `json:"targetRef"`
			UpdatePolicy struct {
				UpdateMode string `json:"updateMode"`
			} `json:"updatePolicy"`
		} `json:"spec"`
		Status struct {
			Recommendation struct {
				ContainerRecommendations []ContainerRecommendation `json:"containerRecommendations"`
			} `json:"recommendation"`
		} `json:"status"`
	}

	if err := runtime.DefaultUnstructuredConverter.FromUnstructured(item.Object, &wrapper); err == nil {
		detail.TargetRef = wrapper.Spec.TargetRef
		detail.UpdateMode = wrapper.Spec.UpdatePolicy.UpdateMode
		detail.Recommendations = wrapper.Status.Recommendation.ContainerRecommendations
	}

	return detail
}
