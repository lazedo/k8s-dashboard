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
import {ChangeDetectorRef, Component, OnInit, ViewChild, forwardRef} from '@angular/core';
import {CrdAvailabilityService} from '@common/services/global/crd';
import {CreateFromFormComponent} from '../component';
import {FormPluginHostComponent} from '../pluginhost/component';
import {FormActionBar, FormPluginButtonSpec, FormPluginForm} from './contract';
import {CRD_FORM_SCRIPT} from './scripts/crdform';

export interface FormCard {
  id: string;
  title: string;
  description: string;
  icon: string;
  // FormPlugin script run by kd-form-plugin-host; cards without a script are
  // built-in components (the Application deploy form).
  script?: string;
  // Passed to the script as ctx.args.
  args?: {};
}

const FORM_PLUGIN_CRD = 'formplugins.dashboard.k8s.io';

interface FormPluginSpec {
  title?: string;
  description?: string;
  icon?: string;
  script?: string;
  args?: {};
}

// The "Create from form" tab is a gallery of form cards; each card opens a
// guided form for one kind of resource. Stock cards (Application, Custom
// resource) are FormPlugins shipped built-in; further cards come from
// FormPlugin custom resources in the cluster. The container owns the action
// bar below the active form (see contract.ts).
@Component({
  selector: 'kd-create-from-form-cards',
  templateUrl: './template.html',
  styleUrls: ['./style.scss'],
  standalone: false,
  providers: [{provide: FormActionBar, useExisting: forwardRef(() => CreateFromFormCardsComponent)}],
})
export class CreateFromFormCardsComponent extends FormActionBar implements OnInit {
  // Only present while the corresponding card is open; used by the create
  // page's canDeactivate to keep the unsaved-changes prompt working.
  @ViewChild(CreateFromFormComponent) fromForm: CreateFromFormComponent;
  @ViewChild(FormPluginHostComponent) pluginHost: FormPluginHostComponent;

  cards: FormCard[] = [];
  active: FormCard = null;
  barButtons: FormPluginButtonSpec[] = [];

  private activeForm_: FormPluginForm = null;

  constructor(
    private readonly crdAvailability_: CrdAvailabilityService,
    private readonly http_: HttpClient,
    private readonly cdr_: ChangeDetectorRef
  ) {
    super();
  }

  canDeactivate(): boolean {
    if (this.fromForm) {
      return this.fromForm.canDeactivate();
    }
    return this.pluginHost ? !this.pluginHost.isDirty() : true;
  }

  // FormActionBar
  register(form: FormPluginForm): void {
    this.activeForm_ = form;
    this.update();
  }

  update(): void {
    this.barButtons = this.activeForm_ ? this.activeForm_.formButtons() : [];
    this.cdr_.markForCheck();
    // register()/buttons.set arrive from ngAfterViewInit — inside the change
    // detection flush, where a mark doesn't schedule another pass (zoneless).
    // Re-mark from a microtask so the bar paints on first render.
    queueMicrotask(() => this.cdr_.markForCheck());
  }

  unregister(form: FormPluginForm): void {
    if (this.activeForm_ === form) {
      this.activeForm_ = null;
      this.barButtons = [];
      this.cdr_.markForCheck();
    }
  }

  onBarClick(actionId: string): void {
    this.activeForm_?.onFormAction(actionId);
  }

  ngOnInit(): void {
    this.cards = [
      {
        id: 'deployment',
        title: 'Application',
        description: 'Deploy a containerized application (Deployment + optional Service).',
        icon: 'apps',
      },
      {
        id: 'crd',
        title: 'Custom resource',
        description: 'Create an object of any installed Custom Resource Definition from a form generated off its openAPI schema.',
        icon: 'extension',
        script: CRD_FORM_SCRIPT,
      },
    ];

    // Product example card: only offered when a Kazoo media CRD is installed.
    const kazooMediaCrd = this.crdAvailability_.installedNames().find(name => /media.*kazoo|kazoo.*media/.test(name));
    if (kazooMediaCrd) {
      this.cards.push({
        id: 'kazoo-media',
        title: 'Kazoo Media',
        description: `Create a Kazoo media resource (${kazooMediaCrd}).`,
        icon: 'library_music',
        script: CRD_FORM_SCRIPT,
        args: {presetPattern: 'media.*kazoo|kazoo.*media'},
      });
    }

    this.loadFormPlugins_();
  }

  open(card: FormCard): void {
    this.active = card;
  }

  back(): void {
    this.active = null;
  }

  // Cards contributed by FormPlugin custom resources. The typed CR endpoints
  // strip everything but metadata, so each object is re-fetched raw for its
  // spec (script, icon, ...). Absence of the CRD or RBAC errors degrade to
  // "no extra cards".
  private loadFormPlugins_(): void {
    this.http_.get<{items?: Array<{objectMeta?: {name?: string}}>}>(`api/v1/crd/_all/${FORM_PLUGIN_CRD}/object`).subscribe({
      next: list => {
        const names = (list?.items || []).map(item => item.objectMeta?.name).filter(Boolean);
        names.forEach(name => {
          this.http_.get<{spec?: FormPluginSpec}>(`api/v1/crd/_all/${FORM_PLUGIN_CRD}/${name}/raw`).subscribe({
            next: obj => {
              const spec = obj?.spec;
              if (!spec?.script) {
                return;
              }
              this.cards = [
                ...this.cards,
                {
                  id: `formplugin/${name}`,
                  title: spec.title || name,
                  description: spec.description || '',
                  icon: spec.icon || 'dynamic_form',
                  script: spec.script,
                  args: spec.args,
                },
              ];
              this.cdr_.markForCheck();
            },
            error: () => {},
          });
        });
      },
      error: () => {},
    });
  }
}
