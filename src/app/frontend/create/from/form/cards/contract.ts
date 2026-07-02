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

// The FormPlugin contract: the cards container owns the action bar at the
// bottom of every form; hosted forms — built-in components (Application) and
// FormPlugin scripts alike — declare their buttons and receive the clicks.

export interface FormPluginButtonSpec {
  id: string;
  label: string;
  // mat-raised-button (primary action) instead of the flat mat-button.
  raised?: boolean;
  disabled?: boolean;
}

// Implemented by anything hosted inside the cards container.
export interface FormPluginForm {
  formButtons(): FormPluginButtonSpec[];
  onFormAction(actionId: string): void;
}

// DI handle the container provides. Hosted forms register themselves on init
// and call update() whenever button state (label, disabled) changes; the
// container re-reads formButtons() and repaints the bar.
export abstract class FormActionBar {
  abstract register(form: FormPluginForm): void;
  abstract update(): void;
  abstract unregister(form: FormPluginForm): void;
}
