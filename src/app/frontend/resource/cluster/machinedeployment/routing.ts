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

import {CLUSTER_API_ROUTE} from '../../clusterapi/routing';

import {MachineDeploymentDetailComponent} from './detail/component';
import {MachineDeploymentListComponent} from './list/component';

const MACHINE_DEPLOYMENT_LIST_ROUTE: Route = {
  path: '',
  component: MachineDeploymentListComponent,
  data: {
    breadcrumb: BREADCRUMBS.MachineDeployments,
    parent: CLUSTER_API_ROUTE,
  },
};

const MACHINE_DEPLOYMENT_DETAIL_ROUTE: Route = {
  path: ':resourceNamespace/:resourceName',
  component: MachineDeploymentDetailComponent,
  data: {
    breadcrumb: '{{ resourceName }}',
    parent: MACHINE_DEPLOYMENT_LIST_ROUTE,
  },
};

@NgModule({
  imports: [RouterModule.forChild([MACHINE_DEPLOYMENT_LIST_ROUTE, MACHINE_DEPLOYMENT_DETAIL_ROUTE, DEFAULT_ACTIONBAR])],
  exports: [RouterModule],
})
export class MachineDeploymentRoutingModule {}
