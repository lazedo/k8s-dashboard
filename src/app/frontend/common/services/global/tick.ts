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

// The app runs zoneless (no zone.js): change detection runs only for views
// marked dirty (DOM events, markForCheck, signals). This codebase predates
// signals and routinely mutates plain component state in HTTP subscribes
// (workload ratios, pinned nav, detail pages), which no longer re-renders on
// its own. Until every such call site is migrated to signals/OnPush, one
// coalesced sweep after each HTTP response bridges the gap.
//
// IMPORTANT — why detectChanges() on the roots and NOT ApplicationRef.tick():
// in zoneless Angular, tick() only refreshes views reachable through the
// dirty-flag traversal (marked via markForCheck/signals). A plain HTTP subscribe
// that mutates a component property marks nothing dirty, so tick() is a no-op
// and the view stays stale — exactly the bug this shim exists to paper over.
// ChangeDetectorRef.detectChanges() instead force-checks a view and its whole
// CheckAlways subtree unconditionally, which is what restores the ZoneJS-era
// behavior for the un-migrated components.
//
// Scope: this force-checks appRef.components (the bootstrapped root tree). It
// does NOT reach CDK/Material overlays (dialogs, menus) — those attach as
// separate views via appRef.attachView() and are not in `components`. Overlays
// that mutate state from an async source must call detectChanges() themselves
// (see common/dialogs/download/dialog.ts); markForCheck() is not enough zoneless.
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
