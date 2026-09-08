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

import {HttpClient} from '@angular/common/http';
import {Injectable} from '@angular/core';
import {Cluster, ClusterList} from '@api/root.api';
import {Subject} from 'rxjs';

const API_PREFIX = 'api/v1/';
// The backend accepts this alias for the local cluster whatever its --cluster-name is.
const LOCAL_ALIAS = 'local';

// ClusterService holds the cluster the dashboard is looking at, like NamespaceService holds
// the namespace: the state lives in the `cluster` route query param (absent = local) and is
// set from it by the cluster selector. Every backend call of a non-local cluster is rewritten
// by the AuthInterceptor to the 'api/v1/cluster/<name>/' route prefix; nothing else carries
// the cluster, so the URL bar always tells which cluster a page acts on.
@Injectable()
export class ClusterService {
  // Emits the new current cluster name after every change (zoneless views markForCheck on it).
  changed = new Subject<string>();

  private readonly clustersPath_ = 'api/v1/clusters';
  private clusters_: Cluster[] = [{name: LOCAL_ALIAS, local: true, accessible: true}];
  private local_ = LOCAL_ALIAS;
  // Empty for the local cluster.
  private current_ = '';

  constructor(private readonly http_: HttpClient) {}

  init(): Promise<void> {
    return this.http_
      .get<ClusterList>(this.clustersPath_)
      .toPromise()
      .then(list => this.setList_((list && list.clusters) || []))
      .catch(() => this.setList_([]));
  }

  // Name of the cluster every call goes to: the local cluster's name when none is selected.
  current(): string {
    return this.current_ || this.local_;
  }

  // Name the local cluster is listed under (--cluster-name of the backend).
  local(): string {
    return this.local_;
  }

  // Whether the given name (the current cluster by default) is the local cluster.
  isLocal(name: string = this.current()): boolean {
    return !name || name === LOCAL_ALIAS || name === this.local_;
  }

  list(): Cluster[] {
    return this.clusters_;
  }

  hasRemote(): boolean {
    return this.clusters_.some(cluster => !cluster.local);
  }

  setCurrent(name: string): void {
    const next = this.isLocal(name) ? '' : name;
    if (next === this.current_) {
      return;
    }

    this.current_ = next;
    this.changed.next(this.current());
  }

  // Value of the `cluster` route query param for the given cluster: null (param removed) for the local one.
  stateParam(name: string): string | null {
    return this.isLocal(name) ? null : name;
  }

  // Backend path of an 'api/v1' request on the given cluster (the current one by default):
  // path('crd/ns/x/y/raw') is 'api/v1/crd/ns/x/y/raw' on the local cluster and
  // 'api/v1/cluster/<name>/crd/ns/x/y/raw' on a remote one. A leading 'api/v1/' is accepted.
  path(rest: string, cluster: string = this.current()): string {
    rest = rest.replace(/^\/?(api\/v1\/)?/, '');
    if (this.isLocal(cluster)) {
      return API_PREFIX + rest;
    }

    return `${API_PREFIX}cluster/${encodeURIComponent(cluster)}/${rest}`;
  }

  private setList_(clusters: Cluster[]): void {
    const local = clusters.find(cluster => cluster.local) || {name: LOCAL_ALIAS, local: true, accessible: true};
    this.local_ = local.name;
    this.clusters_ = [local, ...clusters.filter(cluster => !cluster.local)];
  }
}

// window.kdCluster: how plugin bundles (DOM-first, plain fetch) learn which cluster the
// dashboard is looking at and address it — same contract style as kdActionbar/kdSchemaForm.
// See docs/plugins/README.md, "Remote clusters".
export function installKdCluster(clusters: ClusterService): void {
  (window as unknown as {kdCluster: {}}).kdCluster = {
    version: 1,
    current: (): string => clusters.current(),
    local: (): string => clusters.local(),
    isLocal: (): boolean => clusters.isLocal(),
    list: (): Cluster[] => clusters.list().map(cluster => ({...cluster})),
    path: (rest: string, cluster?: string): string => clusters.path(rest, cluster),
  };
}
