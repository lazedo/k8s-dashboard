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

package deployment

import (
	"github.com/kubernetes/dashboard/src/app/backend/api"
	metricapi "github.com/kubernetes/dashboard/src/app/backend/integration/metric/api"
	"github.com/kubernetes/dashboard/src/app/backend/resource/common"
	"github.com/kubernetes/dashboard/src/app/backend/resource/dataselect"
	"github.com/kubernetes/dashboard/src/app/backend/resource/event"
	apps "k8s.io/api/apps/v1"
	v1 "k8s.io/api/core/v1"
)

// The code below allows to perform complex data section on Deployment

// DeploymentCell wraps a Deployment together with its computed status
// (Running/Pending/Failed) so that dataselect can filter the list by the same
// status categories shown in the Workload Status chart.
type DeploymentCell struct {
	apps.Deployment
	status string
}

// GetProperty is used to get property of the deployment
func (self DeploymentCell) GetProperty(name dataselect.PropertyName) dataselect.ComparableValue {
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
		// if name is not supported then just return a constant dummy value, sort will have no effect.
		return nil
	}
}

func (self DeploymentCell) GetResourceSelector() *metricapi.ResourceSelector {
	return &metricapi.ResourceSelector{
		Namespace:    self.ObjectMeta.Namespace,
		ResourceType: api.ResourceKindDeployment,
		ResourceName: self.ObjectMeta.Name,
		Selector:     self.Spec.Selector.MatchLabels,
		UID:          self.UID,
	}
}

// deploymentStatus returns the status category (Running/Pending/Failed) of a
// single Deployment, matching the categorization used by the Workload Status
// chart in getStatus.
func deploymentStatus(deployment apps.Deployment, rs []apps.ReplicaSet, pods []v1.Pod, events []v1.Event) string {
	matchingPods := common.FilterDeploymentPodsByOwnerReference(deployment, rs, pods)
	podInfo := common.GetPodInfo(deployment.Status.Replicas, deployment.Spec.Replicas, matchingPods)
	warnings := event.GetPodsEventWarnings(events, matchingPods)

	if len(warnings) > 0 {
		return "Failed"
	} else if podInfo.Pending > 0 {
		return "Pending"
	}
	return "Running"
}

func toCells(std []apps.Deployment, rs []apps.ReplicaSet, pods []v1.Pod, events []v1.Event) []dataselect.DataCell {
	cells := make([]dataselect.DataCell, len(std))
	for i := range std {
		cells[i] = DeploymentCell{
			Deployment: std[i],
			status:     deploymentStatus(std[i], rs, pods, events),
		}
	}
	return cells
}

func fromCells(cells []dataselect.DataCell) []apps.Deployment {
	std := make([]apps.Deployment, len(cells))
	for i := range std {
		std[i] = cells[i].(DeploymentCell).Deployment
	}
	return std
}

func getStatus(list *apps.DeploymentList, rs []apps.ReplicaSet, pods []v1.Pod, events []v1.Event) common.ResourceStatus {
	info := common.ResourceStatus{}
	if list == nil {
		return info
	}

	for _, deployment := range list.Items {
		switch deploymentStatus(deployment, rs, pods, events) {
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

func getConditions(deploymentConditions []apps.DeploymentCondition) []common.Condition {
	conditions := make([]common.Condition, 0)

	for _, condition := range deploymentConditions {
		conditions = append(conditions, common.Condition{
			Type:               string(condition.Type),
			Status:             condition.Status,
			Reason:             condition.Reason,
			Message:            condition.Message,
			LastTransitionTime: condition.LastTransitionTime,
			LastProbeTime:      condition.LastUpdateTime,
		})
	}

	return conditions
}
