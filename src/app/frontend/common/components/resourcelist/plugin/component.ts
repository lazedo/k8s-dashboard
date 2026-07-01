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
import {DomSanitizer, SafeUrl} from '@angular/platform-browser';
import {Plugin, PluginList} from '@api/root.api';
import {EMPTY, Observable} from 'rxjs';
import {ResourceListBase} from '@common/resources/list';
import {NotificationsService} from '@common/services/global/notifications';
import {PinnerService} from '@common/services/global/pinner';
import {EndpointManager, Resource} from '@common/services/resource/endpoint';
import {NamespacedResourceService} from '@common/services/resource/resource';
import {ListGroupIdentifier, ListIdentifier} from '../groupids';

const PLUGIN_KIND = 'plugin';

@Component({
  selector: 'kd-plugin-list',
  templateUrl: './template.html',
  styleUrls: ['./style.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PluginListComponent extends ResourceListBase<PluginList, Plugin> {
  @Input() endpoint = EndpointManager.resource(Resource.plugin, true).list();

  // The card grid renders the data source's RENDERED page (filtered + sorted +
  // paginated), so the cards respect the MatPaginator the base wires up.
  readonly pagedPlugins$: Observable<readonly Plugin[]> = this.getData().connect({viewChange: EMPTY});

  constructor(
    private readonly plugin_: NamespacedResourceService<PluginList>,
    private readonly pinner_: PinnerService,
    private readonly sanitizer_: DomSanitizer,
    notifications: NotificationsService,
    cdr: ChangeDetectorRef
  ) {
    super('plugin', notifications, cdr);
    this.id = ListIdentifier.plugin;
    this.groupId = ListGroupIdentifier.none;
  }

  getResourceObservable(params?: HttpParams): Observable<PluginList> {
    return this.plugin_.get(this.endpoint, undefined, undefined, params);
  }

  map(pluginList: PluginList): Plugin[] {
    return pluginList.items || [];
  }

  getDisplayColumns(): string[] {
    return ['name'];
  }

  // --- card helpers ---
  // A GlobalPlugin is cluster-scoped: no namespace, addressed by name only, and
  // pinned without the "N" (namespaced) indicator.
  private pinNamespace(p: Plugin): string | undefined {
    return p.global ? undefined : p.objectMeta.namespace;
  }

  detailsHref(p: Plugin): string {
    return p.global ? `/plugin/${p.objectMeta.name}` : this.getDetailsHref(p.objectMeta.name, p.objectMeta.namespace);
  }

  icon(p: Plugin): SafeUrl | null {
    // Angular strips data:image/svg+xml from [src] (XSS guard); trust the
    // plugin-declared icon explicitly. (Dev: plugins are cluster-admin authored.)
    return p.icon ? this.sanitizer_.bypassSecurityTrustUrl(p.icon) : null;
  }

  isPinned(p: Plugin): boolean {
    return this.pinner_.isPinned(PLUGIN_KIND, p.objectMeta.name, this.pinNamespace(p));
  }

  togglePin(p: Plugin, event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    const namespace = this.pinNamespace(p);
    if (this.isPinned(p)) {
      this.pinner_.unpin(PLUGIN_KIND, p.objectMeta.name, namespace);
    } else {
      this.pinner_.pin(PLUGIN_KIND, p.objectMeta.name, namespace, p.objectMeta.name, !p.global);
    }
  }
}
