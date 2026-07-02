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

import {HttpEvent, HttpHandler, HttpInterceptor, HttpRequest} from '@angular/common/http';
import {ApplicationRef, Injectable} from '@angular/core';
import {Observable} from 'rxjs';
import {finalize} from 'rxjs/operators';

// Angular is zoneless by default since v21: change detection runs only for
// views marked dirty (DOM events, markForCheck, signals). This codebase
// predates that and routinely mutates plain component state in HTTP subscribes
// (workload ratios, pinned nav, detail pages), which no longer re-renders on
// its own. Scheduling one coalesced ApplicationRef.tick() after every HTTP
// response restores the ZoneJS-era behavior where it matters, without touching
// every call site.
@Injectable()
export class TickInterceptor implements HttpInterceptor {
  private pending_ = false;

  constructor(private readonly appRef_: ApplicationRef) {}

  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    return next.handle(req).pipe(finalize(() => this.scheduleTick_()));
  }

  private scheduleTick_(): void {
    if (this.pending_) {
      return;
    }

    this.pending_ = true;
    queueMicrotask(() => {
      this.pending_ = false;
      try {
        // Angular v21+ refreshes only dirty view paths, even via tick() with
        // the roots marked — the classic full CheckAlways sweep is gone.
        // detectChanges() on the root views is the remaining public API that
        // synchronously checks a view and its whole CheckAlways subtree.
        for (const component of this.appRef_.components) {
          component.changeDetectorRef.detectChanges();
        }
      } catch (_) {
        // detectChanges() throws when change detection is already running;
        // that cycle will render the state this one was scheduled for.
      }
    });
  }
}
