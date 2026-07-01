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

// Package keda browses the optional KEDA CRDs (keda.sh) — ScaledObject and
// ScaledJob — through the shared dynamic-CRD read path, so they show up only
// when KEDA is installed and need no generated clientset.
package keda

// ScaleTargetRef identifies the workload a ScaledObject scales.
type ScaleTargetRef struct {
	APIVersion string `json:"apiVersion,omitempty"`
	Kind       string `json:"kind,omitempty"`
	Name       string `json:"name,omitempty"`
}

// Trigger is one KEDA scaler (its metadata drives the query/threshold).
type Trigger struct {
	Type     string            `json:"type,omitempty"`
	Name     string            `json:"name,omitempty"`
	Metadata map[string]string `json:"metadata,omitempty"`
}
