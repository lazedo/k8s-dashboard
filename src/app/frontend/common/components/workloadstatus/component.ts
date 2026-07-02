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

import {Component, Input} from '@angular/core';
import {Router} from '@angular/router';
import {ResourcesRatio} from '@api/root.ui';
import {StatusFilterService} from '@common/services/global/statusfilter';

export const emptyResourcesRatio: ResourcesRatio = {
  cronJobRatio: [],
  daemonSetRatio: [],
  deploymentRatio: [],
  jobRatio: [],
  podRatio: [],
  replicaSetRatio: [],
  replicationControllerRatio: [],
  statefulSetRatio: [],
};

@Component({
    selector: 'kd-workload-statuses',
    templateUrl: './template.html',
    styleUrls: ['./style.scss'],
    standalone: false
})
export class WorkloadStatusComponent {
  @Input() resourcesRatio = emptyResourcesRatio;
  colors: string[] = [];
  animations = false;
  labels = true;
  trimLabels = false;
  size = [350, 250];

  constructor(
    private readonly router_: Router,
    private readonly statusFilter_: StatusFilterService
  ) {}

  // Clicking a status slice of a workload chart navigates to that workload's list
  // filtered by the clicked status. The filter travels one-shot via
  // StatusFilterService (not the URL), so it applies only to the list navigated
  // to and never leaks into later navigations. `route` is the list route segment
  // (e.g. 'deployment').
  onSelect(event: {name?: string; label?: string; value?: string} | string, route: string): void {
    const raw = typeof event === 'string' ? event : event?.name ?? event?.label ?? event?.value ?? '';
    // Ratio labels look like "Running: 3"; keep just the status word.
    const status = `${raw}`.split(':')[0].trim();
    if (status) {
      this.statusFilter_.set(route, status);
      this.router_.navigate([route], {queryParamsHandling: 'preserve'});
    }
  }

  getCustomColor(label: string): string {
    if (label.includes('Running')) {
      return '#00c752';
    } else if (label.includes('Succeeded')) {
      return '#006028';
    } else if (label.includes('Pending')) {
      return '#ffad20';
    } else if (label.includes('Failed')) {
      return '#f00';
    }
    return '';
  }
}
