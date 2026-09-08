// Copyright 2024 The Kubernetes Authors.
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

import {HttpClient, HttpContext} from '@angular/common/http';
import {HUB_ONLY} from './interceptor';
import {Injectable} from '@angular/core';

interface CrdListItem {
  objectMeta?: {name?: string};
}

interface CrdListResponse {
  items?: CrdListItem[];
}

// CrdAvailabilityService caches which CustomResourceDefinitions are installed so
// the nav can hide menu items for optional CRD-backed resources (VPA, KEDA,
// Karpenter, Cluster API) that are not present in the cluster. It is populated
// once at bootstrap via APP_INITIALIZER, so the nav reads it synchronously.
@Injectable()
export class CrdAvailabilityService {
  private readonly crdListPath_ = 'api/v1/crd?itemsPerPage=2000&page=1';
  private installed_ = new Set<string>();
  // If the CRD list can't be read (e.g. RBAC), fail OPEN: show the optional
  // items (they degrade to an empty list) rather than hide a working feature.
  private failedOpen_ = false;

  constructor(private readonly http: HttpClient) {}

  init(): Promise<void> {
    return this.http
      .get<CrdListResponse>(this.crdListPath_, {context: new HttpContext().set(HUB_ONLY, true)})
      .toPromise()
      .then(list => {
        this.installed_ = new Set(
          (list?.items || []).map(item => item.objectMeta?.name).filter((name): name is string => !!name)
        );
        this.failedOpen_ = false;
      })
      .catch(() => {
        this.installed_ = new Set();
        this.failedOpen_ = true;
      });
  }

  // isInstalled reports whether a CRD (by full name, e.g.
  // "verticalpodautoscalers.autoscaling.k8s.io") is present in the cluster.
  isInstalled(crdName: string): boolean {
    return this.failedOpen_ || this.installed_.has(crdName);
  }

  // isAnyInstalled reports whether any of the given CRDs is present (used to
  // hide a whole nav group when none of its optional resources exist).
  isAnyInstalled(crdNames: string[]): boolean {
    return this.failedOpen_ || crdNames.some(name => this.installed_.has(name));
  }

  // installedNames returns the full names of every installed CRD (empty when
  // the list could not be read). Used by feature cards that look for a CRD by
  // pattern rather than exact name (e.g. the Kazoo Media create card).
  installedNames(): string[] {
    return Array.from(this.installed_);
  }
}
