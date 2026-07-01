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
import {Route, RouterModule} from '@angular/router';
import {DEFAULT_ACTIONBAR} from '@common/components/actionbars/routing';
import {BREADCRUMBS} from '../../../index.messages';

import {AUTOSCALING_ROUTE} from '../../autoscaling/routing';

import {PodDisruptionBudgetDetailComponent} from './detail/component';
import {PodDisruptionBudgetListComponent} from './list/component';

const POD_DISRUPTION_BUDGET_LIST_ROUTE: Route = {
  path: '',
  component: PodDisruptionBudgetListComponent,
  data: {
    breadcrumb: BREADCRUMBS.PodDisruptionBudgets,
    parent: AUTOSCALING_ROUTE,
  },
};

const POD_DISRUPTION_BUDGET_DETAIL_ROUTE: Route = {
  path: ':resourceNamespace/:resourceName',
  component: PodDisruptionBudgetDetailComponent,
  data: {
    breadcrumb: '{{ resourceName }}',
    parent: POD_DISRUPTION_BUDGET_LIST_ROUTE,
  },
};

@NgModule({
  imports: [
    RouterModule.forChild([POD_DISRUPTION_BUDGET_LIST_ROUTE, POD_DISRUPTION_BUDGET_DETAIL_ROUTE, DEFAULT_ACTIONBAR]),
  ],
  exports: [RouterModule],
})
export class PodDisruptionBudgetRoutingModule {}
