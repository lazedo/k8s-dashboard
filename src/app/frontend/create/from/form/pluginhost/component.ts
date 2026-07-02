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

import {HttpClient} from '@angular/common/http';
import {AfterViewInit, Component, ElementRef, EventEmitter, Input, OnDestroy, Optional, Output, ViewChild} from '@angular/core';
import {CreateService} from '@common/services/create/service';
import {NamespaceService} from '@common/services/global/namespace';
import {firstValueFrom} from 'rxjs';

import {FormActionBar, FormPluginButtonSpec, FormPluginForm} from '../contract';

// The ctx object handed to a FormPlugin script. The script renders arbitrary
// HTML into its host element; the dashboard keeps ownership of the action bar
// and of every API interaction (submit goes through CreateService — scripts
// never talk to the cluster with their own credentials).
export interface FormPluginCtx {
  namespace: string;
  args: {};
  http: {
    get(url: string): Promise<{}>;
    post(url: string, body: {}): Promise<{}>;
  };
  buttons: {
    set(specs: FormPluginButtonSpec[]): void;
    patch(id: string, patch: Partial<FormPluginButtonSpec>): void;
  };
  onAction(handler: (actionId: string) => void): void;
  submit(content: string | {}): Promise<{}>;
  markDirty(dirty?: boolean): void;
  close(): void;
}

// Runs a FormPlugin script: plain JavaScript with signature (host, ctx).
// Stock cards (Custom resource) and FormPlugin CRs share this exact code path.
@Component({
  selector: 'kd-form-plugin-host',
  template: '<div class="kd-form-plugin-host" #host></div>',
  styleUrls: ['./style.scss'],
  standalone: false,
})
export class FormPluginHostComponent implements AfterViewInit, OnDestroy, FormPluginForm {
  @Input() script: string;
  @Input() args: {};
  @Output() closed = new EventEmitter<void>();
  @ViewChild('host') hostRef: ElementRef<HTMLElement>;

  private buttons_: FormPluginButtonSpec[] = [
    {id: 'create', label: 'Create', raised: true},
    {id: 'cancel', label: 'Cancel'},
  ];
  private actionHandler_: (actionId: string) => void = null;
  private dirty_ = false;

  constructor(
    @Optional() private readonly actionBar_: FormActionBar,
    private readonly http_: HttpClient,
    private readonly create_: CreateService,
    private readonly namespace_: NamespaceService
  ) {}

  ngAfterViewInit(): void {
    this.actionBar_?.register(this);
    try {
      // eslint-disable-next-line no-new-func
      const run = new Function('host', 'ctx', this.script);
      run(this.hostRef.nativeElement, this.makeCtx_());
    } catch (err) {
      this.hostRef.nativeElement.textContent = `Form plugin failed: ${err}`;
    }
  }

  ngOnDestroy(): void {
    this.actionBar_?.unregister(this);
  }

  isDirty(): boolean {
    return this.dirty_;
  }

  // FormPluginForm
  formButtons(): FormPluginButtonSpec[] {
    return this.buttons_;
  }

  onFormAction(actionId: string): void {
    if (this.actionHandler_) {
      this.actionHandler_(actionId);
      return;
    }
    if (actionId === 'cancel') {
      this.closed.emit();
    }
  }

  private makeCtx_(): FormPluginCtx {
    return {
      namespace: this.namespace_.current(),
      args: this.args || {},
      http: {
        get: (url: string) => firstValueFrom(this.http_.get(url)),
        post: (url: string, body: {}) => firstValueFrom(this.http_.post(url, body)),
      },
      buttons: {
        set: (specs: FormPluginButtonSpec[]) => {
          this.buttons_ = specs || [];
          this.actionBar_?.update();
        },
        patch: (id: string, patch: Partial<FormPluginButtonSpec>) => {
          this.buttons_ = this.buttons_.map(b => (b.id === id ? {...b, ...patch} : b));
          this.actionBar_?.update();
        },
      },
      onAction: (handler: (actionId: string) => void) => (this.actionHandler_ = handler),
      submit: (content: string | {}) => {
        const text = typeof content === 'string' ? content : JSON.stringify(content);
        return this.create_.createContent(text).then(result => {
          this.dirty_ = false;
          return result as {};
        });
      },
      markDirty: (dirty = true) => (this.dirty_ = dirty),
      close: () => this.closed.emit(),
    };
  }
}
