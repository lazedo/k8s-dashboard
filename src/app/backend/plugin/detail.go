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

package plugin

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"fmt"
	"io"

	"github.com/kubernetes/dashboard/src/app/backend/plugin/apis/v1alpha1"
	pluginclientset "github.com/kubernetes/dashboard/src/app/backend/plugin/client/clientset/versioned"
	v1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

const gzipBase64Encoding = "gzip+base64"

// GetPluginSource has the logic to get the actual plugin source code from information in Plugin.Spec.
// The source may be embedded inline in the CR (Spec.Source.Inline) or held in a ConfigMap.
func GetPluginSource(client pluginclientset.Interface, k8sClient kubernetes.Interface, ns string, name string) ([]byte, error) {
	plugin, err := client.DashboardV1alpha1().Plugins(ns).Get(context.TODO(), name, v1.GetOptions{})
	if err != nil {
		return nil, err
	}

	if plugin.Spec.Source.Inline != nil {
		return decodeInlineSource(plugin.Spec.Source.Inline)
	}

	if plugin.Spec.Source.ConfigMapRef == nil {
		return nil, fmt.Errorf("plugin %s/%s has neither source.inline nor source.configMapRef", ns, name)
	}
	cfgMap, err := k8sClient.CoreV1().ConfigMaps(ns).Get(context.TODO(), plugin.Spec.Source.ConfigMapRef.Name, v1.GetOptions{})
	if err != nil {
		return nil, err
	}
	return []byte(cfgMap.Data[plugin.Spec.Source.Filename]), nil
}

// decodeInlineSource returns the raw JS from an inline source, decompressing it
// when the "gzip+base64" encoding is used.
func decodeInlineSource(inline *v1alpha1.InlineSource) ([]byte, error) {
	if inline.Encoding == "" {
		return []byte(inline.JS), nil
	}
	if inline.Encoding != gzipBase64Encoding {
		return nil, fmt.Errorf("unsupported inline source encoding %q", inline.Encoding)
	}
	compressed, err := base64.StdEncoding.DecodeString(inline.JS)
	if err != nil {
		return nil, fmt.Errorf("decoding base64 inline source: %w", err)
	}
	reader, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		return nil, fmt.Errorf("opening gzip inline source: %w", err)
	}
	defer func() { _ = reader.Close() }()
	return io.ReadAll(reader)
}
