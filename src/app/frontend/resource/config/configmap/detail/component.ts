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

import {Component, OnDestroy, OnInit, signal} from '@angular/core';
import {ActivatedRoute} from '@angular/router';
import {ConfigMapDetail} from '@api/root.api';
import {Subject} from 'rxjs';
import {takeUntil} from 'rxjs/operators';

import {ActionbarService, ResourceMeta} from '@common/services/global/actionbar';
import {NotificationsService} from '@common/services/global/notifications';
import {EndpointManager, Resource} from '@common/services/resource/endpoint';
import {NamespacedResourceService} from '@common/services/resource/resource';

@Component({
    selector: 'kd-config-map-detail',
    templateUrl: './template.html',
    standalone: false
})
export class ConfigMapDetailComponent implements OnInit, OnDestroy {
  private endpoint_ = EndpointManager.resource(Resource.configMap, true);
  private readonly unsubscribe_ = new Subject<void>();

  // signal + getter: the template still reads `configMap`, but the read now
  // happens in a reactive context — zoneless has no zone to notice a
  // plain assignment, so the poll refreshed the data and never the view
  private readonly configMapSig = signal<ConfigMapDetail>(undefined);
  get configMap(): ConfigMapDetail {
    return this.configMapSig();
  }
  // signal + getter: the template still reads `isInitialized`, but the read now
  // happens in a reactive context — zoneless has no zone to notice a
  // plain assignment, so the poll refreshed the data and never the view
  private readonly isInitializedSig = signal<boolean>(false);
  get isInitialized(): boolean {
    return this.isInitializedSig();
  }

  constructor(
    private readonly configMap_: NamespacedResourceService<ConfigMapDetail>,
    private readonly actionbar_: ActionbarService,
    private readonly activatedRoute_: ActivatedRoute,
    private readonly notifications_: NotificationsService
  ) {}

  ngOnInit(): void {
    const resourceName = this.activatedRoute_.snapshot.params.resourceName;
    const resourceNamespace = this.activatedRoute_.snapshot.params.resourceNamespace;

    this.configMap_
      .get(this.endpoint_.detail(), resourceName, resourceNamespace)
      .pipe(takeUntil(this.unsubscribe_))
      .subscribe((d: ConfigMapDetail) => {
        this.configMapSig.set(d);
        this.notifications_.pushErrors(d.errors);
        this.actionbar_.onInit.emit(new ResourceMeta('Config Map', d.objectMeta, d.typeMeta));
        this.isInitializedSig.set(true);
      });
  }

  ngOnDestroy(): void {
    this.unsubscribe_.next();
    this.unsubscribe_.complete();
    this.actionbar_.onDetailsLeave.emit();
  }

  getConfigMapData(cm: ConfigMapDetail): string {
    if (!cm) {
      return '';
    }

    return JSON.stringify(cm.data);
  }
}
