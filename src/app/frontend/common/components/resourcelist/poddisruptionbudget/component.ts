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

import {HttpParams} from '@angular/common/http';
import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input} from '@angular/core';
import {Observable} from 'rxjs';
import {PodDisruptionBudget, PodDisruptionBudgetList} from 'typings/root.api';

import {ResourceListBase} from '@common/resources/list';
import {NotificationsService} from '@common/services/global/notifications';
import {EndpointManager, Resource} from '@common/services/resource/endpoint';
import {NamespacedResourceService} from '@common/services/resource/resource';
import {MenuComponent} from '../../list/column/menu/component';
import {ListGroupIdentifier, ListIdentifier} from '../groupids';

@Component({
  selector: 'kd-pod-disruption-budget-list',
  templateUrl: './template.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PodDisruptionBudgetListComponent extends ResourceListBase<PodDisruptionBudgetList, PodDisruptionBudget> {
  @Input() endpoint = EndpointManager.resource(Resource.podDisruptionBudget, true).list();

  constructor(
    private readonly pdb_: NamespacedResourceService<PodDisruptionBudgetList>,
    notifications: NotificationsService,
    cdr: ChangeDetectorRef
  ) {
    super('poddisruptionbudget', notifications, cdr);
    this.id = ListIdentifier.podDisruptionBudget;
    this.groupId = ListGroupIdentifier.cluster;

    this.registerActionColumn<MenuComponent>('menu', MenuComponent);
    this.registerDynamicColumn('namespace', 'name', this.shouldShowNamespaceColumn_.bind(this));
  }

  getResourceObservable(params?: HttpParams): Observable<PodDisruptionBudgetList> {
    return this.pdb_.get(this.endpoint, undefined, undefined, params);
  }

  map(list: PodDisruptionBudgetList): PodDisruptionBudget[] {
    return list.items;
  }

  getDisplayColumns(): string[] {
    return ['name', 'minmax', 'allowed', 'healthy', 'created'];
  }

  // The min/max budget: only one of MinAvailable / MaxUnavailable is set.
  budget(pdb: PodDisruptionBudget): string {
    if (pdb.minAvailable !== undefined && pdb.minAvailable !== null) {
      return `min ${pdb.minAvailable}`;
    }
    if (pdb.maxUnavailable !== undefined && pdb.maxUnavailable !== null) {
      return `max unavailable ${pdb.maxUnavailable}`;
    }
    return '-';
  }

  private shouldShowNamespaceColumn_(): boolean {
    return this.namespaceService_.areMultipleNamespacesSelected();
  }
}
