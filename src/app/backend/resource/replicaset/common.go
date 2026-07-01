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

package replicaset

import (
	"github.com/kubernetes/dashboard/src/app/backend/api"
	metricapi "github.com/kubernetes/dashboard/src/app/backend/integration/metric/api"
	"github.com/kubernetes/dashboard/src/app/backend/resource/common"
	"github.com/kubernetes/dashboard/src/app/backend/resource/dataselect"
	"github.com/kubernetes/dashboard/src/app/backend/resource/event"
	apps "k8s.io/api/apps/v1"
	v1 "k8s.io/api/core/v1"
)

// The code below allows to perform complex data section on Replica Set

// ReplicaSetCell wraps a ReplicaSet together with its computed status
// (Running/Pending/Failed) so that dataselect can filter the list by the same
// status categories shown in the Workload Status chart.
type ReplicaSetCell struct {
	apps.ReplicaSet
	status string
}

func (self ReplicaSetCell) GetProperty(name dataselect.PropertyName) dataselect.ComparableValue {
	switch name {
	case dataselect.NameProperty:
		return dataselect.StdComparableString(self.ObjectMeta.Name)
	case dataselect.StatusProperty:
		return dataselect.StdComparableString(self.status)
	case dataselect.CreationTimestampProperty:
		return dataselect.StdComparableTime(self.ObjectMeta.CreationTimestamp.Time)
	case dataselect.NamespaceProperty:
		return dataselect.StdComparableString(self.ObjectMeta.Namespace)
	default:
		return nil
	}
}

func (self ReplicaSetCell) GetResourceSelector() *metricapi.ResourceSelector {
	return &metricapi.ResourceSelector{
		Namespace:    self.ObjectMeta.Namespace,
		ResourceType: api.ResourceKindReplicaSet,
		ResourceName: self.ObjectMeta.Name,
		UID:          self.UID,
	}
}

// replicaSetStatus returns the status category (Running/Pending/Failed) of a
// single ReplicaSet, matching the categorization used by the Workload Status
// chart in getStatus.
func replicaSetStatus(rs apps.ReplicaSet, pods []v1.Pod, events []v1.Event) string {
	matchingPods := common.FilterPodsByControllerRef(&rs, pods)
	podInfo := common.GetPodInfo(rs.Status.Replicas, rs.Spec.Replicas, matchingPods)
	warnings := event.GetPodsEventWarnings(events, matchingPods)

	if len(warnings) > 0 {
		return "Failed"
	} else if podInfo.Pending > 0 {
		return "Pending"
	}
	return "Running"
}

func ToCells(std []apps.ReplicaSet, pods []v1.Pod, events []v1.Event) []dataselect.DataCell {
	cells := make([]dataselect.DataCell, len(std))
	for i := range std {
		cells[i] = ReplicaSetCell{
			ReplicaSet: std[i],
			status:     replicaSetStatus(std[i], pods, events),
		}
	}
	return cells
}

func FromCells(cells []dataselect.DataCell) []apps.ReplicaSet {
	std := make([]apps.ReplicaSet, len(cells))
	for i := range std {
		std[i] = cells[i].(ReplicaSetCell).ReplicaSet
	}
	return std
}

func getStatus(list *apps.ReplicaSetList, pods []v1.Pod, events []v1.Event) common.ResourceStatus {
	info := common.ResourceStatus{}
	if list == nil {
		return info
	}

	for _, rs := range list.Items {
		switch replicaSetStatus(rs, pods, events) {
		case "Failed":
			info.Failed++
		case "Pending":
			info.Pending++
		default:
			info.Running++
		}
	}

	return info
}
