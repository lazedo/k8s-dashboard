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

import {
  Component,
  Injector,
  Input,
  NgModuleRef,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
  ViewChild,
  ViewContainerRef,
} from '@angular/core';

import {PluginLoaderService} from '@common/services/pluginloader/pluginloader.service';
import {PluginsConfigService} from '@common/services/global/plugin';

@Component({
  selector: 'kd-plugin-holder',
  template: `
    <div>
      <div class="plugin">
        <mat-card appearance="outlined" *ngIf="entryError">This plugin has no entry component</mat-card>
        <ng-template #pluginViewRef #elseBlock></ng-template>
      </div>
    </div>
  `,
  standalone: false,
})
export class PluginHolderComponent implements OnInit, OnChanges, OnDestroy {
  @ViewChild('pluginViewRef', {read: ViewContainerRef, static: true}) vcRef: ViewContainerRef;
  @Input('pluginName') private pluginName: string;
  entryError = false;

  private moduleRef_: NgModuleRef<unknown> | null = null;
  private loadToken_ = 0;

  constructor(
    private injector: Injector,
    private pluginLoader: PluginLoaderService,
    private pluginsConfig: PluginsConfigService
  ) {}

  ngOnInit() {
    try {
      this.loadPlugin(this.pluginName);
    } catch (e) {
      console.log(e);
    }
  }

  // Router reuses this view when navigating plugin → plugin (only the route
  // param changes): swap the mounted plugin instead of keeping the old one.
  ngOnChanges(changes: SimpleChanges) {
    const change = changes['pluginName'];
    if (change && !change.firstChange && change.currentValue !== change.previousValue) {
      this.loadPlugin(change.currentValue);
    }
  }

  ngOnDestroy() {
    this.loadToken_++;
    this.teardown_();
  }

  loadPlugin(pluginName: string) {
    const token = ++this.loadToken_;
    this.teardown_();
    this.entryError = false;
    // Fresh registry first: the module path carries the CR's resourceVersion,
    // so an updated plugin is a new URL for SystemJS instead of a cached module.
    this.pluginsConfig
      .refreshConfig()
      .catch((): void => undefined) // stale registry is better than no plugin
      .then(() => this.pluginLoader.load<unknown>(pluginName))
      .then((moduleFactory): void => {
        if (token !== this.loadToken_) {
          // A newer navigation superseded this load.
          return;
        }
        const moduleRef = moduleFactory.create(this.injector);
        const entryComponent = (moduleFactory.moduleType as any).entry;
        try {
          // ComponentFactoryResolver is gone in Angular 22; createComponent takes
          // the type plus the plugin module's injector/ngModuleRef directly.
          this.vcRef.createComponent(entryComponent, {ngModuleRef: moduleRef});
          this.moduleRef_ = moduleRef;
        } catch (e) {
          this.entryError = true;
        }
      });
  }

  private teardown_(): void {
    this.vcRef.clear();
    if (this.moduleRef_) {
      this.moduleRef_.destroy();
      this.moduleRef_ = null;
    }
  }
}
