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

package job

import (
	"context"
	"strings"

	batch "k8s.io/api/batch/v1"
	meta "k8s.io/apimachinery/pkg/apis/meta/v1"
	client "k8s.io/client-go/kubernetes"
)

const (
	// generateNameMaxBaseLength caps the base name so that the 5-character
	// random suffix appended by the API server keeps the generated name within
	// the DNS1035 label limit (63 characters, minus one dash and the suffix).
	generateNameMaxBaseLength = 57

	// controllerUIDLabel and jobNameLabel are the system labels the Job
	// controller injects into the selector and the pod template. They must be
	// dropped from a clone so the API server can generate a fresh selector.
	controllerUIDLabel = "controller-uid"
	jobNameLabel       = "job-name"

	// batchLabelPrefix covers the newer batch.kubernetes.io/{controller-uid,job-name}
	// labels used by recent Kubernetes releases.
	batchLabelPrefix = "batch.kubernetes.io/"
)

// RerunJob clones an existing (immutable) Job into a brand new Job and creates
// it. Jobs cannot be restarted in place, so "run again" means creating a fresh
// Job from the same spec. The controller-managed fields (status, uid, selector,
// controller labels, owner references, ...) are stripped so that the API server
// regenerates them.
func RerunJob(client client.Interface, namespace, name string) error {
	job, err := client.BatchV1().Jobs(namespace).Get(context.TODO(), name, meta.GetOptions{})
	if err != nil {
		return err
	}

	_, err = client.BatchV1().Jobs(namespace).Create(context.TODO(), cloneJob(job), meta.CreateOptions{})
	return err
}

// cloneJob builds a new Job from the given one, keeping only the user-authored
// parts of the spec and metadata.
func cloneJob(job *batch.Job) *batch.Job {
	newSpec := *job.Spec.DeepCopy()

	// Let the API server regenerate the selector and the controller labels it
	// injects into the pod template.
	newSpec.Selector = nil
	newSpec.ManualSelector = nil
	newSpec.Template.Labels = filterControllerLabels(newSpec.Template.Labels)

	return &batch.Job{
		ObjectMeta: meta.ObjectMeta{
			GenerateName: deriveBaseName(job.Name) + "-",
			Namespace:    job.Namespace,
			Labels:       filterControllerLabels(job.Labels),
			Annotations:  job.Annotations,
		},
		Spec: newSpec,
	}
}

// filterControllerLabels returns a copy of the given labels without the
// controller-managed selector labels (controller-uid, job-name and their
// batch.kubernetes.io/* equivalents).
func filterControllerLabels(labels map[string]string) map[string]string {
	if len(labels) == 0 {
		return nil
	}

	filtered := make(map[string]string, len(labels))
	for k, v := range labels {
		if k == controllerUIDLabel || k == jobNameLabel || strings.HasPrefix(k, batchLabelPrefix) {
			continue
		}
		filtered[k] = v
	}

	if len(filtered) == 0 {
		return nil
	}
	return filtered
}

// deriveBaseName strips a trailing generated suffix (a dash followed by a short
// alphanumeric token, e.g. "-a1b2c") so that re-running a Job that was itself
// created via generateName does not grow the name on every run. The result is
// capped to fit the DNS label limit once the API server appends its suffix.
func deriveBaseName(name string) string {
	base := name
	if i := strings.LastIndex(name, "-"); i > 0 {
		suffix := name[i+1:]
		if len(suffix) >= 3 && len(suffix) <= 6 && isAlphanumeric(suffix) {
			base = name[:i]
		}
	}

	if len(base) > generateNameMaxBaseLength {
		base = base[:generateNameMaxBaseLength]
	}
	return base
}

func isAlphanumeric(s string) bool {
	for _, r := range s {
		if (r < 'a' || r > 'z') && (r < '0' || r > '9') {
			return false
		}
	}
	return true
}
