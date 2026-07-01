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
import {Subscription} from 'rxjs';

@Component({
  selector: 'kd-daemon-set-list-state',
  template: '<kd-daemon-set-list [showMetrics]="true" [statusFilter]="statusFilter"></kd-daemon-set-list>',
})
export class DaemonSetListComponent implements OnInit, OnDestroy {
  // Optional status filter carried in the URL (?statusFilter=Running), set by
  // clicking a status on the Workload Status chart.
  statusFilter = '';
  private sub_: Subscription;

  constructor(private readonly route_: ActivatedRoute) {}

  ngOnInit(): void {
    this.sub_ = this.route_.queryParams.subscribe(params => (this.statusFilter = params['statusFilter'] || ''));
  }

  ngOnDestroy(): void {
    this.sub_?.unsubscribe();
  }
}
