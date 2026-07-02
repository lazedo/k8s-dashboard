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

import { HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import {ErrorHandler, NgModule} from '@angular/core';
import {MAT_FORM_FIELD_DEFAULT_OPTIONS} from '@angular/material/form-field';
import {TickInterceptor} from '@common/services/global/tick';
import {BrowserModule} from '@angular/platform-browser';
import {BrowserAnimationsModule} from '@angular/platform-browser/animations';
import {RouterModule} from '@angular/router';
import {ChromeModule} from './chrome/module';
import {CoreModule} from './core.module';
import {GlobalErrorHandler} from './error/handler';
import {RootComponent} from './index.component';
import {routes} from './index.routing';
import {LoginModule} from './login/module';

@NgModule({ declarations: [RootComponent],
    bootstrap: [RootComponent], imports: [BrowserModule,
        BrowserAnimationsModule,
        CoreModule,
        ChromeModule,
        LoginModule,
        RouterModule.forRoot(routes, {
            useHash: true,
            onSameUrlNavigation: 'reload',
        })], providers: [
        // Zone-based CD itself is requested via applicationProviders in
        // index.ts — in NgModule.providers it would be silently ineffective.
        // MDC form fields reserve subscript (hint/error) space by default,
        // inflating every field; size it dynamically like the legacy fields.
        { provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { subscriptSizing: 'dynamic' } },
        // Zoneless-era compatibility: re-render after HTTP responses (see tick.ts).
        { provide: HTTP_INTERCEPTORS, useClass: TickInterceptor, multi: true },
        { provide: ErrorHandler, useClass: GlobalErrorHandler }, provideHttpClient(withInterceptorsFromDi())] })
export class RootModule {}
