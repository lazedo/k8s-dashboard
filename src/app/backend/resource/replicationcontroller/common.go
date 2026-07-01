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

package replicationcontroller

import (
	"context"

	"github.com/kubernetes/dashboard/src/app/backend/api"
	metricapi "github.com/kubernetes/dashboard/src/app/backend/integration/metric/api"
	"github.com/kubernetes/dashboard/src/app/backend/resource/common"
	"github.com/kubernetes/dashboard/src/app/backend/resource/dataselect"
	"github.com/kubernetes/dashboard/src/app/backend/resource/event"
	v1 "k8s.io/api/core/v1"
	metaV1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/fields"
	"k8s.io/apimachinery/pkg/labels"
	client "k8s.io/client-go/kubernetes"
)

// Transforms simple selector map to labels.Selector object that can be used when querying for
// object.
func toLabelSelector(selector map[string]string) (labels.Selector, error) {
	labelSelector, err := metaV1.LabelSelectorAsSelector(&metaV1.LabelSelector{MatchLabels: selector})

	if err != nil {
		return nil, err
	}

	return labelSelector, nil
}

// Based on given selector returns list of services that are candidates for deletion.
// Services are matched by replication controllers' label selector. They are deleted if given
// label selector is targeting only 1 replication controller.
func getServicesForDeletion(client client.Interface, labelSelector labels.Selector,
	namespace string) ([]v1.Service, error) {

	replicationControllers, err := client.CoreV1().ReplicationControllers(namespace).List(context.TODO(), metaV1.ListOptions{
		LabelSelector: labelSelector.String(),
		FieldSelector: fields.Everything().String(),
	})
	if err != nil {
		return nil, err
	}

	// if label selector is targeting only 1 replication controller
	// then we can delete services targeted by this label selector,
	// otherwise we can not delete any services so just return empty list
	if len(replicationControllers.Items) != 1 {
		return []v1.Service{}, nil
	}

	services, err := client.CoreV1().Services(namespace).List(context.TODO(), metaV1.ListOptions{
		LabelSelector: labelSelector.String(),
		FieldSelector: fields.Everything().String(),
	})
	if err != nil {
		return nil, err
	}

	return services.Items, nil
}

// ToReplicationController converts replication controller api object to replication controller
// model object.
func ToReplicationController(replicationController *v1.ReplicationController,
	podInfo *common.PodInfo) ReplicationController {

	return ReplicationController{
		ObjectMeta:          api.NewObjectMeta(replicationController.ObjectMeta),
		TypeMeta:            api.NewTypeMeta(api.ResourceKindReplicationController),
		Pods:                *podInfo,
		ContainerImages:     common.GetContainerImages(&replicationController.Spec.Template.Spec),
		InitContainerImages: common.GetInitContainerImages(&replicationController.Spec.Template.Spec),
	}
}

// The code below allows to perform complex data section on []api.ReplicationController

// ReplicationControllerCell wraps a ReplicationController together with its
// computed status (Running/Pending/Failed) so that dataselect can filter the
// list by the same status categories shown in the Workload Status chart.
type ReplicationControllerCell struct {
	v1.ReplicationController
	status string
}

func (self ReplicationControllerCell) GetProperty(name dataselect.PropertyName) dataselect.ComparableValue {
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
func (self ReplicationControllerCell) GetResourceSelector() *metricapi.ResourceSelector {
	return &metricapi.ResourceSelector{
		Namespace:    self.ObjectMeta.Namespace,
		ResourceType: api.ResourceKindReplicationController,
		ResourceName: self.ObjectMeta.Name,
		UID:          self.UID,
	}
}

// replicationControllerStatus returns the status category (Running/Pending/Failed)
// of a single ReplicationController, matching the categorization used by the
// Workload Status chart in getStatus.
func replicationControllerStatus(rc v1.ReplicationController, pods []v1.Pod, events []v1.Event) string {
	matchingPods := common.FilterPodsByControllerRef(&rc, pods)
	podInfo := common.GetPodInfo(rc.Status.Replicas, rc.Spec.Replicas, matchingPods)
	warnings := event.GetPodsEventWarnings(events, matchingPods)

	if len(warnings) > 0 {
		return "Failed"
	} else if podInfo.Pending > 0 {
		return "Pending"
	}
	return "Running"
}

func toCells(std []v1.ReplicationController, pods []v1.Pod, events []v1.Event) []dataselect.DataCell {
	cells := make([]dataselect.DataCell, len(std))
	for i := range std {
		cells[i] = ReplicationControllerCell{
			ReplicationController: std[i],
			status:                replicationControllerStatus(std[i], pods, events),
		}
	}
	return cells
}

func fromCells(cells []dataselect.DataCell) []v1.ReplicationController {
	std := make([]v1.ReplicationController, len(cells))
	for i := range std {
		std[i] = cells[i].(ReplicationControllerCell).ReplicationController
	}
	return std
}

func getStatus(list *v1.ReplicationControllerList, pods []v1.Pod, events []v1.Event) common.ResourceStatus {
	info := common.ResourceStatus{}
	if list == nil {
		return info
	}

	for _, rc := range list.Items {
		switch replicationControllerStatus(rc, pods, events) {
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
