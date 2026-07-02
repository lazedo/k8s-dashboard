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
import {Injectable} from '@angular/core';
import {Subject} from 'rxjs';
import {Me} from '@api/root.api';

// MeService exposes the identity behind the current request, read from the backend
// /api/v1/me endpoint (which decodes the bearer token's claims). Works transparently
// when Dashboard sits behind an OIDC proxy that injects an id_token.
@Injectable()
export class MeService {
  private user_: Me = {authenticated: false};

  constructor(private readonly http_: HttpClient) {}

  // Emits when the identity finishes (re)loading, so views reading the
  // getters can markForCheck (required since the zoneless default).
  loaded = new Subject<void>();

  init(): void {
    this.reload();
  }

  reload(): void {
    this.http_.get<Me>('api/v1/me').subscribe({
      next: user => {
        this.user_ = user || {authenticated: false};
        this.loaded.next();
      },
      error: () => {
        this.user_ = {authenticated: false};
        this.loaded.next();
      },
    });
  }

  getUser(): Me {
    return this.user_;
  }

  getUserName(): string {
    return this.user_.name || '';
  }

  getPicture(): string {
    return this.user_.picture || '';
  }
}
