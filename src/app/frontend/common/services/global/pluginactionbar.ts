// Copyright 2026 The Kubernetes Authors.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.

// window.kdActionbar: lets plugin bundles put their own buttons on the detail
// actionbar (left of the pin) and hide the stock pin/edit/delete actions —
// individually or all. Same contract style as kdSchemaForm/kdYaml: a small
// versioned surface published on window, consumed by DOM-first plugins.
//
// The state is a module-level stream (no DI): the plugin calls set() when it
// boots, the pin-default actionbar renders it, and the plugin detail route
// resets it on leave/param change so nothing leaks across plugins.

import {BehaviorSubject} from 'rxjs';

export interface PluginActionButton {
  // Material icon name (icon button when set) — otherwise a text button.
  icon?: string;
  label?: string;
  // Tooltip; falls back to the label.
  title?: string;
  onClick: () => void;
}

export interface PluginStockActions {
  pin: boolean;
  edit: boolean;
  delete: boolean;
}

export interface PluginActionbarState {
  buttons: PluginActionButton[];
  stock: PluginStockActions;
  // When set, replaces the breadcrumb trail (e.g. ['Cluster API', 'Classes'])
  // — for plugins that own a nav section instead of living under Plugins.
  breadcrumb: string[] | null;
}

const DEFAULT_STATE: PluginActionbarState = {
  buttons: [],
  stock: {pin: true, edit: true, delete: true},
  breadcrumb: null,
};

export const pluginActionbarState = new BehaviorSubject<PluginActionbarState>(DEFAULT_STATE);

export function resetPluginActionbar(): void {
  pluginActionbarState.next(DEFAULT_STATE);
}

export function installKdActionbar(): void {
  (window as unknown as {kdActionbar: {}}).kdActionbar = {
    version: 1,
    set(opts: {buttons?: PluginActionButton[]; stock?: Partial<PluginStockActions>; breadcrumb?: string[]}): void {
      opts = opts || {};
      pluginActionbarState.next({
        buttons: opts.buttons || [],
        stock: {...DEFAULT_STATE.stock, ...(opts.stock || {})},
        breadcrumb: opts.breadcrumb && opts.breadcrumb.length ? opts.breadcrumb : null,
      });
    },
    reset: resetPluginActionbar,
  };
}
