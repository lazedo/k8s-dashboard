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

import { HttpParams } from '@angular/common/http';
import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input} from '@angular/core';
import {NodeClaim, NodeClaimList} from '@api/root.api';
import {Observable} from 'rxjs';

import {ResourceListBase} from '@common/resources/list';
import {NotificationsService} from '@common/services/global/notifications';
import {EndpointManager, Resource} from '@common/services/resource/endpoint';
import {ResourceService} from '@common/services/resource/resource';
import {MenuComponent} from '../../list/column/menu/component';
import {ListGroupIdentifier, ListIdentifier} from '../groupids';

@Component({
    selector: 'kd-node-claim-list',
    templateUrl: './template.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class NodeClaimListComponent extends ResourceListBase<NodeClaimList, NodeClaim> {
  @Input() endpoint = EndpointManager.resource(Resource.nodeClaim).list();

  constructor(
    private readonly nodeClaim_: ResourceService<NodeClaimList>,
    notifications: NotificationsService,
    cdr: ChangeDetectorRef
  ) {
    super('nodeclaim', notifications, cdr);
    this.id = ListIdentifier.nodeClaim;
    this.groupId = ListGroupIdentifier.autoscaling;

    // Register action columns.
    this.registerActionColumn<MenuComponent>('menu', MenuComponent);
  }

  getResourceObservable(params?: HttpParams): Observable<NodeClaimList> {
    return this.nodeClaim_.get(this.endpoint, undefined, params);
  }

  map(nodeClaimList: NodeClaimList): NodeClaim[] {
    return nodeClaimList.items;
  }

  getDisplayColumns(): string[] {
    return ['name', 'labels', 'created'];
  }
}
