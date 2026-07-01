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

package keda

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

var scaledObjectDescriptor = dynamicresource.Descriptor{
	Group:    "keda.sh",
	Versions: []string{"v1alpha1"},
	Resource: "scaledobjects",
	Kind:     api.ResourceKindScaledObject,
}

// ScaledObjectList is a list of KEDA ScaledObjects (object-meta only).
type ScaledObjectList = dynamicresource.List

// ScaledObjectDetail is the projected detail of a single ScaledObject.
type ScaledObjectDetail struct {
	dynamicresource.Object `json:",inline"`
	ScaleTargetRef         *ScaleTargetRef `json:"scaleTargetRef,omitempty"`
	MinReplicaCount        *int32          `json:"minReplicaCount,omitempty"`
	MaxReplicaCount        *int32          `json:"maxReplicaCount,omitempty"`
	Triggers               []Trigger       `json:"triggers,omitempty"`
	Errors                 []error         `json:"errors"`
}

// GetScaledObjectList lists ScaledObjects from the given namespace. Returns an
// empty list when the KEDA CRDs are not installed.
func GetScaledObjectList(client dynamic.Interface, namespace *common.NamespaceQuery,
	dsQuery *dataselect.DataSelectQuery) (*ScaledObjectList, error) {
	return dynamicresource.GetList(client, scaledObjectDescriptor, namespace, dsQuery)
}

// GetScaledObjectDetail returns the projected detail of a single ScaledObject.
func GetScaledObjectDetail(client dynamic.Interface, namespace, name string) (*ScaledObjectDetail, error) {
	log.Printf("Getting details of %s scaled object in %s namespace", name, namespace)

	item, err := dynamicresource.GetObject(client, scaledObjectDescriptor, namespace, name)
	if err != nil {
		return nil, err
	}

	return toScaledObjectDetail(item), nil
}

func toScaledObjectDetail(item *unstructured.Unstructured) *ScaledObjectDetail {
	detail := &ScaledObjectDetail{
		Object: dynamicresource.Object{
			ObjectMeta: api.NewObjectMeta(dynamicresource.ObjectMetaFromUnstructured(item)),
			TypeMeta:   api.NewTypeMeta(api.ResourceKindScaledObject),
		},
	}

	var wrapper struct {
		Spec struct {
			ScaleTargetRef  *ScaleTargetRef `json:"scaleTargetRef"`
			MinReplicaCount *int32          `json:"minReplicaCount"`
			MaxReplicaCount *int32          `json:"maxReplicaCount"`
			Triggers        []Trigger       `json:"triggers"`
		} `json:"spec"`
	}

	if err := runtime.DefaultUnstructuredConverter.FromUnstructured(item.Object, &wrapper); err == nil {
		detail.ScaleTargetRef = wrapper.Spec.ScaleTargetRef
		detail.MinReplicaCount = wrapper.Spec.MinReplicaCount
		detail.MaxReplicaCount = wrapper.Spec.MaxReplicaCount
		detail.Triggers = wrapper.Spec.Triggers
	}

	return detail
}
