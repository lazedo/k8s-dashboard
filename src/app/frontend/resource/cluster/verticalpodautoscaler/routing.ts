// Copyright 2024 The Kubernetes Authors.
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
import {Route, RouterModule} from '@angular/router';
import {DEFAULT_ACTIONBAR} from '@common/components/actionbars/routing';
import {BREADCRUMBS} from '../../../index.messages';

import {AUTOSCALING_ROUTE} from '../../autoscaling/routing';

import {VerticalPodAutoscalerDetailComponent} from './detail/component';
import {VerticalPodAutoscalerListComponent} from './list/component';

const VERTICAL_POD_AUTOSCALER_LIST_ROUTE: Route = {
  path: '',
  component: VerticalPodAutoscalerListComponent,
  data: {
    breadcrumb: BREADCRUMBS.VerticalPodAutoscalers,
    parent: AUTOSCALING_ROUTE,
  },
};

const VERTICAL_POD_AUTOSCALER_DETAIL_ROUTE: Route = {
  path: ':resourceNamespace/:resourceName',
  component: VerticalPodAutoscalerDetailComponent,
  data: {
    breadcrumb: '{{ resourceName }}',
    parent: VERTICAL_POD_AUTOSCALER_LIST_ROUTE,
  },
};

@NgModule({
  imports: [
    RouterModule.forChild([
      VERTICAL_POD_AUTOSCALER_LIST_ROUTE,
      VERTICAL_POD_AUTOSCALER_DETAIL_ROUTE,
      DEFAULT_ACTIONBAR,
    ]),
  ],
  exports: [RouterModule],
})
export class VerticalPodAutoscalerRoutingModule {}
