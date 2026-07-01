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

// Package capi browses the optional Cluster API CRDs (cluster.x-k8s.io) —
// MachineDeployment, MachineSet and Machine — through the shared dynamic-CRD
// read path. These are the node-lifecycle objects a Cluster Autoscaler scales
// (it adjusts a MachineDeployment's replicas within min/max annotations), so
// they form the node-scaling ("Cluster") members of the Scaling group. They
// show up only when Cluster API is installed and need no generated clientset.
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

var machineDeploymentDescriptor = dynamicresource.Descriptor{
	Group:    "cluster.x-k8s.io",
	Versions: []string{"v1beta1", "v1beta2"},
	Resource: "machinedeployments",
	Kind:     api.ResourceKindMachineDeployment,
}

// MachineDeploymentList is a list of Cluster API MachineDeployments.
type MachineDeploymentList = dynamicresource.List

// MachineDeploymentDetail is the projected detail of a single MachineDeployment.
type MachineDeploymentDetail struct {
	dynamicresource.Object `json:",inline"`
	ClusterName            string `json:"clusterName,omitempty"`
	Replicas               *int32 `json:"replicas,omitempty"`
	ReadyReplicas          int32  `json:"readyReplicas,omitempty"`
	UpdatedReplicas        int32  `json:"updatedReplicas,omitempty"`
	Phase                  string `json:"phase,omitempty"`
	Errors                 []error `json:"errors"`
}

// GetMachineDeploymentList lists MachineDeployments from the given namespace.
// Returns an empty list when the Cluster API CRDs are not installed.
func GetMachineDeploymentList(client dynamic.Interface, namespace *common.NamespaceQuery,
	dsQuery *dataselect.DataSelectQuery) (*MachineDeploymentList, error) {
	return dynamicresource.GetList(client, machineDeploymentDescriptor, namespace, dsQuery)
}

// GetMachineDeploymentDetail returns the projected detail of a MachineDeployment.
func GetMachineDeploymentDetail(client dynamic.Interface, namespace, name string) (*MachineDeploymentDetail, error) {
	log.Printf("Getting details of %s machine deployment in %s namespace", name, namespace)

	item, err := dynamicresource.GetObject(client, machineDeploymentDescriptor, namespace, name)
	if err != nil {
		return nil, err
	}

	return toMachineDeploymentDetail(item), nil
}

func toMachineDeploymentDetail(item *unstructured.Unstructured) *MachineDeploymentDetail {
	detail := &MachineDeploymentDetail{
		Object: dynamicresource.Object{
			ObjectMeta: api.NewObjectMeta(dynamicresource.ObjectMetaFromUnstructured(item)),
			TypeMeta:   api.NewTypeMeta(api.ResourceKindMachineDeployment),
		},
	}

	var wrapper struct {
		Spec struct {
			Replicas    *int32 `json:"replicas"`
			ClusterName string `json:"clusterName"`
		} `json:"spec"`
		Status struct {
			ReadyReplicas   int32  `json:"readyReplicas"`
			UpdatedReplicas int32  `json:"updatedReplicas"`
			Phase           string `json:"phase"`
		} `json:"status"`
	}

	if err := runtime.DefaultUnstructuredConverter.FromUnstructured(item.Object, &wrapper); err == nil {
		detail.Replicas = wrapper.Spec.Replicas
		detail.ClusterName = wrapper.Spec.ClusterName
		detail.ReadyReplicas = wrapper.Status.ReadyReplicas
		detail.UpdatedReplicas = wrapper.Status.UpdatedReplicas
		detail.Phase = wrapper.Status.Phase
	}

	return detail
}
