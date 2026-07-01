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

package capi

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

var machineSetDescriptor = dynamicresource.Descriptor{
	Group:    "cluster.x-k8s.io",
	Versions: []string{"v1beta1", "v1beta2"},
	Resource: "machinesets",
	Kind:     api.ResourceKindMachineSet,
}

// MachineSetList is a list of Cluster API MachineSets.
type MachineSetList = dynamicresource.List

// MachineSetDetail is the projected detail of a single MachineSet.
type MachineSetDetail struct {
	dynamicresource.Object `json:",inline"`
	ClusterName            string `json:"clusterName,omitempty"`
	Replicas               *int32 `json:"replicas,omitempty"`
	ReadyReplicas          int32  `json:"readyReplicas,omitempty"`
	AvailableReplicas      int32  `json:"availableReplicas,omitempty"`
	Errors                 []error `json:"errors"`
}

// GetMachineSetList lists MachineSets from the given namespace. Returns an empty
// list when the Cluster API CRDs are not installed.
func GetMachineSetList(client dynamic.Interface, namespace *common.NamespaceQuery,
	dsQuery *dataselect.DataSelectQuery) (*MachineSetList, error) {
	return dynamicresource.GetList(client, machineSetDescriptor, namespace, dsQuery)
}

// GetMachineSetDetail returns the projected detail of a MachineSet.
func GetMachineSetDetail(client dynamic.Interface, namespace, name string) (*MachineSetDetail, error) {
	log.Printf("Getting details of %s machine set in %s namespace", name, namespace)

	item, err := dynamicresource.GetObject(client, machineSetDescriptor, namespace, name)
	if err != nil {
		return nil, err
	}

	return toMachineSetDetail(item), nil
}

func toMachineSetDetail(item *unstructured.Unstructured) *MachineSetDetail {
	detail := &MachineSetDetail{
		Object: dynamicresource.Object{
			ObjectMeta: api.NewObjectMeta(dynamicresource.ObjectMetaFromUnstructured(item)),
			TypeMeta:   api.NewTypeMeta(api.ResourceKindMachineSet),
		},
	}

	var wrapper struct {
		Spec struct {
			Replicas    *int32 `json:"replicas"`
			ClusterName string `json:"clusterName"`
		} `json:"spec"`
		Status struct {
			ReadyReplicas     int32 `json:"readyReplicas"`
			AvailableReplicas int32 `json:"availableReplicas"`
		} `json:"status"`
	}

	if err := runtime.DefaultUnstructuredConverter.FromUnstructured(item.Object, &wrapper); err == nil {
		detail.Replicas = wrapper.Spec.Replicas
		detail.ClusterName = wrapper.Spec.ClusterName
		detail.ReadyReplicas = wrapper.Status.ReadyReplicas
		detail.AvailableReplicas = wrapper.Status.AvailableReplicas
	}

	return detail
}
