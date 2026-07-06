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
import {PluginMetadata, PluginsConfig} from '@api/root.ui';
import {Observable, Subject} from 'rxjs';

@Injectable()
export class PluginsConfigService {
  // Fires after every config (re)fetch so views gated on plugin presence
  // (the nav's Plugins entry) can markForCheck — zoneless default.
  changed = new Subject<void>();

  private readonly pluginConfigPath_ = 'api/v1/plugin/config';
  private config_: PluginsConfig = {status: 204, plugins: [], errors: []};

  constructor(private readonly http: HttpClient) {}

  init(): Promise<PluginsConfig> {
    return this.fetchConfig();
  }

  refreshConfig(): void {
    this.fetchConfig();
  }

  anyPlugins(): boolean {
    return this.config_.plugins.length > 0;
  }

  private fetchConfig(): Promise<PluginsConfig> {
    return this.getConfig()
      .toPromise()
      .then(config => {
        this.config_ = config;
        this.changed.next();
        return config;
      });
  }

  private getConfig(): Observable<PluginsConfig> {
    return this.http.get<PluginsConfig>(this.pluginConfigPath_);
  }

  pluginsMetadata(): PluginMetadata[] {
    return this.config_.plugins;
  }

  // Plugin-declared side-nav groups (spec.nav), for the chrome nav to render.
  navGroups(): PluginMetadata[] {
    return this.config_.plugins.filter(p => !!p.nav && !!p.nav.group);
  }

  status(): number {
    return this.config_.status;
  }
}
