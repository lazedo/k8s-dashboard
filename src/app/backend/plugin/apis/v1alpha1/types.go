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

package v1alpha1

import (
	coreV1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// +genclient
// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// Plugin holds the object information for Plugin kind, it also implements runtime.Object
type Plugin struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec PluginSpec `json:"spec"`
}

// PluginSpec holds the specs for the Plugin kind. It is shared by the namespaced
// Plugin and the cluster-scoped GlobalPlugin (whose availability is defined by the
// kind itself, so it carries no per-object global flag).
type PluginSpec struct {
	Source       Source   `json:"source"`
	Dependencies []string `json:"dependencies,omitempty"`
	// Description is long text shown in the Plugins list.
	Description string `json:"description,omitempty"`
	// Icon is an image URL or data-URI shown next to the plugin in the list.
	Icon string `json:"icon,omitempty"`
	// NavHidden keeps the plugin out of the side navigation (pinned plugin
	// entries) — for plugins that bring their own nav section.
	NavHidden bool `json:"navHidden,omitempty"`

	// Nav lets the plugin declare its own side-navigation group: a header
	// that opens the plugin (with HeaderView as ?view=) and one entry per
	// item. RequiresCrd gates the whole group on a CRD being present, so a
	// plugin for an uninstalled subsystem stays out of the menu.
	Nav *PluginNav `json:"nav,omitempty"`
}

// Source holds the information about the plugin's source code origin. Exactly one
// of ConfigMapRef or Inline should be set.
type Source struct {
	Filename     string                     `json:"filename,omitempty"`
	ConfigMapRef *coreV1.ConfigMapEnvSource `json:"configMapRef,omitempty" protobuf:"bytes,1,opt,name=configMapRef"`
	// Inline embeds the plugin's compiled JS directly in the CR, removing the
	// need for a companion ConfigMap (and a namespace to hold it).
	Inline *InlineSource `json:"inline,omitempty"`
}

// InlineSource carries the plugin source code inside the Plugin object.
type InlineSource struct {
	// JS is the plugin source. When Encoding is "gzip+base64" it is a base64
	// string of gzip-compressed bytes; otherwise it is the raw JavaScript.
	JS string `json:"js"`
	// Encoding is either "" (plain JS) or "gzip+base64".
	Encoding string `json:"encoding,omitempty"`
}

// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// PluginList holds the list information for Plugin kind, it also implements runtime.Object
type PluginList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata"`

	Items []Plugin `json:"items"`
}


// PluginNav declares a plugin-owned navigation group.
type PluginNav struct {
	Group       string          `json:"group"`
	HeaderView  string          `json:"headerView,omitempty"`
	RequiresCrd string          `json:"requiresCrd,omitempty"`
	Items       []PluginNavItem `json:"items,omitempty"`
}

// PluginNavItem is one entry: Title shown in the nav, View passed as ?view=.
type PluginNavItem struct {
	Title string `json:"title"`
	View  string `json:"view"`
}
