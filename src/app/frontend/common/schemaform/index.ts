// Copyright 2026 The Kubernetes Authors.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.

// kdSchemaForm: schema → HTML form generator shared by every schema-driven
// form in and around the dashboard — the stock Custom-resource card (openAPI
// CRD schemas) and plugins (helm values.schema.json). Exposed on
// window.kdSchemaForm so GlobalPlugin bundles and FormPlugin scripts consume
// the exact same implementation the dashboard uses; treat the surface as a
// versioned public API (documented in docs/plugins/form-plugins.md).
//
// No Angular dependencies on purpose: plain DOM, per-handle state, styling
// via the global .kd-schema-form rules (index.scss).

interface Schema {
  type?: string;
  properties?: {[key: string]: Schema};
  required?: string[];
  items?: Schema;
  enum?: Array<string | number>;
  default?: unknown;
  description?: string;
  title?: string;
  additionalProperties?: Schema | boolean;
}

export interface SchemaFormOptions {
  // Root the collected object under this key (e.g. 'deployment' when
  // rendering one section of a larger schema).
  pathPrefix?: string;
  // Top-level keys to skip (the CRD form skips apiVersion/kind/metadata/status).
  skipKeys?: string[];
  // Mark required fields with an asterisk.
  requiredMarkers?: boolean;
  // Show schema defaults as placeholders/pre-set checkboxes and collect only
  // fields the user changed (helm-values mode).
  defaultsAsPlaceholders?: boolean;
  // Seed the form with existing values (upgrade flows). Seeded fields are
  // collected like user input.
  initial?: {[key: string]: unknown};
  // Object expansion depth before falling back to JSON (Infinity by default).
  maxDepth?: number;
}

export interface SchemaFormHandle {
  container: HTMLElement;
  // Build the object from the current inputs; throws Error on invalid input.
  collect(): {[key: string]: unknown};
  destroy(): void;
}

interface DynEntry {
  kind: 'map' | 'arr' | 'objarr';
  schema: Schema | null;
}

