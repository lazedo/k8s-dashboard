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


import { HttpClient } from '@angular/common/http';
import {ChangeDetectorRef, Component, Inject, OnDestroy, OnInit, DOCUMENT} from '@angular/core';
import {Router} from '@angular/router';
import {Subject} from 'rxjs';
import {takeUntil} from 'rxjs/operators';

import {AssetsService} from '@common/services/global/assets';
import {ClusterService} from '@common/services/global/cluster';
import {GlobalSettingsService} from '@common/services/global/globalsettings';

class SystemBanner {
  message: string;
  severity: string;
}

@Component({
    selector: 'kd-chrome',
    templateUrl: './template.html',
    styleUrls: ['./style.scss'],
    standalone: false
})
export class ChromeComponent implements OnInit, OnDestroy {
  private static readonly systemBannerEndpoint = 'api/v1/systembanner';
  private systemBanner_: SystemBanner;
  private readonly unsubscribe_ = new Subject<void>();
  loading = false;

  constructor(
    public assets: AssetsService,
    private readonly http_: HttpClient,
    private readonly router_: Router,
    @Inject(DOCUMENT) private readonly document_: Document,
    private readonly globalSettings_: GlobalSettingsService,
    private readonly clusters_: ClusterService,
    private readonly cdr_: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.http_
      .get<SystemBanner>(ChromeComponent.systemBannerEndpoint)
      .toPromise()
      .then(sb => {
        this.systemBanner_ = sb;
      });

    // The toolbar tint and badge follow the selected cluster (zoneless: repaint on change).
    this.clusters_.changed.pipe(takeUntil(this.unsubscribe_)).subscribe(() => this.cdr_.markForCheck());
    this.registerVisibilityChangeHandler_();
  }

  ngOnDestroy(): void {
    this.unsubscribe_.next();
    this.unsubscribe_.complete();
  }

  // True when the dashboard is looking at a cluster other than its own: the top bar is
  // tinted and badged so a delete on "the hub" can never silently land on a site.
  isRemoteCluster(): boolean {
    return !this.clusters_.isLocal();
  }

  currentCluster(): string {
    return this.clusters_.current();
  }

  getWorkloadsStateName(): string {
    return '/workloads';
  }

  isSystemBannerVisible(): boolean {
    return this.systemBanner_ && this.systemBanner_.message.length > 0;
  }

  getSystemBannerClass(): string {
    const severity = this.systemBanner_ && this.systemBanner_.severity ? this.systemBanner_.severity.toLowerCase() : '';
    switch (severity) {
      case 'warning':
        return 'kd-bg-warning-light';
      case 'error':
        return 'kd-bg-error-light';
      default:
        return 'kd-bg-success-light';
    }
  }

  getSystemBannerMessage(): string {
    return this.systemBanner_ ? this.systemBanner_.message : '';
  }

  goToCreateState(): void {
    this.router_.navigate(['create'], {queryParamsHandling: 'preserve'});
  }

  private registerVisibilityChangeHandler_(): void {
    if (typeof this.document_.addEventListener === 'undefined') {
      console.log(
        'Your browser does not support Page Visibility API. Page cannot properly stop background tasks when tab is inactive.'
      );
      return;
    }

    this.document_.addEventListener('visibilitychange', this.handleVisibilityChange_.bind(this), false);
  }

  private handleVisibilityChange_(): void {
    this.globalSettings_.onPageVisibilityChange.emit(!this.document_.hidden);
  }
}
