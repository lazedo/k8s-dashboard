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

import {HttpParams} from '@angular/common/http';
import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input} from '@angular/core';
import {Observable} from 'rxjs';
import {ScaledJob, ScaledJobList} from 'typings/root.api';

import {ResourceListBase} from '@common/resources/list';
import {NotificationsService} from '@common/services/global/notifications';
import {EndpointManager, Resource} from '@common/services/resource/endpoint';
import {NamespacedResourceService} from '@common/services/resource/resource';
import {MenuComponent} from '../../list/column/menu/component';
import {ListGroupIdentifier, ListIdentifier} from '../groupids';

@Component({
  selector: 'kd-scaled-job-list',
  templateUrl: './template.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScaledJobListComponent extends ResourceListBase<ScaledJobList, ScaledJob> {
  @Input() endpoint = EndpointManager.resource(Resource.scaledJob, true).list();

  constructor(
    private readonly scaledJob_: NamespacedResourceService<ScaledJobList>,
    notifications: NotificationsService,
    cdr: ChangeDetectorRef
  ) {
    super('scaledjob', notifications, cdr);
    this.id = ListIdentifier.scaledJob;
    this.groupId = ListGroupIdentifier.autoscaling;

    // Register action columns.
    this.registerActionColumn<MenuComponent>('menu', MenuComponent);

    // Register dynamic columns.
    this.registerDynamicColumn('namespace', 'name', this.shouldShowNamespaceColumn_.bind(this));
  }

  getResourceObservable(params?: HttpParams): Observable<ScaledJobList> {
    return this.scaledJob_.get(this.endpoint, undefined, undefined, params);
  }

  map(scaledJobList: ScaledJobList): ScaledJob[] {
    return scaledJobList.items;
  }

  getDisplayColumns(): string[] {
    return ['name', 'labels', 'created'];
  }

  private shouldShowNamespaceColumn_(): boolean {
    return this.namespaceService_.areMultipleNamespacesSelected();
  }
}
