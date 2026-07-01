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
import {BREADCRUMBS} from '../../index.messages';
import {ClusterApiComponent} from './component';

export const CLUSTER_API_ROUTE: Route = {
  path: '',
  component: ClusterApiComponent,
  data: {
    breadcrumb: BREADCRUMBS.ClusterAPI,
    link: ['', 'clusterapi'],
  },
};

@NgModule({
  imports: [RouterModule.forChild([CLUSTER_API_ROUTE])],
  exports: [RouterModule],
})
export class ClusterApiRoutingModule {}
