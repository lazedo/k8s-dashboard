// Copyright 2026 The Kubernetes Authors.
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

package api

import (
	"context"

	"k8s.io/client-go/rest"

	"github.com/kubernetes/dashboard/src/app/backend/args"
)

// LocalClusterAlias always names the local cluster, whatever --cluster-name says.
const LocalClusterAlias = "local"

// Cluster describes a cluster this dashboard serves: the local one, or a remote one whose kubeconfig is stored
// in a Secret of the local cluster.
type Cluster struct {
	// Name is the segment accepted by the 'api/v1/cluster/{cluster}' route prefix.
	Name string `json:"name"`
	// Local is true for the cluster the dashboard runs against; requests without the prefix go there.
	Local bool `json:"local"`
	// Server is the API server address, empty if the remote kubeconfig could not be parsed.
	Server string `json:"server"`
	// Accessible is true when the requesting user may use the cluster: always for the local one, for a remote
	// one when the user may read its kubeconfig Secret.
	Accessible bool `json:"accessible"`
}

// ClusterList is the response of the 'clusters' endpoint.
type ClusterList struct {
	Clusters []Cluster `json:"clusters"`
}

// LocalClusterName is the name the local cluster is listed under: --cluster-name, 'local' when unset.
func LocalClusterName() string {
	if name := args.Holder.GetClusterName(); len(name) > 0 {
		return name
	}

	return LocalClusterAlias
}

// IsLocalCluster tells whether a name from the route prefix addresses the local cluster: 'local' or the name
// given by --cluster-name.
func IsLocalCluster(name string) bool {
	return name == LocalClusterAlias || name == LocalClusterName()
}

// remoteClusterKey is the context key under which a request carries the remote cluster it was routed to.
type remoteClusterKey struct{}

type remoteCluster struct {
	name   string
	config *rest.Config
}

// WithRemoteCluster marks the request context as routed to the named remote cluster, served with the given
// rest config (the remote kubeconfig plus the caller's impersonation). The client manager builds every client
// of such a request from that config instead of the local one.
func WithRemoteCluster(ctx context.Context, name string, config *rest.Config) context.Context {
	return context.WithValue(ctx, remoteClusterKey{}, &remoteCluster{name: name, config: config})
}

// RemoteClusterFrom returns the remote cluster a request was routed to and its rest config; empty name and nil
// config for requests served by the local cluster.
func RemoteClusterFrom(ctx context.Context) (string, *rest.Config) {
	if ctx == nil {
		return "", nil
	}

	if remote, ok := ctx.Value(remoteClusterKey{}).(*remoteCluster); ok && remote != nil {
		return remote.name, remote.config
	}

	return "", nil
}
