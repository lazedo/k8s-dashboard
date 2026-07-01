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
	"k8s.io/apimachinery/pkg/util/intstr"
	client "k8s.io/client-go/kubernetes"

	"github.com/kubernetes/dashboard/src/app/backend/api"
	"github.com/kubernetes/dashboard/src/app/backend/errors"
	"github.com/kubernetes/dashboard/src/app/backend/resource/common"
	"github.com/kubernetes/dashboard/src/app/backend/resource/dataselect"
)

// PodDisruptionBudget is a presentation-layer view of a Kubernetes PodDisruptionBudget.
type PodDisruptionBudget struct {
	api.ObjectMeta `json:"objectMeta"`
	api.TypeMeta   `json:"typeMeta"`

	// MinAvailable / MaxUnavailable is the budget spec (only one is set).
	MinAvailable   *intstr.IntOrString `json:"minAvailable,omitempty"`
	MaxUnavailable *intstr.IntOrString `json:"maxUnavailable,omitempty"`

	// Status counters.
	CurrentHealthy     int32 `json:"currentHealthy"`
	DesiredHealthy     int32 `json:"desiredHealthy"`
	DisruptionsAllowed int32 `json:"disruptionsAllowed"`
	ExpectedPods       int32 `json:"expectedPods"`
}

// PodDisruptionBudgetList contains a list of PodDisruptionBudgets.
type PodDisruptionBudgetList struct {
	api.ListMeta `json:"listMeta"`
	Items        []PodDisruptionBudget `json:"items"`
	Errors       []error               `json:"errors"`
}

// GetPodDisruptionBudgetList returns a list of PodDisruptionBudgets in the given namespace.
func GetPodDisruptionBudgetList(client client.Interface, namespace *common.NamespaceQuery,
	dsQuery *dataselect.DataSelectQuery) (*PodDisruptionBudgetList, error) {
	list, err := client.PolicyV1().PodDisruptionBudgets(namespace.ToRequestParam()).List(context.TODO(),
		api.ListEverything)

	nonCriticalErrors, criticalError := errors.HandleError(err)
	if criticalError != nil {
		return nil, criticalError
	}

	return toPodDisruptionBudgetList(list.Items, nonCriticalErrors, dsQuery), nil
}

func toPodDisruptionBudget(pdb *policyv1.PodDisruptionBudget) PodDisruptionBudget {
	return PodDisruptionBudget{
		ObjectMeta:         api.NewObjectMeta(pdb.ObjectMeta),
		TypeMeta:           api.NewTypeMeta(api.ResourceKindPodDisruptionBudget),
		MinAvailable:       pdb.Spec.MinAvailable,
		MaxUnavailable:     pdb.Spec.MaxUnavailable,
		CurrentHealthy:     pdb.Status.CurrentHealthy,
		DesiredHealthy:     pdb.Status.DesiredHealthy,
		DisruptionsAllowed: pdb.Status.DisruptionsAllowed,
		ExpectedPods:       pdb.Status.ExpectedPods,
	}
}

func toPodDisruptionBudgetList(items []policyv1.PodDisruptionBudget, nonCriticalErrors []error,
	dsQuery *dataselect.DataSelectQuery) *PodDisruptionBudgetList {
	result := &PodDisruptionBudgetList{
		ListMeta: api.ListMeta{TotalItems: len(items)},
		Items:    make([]PodDisruptionBudget, 0),
		Errors:   nonCriticalErrors,
	}

	cells, filteredTotal := dataselect.GenericDataSelectWithFilter(toCells(items), dsQuery)
	items = fromCells(cells)
	result.ListMeta = api.ListMeta{TotalItems: filteredTotal}

	for i := range items {
		result.Items = append(result.Items, toPodDisruptionBudget(&items[i]))
	}

	return result
}
