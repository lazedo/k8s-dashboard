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

package karpenter

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

var nodeClaimDescriptor = dynamicresource.Descriptor{
	Group:         "karpenter.sh",
	Versions:      []string{"v1", "v1beta1"},
	Resource:      "nodeclaims",
	Kind:          api.ResourceKindNodeClaim,
	ClusterScoped: true,
}

// NodeClaimList is a list of Karpenter NodeClaims (individual provisioned nodes).
type NodeClaimList = dynamicresource.List

// NodeClaimDetail is the projected detail of a single NodeClaim.
type NodeClaimDetail struct {
	dynamicresource.Object `json:",inline"`
	NodeName               string            `json:"nodeName,omitempty"`
	ProviderID             string            `json:"providerID,omitempty"`
	Capacity               map[string]string `json:"capacity,omitempty"`
	Errors                 []error           `json:"errors"`
}

// GetNodeClaimList lists NodeClaims. Returns an empty list when Karpenter is not
// installed.
func GetNodeClaimList(client dynamic.Interface, namespace *common.NamespaceQuery,
	dsQuery *dataselect.DataSelectQuery) (*NodeClaimList, error) {
	return dynamicresource.GetList(client, nodeClaimDescriptor, namespace, dsQuery)
}

// GetNodeClaimDetail returns the projected detail of a NodeClaim.
func GetNodeClaimDetail(client dynamic.Interface, namespace, name string) (*NodeClaimDetail, error) {
	log.Printf("Getting details of %s node claim", name)

	item, err := dynamicresource.GetObject(client, nodeClaimDescriptor, namespace, name)
	if err != nil {
		return nil, err
	}

	return toNodeClaimDetail(item), nil
}

func toNodeClaimDetail(item *unstructured.Unstructured) *NodeClaimDetail {
	detail := &NodeClaimDetail{
		Object: dynamicresource.Object{
			ObjectMeta: api.NewObjectMeta(dynamicresource.ObjectMetaFromUnstructured(item)),
			TypeMeta:   api.NewTypeMeta(api.ResourceKindNodeClaim),
		},
	}

	var wrapper struct {
		Status struct {
			NodeName   string            `json:"nodeName"`
			ProviderID string            `json:"providerID"`
			Capacity   map[string]string `json:"capacity"`
		} `json:"status"`
	}

	if err := runtime.DefaultUnstructuredConverter.FromUnstructured(item.Object, &wrapper); err == nil {
		detail.NodeName = wrapper.Status.NodeName
		detail.ProviderID = wrapper.Status.ProviderID
		detail.Capacity = wrapper.Status.Capacity
	}

	return detail
}
