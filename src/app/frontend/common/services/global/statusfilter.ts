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

import {Injectable} from '@angular/core';

// One-shot carrier for the status filter picked by clicking a segment on the
// Workload Status chart. The chart stores {route, status} and navigates to the
// list; the target list consumes it exactly once on init. Nothing is kept in
// the URL or in storage, so the filter can never leak into a later navigation —
// the chip's X re-renders the current list unfiltered, and navigating away
// simply drops it.
@Injectable()
export class StatusFilterService {
  private route_ = '';
  private status_ = '';

  set(route: string, status: string): void {
    this.route_ = route;
    this.status_ = status;
  }

  // Returns the pending status for the given list route and clears it.
  consume(route: string): string {
    if (this.route_ !== route) {
      return '';
    }

    const status = this.status_;
    this.route_ = '';
    this.status_ = '';
    return status;
  }
}
