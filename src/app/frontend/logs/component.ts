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

import { HttpParams } from '@angular/common/http';
import {ChangeDetectorRef, Component, ElementRef, OnDestroy, ViewChild} from '@angular/core';
import {MatDialog} from '@angular/material/dialog';
import {ActivatedRoute, Router} from '@angular/router';
import {LogControl, LogDetails, LogLine, LogSelection, LogSources} from '@api/root.api';

import {LogsDownloadDialog} from '@common/dialogs/download/dialog';
import {GlobalSettingsService} from 'common/services/global/globalsettings';
import {LogService} from 'common/services/global/logs';
import {NotificationSeverity, NotificationsService} from 'common/services/global/notifications';
import {EMPTY, forkJoin, merge, Observable, of, Subject, timer} from 'rxjs';
import {catchError, switchMap, take, takeUntil, tap} from 'rxjs/operators';

const i18n = {
  MSG_LOGS_ZEROSTATE_TEXT: 'The selected container has not logged any messages yet.',
  MSG_LOGS_TRUNCATED_WARNING: 'The middle part of the log file cannot be loaded, because it is too big.',
};

// Sentinel value used by the pod selector to aggregate logs from all pods of the owner.
const ALL_PODS = '__kd-all-pods__';

// Minimum interval (seconds) used to watch the owner for new/removed pods in auto mode.
const MIN_AUTO_WATCH_INTERVAL = 5;

// A log line paired with the pod it came from (aggregated "All pods" view).
interface PodLogLine {
  pod: string;
  line: LogLine;
}

@Component({
    selector: 'kd-logs',
    templateUrl: './template.html',
    styleUrls: ['./style.scss'],
    standalone: false
})
export class LogsComponent implements OnDestroy {
  @ViewChild('logViewContainer', {static: true}) logViewContainer_: ElementRef;
  readonly allPods = ALL_PODS;
  refreshInterval: number;
  podLogs: LogDetails;
  logsSet: string[];
  logSources: LogSources;
  pod: string;
  container: string;
  totalItems = 0;
  itemsPerPage = 10;
  currentSelection: LogSelection;
  isLoading: boolean;
  // Follows pods of the owner automatically: switches to (or, in the aggregated
  // view, includes) newly created pods without manual re-selection.
  autoMode = false;

  private readonly refreshUnsubscribe_ = new Subject<void>();
  private readonly autoWatchUnsubscribe_ = new Subject<void>();
  private readonly logsPerView = 100;
  private readonly maxLogSize = 2e9;
  private readonly namespace_: string;
  private readonly resourceType_: string;
  private readonly resourceName_: string;
  // Source lines of the aggregated view, kept for re-formatting (e.g. timestamp toggle).
  private allPodsLogs_: PodLogLine[] = [];

  constructor(
    readonly logService: LogService,
    private readonly activatedRoute_: ActivatedRoute,
    private readonly settingsService_: GlobalSettingsService,
    private readonly dialog_: MatDialog,
    private readonly notifications_: NotificationsService,
    private readonly _router: Router,
    private readonly cdr_: ChangeDetectorRef
  ) {
    this.isLoading = true;
    this.refreshInterval = this.settingsService_.getLogsAutoRefreshTimeInterval();

    this.namespace_ = this.activatedRoute_.snapshot.params.resourceNamespace;
    this.resourceType_ = this.activatedRoute_.snapshot.params.resourceType;
    this.resourceName_ = this.activatedRoute_.snapshot.params.resourceName;
    const containerName = this.activatedRoute_.snapshot.queryParams.container;

    // Jobs (e.g. indexed jobs with many short-lived workers) benefit the most from
    // following pods automatically, so auto mode is on by default for them.
    this.autoMode = this.resourceType_ === 'job';

    logService
      .getResource<LogSources>(`source/${this.namespace_}/${this.resourceName_}/${this.resourceType_}`)
      .pipe(
        switchMap<LogSources, Observable<LogDetails>>(data => {
          this.logSources = data;
          this.pod = data.podNames[0]; // Pick first pod (cannot use resource name as it may
          // not be a pod).
          this.container = containerName ? containerName : data.containerNames[0]; // Pick from URL or first.
          this.appendContainerParam_();

          return this.logService.getResource(`${this.namespace_}/${this.pod}/${this.container}`);
        })
      )
      .pipe(tap(_ => (this.logService.getAutoRefresh() ? this.toggleIntervalFunction_() : undefined)))
      .pipe(take(1))
      .subscribe(data => {
        this.updateUiModel_(data);
        this.isLoading = false;
        this.updateAutoWatch_();
        // Zoneless: the sources+logs chain resolves after the first render;
        // without a mark the spinner never leaves.
        this.cdr_.markForCheck();
      });
  }

