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

import {ChangeDetectorRef, Component, Inject, OnDestroy, OnInit} from '@angular/core';
import {ActivatedRoute, Router} from '@angular/router';
import {Cluster} from '@api/root.api';
import {IConfig} from '@api/root.ui';
import {Subject} from 'rxjs';
import {takeUntil} from 'rxjs/operators';
import {CONFIG_DI_TOKEN} from '../../../index.config';

import {CLUSTER_STATE_PARAM, NAMESPACE_STATE_PARAM} from '../../params/params';
import {ClusterService} from '../../services/global/cluster';
import {GlobalSettingsService} from '../../services/global/globalsettings';

// The cluster selector of the top bar, left of the namespace selector. It is the counterpart
// of NamespaceSelectorComponent for the `cluster` route query param: it copies the param into
// ClusterService (absent = local) and, on a pick, navigates to the overview of the chosen
// cluster with the default namespace. Hidden when only the local cluster exists.
@Component({
  selector: 'kd-cluster-selector',
  templateUrl: './template.html',
  styleUrls: ['style.scss'],
  host: {
    '[class.kd-hidden]': '!hasRemote()',
  },
  standalone: false,
})
export class ClusterSelectorComponent implements OnInit, OnDestroy {
  clusters: Cluster[] = [];
  selectedCluster = '';

  private readonly unsubscribe_ = new Subject<void>();

  constructor(
    private readonly router_: Router,
    private readonly activatedRoute_: ActivatedRoute,
    private readonly clusterService_: ClusterService,
    private readonly settingsService_: GlobalSettingsService,
    private readonly cdr_: ChangeDetectorRef,
    @Inject(CONFIG_DI_TOKEN) private readonly appConfig_: IConfig
  ) {}

  ngOnInit(): void {
    this.clusters = this.clusterService_.list();
    this.activatedRoute_.queryParams.pipe(takeUntil(this.unsubscribe_)).subscribe(params => {
      this.clusterService_.setCurrent(params[CLUSTER_STATE_PARAM] || '');
      this.selectedCluster = this.clusterService_.current();
      this.cdr_.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.unsubscribe_.next();
    this.unsubscribe_.complete();
  }

  hasRemote(): boolean {
    return this.clusterService_.hasRemote();
  }

  isLocal(cluster: Cluster): boolean {
    return cluster.local;
  }

  onClusterChange(name: string): void {
    if (name === this.clusterService_.current()) {
      return;
    }

    // A cluster is a different world: start from its overview, in the default namespace, so
    // no resource of the previous cluster stays on screen under the new context.
    const defaultNamespace = this.settingsService_.getDefaultNamespace() || this.appConfig_.defaultNamespace;
    this.router_.navigate(['overview'], {
      queryParams: {
        [CLUSTER_STATE_PARAM]: this.clusterService_.stateParam(name),
        [NAMESPACE_STATE_PARAM]: defaultNamespace,
      },
      queryParamsHandling: 'merge',
    });
  }
}