function esc(value: unknown): string {
  return String(value == null ? '' : value).replace(
    /[&<>"]/g,
    c => (({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}) as {[k: string]: string})[c]
  );
}

function isScalar(schema: Schema | null | undefined): boolean {
  return !!schema && ['string', 'integer', 'number', 'boolean'].indexOf(schema.type || '') >= 0;
}

function setPath(target: {[k: string]: unknown}, segments: string[], value: unknown): void {
  let cursor = target;
  for (let i = 0; i < segments.length - 1; i++) {
    if (typeof cursor[segments[i]] !== 'object' || cursor[segments[i]] === null) {
      cursor[segments[i]] = {};
    }
    cursor = cursor[segments[i]] as {[k: string]: unknown};
  }
  cursor[segments[segments.length - 1]] = value;
}

function getPath(source: unknown, segments: string[]): unknown {
  let cursor: unknown = source;
  for (const segment of segments) {
    if (cursor == null || typeof cursor !== 'object') {
      return undefined;
    }
    cursor = (cursor as {[k: string]: unknown})[segment];
  }
  return cursor;
}

class Form implements SchemaFormHandle {
  container: HTMLElement;

  private readonly dyn_: DynEntry[] = [];
  private readonly opts_: SchemaFormOptions;
  private readonly clickHandler_: (ev: Event) => void;

  constructor(container: HTMLElement, schema: Schema, opts: SchemaFormOptions) {
    this.container = container;
    this.opts_ = opts;
    container.classList.add('kd-schema-form');

    const properties = (schema && schema.properties) || {};
    const required = (schema && schema.required) || [];
    const skip = opts.skipKeys || [];
    const parts: string[] = [];
    Object.keys(properties).forEach(key => {
      if (skip.indexOf(key) >= 0) {
        return;
      }
      parts.push(this.field_(key, key, properties[key], required.indexOf(key) >= 0, 0, false, this.initialFor_(key)));
    });
    container.innerHTML = parts.join('');

    this.clickHandler_ = (ev: Event) => {
      const target = ev.target as HTMLElement;
      if (!target.classList) {
        return;
      }
      if (target.classList.contains('kdf-add')) {
        const box = target.closest('.kdf-dyn') as HTMLElement;
        box.querySelector('.kdf-rows').insertAdjacentHTML('beforeend', this.row_(this.dyn_[Number(box.getAttribute('data-dyn'))]));
      } else if (target.classList.contains('kdf-remove')) {
        const row = target.closest('.kdf-row') || target.closest('.kdf-entry');
        if (row) {
          row.remove();
        }
      }
    };
    container.addEventListener('click', this.clickHandler_);
  }

  collect(): {[key: string]: unknown} {
    const out: {[key: string]: unknown} = {};
    this.walk_(this.container, 'data-path', out);
    if (!this.opts_.pathPrefix) {
      return out;
    }
    const rooted: {[key: string]: unknown} = {};
    if (Object.keys(out).length) {
      setPath(rooted, this.opts_.pathPrefix.split('.'), out);
    }
    return rooted;
  }

  destroy(): void {
    this.container.removeEventListener('click', this.clickHandler_);
    this.container.innerHTML = '';
    this.container.classList.remove('kd-schema-form');
  }

  private initialFor_(key: string): unknown {
    return this.opts_.initial ? (this.opts_.initial as {[k: string]: unknown})[key] : undefined;
  }

  private hint_(schema: Schema): string {
    const text = schema && (schema.description || schema.title);
    return text ? `<div class="kdf-hint">${esc(String(text).slice(0, 220))}</div>` : '';
  }

  private label_(name: string, required: boolean): string {
    const marker = required && this.opts_.requiredMarkers ? ' <span class="kdf-required">*</span>' : '';
    return `<label>${esc(name)}${marker}</label>`;
  }

  private scalarInput_(schema: Schema | null, cls: string, extra: string, initial?: unknown): string {
    schema = schema || {};
    const def = this.opts_.defaultsAsPlaceholders ? schema.default : undefined;
    const value = initial != null && typeof initial !== 'object' ? ` value="${esc(initial)}"` : '';
    if (schema.enum) {
      const marker = def != null ? `: ${esc(def)}` : '';
      const head = this.opts_.defaultsAsPlaceholders ? `(default${marker})` : '';
      return (
        `<select class="${cls}"${extra}><option value="">${head}</option>` +
        schema.enum
          .map(v => `<option${String(initial) === String(v) ? ' selected' : ''}>${esc(v)}</option>`)
          .join('') +
        '</select>'
      );
    }
    const placeholder = def != null && typeof def !== 'object' ? ` placeholder="${esc(def)}"` : '';
    if (schema.type === 'integer' || schema.type === 'number') {
      return `<input type="number" class="${cls}"${extra}${placeholder}${value}>`;
    }
    return `<input type="text" class="${cls}"${extra}${placeholder}${value} autocomplete="off">`;
  }

  private dynSection_(kind: DynEntry['kind'], path: string, name: string, schema: Schema, sub: Schema | null, initial?: unknown): string {
    const idx = this.dyn_.length;
    this.dyn_.push({kind, schema: sub});
    let rows = '';
    if (kind === 'map' && initial && typeof initial === 'object' && !Array.isArray(initial)) {
      rows = Object.keys(initial as object)
        .map(k => this.row_(this.dyn_[idx], k, (initial as {[k: string]: unknown})[k]))
        .join('');
    } else if ((kind === 'arr' || kind === 'objarr') && Array.isArray(initial)) {
      rows = (initial as unknown[]).map(item => this.row_(this.dyn_[idx], undefined, item)).join('');
    }
    return (
      `<fieldset class="kdf-dyn" data-dyn="${idx}" data-dynpath="${esc(path)}"><legend>${esc(name)}</legend>` +
      this.hint_(schema) +
      `<div class="kdf-rows">${rows}</div>` +
      '<button type="button" class="kdf-add">Add</button></fieldset>'
    );
  }

  private row_(entry: DynEntry, key?: string, value?: unknown): string {
    if (entry.kind === 'map') {
      const keyAttr = key != null ? ` value="${esc(key)}"` : '';
      return (
        `<div class="kdf-row"><input type="text" class="kdf-k" placeholder="key"${keyAttr} autocomplete="off">` +
        this.scalarInput_(entry.schema, 'kdf-v', '', value) +
        '<button type="button" class="kdf-remove" title="Remove">&#10005;</button></div>'
      );
    }
    if (entry.kind === 'arr') {
      return (
        `<div class="kdf-row">` +
        this.scalarInput_(entry.schema, 'kdf-v', '', value) +
        '<button type="button" class="kdf-remove" title="Remove">&#10005;</button></div>'
      );
    }
    const schema = entry.schema || {};
    const required = schema.required || [];
    const fields = Object.keys(schema.properties || {})
      .map(k =>
        this.field_(k, k, schema.properties[k], required.indexOf(k) >= 0, 0, true, value != null ? getPath(value, [k]) : undefined)
      )
      .join('');
    return `<div class="kdf-entry">${fields}<button type="button" class="kdf-remove">Remove</button></div>`;
  }

  private field_(path: string, name: string, schema: Schema, required: boolean, depth: number, rel: boolean, initial?: unknown): string {
    schema = schema || {};
    const attr = ` ${rel ? 'data-rel' : 'data-path'}="${esc(path)}"`;
    const type = schema.type || (schema.properties ? 'object' : undefined);
    const maxDepth = this.opts_.maxDepth == null ? Infinity : this.opts_.maxDepth;

    if (type === 'object' && schema.properties && depth < maxDepth) {
      const requiredChildren = schema.required || [];
      const children = Object.keys(schema.properties)
        .map(key =>
          this.field_(
            `${path}.${key}`,
            key,
            schema.properties[key],
            requiredChildren.indexOf(key) >= 0,
            depth + 1,
            rel,
            initial != null ? getPath(initial, [key]) : undefined
          )
        )
        .join('');
      return `<fieldset><legend>${esc(name)}</legend>${this.hint_(schema)}${children}</fieldset>`;
    }
    if (type === 'object' && !schema.properties && !rel) {
      const valueSchema = typeof schema.additionalProperties === 'object' ? schema.additionalProperties : null;
      return this.dynSection_('map', path, name, schema, valueSchema, initial);
    }
    if (type === 'array' && !rel) {
      const items = schema.items || {};
      if (items.type === 'object' && items.properties) {
        return this.dynSection_('objarr', path, name, schema, items, initial);
      }
      if (isScalar(items) || items.enum) {
        return this.dynSection_('arr', path, name, schema, items, initial);
      }
    }
    if (type === 'boolean') {
      const def = this.opts_.defaultsAsPlaceholders && schema.default === true;
      const checked = initial != null ? initial === true : def;
      return (
        `<label class="kdf-bool"><input type="checkbox" data-kind="boolean" data-def="${def}"${attr}${checked ? ' checked' : ''}>` +
        `${esc(name)}</label>${this.hint_(schema)}`
      );
    }
    if (isScalar(schema) || schema.enum) {
      const kind = type === 'integer' || type === 'number' ? type : 'string';
      return this.label_(name, required) + this.scalarInput_(schema, '', ` data-kind="${kind}"${attr}`, initial) + this.hint_(schema);
    }
    const seeded = initial !== undefined ? esc(JSON.stringify(initial)) : '';
    return (
      this.label_(`${name} (JSON)`, required) +
      `<textarea rows="3" data-kind="json"${attr} placeholder='{"key": "value"}'>${seeded}</textarea>` +
      this.hint_(schema)
    );
  }

  private leaf_(el: HTMLInputElement): unknown {
    const where = el.getAttribute('data-path') || el.getAttribute('data-rel');
    const kind = el.getAttribute('data-kind');
    if (kind === 'boolean') {
      if (this.opts_.defaultsAsPlaceholders) {
        const def = el.getAttribute('data-def') === 'true';
        return el.checked === def ? undefined : el.checked;
      }
      return el.checked ? true : undefined;
    }
    if (el.value === '' || el.value == null) {
      return undefined;
    }
    if (kind === 'integer' || kind === 'number') {
      const parsed = Number(el.value);
      if (isNaN(parsed)) {
        throw new Error(`Invalid number in ${where}`);
      }
      return parsed;
    }
    if (kind === 'json') {
      try {
        return JSON.parse(el.value);
      } catch (_) {
        throw new Error(`Invalid JSON in ${where}`);
      }
    }
    return el.value;
  }

  private scalarValue_(el: HTMLInputElement, schema: Schema | null): unknown {
    const value = el.value;
    if (value === '' || value == null) {
      return undefined;
    }
    if (schema && (schema.type === 'integer' || schema.type === 'number')) {
      const parsed = Number(value);
      if (isNaN(parsed)) {
        throw new Error(`Invalid number: ${value}`);
      }
      return parsed;
    }
    if (schema && schema.type === 'boolean') {
      return value === 'true';
    }
    if (schema) {
      return value;
    }
    // Untyped map values are auto-typed: 10000 → number, true/false → boolean.
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
    if (/^-?\d+(\.\d+)?$/.test(value)) {
      return Number(value);
    }
    return value;
  }

  private section_(box: HTMLElement): unknown {
    const entry = this.dyn_[Number(box.getAttribute('data-dyn'))];
    if (entry.kind === 'map') {
      const map: {[k: string]: unknown} = {};
      box.querySelectorAll(':scope > .kdf-rows > .kdf-row').forEach(row => {
        const key = (row.querySelector('.kdf-k') as HTMLInputElement).value.trim();
        const value = this.scalarValue_(row.querySelector('.kdf-v') as HTMLInputElement, entry.schema);
        if (key && value !== undefined) {
          map[key] = value;
        }
      });
      return Object.keys(map).length ? map : undefined;
    }
    if (entry.kind === 'arr') {
      const list: unknown[] = [];
      box.querySelectorAll(':scope > .kdf-rows > .kdf-row > .kdf-v').forEach(input => {
        const value = this.scalarValue_(input as HTMLInputElement, entry.schema);
        if (value !== undefined) {
          list.push(value);
        }
      });
      return list.length ? list : undefined;
    }
    const entries: Array<{[k: string]: unknown}> = [];
    box.querySelectorAll(':scope > .kdf-rows > .kdf-entry').forEach(entryEl => {
      const obj: {[k: string]: unknown} = {};
      this.walk_(entryEl as HTMLElement, 'data-rel', obj);
      if (Object.keys(obj).length) {
        entries.push(obj);
      }
    });
    return entries.length ? entries : undefined;
  }

  private walk_(rootEl: HTMLElement, attr: string, out: {[k: string]: unknown}): void {
    const kids = rootEl.children;
    for (let i = 0; i < kids.length; i++) {
      const el = kids[i] as HTMLElement;
      if (el.classList.contains('kdf-dyn')) {
        const value = this.section_(el);
        if (value !== undefined) {
          setPath(out, el.getAttribute('data-dynpath').split('.'), value);
        }
        continue;
      }
      if (el.hasAttribute(attr)) {
        const value = this.leaf_(el as HTMLInputElement);
        if (value !== undefined) {
          setPath(out, el.getAttribute(attr).split('.'), value);
        }
        continue;
      }
      this.walk_(el, attr, out);
    }
  }
}

export function renderSchemaForm(container: HTMLElement, schema: {}, opts?: SchemaFormOptions): SchemaFormHandle {
  return new Form(container, (schema || {}) as Schema, opts || {});
}

// Publish for plugin bundles and FormPlugin scripts. Additive evolution only;
// bump version when the surface grows so consumers can feature-detect.
export function installKdSchemaForm(): void {
  (window as unknown as {kdSchemaForm: {}}).kdSchemaForm = {
    version: 1,
    render: renderSchemaForm,
  };
}
