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

package cronjob

import (
	batch "k8s.io/api/batch/v1"

	"github.com/kubernetes/dashboard/src/app/backend/api"
	metricapi "github.com/kubernetes/dashboard/src/app/backend/integration/metric/api"
	"github.com/kubernetes/dashboard/src/app/backend/resource/common"
	"github.com/kubernetes/dashboard/src/app/backend/resource/dataselect"
)

// The code below allows to perform complex data section on []batch.CronJob

// CronJobCell wraps a CronJob together with its computed status
// (Running/Suspended) so that dataselect can filter the list by the same
// status categories shown in the Workload Status chart.
type CronJobCell struct {
	batch.CronJob
	status string
}

func (self CronJobCell) GetProperty(name dataselect.PropertyName) dataselect.ComparableValue {
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

func (self CronJobCell) GetResourceSelector() *metricapi.ResourceSelector {
	return &metricapi.ResourceSelector{
		Namespace:    self.ObjectMeta.Namespace,
		ResourceType: api.ResourceKindCronJob,
		ResourceName: self.ObjectMeta.Name,
		UID:          self.UID,
	}
}

// cronJobStatus returns the status category (Running/Suspended) of a single
// CronJob, matching the categorization used by the Workload Status chart in
// getStatus.
func cronJobStatus(cronJob batch.CronJob) string {
	if cronJob.Spec.Suspend != nil && !(*cronJob.Spec.Suspend) {
		return "Running"
	}
	return "Suspended"
}

func ToCells(std []batch.CronJob) []dataselect.DataCell {
	cells := make([]dataselect.DataCell, len(std))
	for i := range std {
		cells[i] = CronJobCell{
			CronJob: std[i],
			status:  cronJobStatus(std[i]),
		}
	}
	return cells
}

func FromCells(cells []dataselect.DataCell) []batch.CronJob {
	std := make([]batch.CronJob, len(cells))
	for i := range std {
		std[i] = cells[i].(CronJobCell).CronJob
	}
	return std
}

func getStatus(list *batch.CronJobList) common.ResourceStatus {
	info := common.ResourceStatus{}
	if list == nil {
		return info
	}

	for _, cronJob := range list.Items {
		if cronJobStatus(cronJob) == "Running" {
			info.Running++
		} else {
			info.Failed++
		}
	}

	return info
}

func getContainerImages(cronJob *batch.CronJob) []string {
	podSpec := cronJob.Spec.JobTemplate.Spec.Template.Spec
	result := make([]string, 0)

	for _, container := range podSpec.Containers {
		result = append(result, container.Image)
	}

	return result
}
