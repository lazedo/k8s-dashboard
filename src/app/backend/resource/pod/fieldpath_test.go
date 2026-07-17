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
// FILE TAKEN FROM: k8s.io/kubernetes/pkg/fieldpath/fieldpath_test.go
// Commit hash: 6f52cd3d0ba0cafc7d427a29dfaf69b97c9c1968 (K8S 1.7.2)
// -----------------------------------

package pod

import (
	"strings"
	"testing"

	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestExtractFieldPathAsString(t *testing.T) {
	cases := []struct {
		name                    string
		fieldPath               string
		obj                     interface{}
		expectedValue           string
		expectedMessageFragment string
	}{
		{
			name:                    "not an API object",
			fieldPath:               "metadata.name",
			obj:                     "",
			expectedMessageFragment: "object does not implement",
		},
		{
			name:      "ok - namespace",
			fieldPath: "metadata.namespace",
			obj: &v1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					Namespace: "object-namespace",
				},
			},
			expectedValue: "object-namespace",
		},
		{
			name:      "ok - name",
			fieldPath: "metadata.name",
			obj: &v1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					Name: "object-name",
				},
			},
			expectedValue: "object-name",
		},
		{
			name:      "ok - labels",
			fieldPath: "metadata.labels",
			obj: &v1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{"key": "value"},
				},
			},
			expectedValue: "key=\"value\"",
		},
		{
			name:      "ok - labels bslash n",
			fieldPath: "metadata.labels",
			obj: &v1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{"key": "value\n"},
				},
			},
			expectedValue: "key=\"value\\n\"",
		},
		{
			name:      "ok - annotations",
			fieldPath: "metadata.annotations",
			obj: &v1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					Annotations: map[string]string{"builder": "john-doe"},
				},
			},
			expectedValue: "builder=\"john-doe\"",
		},

		{
			name:      "ok - uid",
			fieldPath: "metadata.uid",
			obj: &v1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					UID: "b415a578-b3b6-4123-91ca-8f0a4a3a1e10",
				},
			},
			expectedValue: "b415a578-b3b6-4123-91ca-8f0a4a3a1e10",
		},
		{
			name:      "ok - annotation subscript",
			fieldPath: "metadata.annotations['kazoo.io/zone']",
			obj: &v1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					Annotations: map[string]string{"kazoo.io/zone": "west1"},
				},
			},
			expectedValue: "west1",
		},
		{
			name:      "ok - label subscript",
			fieldPath: "metadata.labels['app.kubernetes.io/name']",
			obj: &v1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{"app.kubernetes.io/name": "kazoo"},
				},
			},
			expectedValue: "kazoo",
		},
		{
			name:      "missing annotation subscript",
			fieldPath: "metadata.annotations['nope']",
			obj: &v1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					Annotations: map[string]string{"kazoo.io/zone": "west1"},
				},
			},
			expectedMessageFragment: "not found",
		},
		{
			name:      "invalid subscript path",
			fieldPath: "metadata.name['foo']",
			obj: &v1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					Name: "object-name",
				},
			},
			expectedMessageFragment: "does not support subscript",
		},
		{
			name:      "invalid expression",
			fieldPath: "metadata.whoops",
			obj: &v1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					Namespace: "object-namespace",
				},
			},
			expectedMessageFragment: "unsupported fieldPath",
		},
	}

	for _, tc := range cases {
		actual, err := ExtractFieldPathAsString(tc.obj, tc.fieldPath)
		if err != nil {
			if tc.expectedMessageFragment != "" {
				if !strings.Contains(err.Error(), tc.expectedMessageFragment) {
					t.Errorf("%v: unexpected error message: %q, expected to contain %q", tc.name, err, tc.expectedMessageFragment)
				}
			} else {
				t.Errorf("%v: unexpected error: %v", tc.name, err)
			}
		} else if e := tc.expectedValue; e != "" && e != actual {
			t.Errorf("%v: unexpected result; got %q, expected %q", tc.name, actual, e)
		}
	}
}

func TestExtractPodFieldPathAsString(t *testing.T) {
	pod := &v1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:        "test-pod",
			Namespace:   "test-namespace",
			Annotations: map[string]string{"kazoo.io/zone": "west1"},
		},
		Spec: v1.PodSpec{
			NodeName:           "node-1",
			ServiceAccountName: "kazoo-sa",
		},
		Status: v1.PodStatus{
			HostIP: "10.0.0.1",
			PodIP:  "192.168.1.10",
			PodIPs: []v1.PodIP{{IP: "192.168.1.10"}, {IP: "fd00::10"}},
		},
	}

	cases := []struct {
		name                    string
		fieldPath               string
		expectedValue           string
		expectedMessageFragment string
	}{
		{name: "spec.nodeName", fieldPath: "spec.nodeName", expectedValue: "node-1"},
		{name: "spec.serviceAccountName", fieldPath: "spec.serviceAccountName", expectedValue: "kazoo-sa"},
		{name: "status.hostIP", fieldPath: "status.hostIP", expectedValue: "10.0.0.1"},
		{name: "status.podIP", fieldPath: "status.podIP", expectedValue: "192.168.1.10"},
		{name: "status.podIPs", fieldPath: "status.podIPs", expectedValue: "192.168.1.10,fd00::10"},
		{name: "metadata fallthrough", fieldPath: "metadata.annotations['kazoo.io/zone']", expectedValue: "west1"},
		{name: "unsupported", fieldPath: "spec.whoops", expectedMessageFragment: "unsupported fieldPath"},
	}

	for _, tc := range cases {
		actual, err := extractPodFieldPathAsString(pod, tc.fieldPath)
		if err != nil {
			if tc.expectedMessageFragment != "" {
				if !strings.Contains(err.Error(), tc.expectedMessageFragment) {
					t.Errorf("%v: unexpected error message: %q, expected to contain %q", tc.name, err, tc.expectedMessageFragment)
				}
			} else {
				t.Errorf("%v: unexpected error: %v", tc.name, err)
			}
		} else if e := tc.expectedValue; e != "" && e != actual {
			t.Errorf("%v: unexpected result; got %q, expected %q", tc.name, actual, e)
		}
	}
}
