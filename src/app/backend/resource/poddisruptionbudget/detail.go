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

package poddisruptionbudget

import (
	"context"

	policyv1 "k8s.io/api/policy/v1"
	metaV1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	client "k8s.io/client-go/kubernetes"
)

// PodDisruptionBudgetDetail contains detailed information about a PodDisruptionBudget.
type PodDisruptionBudgetDetail struct {
	PodDisruptionBudget `json:",inline"`

	// Selector matches the pods governed by this budget.
	Selector *metaV1.LabelSelector `json:"selector,omitempty"`

	// UnhealthyPodEvictionPolicy controls eviction of unhealthy pods.
	UnhealthyPodEvictionPolicy *policyv1.UnhealthyPodEvictionPolicyType `json:"unhealthyPodEvictionPolicy,omitempty"`

	// DisruptedPods maps a pod name to the time its eviction was requested.
	DisruptedPods map[string]metaV1.Time `json:"disruptedPods,omitempty"`

	// Conditions is the list of status conditions.
	Conditions []metaV1.Condition `json:"conditions,omitempty"`

	Errors []error `json:"errors"`
}

// GetPodDisruptionBudgetDetail returns detailed information about a PodDisruptionBudget.
func GetPodDisruptionBudgetDetail(client client.Interface, namespace, name string) (*PodDisruptionBudgetDetail, error) {
	raw, err := client.PolicyV1().PodDisruptionBudgets(namespace).Get(context.TODO(), name, metaV1.GetOptions{})
	if err != nil {
		return nil, err
	}

	return getPodDisruptionBudgetDetail(raw), nil
}

func getPodDisruptionBudgetDetail(pdb *policyv1.PodDisruptionBudget) *PodDisruptionBudgetDetail {
	return &PodDisruptionBudgetDetail{
		PodDisruptionBudget:        toPodDisruptionBudget(pdb),
		Selector:                   pdb.Spec.Selector,
		UnhealthyPodEvictionPolicy: pdb.Spec.UnhealthyPodEvictionPolicy,
		DisruptedPods:              pdb.Status.DisruptedPods,
		Conditions:                 pdb.Status.Conditions,
		Errors:                     []error{},
	}
}
