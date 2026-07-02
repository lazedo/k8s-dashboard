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

import {ChangeDetectorRef, Component, Input, OnDestroy, OnInit} from '@angular/core';
import {PinnedResource} from '@api/root.api';
import {NamespaceService} from '@common/services/global/namespace';
import {PinnerService} from '@common/services/global/pinner';
import {Subject} from 'rxjs';
import {takeUntil} from 'rxjs/operators';

@Component({
    selector: 'kd-pinner-nav',
    templateUrl: './template.html',
    styleUrls: ['../style.scss'],
    standalone: false
})
export class PinnerNavComponent implements OnInit, OnDestroy {
  @Input() kind: string;

  private readonly unsubscribe_ = new Subject<void>();

  constructor(
    private readonly pinner_: PinnerService,
    private readonly namespace_: NamespaceService,
    private readonly cdr_: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    // Re-render when the pin list changes (pins/unpins land asynchronously and
    // the zoneless default no longer refreshes this view on its own).
    this.pinner_.changed.pipe(takeUntil(this.unsubscribe_)).subscribe(() => this.cdr_.markForCheck());
  }

  ngOnDestroy(): void {
    this.unsubscribe_.next();
    this.unsubscribe_.complete();
  }

  isInitialized(): boolean {
    return this.pinner_.isInitialized();
  }

  getResourceHref(resource: PinnedResource): string {
    let href = `/${resource.kind}`;
    if (resource.namespace !== undefined) {
      href += `/${resource.namespace}`;
    }
    href += `/${resource.name}`;

    return href;
  }

  getPinnedResources(): PinnedResource[] {
    return this.pinner_.getPinnedForKind(this.kind).filter(r => this.isVisibleInCurrentNamespace_(r));
  }

  // A namespaced pin (e.g. a namespaced Plugin) only makes sense when its namespace
  // is in view — otherwise clicking it lands on a list that doesn't contain it. Show
  // it only when "All namespaces" is selected or the current namespace matches.
  // Namespaceless pins (cluster-scoped CRDs, GlobalPlugins) are always shown.
  private isVisibleInCurrentNamespace_(resource: PinnedResource): boolean {
    if (resource.namespace === undefined) {
      return true;
    }
    const current = this.namespace_.current();
    return current === this.namespace_.getAllNamespacesKey() || current === resource.namespace;
  }

  unpin(resource: PinnedResource): void {
    this.pinner_.unpinResource(resource);
  }

  getDisplayName(resource: PinnedResource): string {
    return resource.displayName.replace(/([A-Z]+)/g, ' $1').replace(/([A-Z][a-z])/g, ' $1');
  }
}