  ngOnDestroy(): void {
    this._router.navigate([], {
      queryParams: {['container']: null},
      queryParamsHandling: 'merge',
    });

    this.refreshUnsubscribe_.next();
    this.refreshUnsubscribe_.complete();
    this.autoWatchUnsubscribe_.next();
    this.autoWatchUnsubscribe_.complete();
  }

  onContainerChange() {
    this.appendContainerParam_();
    this.loadNewest();
  }

  /**
   * Whether the logs were opened from a controller (Job/Deployment/etc.) rather
   * than a single pod, i.e. the owner may have multiple pods.
   */
  isController(): boolean {
    return this.resourceType_ !== 'pod';
  }

  /**
   * Whether the aggregated "All pods" option is selected.
   */
  isAllPods(): boolean {
    return this.pod === ALL_PODS;
  }

  /**
   * Executed when the user changes the selected pod. Picking a specific pod is an
   * explicit choice, so it disables automatic pod following; the aggregated
   * "All pods" option keeps it untouched.
   */
  onPodChange(): void {
    if (!this.isAllPods()) {
      this.autoMode = false;
      this.updateAutoWatch_();
    }
    this.loadNewest();
  }

  /**
   * Toggles automatic following of new/removed pods of the owner.
   */
  toggleAutoMode(): void {
    this.autoMode = !this.autoMode;
    this.updateAutoWatch_();
  }

  /**
   * Loads maxLogSize oldest lines of logs.
   */
  loadOldest(): void {
    this.loadView_(
      LogControl.LoadStart,
      LogControl.TimestampOldest,
      0,
      -this.maxLogSize - this.logsPerView,
      -this.maxLogSize,
      this.scrollToTop_.bind(this)
    );
  }

  /**
   * Loads maxLogSize newest lines of logs.
   */
  loadNewest(): void {
    if (this.isAllPods()) {
      this.loadAllPodsNewest_(this.scrollToBottom_.bind(this));
      return;
    }

    this.loadView_(
      LogControl.LoadEnd,
      LogControl.TimestampNewest,
      0,
      this.maxLogSize,
      this.maxLogSize + this.logsPerView,
      this.scrollToBottom_.bind(this)
    );
  }

  /**
   * Shifts view by maxLogSize lines to the past.
   */
  loadOlder(): void {
    this.loadView_(
      this.currentSelection.logFilePosition,
      this.currentSelection.referencePoint.timestamp,
      this.currentSelection.referencePoint.lineNum,
      this.currentSelection.offsetFrom - this.logsPerView,
      this.currentSelection.offsetFrom,
      this.scrollToBottom_.bind(this)
    );
  }

  /**
   * Shifts view by maxLogSize lines to the future.
   */
  loadNewer(): void {
    this.loadView_(
      this.currentSelection.logFilePosition,
      this.currentSelection.referencePoint.timestamp,
      this.currentSelection.referencePoint.lineNum,
      this.currentSelection.offsetTo,
      this.currentSelection.offsetTo + this.logsPerView,
      this.scrollToTop_.bind(this)
    );
  }

