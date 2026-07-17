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

import {Component, Input, OnChanges} from '@angular/core';
import {MatTableDataSource} from '@angular/material/table';
import {StringMap} from '@api/root.shared';
import {
  Affinity,
  LabelSelector,
  NodeSelectorTerm,
  PodAffinity,
  PodAffinityTerm,
  SelectorRequirement,
  Toleration,
} from '@api/root.api';
import {dump as toYaml} from 'js-yaml';

// Well-known topology keys mapped to a short human readable label.
const TOPOLOGY_LABELS: {[key: string]: string} = {
  'kubernetes.io/hostname': 'node',
  'topology.kubernetes.io/zone': 'zone',
  'failure-domain.beta.kubernetes.io/zone': 'zone',
  'topology.kubernetes.io/region': 'region',
  'failure-domain.beta.kubernetes.io/region': 'region',
};

// A single affinity rule in a structured, display-ready form.
export interface AffinityRuleView {
  // Node affinity | Pod affinity | Pod anti-affinity
  type: string;
  // Whether the rule is a node affinity rule (drives the empty-selector wording).
  isNode: boolean;
  // requiredDuringScheduling vs preferredDuringScheduling
  required: boolean;
  // Weight of a preferred rule.
  weight?: number;
  // Raw topology key of a pod (anti-)affinity term, e.g. kubernetes.io/hostname.
  topologyKey?: string;
  // Short label of a well-known topology key (node/zone/region), or the raw key.
  topologyLabel?: string;
  // Selector rendered as chips: "k=v", "k In (a, b)", "k Exists", ...
  chips: string[];
  // Namespace restrictions of a pod (anti-)affinity term rendered as chips.
  namespaceChips: string[];
  // Recognized pattern: required pod anti-affinity per hostname = one pod per node.
  onePodPerNode: boolean;
}

@Component({
    selector: 'kd-scheduling',
    templateUrl: './template.html',
    styleUrls: ['./style.scss'],
    standalone: false
})
export class SchedulingComponent implements OnChanges {
  @Input() initialized: boolean;
  @Input() nodeSelector: StringMap;
  @Input() tolerations: Toleration[];
  @Input() affinity: Affinity;

  affinityRules: AffinityRuleView[] = [];
  affinityYaml = '';
  isShowingAffinityYaml = false;

  private tolerationColumns = ['key', 'operator', 'value', 'effect', 'tolerationSeconds'];

  ngOnChanges(): void {
    this.affinityRules = this.buildAffinityRules_();
    this.affinityYaml = this.affinity ? toYaml({affinity: this.affinity}) : '';
    this.isShowingAffinityYaml = false;
  }

  hasScheduling(): boolean {
    return this.hasNodeSelector() || this.hasTolerations() || this.affinityRules.length > 0;
  }

  hasNodeSelector(): boolean {
    return !!this.nodeSelector && Object.keys(this.nodeSelector).length > 0;
  }

  hasTolerations(): boolean {
    return !!this.tolerations && this.tolerations.length > 0;
  }

  getTolerationColumns(): string[] {
    return this.tolerationColumns;
  }

  getTolerationsDataSource(): MatTableDataSource<Toleration> {
    const tableData = new MatTableDataSource<Toleration>();
    tableData.data = this.tolerations || [];
    return tableData;
  }

  toggleAffinityYaml(): void {
    this.isShowingAffinityYaml = !this.isShowingAffinityYaml;
  }

  trackByAffinityRule(index: number, _: AffinityRuleView): number {
    return index;
  }

  private buildAffinityRules_(): AffinityRuleView[] {
    const rules: AffinityRuleView[] = [];
    if (!this.affinity) {
      return rules;
    }

    const nodeAffinity = this.affinity.nodeAffinity;
    if (nodeAffinity) {
      const required = nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution;
      for (const term of (required && required.nodeSelectorTerms) || []) {
        rules.push(this.nodeRule_(term, true));
      }
      for (const preferred of nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution || []) {
        rules.push(this.nodeRule_(preferred.preference, false, preferred.weight));
      }
    }

    this.appendPodAffinityRules_(rules, 'Pod affinity', false, this.affinity.podAffinity);
    this.appendPodAffinityRules_(rules, 'Pod anti-affinity', true, this.affinity.podAntiAffinity);
    return rules;
  }

  private nodeRule_(term: NodeSelectorTerm, required: boolean, weight?: number): AffinityRuleView {
    const chips: string[] = [];
    for (const expression of term.matchExpressions || []) {
      chips.push(this.requirementChip_(expression));
    }
    for (const field of term.matchFields || []) {
      chips.push(`field: ${this.requirementChip_(field)}`);
    }

    return {
      type: 'Node affinity',
      isNode: true,
      required,
      weight,
      chips,
      namespaceChips: [],
      onePodPerNode: false,
    };
  }

  private appendPodAffinityRules_(
    rules: AffinityRuleView[],
    type: string,
    isAntiAffinity: boolean,
    affinity?: PodAffinity
  ): void {
    if (!affinity) {
      return;
    }

    for (const term of affinity.requiredDuringSchedulingIgnoredDuringExecution || []) {
      rules.push(this.podRule_(type, isAntiAffinity, term, true));
    }
    for (const preferred of affinity.preferredDuringSchedulingIgnoredDuringExecution || []) {
      rules.push(this.podRule_(type, isAntiAffinity, preferred.podAffinityTerm, false, preferred.weight));
    }
  }

  private podRule_(
    type: string,
    isAntiAffinity: boolean,
    term: PodAffinityTerm,
    required: boolean,
    weight?: number
  ): AffinityRuleView {
    const chips = this.selectorChips_(term.labelSelector);

    const namespaceChips: string[] = [...(term.namespaces || [])];
    if (term.namespaceSelector) {
      const namespaceSelector = this.selectorChips_(term.namespaceSelector);
      namespaceChips.push(...(namespaceSelector.length > 0 ? namespaceSelector : ['(all namespaces)']));
    }

    return {
      type,
      isNode: false,
      required,
      weight,
      topologyKey: term.topologyKey,
      topologyLabel: TOPOLOGY_LABELS[term.topologyKey] || term.topologyKey,
      chips,
      namespaceChips,
      onePodPerNode: isAntiAffinity && required && term.topologyKey === 'kubernetes.io/hostname',
    };
  }

  private selectorChips_(selector?: LabelSelector): string[] {
    if (!selector) {
      return [];
    }

    const chips = Object.entries(selector.matchLabels || {}).map(([key, value]) => `${key}=${value}`);
    for (const expression of selector.matchExpressions || []) {
      chips.push(this.requirementChip_(expression));
    }
    return chips;
  }

  private requirementChip_(requirement: SelectorRequirement): string {
    const values = requirement.values || [];
    switch (requirement.operator) {
      case 'Exists':
        return `${requirement.key} Exists`;
      case 'DoesNotExist':
        return `${requirement.key} DoesNotExist`;
      case 'In':
        return values.length === 1 ? `${requirement.key}=${values[0]}` : `${requirement.key} In (${values.join(', ')})`;
      case 'NotIn':
        return `${requirement.key} NotIn (${values.join(', ')})`;
      default:
        return `${requirement.key} ${requirement.operator} ${values.join(', ')}`.trim();
    }
  }
}
