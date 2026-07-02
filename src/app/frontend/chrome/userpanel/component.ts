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

import {ChangeDetectorRef, Component, Inject, OnInit, ViewChild} from '@angular/core';
import {MatMenuTrigger} from '@angular/material/menu';
import {LoginStatus} from '@api/root.api';
import {IConfig} from '@api/root.ui';
import {AuthService} from '@common/services/global/authentication';
import {MeService} from '@common/services/global/me';
import {CookieService} from 'ngx-cookie-service';
import {CONFIG_DI_TOKEN} from '../../index.config';

@Component({
    selector: 'kd-user-panel',
    templateUrl: './template.html',
    styleUrls: ['./style.scss'],
    host: {
        '[class.kd-hidden]': 'this.isAuthEnabled() === false',
    },
    standalone: false
})
export class UserPanelComponent implements OnInit {
  @ViewChild(MatMenuTrigger)
  private readonly trigger_: MatMenuTrigger;

  loginStatus: LoginStatus;
  isLoginStatusInitialized = false;

  constructor(
    private readonly cdr_: ChangeDetectorRef,
    private readonly authService_: AuthService,
    private readonly cookieService_: CookieService,
    private readonly me_: MeService,
    @Inject(CONFIG_DI_TOKEN) private readonly config_: IConfig
  ) {}

  get hasUsername(): boolean {
    return !!this.name;
  }

  // Prefer the identity from /me (JWT claims, e.g. an OIDC id_token injected by a
  // proxy); fall back to the legacy username cookie.
  get name(): string {
    return this.me_.getUserName() || this.cookieService_.get(this.config_.usernameCookieName);
  }

  get username(): string {
    return this.name;
  }

  get email(): string {
    return this.me_.getUser().email || '';
  }

  get picture(): string {
    return this.me_.getPicture();
  }

  ngOnInit(): void {
    this.me_.init();
    // Zoneless default: both async loads must mark this view or the avatar and
    // login status only appear after an unrelated user event.
    this.me_.loaded.subscribe(() => this.cdr_.markForCheck());
    this.authService_.getLoginStatus().subscribe(status => {
      this.loginStatus = status;
      this.isLoginStatusInitialized = true;
      this.cdr_.markForCheck();
    });
  }

  isAuthSkipped(): boolean {
    return this.loginStatus && !this.authService_.isLoginPageEnabled() && !this.loginStatus.headerPresent;
  }

  isLoggedIn(): boolean {
    return this.loginStatus && !this.loginStatus.headerPresent && this.loginStatus.tokenPresent;
  }

  isAuthEnabled(): boolean {
    return this.loginStatus ? this.loginStatus.httpsMode : false;
  }

  logout(): void {
    this.authService_.logout();
  }

  close(): void {
    this.trigger_.closeMenu();
  }
}
