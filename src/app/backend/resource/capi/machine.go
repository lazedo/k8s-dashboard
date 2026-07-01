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

var machineDescriptor = dynamicresource.Descriptor{
	Group:    "cluster.x-k8s.io",
	Versions: []string{"v1beta1", "v1beta2"},
	Resource: "machines",
	Kind:     api.ResourceKindMachine,
}

// MachineList is a list of Cluster API Machines (individual nodes).
type MachineList = dynamicresource.List

// MachineDetail is the projected detail of a single Machine.
type MachineDetail struct {
	dynamicresource.Object `json:",inline"`
	ClusterName            string `json:"clusterName,omitempty"`
	Version                string `json:"version,omitempty"`
	ProviderID             string `json:"providerID,omitempty"`
	Phase                  string `json:"phase,omitempty"`
	NodeName               string `json:"nodeName,omitempty"`
	Errors                 []error `json:"errors"`
}

// GetMachineList lists Machines from the given namespace. Returns an empty list
// when the Cluster API CRDs are not installed.
func GetMachineList(client dynamic.Interface, namespace *common.NamespaceQuery,
	dsQuery *dataselect.DataSelectQuery) (*MachineList, error) {
	return dynamicresource.GetList(client, machineDescriptor, namespace, dsQuery)
}

// GetMachineDetail returns the projected detail of a Machine.
func GetMachineDetail(client dynamic.Interface, namespace, name string) (*MachineDetail, error) {
	log.Printf("Getting details of %s machine in %s namespace", name, namespace)

	item, err := dynamicresource.GetObject(client, machineDescriptor, namespace, name)
	if err != nil {
		return nil, err
	}

	return toMachineDetail(item), nil
}

func toMachineDetail(item *unstructured.Unstructured) *MachineDetail {
	detail := &MachineDetail{
		Object: dynamicresource.Object{
			ObjectMeta: api.NewObjectMeta(dynamicresource.ObjectMetaFromUnstructured(item)),
			TypeMeta:   api.NewTypeMeta(api.ResourceKindMachine),
		},
	}

	var wrapper struct {
		Spec struct {
			ClusterName string  `json:"clusterName"`
			Version     *string `json:"version"`
			ProviderID  *string `json:"providerID"`
		} `json:"spec"`
		Status struct {
			Phase   string `json:"phase"`
			NodeRef *struct {
				Name string `json:"name"`
			} `json:"nodeRef"`
		} `json:"status"`
	}

	if err := runtime.DefaultUnstructuredConverter.FromUnstructured(item.Object, &wrapper); err == nil {
		detail.ClusterName = wrapper.Spec.ClusterName
		if wrapper.Spec.Version != nil {
			detail.Version = *wrapper.Spec.Version
		}
		if wrapper.Spec.ProviderID != nil {
			detail.ProviderID = *wrapper.Spec.ProviderID
		}
		detail.Phase = wrapper.Status.Phase
		if wrapper.Status.NodeRef != nil {
			detail.NodeName = wrapper.Status.NodeRef.Name
		}
	}

	return detail
}
