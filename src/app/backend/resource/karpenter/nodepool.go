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

// Package karpenter browses the optional Karpenter CRDs (karpenter.sh) —
// NodePool and NodeClaim — through the shared dynamic-CRD read path. A NodePool
// carries the actual cluster-autoscaling rules (limits, disruption policy), so
// it is the genuine node-scaling member of the Scaling group. Karpenter objects
// are CLUSTER-SCOPED and show up only when Karpenter is installed.
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

var nodePoolDescriptor = dynamicresource.Descriptor{
	Group:         "karpenter.sh",
	Versions:      []string{"v1", "v1beta1"},
	Resource:      "nodepools",
	Kind:          api.ResourceKindNodePool,
	ClusterScoped: true,
}

// NodePoolList is a list of Karpenter NodePools.
type NodePoolList = dynamicresource.List

// NodePoolDetail is the projected detail of a single NodePool — the cluster
// autoscaling rules (limits + disruption policy).
type NodePoolDetail struct {
	dynamicresource.Object `json:",inline"`
	Limits                 map[string]string `json:"limits,omitempty"`
	ConsolidationPolicy    string            `json:"consolidationPolicy,omitempty"`
	ConsolidateAfter       string            `json:"consolidateAfter,omitempty"`
	Weight                 *int32            `json:"weight,omitempty"`
	Errors                 []error           `json:"errors"`
}

// GetNodePoolList lists NodePools. Returns an empty list when Karpenter is not
// installed.
func GetNodePoolList(client dynamic.Interface, namespace *common.NamespaceQuery,
	dsQuery *dataselect.DataSelectQuery) (*NodePoolList, error) {
	return dynamicresource.GetList(client, nodePoolDescriptor, namespace, dsQuery)
}

// GetNodePoolDetail returns the projected detail of a NodePool.
func GetNodePoolDetail(client dynamic.Interface, namespace, name string) (*NodePoolDetail, error) {
	log.Printf("Getting details of %s node pool", name)

	item, err := dynamicresource.GetObject(client, nodePoolDescriptor, namespace, name)
	if err != nil {
		return nil, err
	}

	return toNodePoolDetail(item), nil
}

func toNodePoolDetail(item *unstructured.Unstructured) *NodePoolDetail {
	detail := &NodePoolDetail{
		Object: dynamicresource.Object{
			ObjectMeta: api.NewObjectMeta(dynamicresource.ObjectMetaFromUnstructured(item)),
			TypeMeta:   api.NewTypeMeta(api.ResourceKindNodePool),
		},
	}

	var wrapper struct {
		Spec struct {
			Limits     map[string]string `json:"limits"`
			Weight     *int32            `json:"weight"`
			Disruption struct {
				ConsolidationPolicy string `json:"consolidationPolicy"`
				ConsolidateAfter    string `json:"consolidateAfter"`
			} `json:"disruption"`
		} `json:"spec"`
	}

	if err := runtime.DefaultUnstructuredConverter.FromUnstructured(item.Object, &wrapper); err == nil {
		detail.Limits = wrapper.Spec.Limits
		detail.Weight = wrapper.Spec.Weight
		detail.ConsolidationPolicy = wrapper.Spec.Disruption.ConsolidationPolicy
		detail.ConsolidateAfter = wrapper.Spec.Disruption.ConsolidateAfter
	}

	return detail
}
