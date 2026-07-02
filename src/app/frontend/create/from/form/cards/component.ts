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

import {Component, OnInit, ViewChild} from '@angular/core';
import {CrdAvailabilityService} from '@common/services/global/crd';
import {CreateFromFormComponent} from '../component';

export interface FormCard {
  id: string;
  title: string;
  description: string;
  icon: string;
  // Only for CRD-backed cards: pre-selects the first installed CRD matching
  // this pattern in the CRD create form.
  presetPattern?: string;
}

// The "Create from form" tab is a gallery of form cards; each card opens a
// guided form for one kind of resource. New cards register here — the intent
// is for optional/product cards (like Kazoo Media) to appear only when their
// CRDs are installed.
@Component({
  selector: 'kd-create-from-form-cards',
  templateUrl: './template.html',
  styleUrls: ['./style.scss'],
  standalone: false,
})
export class CreateFromFormCardsComponent implements OnInit {
  // Only present while the Application card is open; used by the create page's
  // canDeactivate to keep the unsaved-changes prompt working.
  @ViewChild(CreateFromFormComponent) fromForm: CreateFromFormComponent;

  cards: FormCard[] = [];
  active: FormCard = null;

  constructor(private readonly crdAvailability_: CrdAvailabilityService) {}

  canDeactivate(): boolean {
    return this.fromForm ? this.fromForm.canDeactivate() : true;
  }

  ngOnInit(): void {
    this.cards = [
      {
        id: 'deployment',
        title: 'Application',
        description: 'Deploy a containerized application (Deployment + optional Service).',
        icon: 'apps',
      },
      {
        id: 'crd',
        title: 'Custom resource',
        description: 'Create an object of any installed Custom Resource Definition from a generated skeleton.',
        icon: 'extension',
      },
    ];

    // Product example card: only offered when a Kazoo media CRD is installed.
    const kazooMediaCrd = this.crdAvailability_.installedNames().find(name => /media.*kazoo|kazoo.*media/.test(name));
    if (kazooMediaCrd) {
      this.cards.push({
        id: 'kazoo-media',
        title: 'Kazoo Media',
        description: `Create a Kazoo media resource (${kazooMediaCrd}).`,
        icon: 'library_music',
        presetPattern: 'media.*kazoo|kazoo.*media',
      });
    }
  }

  open(card: FormCard): void {
    this.active = card;
  }

  back(): void {
    this.active = null;
  }
}
