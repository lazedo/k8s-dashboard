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

import {Location} from '@angular/common';
import {HttpEvent, HttpHandler, HttpInterceptor, HttpRequest} from '@angular/common/http';
import {Inject, Injectable} from '@angular/core';
import {IConfig} from '@api/root.ui';
import {CookieService} from 'ngx-cookie-service';
import {Observable} from 'rxjs';
import {CONFIG_DI_TOKEN} from '../../../index.config';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  constructor(
    private readonly cookies_: CookieService,
    @Inject(CONFIG_DI_TOKEN) private readonly appConfig_: IConfig,
    private readonly location_: Location
  ) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    // Only requests made to our backend, starting with 'api/v1', are touched.
    if (!req.url.startsWith('api/v1')) {
      return next.handle(req);
    }

    // Append request header with token stored in a cookie.
    const authCookie = this.cookies_.get(this.appConfig_.authTokenCookieName);
    if (authCookie.length) {
      req = req.clone({
        headers: req.headers.set(this.appConfig_.authTokenHeaderName, authCookie),
      });
    }

    // Remote clusters: a route opened as '#/...?cluster=west' targets that cluster, so propagate
    // the parameter to backend calls that do not name one themselves (see docs/plugins/README.md).
    const cluster = this.routeCluster_();
    if (cluster && !req.params.has('cluster') && !/[?&]cluster=/.test(req.url)) {
      req = req.clone({setParams: {cluster}});
    }

    return next.handle(req);
  }

  // The app uses hash routing, so the query string of the route lives in Location.path(), not in
  // window.location.search.
  private routeCluster_(): string {
    const path = this.location_.path();
    const query = path.indexOf('?');
    return query < 0 ? '' : new URLSearchParams(path.slice(query + 1)).get('cluster') || '';
  }
}
