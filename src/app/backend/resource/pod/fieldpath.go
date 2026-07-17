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

// -----------------------------------
// ADAPTED FROM: k8s.io/kubernetes/pkg/fieldpath/fieldpath.go and
// k8s.io/kubernetes/pkg/kubelet/kubelet_pods.go (podFieldSelectorRuntimeValue)
// to resolve downward API fieldRef values the same way the kubelet does.
// -----------------------------------

package pod

import (
	"fmt"
	"strings"

	v1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/meta"
)

// FormatMap formats map[string]string to a string.
func FormatMap(m map[string]string) (fmtStr string) {
	for key, value := range m {
		fmtStr += fmt.Sprintf("%v=%q\n", key, value)
	}
	fmtStr = strings.TrimSuffix(fmtStr, "\n")

	return
}

// SplitMaybeSubscriptedPath checks whether the specified fieldPath is
// subscripted, and
//   - if yes, this function splits the fieldPath into path and subscript, and
//     returns (path, subscript, true).
//   - if no, this function returns (fieldPath, "", false).
//
// Example inputs and outputs:
//   - "metadata.annotations['myKey']" --> ("metadata.annotations", "myKey", true)
//   - "metadata.annotations['a[b]c']" --> ("metadata.annotations", "a[b]c", true)
//   - "metadata.labels['key']"        --> ("metadata.labels", "key", true)
//   - "metadata.labels"               --> ("metadata.labels", "", false)
func SplitMaybeSubscriptedPath(fieldPath string) (string, string, bool) {
	if !strings.HasSuffix(fieldPath, "']") {
		return fieldPath, "", false
	}
	s := strings.TrimSuffix(fieldPath, "']")
	parts := strings.SplitN(s, "['", 2)
	if len(parts) < 2 {
		return fieldPath, "", false
	}
	if len(parts[0]) == 0 {
		return fieldPath, "", false
	}
	return parts[0], parts[1], true
}

// ExtractFieldPathAsString extracts the field from the given object
// and returns it as a string.  The object must be a pointer to an
// API type.
func ExtractFieldPathAsString(obj interface{}, fieldPath string) (string, error) {
	accessor, err := meta.Accessor(obj)
	if err != nil {
		return "", err
	}

	if path, subscript, ok := SplitMaybeSubscriptedPath(fieldPath); ok {
		switch path {
		case "metadata.annotations":
			value, ok := accessor.GetAnnotations()[subscript]
			if !ok {
				return "", fmt.Errorf("annotation %q not found", subscript)
			}
			return value, nil
		case "metadata.labels":
			value, ok := accessor.GetLabels()[subscript]
			if !ok {
				return "", fmt.Errorf("label %q not found", subscript)
			}
			return value, nil
		default:
			return "", fmt.Errorf("fieldPath %q does not support subscript", fieldPath)
		}
	}

	switch fieldPath {
	case "metadata.annotations":
		return FormatMap(accessor.GetAnnotations()), nil
	case "metadata.labels":
		return FormatMap(accessor.GetLabels()), nil
	case "metadata.name":
		return accessor.GetName(), nil
	case "metadata.namespace":
		return accessor.GetNamespace(), nil
	case "metadata.uid":
		return string(accessor.GetUID()), nil
	}

	return "", fmt.Errorf("unsupported fieldPath: %v", fieldPath)
}

// extractPodFieldPathAsString resolves a downward API fieldRef the same way
// the kubelet does: pod spec/status runtime fields first, then generic
// metadata field paths (including labels/annotations subscripts).
func extractPodFieldPathAsString(pod *v1.Pod, fieldPath string) (string, error) {
	if pod == nil {
		return "", fmt.Errorf("no pod to extract fieldPath %q from", fieldPath)
	}

	switch fieldPath {
	case "spec.nodeName":
		return pod.Spec.NodeName, nil
	case "spec.serviceAccountName":
		return pod.Spec.ServiceAccountName, nil
	case "status.hostIP":
		return pod.Status.HostIP, nil
	case "status.hostIPs":
		return joinHostIPs(pod.Status.HostIPs), nil
	case "status.podIP":
		return pod.Status.PodIP, nil
	case "status.podIPs":
		return joinPodIPs(pod.Status.PodIPs), nil
	}

	return ExtractFieldPathAsString(pod, fieldPath)
}

func joinPodIPs(podIPs []v1.PodIP) string {
	ips := make([]string, 0, len(podIPs))
	for _, ip := range podIPs {
		ips = append(ips, ip.IP)
	}
	return strings.Join(ips, ",")
}

func joinHostIPs(hostIPs []v1.HostIP) string {
	ips := make([]string, 0, len(hostIPs))
	for _, ip := range hostIPs {
		ips = append(ips, ip.IP)
	}
	return strings.Join(ips, ",")
}