  onTextColorChange(): void {
    this.logService.toggleInverted();
  }

  onFontSizeChange(): void {
    this.logService.toggleCompact();
  }

  onShowTimestamp(): void {
    this.logService.toggleShowTimestamp();
    if (this.isAllPods()) {
      this.logsSet = this.formatAllPodsLogs_(this.allPodsLogs_);
    } else {
      this.logsSet = this.formatAllLogs_(this.podLogs.logs);
    }
  }

  /**
   * Execute when a user changes the selected option for show previous container logs.
   * @export
   */
  onPreviousChange(): void {
    this.logService.togglePrevious();
    this.loadNewest();
  }

  /**
   * Toggles log auto-refresh mechanism.
   */
  toggleLogAutoRefresh(): void {
    this.logService.toggleAutoRefresh();
    this.toggleIntervalFunction_();
  }

  downloadLog(): void {
    const dialogData = {
      data: {
        pod: this.pod,
        container: this.container,
        namespace: this.activatedRoute_.snapshot.paramMap.get('resourceNamespace'),
      },
    };
    this.dialog_.open(LogsDownloadDialog, dialogData);
  }

  /**
   * Listens for scroll events to set log following state.
   */
  onLogsScroll(): void {
    this.logService.setFollowing(this.isScrolledBottom_());
  }

  /**
   * Updates all state parameters and sets the current log view with the data returned from the
   * backend If logs are not available sets logs to no logs available message.
   */
  private updateUiModel_(podLogs: LogDetails): void {
    this.podLogs = podLogs;
    this.currentSelection = podLogs.selection;
    this.logsSet = this.formatAllLogs_(podLogs.logs);
    if (podLogs.info.truncated) {
      this.notifications_.push(i18n.MSG_LOGS_TRUNCATED_WARNING, NotificationSeverity.error);
    }

    if (this.logService.getFollowing()) {
      // Pauses very slightly for the view to refresh.
      setTimeout(() => {
        this.scrollToBottom_();
      });
    }
  }

  private formatAllLogs_(logs: LogLine[]): string[] {
    if (logs.length === 0) {
      logs = [{timestamp: '0', content: i18n.MSG_LOGS_ZEROSTATE_TEXT}];
    }
    return logs.map(line => this.formatLine_(line));
  }

  private formatLine_(line: LogLine, podPrefix?: string): string {
    // add timestamp if needed
    const showTimestamp = this.logService.getShowTimestamp();
    const prefix = podPrefix ? `[${podPrefix}] ` : '';
    const content = `${prefix}${line.content}`;
    return showTimestamp ? `${new Date(line.timestamp).toISOString()} | ${content}` : content;
  }

  private appendContainerParam_() {
    this._router.navigate([], {
      queryParams: {['container']: this.container},
      queryParamsHandling: 'merge',
    });
  }

  /**
   * Downloads and loads slice of logs as specified by offsetFrom and offsetTo.
   * It works just like normal slicing, but indices are referenced relatively to certain reference
   * line.
   * So for example if reference line has index n and we want to download first 10 elements in array
   * we have to use
   * from -n to -n+10.
   */
  private loadView_(
    logFilePosition: LogControl,
    referenceTimestamp: LogControl,
    referenceLinenum: number,
    offsetFrom: number,
    offsetTo: number,
    onLoad?: Function
  ): void {
    const namespace = this.activatedRoute_.snapshot.params.resourceNamespace;
    const params = new HttpParams()
      .set('logFilePosition', logFilePosition)
      .set('referenceTimestamp', referenceTimestamp)
      .set('referenceLineNum', `${referenceLinenum}`)
      .set('offsetFrom', `${offsetFrom}`)
      .set('offsetTo', `${offsetTo}`)
      .set('previous', `${this.logService.getPrevious()}`);
    this.logService
      .getResource(`${namespace}/${this.pod}/${this.container}`, params)
      .pipe(take(1))
      .subscribe((podLogs: LogDetails) => {
        this.updateUiModel_(podLogs);
        if (onLoad) {
          onLoad();
        }
        this.cdr_.markForCheck();
      });
  }

