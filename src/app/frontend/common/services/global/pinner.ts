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

import {Injectable} from '@angular/core';
import {PinnedResource} from '@api/root.api';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {Subject} from 'rxjs';
import {MatDialog, MatDialogConfig} from '@angular/material/dialog';
import {AlertDialog, AlertDialogConfig} from '../../dialogs/alert/dialog';
import {VerberService} from './verber';

@Injectable()
export class PinnerService {
  onPinUpdate = new Subject<void>();
  // Fires whenever the cached pin list content changes (optimistic updates and
  // server reloads) so views reading it (pinned nav, plugin cards) can
  // markForCheck — required since the zoneless default.
  changed = new Subject<void>();
  private isInitialized_ = false;
  private pinnedResources_: PinnedResource[] = [];
  private readonly endpoint_ = 'api/v1/settings/pinner';

  constructor(
    private readonly dialog_: MatDialog,
    private readonly http_: HttpClient,
    private readonly verber_: VerberService
  ) {}

  init(): void {
    this.load();
    this.onPinUpdate.subscribe(() => this.load());
    this.verber_.onDelete.subscribe(() => this.load());
  }

  load(): void {
    this.http_.get<PinnedResource[]>(this.endpoint_).subscribe(resources => {
      this.pinnedResources_ = resources;
      this.isInitialized_ = true;
      this.changed.next();
      this.pruneDeleted_(resources);
    });
  }

  // Pins are manual and survive resource deletion (kubectl delete included),
  // leaving orphan entries in the nav. Verify each pin against its detail
  // endpoint and unpin the ones that are gone. Only a definitive 404 prunes —
  // 403 (no RBAC for this user) must not eat pins.
  private pruneDeleted_(resources: PinnedResource[]): void {
    for (const resource of resources) {
      const url = this.existenceUrl_(resource);
      if (!url) {
        continue;
      }
      this.http_.get(url).subscribe({
        next: () => {},
        error: err => {
          if (err?.status === 404) {
            this.unpin(resource.kind, resource.name, resource.namespace);
          }
        },
      });
    }
  }

  private existenceUrl_(resource: PinnedResource): string | null {
    switch (resource.kind) {
      case 'customresourcedefinition':
        return `api/v1/crd/${resource.name}`;
      case 'plugin':
        return resource.namespace !== undefined
          ? `api/v1/plugin/${resource.namespace}/${resource.name}`
          : `api/v1/globalplugin/${resource.name}`;
      default:
        return null;
    }
  }

  isInitialized(): boolean {
    return this.isInitialized_;
  }

  // The detail actionbar reports cluster-scoped plugins as kind
  // 'globalplugin' (that is what the verber needs for edit/delete), but pins
  // have always been stored as 'plugin' with no namespace — keep that.
  private aliasKind_(kind: string): string {
    return kind === 'globalplugin' ? 'plugin' : kind;
  }

  pin(kind: string, name: string, namespace: string, displayName: string, namespaced?: boolean): void {
    kind = this.aliasKind_(kind);
    // Optimistically update the local cache so OnPush views (e.g. the plugin
    // cards) reflect the new state immediately, before the PUT + reload round
    // trips. The server response reconciles via load(); errors revert it.
    if (!this.isPinned(kind, name, namespace)) {
      this.pinnedResources_ = [...this.pinnedResources_, {kind, name, namespace, displayName, namespaced}];
      this.changed.next();
    }
    this.http_.put(this.endpoint_, {kind, name, namespace, displayName, namespaced}).subscribe(() => this.load(), err => {
      this.load();
      this.handleErrorResponse_(err);
    });
  }

  unpin(kind: string, name: string, namespace: string): void {
    kind = this.aliasKind_(kind);
    let url = `${this.endpoint_}/${kind}`;
    if (namespace !== undefined) {
      url += `/${namespace}`;
    }
    url += `/${name}`;

    this.pinnedResources_ = this.pinnedResources_.filter(
      r => !(r.kind === kind && r.name === name && r.namespace === namespace)
    );
    this.changed.next();
    this.http_.delete(url).subscribe(() => this.load(), err => {
      this.load();
      this.handleErrorResponse_(err);
    });
  }

  unpinResource(resource: PinnedResource): void {
    this.unpin(resource.kind, resource.name, resource.namespace);
  }

  isPinned(kind: string, name: string, namespace?: string): boolean {
    kind = this.aliasKind_(kind);
    for (const pinnedResource of this.pinnedResources_) {
      if (pinnedResource.name === name && pinnedResource.kind === kind && pinnedResource.namespace === namespace) {
        return true;
      }
    }
    return false;
  }

  getPinnedForKind(kind: string): PinnedResource[] {
    const resources = [];
    for (const pinnedResource of this.pinnedResources_) {
      if (pinnedResource.kind === kind) {
        resources.push(pinnedResource);
      }
    }

    return resources;
  }

  handleErrorResponse_(err: HttpErrorResponse): void {
    if (err) {
      const alertDialogConfig: MatDialogConfig<AlertDialogConfig> = {
        width: '630px',
        data: {
          title: err.statusText === 'OK' ? 'Internal server error' : err.statusText,
          message: err.error || 'Could not perform the operation.',
          confirmLabel: 'OK',
        },
      };
      this.dialog_.open(AlertDialog, alertDialogConfig);
    }
  }
}
