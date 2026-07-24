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
import {ChangeDetectorRef} from '@angular/core';
import {Component, Inject, OnDestroy, OnInit, ViewChild} from '@angular/core';
import {MatButtonToggleGroup} from '@angular/material/button-toggle';
import {MAT_DIALOG_DATA, MatDialogRef} from '@angular/material/dialog';
import {dump as toYaml, load as fromYaml} from 'js-yaml';
import {EditorMode} from '../../components/textinput/component';

import {RawResource} from '../../resources/rawresource';
import {ResourceMeta} from '../../services/global/actionbar';
import {Subject} from 'rxjs';
import {takeUntil} from 'rxjs/operators';

@Component({
    selector: 'kd-delete-resource-dialog',
    templateUrl: 'template.html',
    standalone: false
})
export class EditResourceDialog implements OnInit, OnDestroy {
  selectedMode = EditorMode.YAML;
  private unsubscribe_ = new Subject<void>();

  @ViewChild('group', {static: true}) buttonToggleGroup: MatButtonToggleGroup;
  text = '';
  modes = EditorMode;

  constructor(
    public dialogRef: MatDialogRef<EditResourceDialog>,
    @Inject(MAT_DIALOG_DATA) public data: ResourceMeta,
    private readonly http_: HttpClient,
    private readonly cdr_: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const url = RawResource.getUrl(this.data.typeMeta, this.data.objectMeta);
    // Use subscribe(), not the deprecated toPromise(): on Angular's fetch
    // backend (the default since v22) toPromise() did not deliver the body to
    // .then(), so this.text stayed empty and the editor rendered blank. The
    // download dialog's subscribe() path works, so mirror it here.
    this.http_
      .get(url)
      .pipe(takeUntil(this.unsubscribe_))
      .subscribe(response => {
        this.text = toYaml(response);
        // Zoneless: this dialog is a CDK overlay (its own ApplicationRef view,
        // outside the root tree the global HTTP sweep force-checks). The GET
        // lands after the dialog's first render; markForCheck() only flags it
        // dirty for a traversal that never arrives, so the editor stayed blank
        // until the YAML/JSON toggle forced a repaint. detectChanges()
        // force-checks this view so the YAML renders immediately. Guard the
        // destroyed-view case (dialog closed before the response arrived).
        try {
          this.cdr_.detectChanges();
        } catch (_) {}
      });

    this.buttonToggleGroup.valueChange.pipe(takeUntil(this.unsubscribe_)).subscribe((selectedMode: EditorMode) => {
      this.selectedMode = selectedMode;

      if (this.text) {
        this.updateText();
      }
    });
  }

  ngOnDestroy(): void {
    this.unsubscribe_.next();
    this.unsubscribe_.complete();
  }

  onNoClick(): void {
    this.dialogRef.close();
  }

  getJSON(): string {
    if (this.selectedMode === EditorMode.YAML) {
      return this.toRawJSON(fromYaml(this.text));
    }

    return this.text;
  }

  getSelectedMode(): string {
    return this.buttonToggleGroup.value;
  }

  private updateText(): void {
    if (this.selectedMode === EditorMode.YAML) {
      this.text = toYaml(JSON.parse(this.text));
    } else {
      this.text = this.toRawJSON(fromYaml(this.text));
    }
  }

  private toRawJSON(object: {}): string {
    return JSON.stringify(object, null, '\t');
  }
}
