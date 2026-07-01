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

// Package dynamicresource is the shared read path for OPTIONAL CRD-backed
// resources that are browsed through the dynamic client, so no second generated
// clientset is needed. A resource is described by its GroupVersionResource(s)
// and kind; if the CRD is not installed the list degrades to empty instead of
// surfacing an error. It backs the VerticalPodAutoscaler resource today and is
// meant to back KEDA (ScaledObject/ScaledJob) next with only a new Descriptor.
package dynamicresource

import (
	"context"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"

	"github.com/kubernetes/dashboard/src/app/backend/api"
	"github.com/kubernetes/dashboard/src/app/backend/errors"
	"github.com/kubernetes/dashboard/src/app/backend/resource/common"
	"github.com/kubernetes/dashboard/src/app/backend/resource/dataselect"
)

// Descriptor describes an optional CRD-backed resource read through the dynamic
// client. Versions are tried in order, so a resource can be served by whichever
// API version the cluster has installed (e.g. VPA v1, falling back to v1beta2).
// ClusterScoped resources (e.g. Karpenter NodePool) are read without a namespace.
type Descriptor struct {
	Group         string
	Versions      []string
	Resource      string
	Kind          api.ResourceKind
	ClusterScoped bool
}

// Object is an object-meta-only list item, matching the shape of the simple
// browsable resources; a resource's detail handler projects its own spec.
type Object struct {
	api.ObjectMeta `json:"objectMeta"`
	api.TypeMeta   `json:"typeMeta"`
}

// List is a generic list of dynamic-CRD objects.
type List struct {
	api.ListMeta `json:"listMeta"`
	Items        []Object `json:"items"`
	Errors       []error  `json:"errors"`
}

// GetList lists items of an optional CRD. If no version of the CRD is served
// (i.e. it is not installed) it returns an empty list rather than an error, so
// the nav entry is simply empty instead of surfacing a 500.
func GetList(client dynamic.Interface, desc Descriptor, namespace *common.NamespaceQuery,
	dsQuery *dataselect.DataSelectQuery) (*List, error) {
	raw, err := listAnyVersion(client, desc, namespace)
	if err != nil {
		if isNotInstalled(err) {
			return toList(nil, nil, desc, dsQuery), nil
		}

		nonCriticalErrors, criticalError := errors.HandleError(err)
		if criticalError != nil {
			return nil, criticalError
		}
		return toList(nil, nonCriticalErrors, desc, dsQuery), nil
	}

	return toList(raw.Items, nil, desc, dsQuery), nil
}

// GetObject fetches a single item of an optional CRD, trying each served version.
func GetObject(client dynamic.Interface, desc Descriptor, namespace, name string) (*unstructured.Unstructured, error) {
	var lastErr error
	for _, version := range desc.Versions {
		item, err := resourceInterface(client, desc, version, namespace).Get(context.TODO(), name, metav1.GetOptions{})
		if err == nil {
			return item, nil
		}
		lastErr = err
		// A NotFound here can mean the version is not served; try the next one.
		// Any other error (RBAC, timeout) is real and must not be masked.
		if !isNotInstalled(err) {
			return nil, err
		}
	}
	return nil, lastErr
}

func listAnyVersion(client dynamic.Interface, desc Descriptor,
	namespace *common.NamespaceQuery) (*unstructured.UnstructuredList, error) {
	var lastErr error
	for _, version := range desc.Versions {
		list, err := resourceInterface(client, desc, version, namespace.ToRequestParam()).
			List(context.TODO(), metav1.ListOptions{})
		if err == nil {
			return list, nil
		}
		lastErr = err
		// A NotFound means this version is not served; try the next one. Any
		// other error (RBAC, timeout) is real and must not be masked by fallback.
		if !isNotInstalled(err) {
			return nil, err
		}
	}
	return nil, lastErr
}

// resourceInterface returns the dynamic client scoped correctly: cluster-scoped
// resources are addressed without a namespace, namespaced ones with the given
// namespace ("" = all namespaces).
func resourceInterface(client dynamic.Interface, desc Descriptor, version, namespace string) dynamic.ResourceInterface {
	resource := client.Resource(gvr(desc, version))
	if desc.ClusterScoped {
		return resource
	}
	return resource.Namespace(namespace)
}

func gvr(desc Descriptor, version string) schema.GroupVersionResource {
	return schema.GroupVersionResource{Group: desc.Group, Version: version, Resource: desc.Resource}
}

// isNotInstalled reports whether the error means the CRD/version is not served.
// The dynamic client builds the request path directly, so an unknown resource
// or version comes back as a 404 (NotFound).
func isNotInstalled(err error) bool {
	return apierrors.IsNotFound(err)
}

func toList(items []unstructured.Unstructured, nonCriticalErrors []error, desc Descriptor,
	dsQuery *dataselect.DataSelectQuery) *List {
	result := &List{
		ListMeta: api.ListMeta{TotalItems: len(items)},
		Items:    make([]Object, 0),
		Errors:   nonCriticalErrors,
	}

	cells, filteredTotal := dataselect.GenericDataSelectWithFilter(toCells(items), dsQuery)
	result.ListMeta = api.ListMeta{TotalItems: filteredTotal}

	for _, cell := range cells {
		item := cell.(objectCell).Unstructured
		result.Items = append(result.Items, Object{
			ObjectMeta: api.NewObjectMeta(ObjectMetaFromUnstructured(&item)),
			TypeMeta:   api.NewTypeMeta(desc.Kind),
		})
	}

	return result
}

// ObjectMetaFromUnstructured extracts the ObjectMeta fields the dashboard renders
// from an unstructured object (namespaced resources include the namespace).
func ObjectMetaFromUnstructured(item *unstructured.Unstructured) metav1.ObjectMeta {
	return metav1.ObjectMeta{
		Name:              item.GetName(),
		Namespace:         item.GetNamespace(),
		CreationTimestamp: item.GetCreationTimestamp(),
		Labels:            item.GetLabels(),
		Annotations:       item.GetAnnotations(),
		UID:               item.GetUID(),
	}
}

type objectCell struct {
	unstructured.Unstructured
}

func (self objectCell) GetProperty(name dataselect.PropertyName) dataselect.ComparableValue {
	switch name {
	case dataselect.NameProperty:
		return dataselect.StdComparableString(self.GetName())
	case dataselect.CreationTimestampProperty:
		return dataselect.StdComparableTime(self.GetCreationTimestamp().Time)
	case dataselect.NamespaceProperty:
		return dataselect.StdComparableString(self.GetNamespace())
	default:
		return nil
	}
}

func toCells(items []unstructured.Unstructured) []dataselect.DataCell {
	cells := make([]dataselect.DataCell, len(items))
	for i := range items {
		cells[i] = objectCell{items[i]}
	}
	return cells
}