  /**
   * Fetches the newest logs of every pod of the owner (one request per pod, the
   * same follow/poll mechanism as the single pod view) and merges them into a
   * single view, each line prefixed with a short pod identifier. Ordering is
   * approximate: lines are sorted by their timestamps across pods.
   */
  private loadAllPodsNewest_(onLoad?: Function): void {
    const pods = (this.logSources && this.logSources.podNames) || [];
    if (pods.length === 0) {
      return;
    }

    const params = new HttpParams()
      .set('logFilePosition', LogControl.LoadEnd)
      .set('referenceTimestamp', LogControl.TimestampNewest)
      .set('referenceLineNum', '0')
      .set('offsetFrom', `${this.maxLogSize}`)
      .set('offsetTo', `${this.maxLogSize + this.logsPerView}`)
      .set('previous', `${this.logService.getPrevious()}`);

    forkJoin(
      pods.map(pod =>
        this.logService.getResource<LogDetails>(`${this.namespace_}/${pod}/${this.container}`, params).pipe(
          // A pod may not have the selected container (or may be gone already) - skip it.
          catchError(() => of(null as LogDetails))
        )
      )
    )
      .pipe(take(1))
      .subscribe(results => {
        const merged: PodLogLine[] = [];
        let fromDate = '';
        let toDate = '';
        let truncated = false;

        results.forEach((podLogs, index) => {
          if (!podLogs) {
            return;
          }
          for (const line of podLogs.logs) {
            merged.push({pod: pods[index], line});
          }
          if (podLogs.info) {
            if (!fromDate || podLogs.info.fromDate < fromDate) {
              fromDate = podLogs.info.fromDate;
            }
            if (!toDate || podLogs.info.toDate > toDate) {
              toDate = podLogs.info.toDate;
            }
            truncated = truncated || podLogs.info.truncated;
          }
        });

        // RFC3339 timestamps compare correctly as strings; the sort is stable, so
        // lines without a proper timestamp keep their per-pod order.
        merged.sort((a, b) => (a.line.timestamp < b.line.timestamp ? -1 : a.line.timestamp > b.line.timestamp ? 1 : 0));

        this.allPodsLogs_ = merged;
        this.podLogs = {
          info: {
            podName: '',
            containerName: this.container,
            initContainerName: '',
            fromDate,
            toDate,
            truncated,
          },
          logs: [],
          selection: this.currentSelection,
        };
        this.logsSet = this.formatAllPodsLogs_(merged);
        this.isLoading = false;

        if (this.logService.getFollowing()) {
          setTimeout(() => {
            this.scrollToBottom_();
          });
        }
        if (onLoad) {
          onLoad();
        }
        this.cdr_.markForCheck();
      });
  }

  private formatAllPodsLogs_(logs: PodLogLine[]): string[] {
    if (logs.length === 0) {
      return [this.formatLine_({timestamp: '0', content: i18n.MSG_LOGS_ZEROSTATE_TEXT})];
    }
    return logs.map(entry => this.formatLine_(entry.line, this.shortPodName_(entry.pod)));
  }

  /**
   * Short display identifier of a pod: the pod name minus the owner's name prefix
   * (e.g. "provision-0-5jqb6" -> "0-5jqb6"), or the trailing segments as fallback.
   */
  private shortPodName_(pod: string): string {
    const prefix = `${this.resourceName_}-`;
    if (pod.startsWith(prefix) && pod.length > prefix.length) {
      return pod.slice(prefix.length);
    }
    const segments = pod.split('-');
    return segments.length > 2 ? segments.slice(-2).join('-') : pod;
  }

