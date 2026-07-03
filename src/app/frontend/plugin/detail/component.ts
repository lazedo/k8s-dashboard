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

import {ChangeDetectorRef, Component, OnDestroy, OnInit} from '@angular/core';
import {ActivatedRoute} from '@angular/router';
import {ObjectMeta, TypeMeta} from '@api/root.api';
import {ActionbarService, ResourceMeta} from '@common/services/global/actionbar';
import {Subject} from 'rxjs';
import {takeUntil} from 'rxjs/operators';

@Component({
    selector: 'kd-plugin-detail',
    template: ' <kd-plugin-holder [pluginName]="pluginName"></kd-plugin-holder> ',
    standalone: false
})
export class PluginDetailComponent implements OnInit, OnDestroy {
  pluginName: string;

  private readonly unsubscribe_ = new Subject<void>();

  constructor(
    private readonly activatedRoute_: ActivatedRoute,
    private readonly actionbar_: ActionbarService,
    private readonly cdr_: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    // The router reuses this component when only the plugin param changes
    // (plugin → plugin navigation), so track params as a stream — snapshot
    // alone would freeze the first plugin in place.
    this.activatedRoute_.params.pipe(takeUntil(this.unsubscribe_)).subscribe(params => {
      this.pluginName = params.pluginName;
      this.emitActionbar_(params.pluginName, params.pluginNamespace);
      this.cdr_.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.unsubscribe_.next();
    this.unsubscribe_.complete();
    this.actionbar_.onDetailsLeave.emit();
  }

  // Drive the shared actionbar (pin + edit + delete), like CRDs. The Plugin is a
  // namespaced CRD; kind "plugin" matches the pinner-nav and the verber.
  // A GlobalPlugin has no namespace (single-segment route), so it is not
  // namespaced — this keeps the "N" indicator off its actionbar pin.
  private emitActionbar_(name: string, namespace: string | undefined): void {
    const objectMeta = {name, namespace} as ObjectMeta;
    const namespaced = !!namespace;
    // GlobalPlugins are cluster-scoped: their own kind keeps the verber from
    // demanding a namespace on edit/delete.
    const typeMeta = {kind: namespaced ? 'plugin' : 'globalplugin'} as TypeMeta;
    // Defer to a microtask: PinDefaultActionbar (named outlet) subscribes to
    // onInit in its own ngOnInit, which may run after this one. CRDs avoid the
    // race because they emit from an async HTTP subscribe; we have no fetch, so
    // emit after the current activation finishes and the actionbar has subscribed.
    Promise.resolve().then(() => this.actionbar_.onInit.emit(new ResourceMeta(name, objectMeta, typeMeta, namespaced)));
  }
}
