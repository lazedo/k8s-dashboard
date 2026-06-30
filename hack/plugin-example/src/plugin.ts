// Copyright 2026 The Kubernetes Authors.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
//
// Example dashboard plugin (pre-split plugin system) that calls an EXTENDED API:
// it lists the kazoo `Kazoo` custom resources through the dashboard's generic CRD
// endpoint (/api/v1/crd/<ns>/<crd>/object). Cluster-scoped CRDs use a single space
// as the namespace. fetch() carries the user's token (injected by the ingress), so
// it reads with the caller's RBAC — no Angular HttpClient/externals needed.
import {Component, NgModule, OnInit, ɵNgModuleFactory as NgModuleFactory} from '@angular/core';
import {CommonModule} from '@angular/common';

interface KazooItem {
  objectMeta: {name: string; creationTimestamp?: string};
  // the CRD object list may carry the raw object's spec/status depending on the CRD
  spec?: any;
  status?: any;
}

@Component({
  selector: 'kd-demo-plugin',
  template: `
    <div style="padding:24px;font-family:system-ui,sans-serif">
      <h2 style="margin:0 0 4px;color:#326ce5">🔌 Kazoo plugin — clusters from the CRD API</h2>
      <p style="margin:0 0 16px;color:#666">
        Loaded at runtime from a ConfigMap (Plugin CRD), calling
        <code>/api/v1/crd/&nbsp;/kazoos.cluster.kazoo.io/object</code> with your token.
      </p>

      <p *ngIf="loading" style="color:#888">Loading Kazoo clusters…</p>
      <p *ngIf="error" style="color:#b00020">Error: {{ error }}</p>

      <table *ngIf="!loading && !error && kazoos.length" style="border-collapse:collapse;width:100%;max-width:720px">
        <thead>
          <tr style="text-align:left;border-bottom:2px solid #326ce5">
            <th style="padding:8px">Kazoo</th>
            <th style="padding:8px">Apps</th>
            <th style="padding:8px">Media</th>
            <th style="padding:8px">Proxy</th>
            <th style="padding:8px">Created</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let k of kazoos" style="border-bottom:1px solid #eee">
            <td style="padding:8px;font-weight:600">{{ k.objectMeta.name }}</td>
            <td style="padding:8px">{{ count(k, 'governedApplications') }}</td>
            <td style="padding:8px">{{ count(k, 'governedMedia') }}</td>
            <td style="padding:8px">{{ count(k, 'governedProxy') }}</td>
            <td style="padding:8px;color:#888">{{ k.objectMeta.creationTimestamp }}</td>
          </tr>
        </tbody>
      </table>

      <p *ngIf="!loading && !error && !kazoos.length" style="color:#888">No Kazoo clusters found.</p>
    </div>
  `,
})
export class DemoPluginComponent implements OnInit {
  kazoos: KazooItem[] = [];
  loading = true;
  error = '';

  ngOnInit(): void {
    // cluster-scoped CRD → namespace is a single space (%20).
    fetch('api/v1/crd/%20/kazoos.cluster.kazoo.io/object', {headers: {Accept: 'application/json'}})
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then(d => {
        this.kazoos = (d && d.items) || [];
        this.loading = false;
      })
      .catch(e => {
        this.error = String(e && e.message ? e.message : e);
        this.loading = false;
      });
  }

  count(k: KazooItem, field: string): string {
    const v = k && k.status ? k.status[field] : undefined;
    return v === undefined || v === null ? '—' : String(v);
  }
}

@NgModule({
  declarations: [DemoPluginComponent],
  imports: [CommonModule],
})
export class DemoPluginModule {
  static entry = DemoPluginComponent;
}

// SystemJS AMD interop: module.default is the exports object, so exports.default
// must BE the factory (module.default.default === factory, used by the holder).
export default new NgModuleFactory(DemoPluginModule);