  /**
   * (Re)starts the owner watch used by auto mode: periodically re-reads the log
   * sources and reacts to pod churn - a newly created pod (index retry, rolling
   * update) is switched to (single pod view) or included (aggregated view), and a
   * selection pointing at a pod that no longer exists falls back to the newest one.
   */
  private updateAutoWatch_(): void {
    this.autoWatchUnsubscribe_.next();
    if (!this.autoMode || !this.isController()) {
      return;
    }

    const interval = Math.max(this.settingsService_.getLogsAutoRefreshTimeInterval(), MIN_AUTO_WATCH_INTERVAL) * 1000;
    timer(interval, interval)
      .pipe(
        switchMap(() =>
          this.logService
            .getResource<LogSources>(`source/${this.namespace_}/${this.resourceName_}/${this.resourceType_}`)
            .pipe(catchError(() => EMPTY))
        )
      )
      .pipe(takeUntil(this.autoWatchUnsubscribe_))
      .subscribe(sources => {
        this.onSourcesUpdate_(sources);
        this.cdr_.markForCheck();
      });
  }

  private onSourcesUpdate_(sources: LogSources): void {
    const previousPods = (this.logSources && this.logSources.podNames) || [];
    const freshPods = sources.podNames.filter(pod => previousPods.indexOf(pod) < 0);
    this.logSources = sources;

    if (this.isAllPods()) {
      if (freshPods.length > 0) {
        this.loadAllPodsNewest_();
      }
      return;
    }

    if (freshPods.length > 0) {
      // A new pod of the owner appeared (index retry, rolling update) - follow it.
      this.pod = freshPods[freshPods.length - 1];
      this.loadNewest();
    } else if (sources.podNames.indexOf(this.pod) < 0 && sources.podNames.length > 0) {
      // The selected pod is gone - fall back to the newest one still listed.
      this.pod = sources.podNames[sources.podNames.length - 1];
      this.loadNewest();
    }
  }

  /**
   * Starts and stops interval function used to automatically refresh logs.
   */
  private toggleIntervalFunction_(): void {
    if (!this.logService.getAutoRefresh()) {
      this.refreshUnsubscribe_.next();
      return;
    }

    merge(this.settingsService_.onSettingsUpdate, of(true))
      .pipe(
        switchMap(_ => {
          this.refreshInterval = this.settingsService_.getLogsAutoRefreshTimeInterval();
          const interval = this.refreshInterval * 1000;
          return timer(0, interval === 0 ? undefined : interval);
        })
      )
      .pipe(takeUntil(this.refreshUnsubscribe_))
      .subscribe(_ => {
        if (this.isAllPods()) {
          this.loadAllPodsNewest_();
          return;
        }

        this.loadView_(
          LogControl.LoadEnd,
          LogControl.TimestampNewest,
          0,
          this.maxLogSize,
          this.maxLogSize + this.logsPerView
        );
      });
  }

  /**
   * Scrolls log view to the bottom of the page.
   */
  private scrollToBottom_(): void {
    this.scrollTo_('BOTTOM');
  }

  /**
   * Scrolls log view to the top of the page.
   */
  private scrollToTop_(): void {
    this.scrollTo_('TOP');
  }

  /**
   * Checks if the current logs scroll position is at the bottom.
   */
  private isScrolledBottom_(): boolean {
    const {nativeElement} = this.logViewContainer_;
    return nativeElement.scrollHeight <= nativeElement.scrollTop + nativeElement.clientHeight;
  }

  private scrollTo_(position: 'TOP' | 'BOTTOM'): void {
    const {nativeElement} = this.logViewContainer_;
    if (!nativeElement) {
      return;
    }

    let top;
    switch (position) {
      case 'TOP':
        top = 0;
        break;
      case 'BOTTOM':
        top = nativeElement.scrollHeight;
        break;
      default:
        return;
    }

    nativeElement.scrollTo({top, left: 0, behavior: 'smooth'});
  }
}
