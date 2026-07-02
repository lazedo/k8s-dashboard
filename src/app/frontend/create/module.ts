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

import {NgModule} from '@angular/core';

import {ComponentsModule} from '@common/components/module';
import {CreateServiceModule} from '@common/services/create/module';
import {CanDeactivateGuard} from '@common/services/guard/candeactivate';
import {SharedModule} from '../shared.module';

import {CreateComponent} from './component';
import {CreateFromCrdComponent} from './from/crd/component';
import {CreateFromFileComponent} from './from/file/component';
import {CreateFromFormCardsComponent} from './from/form/cards/component';
import {CreateFromFormModule} from './from/form/stock/application/module';
import {CreateFromInputComponent} from './from/input/component';
import {CreateFromUrlComponent} from './from/url/component';
import {FormPluginHostComponent} from './from/form/pluginhost/component';
import {CreateRoutingModule} from './routing';

@NgModule({
  imports: [SharedModule, ComponentsModule, CreateFromFormModule, CreateServiceModule, CreateRoutingModule],
  declarations: [
    CreateComponent,
    CreateFromInputComponent,
    CreateFromFileComponent,
    CreateFromUrlComponent,
    CreateFromCrdComponent,
    CreateFromFormCardsComponent,
    FormPluginHostComponent,
  ],
  providers: [CanDeactivateGuard],
})
export class CreateModule {}
