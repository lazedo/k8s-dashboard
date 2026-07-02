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

import {Component, OnDestroy, OnInit} from '@angular/core';
import {ActivatedRoute} from '@angular/router';
import {ObjectMeta, TypeMeta} from '@api/root.api';
import {ActionbarService, ResourceMeta} from '@common/services/global/actionbar';

@Component({
    selector: 'kd-plugin-detail',
    template: ' <kd-plugin-holder [pluginName]="this.pluginName()"></kd-plugin-holder> ',
    standalone: false
})
export class PluginDetailComponent implements OnInit, OnDestroy {
  constructor(
    private readonly activatedRoute_: ActivatedRoute,
    private readonly actionbar_: ActionbarService
  ) {}

  ngOnInit(): void {
    // Drive the shared actionbar (pin + edit + delete), like CRDs. The Plugin is a
    // namespaced CRD; kind "plugin" matches the pinner-nav and the verber.
    // A GlobalPlugin has no namespace (single-segment route), so it is not
    // namespaced — this keeps the "N" indicator off its actionbar pin.
    const namespace = this.pluginNamespace();
    const objectMeta = {name: this.pluginName(), namespace} as ObjectMeta;
    const typeMeta = {kind: 'plugin'} as TypeMeta;
    const namespaced = !!namespace;
    // Defer to a microtask: PinDefaultActionbar (named outlet) subscribes to
    // onInit in its own ngOnInit, which may run after this one. CRDs avoid the
    // race because they emit from an async HTTP subscribe; we have no fetch, so
    // emit after the current activation finishes and the actionbar has subscribed.
    Promise.resolve().then(() =>
      this.actionbar_.onInit.emit(new ResourceMeta(this.pluginName(), objectMeta, typeMeta, namespaced))
    );
  }

  ngOnDestroy(): void {
    this.actionbar_.onDetailsLeave.emit();
  }

  pluginName(): string {
    return this.activatedRoute_.snapshot.params.pluginName;
  }

  pluginNamespace(): string {
    return this.activatedRoute_.snapshot.params.pluginNamespace;
  }
}
