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

import { HttpClient, HttpEventType, HttpParams, HttpRequest, HttpResponse } from '@angular/common/http';
import {ChangeDetectorRef, Component, Inject, OnDestroy} from '@angular/core';
import {MAT_DIALOG_DATA, MatDialogRef} from '@angular/material/dialog';
import {LogOptions} from '@api/root.api';
import {saveAs} from 'file-saver';
import {Subject} from 'rxjs';
import {takeUntil} from 'rxjs/operators';

import {LogService} from '../../services/global/logs';

export interface LogsDownloadDialogMeta {
  pod: string;
  container: string;
  namespace: string;
}

@Component({
    selector: 'kd-logs-download-dialog',
    templateUrl: 'template.html',
    styleUrls: ['style.scss'],
    standalone: false
})
export class LogsDownloadDialog implements OnDestroy {
  loaded = 0;
  finished = false;

  private _result: Blob;
  private _error: number;
  private _unsubscribe = new Subject<void>();

  private get _logOptions(): LogOptions {
    return {
      previous: this.logService.getPrevious(),
      timestamps: this.logService.getShowTimestamp(),
    };
  }

  constructor(
    private readonly _dialogRef: MatDialogRef<LogsDownloadDialog>,
    @Inject(MAT_DIALOG_DATA) public data: LogsDownloadDialogMeta,
    private readonly logService: LogService,
    private readonly http_: HttpClient,
    private readonly cdr_: ChangeDetectorRef
  ) {
    const logUrl = `api/v1/log/file/${data.namespace}/${data.pod}/${data.container}`;

    this.http_
      .request(
        // GET takes options as the 3rd argument. The previous 4th-argument form
        // passed `{}` as a request BODY: harmless on the legacy XHR backend, but
        // Angular's fetch backend (the default since the v22 upgrade) rejects a
        // GET/HEAD with a body ("Request with GET/HEAD method cannot have body"),
        // so the download errored immediately and the dialog hung on "Size 0.00 B".
        new HttpRequest('GET', logUrl, {
          reportProgress: true,
          responseType: 'blob',
          params: new HttpParams({fromObject: this._logOptions}),
        })
      )
      .pipe(takeUntil(this._unsubscribe))
      .subscribe(
        event => {
          if (event.type === HttpEventType.DownloadProgress) {
            this.loaded = event.loaded;
          } else if (event instanceof HttpResponse) {
            this.finished = true;
            this._result = new Blob([event.body as BlobPart], {type: 'text/plan'});
          } else {
            // Sent / ResponseHeader and other non-rendering events — nothing to
            // paint, and touching change detection here is actively harmful (see
            // renderAsync_).
            return;
          }
          this.renderAsync_();
        },
        error => {
          this._error = error.status;
          this.renderAsync_();
        }
      );
  }

  // Zoneless: this dialog is a CDK overlay attached to the ApplicationRef as its
  // own view, outside the root tree the global HTTP sweep force-checks (see
  // common/services/global/tick.ts). markForCheck() only flags it dirty for a
  // traversal that never arrives, so the overlay never repaints; detectChanges()
  // force-checks this view. But this subscription is created in the constructor
  // and HttpClient emits its first event (Sent, with reportProgress) synchronously
  // before the overlay's view exists — a synchronous detectChanges() then hits a
  // null view and throws, killing the subscription so the response never renders.
  // Defer to a microtask (the view is initialized by then) and swallow the throw
  // for a view that is already being checked or has been destroyed (dialog closed).
  private renderAsync_(): void {
    queueMicrotask(() => {
      try {
        this.cdr_.detectChanges();
      } catch (_) {}
    });
  }

  ngOnDestroy(): void {
    this._unsubscribe.next();
    this._unsubscribe.complete();
  }

  hasForbiddenError(): boolean {
    return this._error !== undefined && this._error === 403;
  }

  save(): void {
    saveAs(this._result, this.logService.getLogFileName(this.data.pod, this.data.container));
    this._dialogRef.close();
  }

  abort(): void {
    this._dialogRef.close();
  }

  getDownloadMode(): string {
    return this.finished ? 'determinate' : 'indeterminate';
  }
}
