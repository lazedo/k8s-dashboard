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

import {ChangeDetectorRef, Component, OnDestroy, OnInit, ViewChild} from '@angular/core';
import {MatDrawer} from '@angular/material/sidenav';
import {Subject} from 'rxjs';
import {takeUntil} from 'rxjs/operators';

import {NavService} from '@common/services/nav/service';
import {PluginsConfigService} from '@common/services/global/plugin';
import {PluginMetadata} from '@api/root.ui';
import {CrdAvailabilityService} from '@common/services/global/crd';
import {VerberService} from '@common/services/global/verber';

@Component({
    selector: 'kd-nav',
    templateUrl: './template.html',
    styleUrls: ['./style.scss'],
    standalone: false
})
export class NavComponent implements OnInit, OnDestroy {
  @ViewChild(MatDrawer, {static: true}) private readonly nav_: MatDrawer;

  private readonly unsubscribe_ = new Subject<void>();

  get isVisible(): boolean {
    return this.nav_.opened;
  }

  constructor(
    private readonly navService_: NavService,
    private readonly pluginsConfigService_: PluginsConfigService,
    private readonly crdAvailability_: CrdAvailabilityService,
    private readonly verber_: VerberService,
    private readonly cdr_: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.navService_.setNav(this.nav_);
    this.navService_.setVisibility(true);
    // The Plugins entry is presence-gated; refetch the plugin config after
    // any dashboard-side delete (dropping the last plugin hides the entry)
    // and repaint when it lands (zoneless).
    this.verber_.onDelete.pipe(takeUntil(this.unsubscribe_)).subscribe(() => this.pluginsConfigService_.refreshConfig());
    this.pluginsConfigService_.changed.pipe(takeUntil(this.unsubscribe_)).subscribe(() => this.cdr_.markForCheck());
  }

  ngOnDestroy(): void {
    this.unsubscribe_.next();
    this.unsubscribe_.complete();
  }

  // Only offer Plugins when the subsystem answers AND at least one plugin
  // (namespaced anywhere, or global) actually exists.
  showPlugin(): boolean {
    return this.pluginsConfigService_.status() === 200 && this.pluginsConfigService_.anyPlugins();
  }

  // Plugin-declared nav groups (spec.nav): a header entry that opens the
  // plugin plus one entry per item, optionally gated on a CRD. This is how a
  // plugin claims a first-class spot in the side nav without a rebuild.
  pluginNavGroups(): PluginMetadata[] {
    return this.pluginsConfigService_.navGroups().filter(p => !p.nav.requiresCrd || this.hasCrd(p.nav.requiresCrd));
  }

  pluginState(p: PluginMetadata): string {
    return '/plugin/' + p.name;
  }

  // hasCrd hides nav items for optional CRD-backed resources that are not
  // installed in the cluster (e.g. VPA, KEDA, Karpenter, Cluster API).
  hasCrd(crdName: string): boolean {
    return this.crdAvailability_.isInstalled(crdName);
  }

  hasAnyCrd(crdNames: string[]): boolean {
    return this.crdAvailability_.isAnyInstalled(crdNames);
  }
}
