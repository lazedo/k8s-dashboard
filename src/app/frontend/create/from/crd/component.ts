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
import {ChangeDetectorRef, Component, Input, OnInit} from '@angular/core';
import {Router} from '@angular/router';
import {CRD, CRDDetail, CRDList} from '@api/root.api';
import {NAMESPACE_STATE_PARAM} from '@common/params/params';
import {CreateService} from '@common/services/create/service';
import {HistoryService} from '@common/services/global/history';
import {NamespaceService} from '@common/services/global/namespace';

// Creates an object of a CustomResourceDefinition: pick a CRD (optionally
// pre-selected via [presetPattern]) and the component seeds an editable YAML
// skeleton with the right apiVersion/kind/metadata for it.
@Component({
  selector: 'kd-create-from-crd',
  templateUrl: './template.html',
  standalone: false,
})
export class CreateFromCrdComponent implements OnInit {
  // Optional regex; the first installed CRD matching it is pre-selected
  // (used by preset cards like Kazoo Media).
  @Input() presetPattern: string;

  crds: CRD[] = [];
  filterQuery = '';
  selected: CRDDetail;
  inputData = '';
  loading = false;

  constructor(
    private readonly http_: HttpClient,
    private readonly create_: CreateService,
    private readonly namespace_: NamespaceService,
    private readonly history_: HistoryService,
    private readonly router_: Router,
    private readonly cdr_: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loading = true;
    this.http_.get<CRDList>('api/v1/crd?itemsPerPage=2000&page=1').subscribe(list => {
      this.crds = (list.items || []).sort((a, b) => a.objectMeta.name.localeCompare(b.objectMeta.name));
      this.loading = false;
      this.cdr_.markForCheck();

      if (this.presetPattern) {
        const re = new RegExp(this.presetPattern);
        const preset = this.crds.find(crd => re.test(crd.objectMeta.name));
        if (preset) {
          this.filterQuery = preset.objectMeta.name;
          // Defer past the first render — selecting mid-initial-CD leaves the
          // view un-refreshed inside the lazily rendered mat-tab content.
          setTimeout(() => this.select(preset.objectMeta.name));
        }
      }
    });
  }

  filteredCrds(): CRD[] {
    const query = this.filterQuery.trim().toLowerCase();
    if (!query) {
      return this.crds;
    }

    return this.crds.filter(crd => crd.objectMeta.name.toLowerCase().includes(query));
  }

  select(crdName: string): void {
    this.http_.get<CRDDetail>(`api/v1/crd/${crdName}`).subscribe(detail => {
      this.selected = detail;
      this.inputData = this.skeletonFor_(detail);
      this.cdr_.markForCheck();
      this.cdr_.detectChanges();
    });
  }

  isCreateDisabled(): boolean {
    return !this.inputData || this.inputData.length === 0;
  }

  create(): void {
    this.create_.createContent(this.inputData).then(() => {
      this.router_.navigate(['customresourcedefinition', this.selected.objectMeta.name], {
        queryParams: {[NAMESPACE_STATE_PARAM]: this.namespace_.current()},
      });
    });
  }

  cancel(): void {
    this.history_.goToPreviousState('overview');
  }

  private skeletonFor_(crd: CRDDetail): string {
    const version = crd.version || crd.versions?.find(v => v.storage)?.name || crd.versions?.[0]?.name || 'v1';
    const name = `my-${crd.names.singular || crd.names.kind.toLowerCase()}`;
    const lines = [`apiVersion: ${crd.group}/${version}`, `kind: ${crd.names.kind}`, 'metadata:', `  name: ${name}`];

    if (crd.scope === 'Namespaced') {
      const ns = this.namespace_.areMultipleNamespacesSelected() ? 'default' : this.namespace_.current();
      lines.push(`  namespace: ${ns}`);
    }

    lines.push('spec:', `  # Fill in the ${crd.names.kind} spec.`, `  # kubectl explain ${crd.objectMeta.name}`, '');
    return lines.join('\n');
  }
}
