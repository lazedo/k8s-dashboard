// Copyright 2026 The Kubernetes Authors.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.

// Stock FormPlugin: generates an HTML form for any installed CRD from its
// openAPI v3 schema and creates the object through ctx.submit. Runs through
// kd-form-plugin-host exactly like FormPlugin CRs do — it is the reference
// implementation of the script contract.
//
// ctx.args.presetPattern (regex source) preselects the first matching CRD —
// product cards (Kazoo Media) reuse the script that way.

export const CRD_FORM_SCRIPT = `'use strict';
var state = {crds: [], crd: null, version: null, scope: 'Namespaced', schema: null, namespaces: []};

host.innerHTML =
  '<div class="kdf">' +
  '<label>Custom Resource Definition</label>' +
  '<select class="kdf-crd"><option value="">Select a CRD…</option></select>' +
  '<div class="kdf-meta"></div>' +
  '<div class="kdf-spec"></div>' +
  '<div class="kdf-error" style="display:none"></div>' +
  '</div>';

var crdSel = host.querySelector('.kdf-crd');
var metaBox = host.querySelector('.kdf-meta');
var specBox = host.querySelector('.kdf-spec');
var errBox = host.querySelector('.kdf-error');

ctx.buttons.set([
  {id: 'create', label: 'Create', raised: true, disabled: true},
  {id: 'cancel', label: 'Cancel'},
]);

ctx.onAction(function (id) {
  if (id === 'cancel') { ctx.close(); return; }
  if (id === 'create') { submit(); }
});

crdSel.addEventListener('change', function () {
  if (crdSel.value) { loadCrd(crdSel.value); }
});

host.addEventListener('input', function () { ctx.markDirty(true); });

// Add/remove rows of the dynamic sections (maps, arrays, object arrays).
host.addEventListener('click', function (ev) {
  var target = ev.target;
  if (!target.classList) { return; }
  if (target.classList.contains('kdf-add')) {
    var box = target.closest('.kdf-dyn');
    var d = DYN[Number(box.getAttribute('data-dyn'))];
    box.querySelector('.kdf-rows').insertAdjacentHTML('beforeend', rowHtml(d));
    ctx.markDirty(true);
  } else if (target.classList.contains('kdf-remove')) {
    var row = target.closest('.kdf-row') || target.closest('.kdf-entry');
    if (row) { row.remove(); ctx.markDirty(true); }
  }
});

function esc(value) {
  return String(value).replace(/[&<>"]/g, function (c) {
    return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c];
  });
}

function showError(message) {
  errBox.textContent = message;
  errBox.style.display = 'block';
}

function fmtErr(e) {
  if (!e) { return 'unknown error'; }
  if (e.error && typeof e.error === 'object' && e.error.message) { return e.error.message; }
  if (typeof e.error === 'string') { return e.error; }
  return e.message || String(e);
}

ctx.http.get('api/v1/crd?itemsPerPage=2000').then(function (list) {
  state.crds = ((list && list.items) || [])
    .map(function (item) { return item.objectMeta && item.objectMeta.name; })
    .filter(Boolean)
    .sort();
  state.crds.forEach(function (name) {
    var option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    crdSel.appendChild(option);
  });
  var preset = ctx.args && ctx.args.presetPattern ? new RegExp(ctx.args.presetPattern) : null;
  if (preset) {
    var match = state.crds.filter(function (name) { return preset.test(name); })[0];
    if (match) {
      crdSel.value = match;
      loadCrd(match);
    }
  }
}, function () { showError('Failed to list CRDs'); });

ctx.http.get('api/v1/namespace').then(function (result) {
  state.namespaces = ((result && result.namespaces) || []).map(function (ns) { return ns.objectMeta.name; });
  if (state.crd) { renderMeta(); }
}, function () {});

function loadCrd(name) {
  errBox.style.display = 'none';
  ctx.http.get('api/v1/_raw/customresourcedefinition/name/' + name).then(function (crd) {
    var versions = (crd.spec && crd.spec.versions) || [];
    var version = versions.filter(function (v) { return v.storage; })[0] ||
      versions.filter(function (v) { return v.served; })[0] || versions[0];
    state.crd = crd;
    state.version = version ? version.name : 'v1';
    state.scope = crd.spec.scope || 'Namespaced';
    state.schema = (version && version.schema && version.schema.openAPIV3Schema) || {type: 'object'};
    renderMeta();
    renderSpec();
    updateCreateEnabled();
  }, function () { showError('Failed to load CRD ' + name); });
}

function renderMeta() {
  var html = '<label>Name <span class="kdf-required">*</span></label>' +
    '<input type="text" class="kdf-name" autocomplete="off">';
  if (state.scope === 'Namespaced') {
    var namespaces = state.namespaces.length ? state.namespaces : [ctx.namespace];
    html += '<label>Namespace</label><select class="kdf-ns">';
    namespaces.forEach(function (ns) {
      html += '<option' + (ns === ctx.namespace ? ' selected' : '') + '>' + esc(ns) + '</option>';
    });
    html += '</select>';
  }
  metaBox.innerHTML = html;
  metaBox.querySelector('.kdf-name').addEventListener('input', updateCreateEnabled);
}

function updateCreateEnabled() {
  var nameEl = metaBox.querySelector('.kdf-name');
  ctx.buttons.patch('create', {disabled: !(state.crd && nameEl && nameEl.value.trim())});
}

function hintHtml(schema) {
  return schema && schema.description ? '<div class="kdf-hint">' + esc(schema.description) + '</div>' : '';
}

function labelHtml(name, required) {
  return '<label>' + esc(name) + (required ? ' <span class="kdf-required">*</span>' : '') + '</label>';
}

// Dynamic sections (maps, arrays, arrays-of-objects): rendered rows are
// added/removed by the user; the section's value schema lives here, indexed
// by the container's data-dyn attribute. Reset on every renderSpec.
var DYN = [];

function isScalar(schema) {
  return !!schema && (schema.type === 'string' || schema.type === 'integer' || schema.type === 'number' || schema.type === 'boolean');
}

function scalarInputHtml(schema, cls, extra) {
  schema = schema || {};
  if (schema.type === 'integer' || schema.type === 'number') {
    return '<input type="number" class="' + cls + '"' + extra + '>';
  }
  if (schema.enum) {
    var options = ['<option value=""></option>'].concat(schema.enum.map(function (value) {
      return '<option>' + esc(value) + '</option>';
    }));
    return '<select class="' + cls + '"' + extra + '>' + options.join('') + '</select>';
  }
  return '<input type="text" class="' + cls + '"' + extra + ' autocomplete="off">';
}

function dynSection(kind, path, name, schema, valueSchema) {
  var idx = DYN.length;
  DYN.push({kind: kind, schema: valueSchema});
  return '<fieldset class="kdf-dyn" data-dyn="' + idx + '" data-dynpath="' + esc(path) + '">' +
    '<legend>' + esc(name) + '</legend>' + hintHtml(schema) +
    '<div class="kdf-rows"></div>' +
    '<button type="button" class="kdf-add">Add</button>' +
    '</fieldset>';
}

function rowHtml(d) {
  if (d.kind === 'map') {
    return '<div class="kdf-row">' +
      '<input type="text" class="kdf-k" placeholder="key" autocomplete="off">' +
      scalarInputHtml(d.schema, 'kdf-v', ' placeholder="value"') +
      '<button type="button" class="kdf-remove" title="Remove">&#10005;</button></div>';
  }
  if (d.kind === 'arr') {
    return '<div class="kdf-row">' + scalarInputHtml(d.schema, 'kdf-v', '') +
      '<button type="button" class="kdf-remove" title="Remove">&#10005;</button></div>';
  }
  // objarr: one entry rendered from the item object's schema (relative paths).
  var requiredChildren = d.schema.required || [];
  var fields = Object.keys(d.schema.properties).map(function (key) {
    return fieldHtml(key, key, d.schema.properties[key], requiredChildren.indexOf(key) >= 0, 0, true);
  });
  return '<div class="kdf-entry">' + fields.join('') +
    '<button type="button" class="kdf-remove">Remove</button></div>';
}

function fieldHtml(path, name, schema, required, depth, rel) {
  schema = schema || {};
  var attrs = ' ' + (rel ? 'data-rel' : 'data-path') + '="' + esc(path) + '"';
  // Objects with declared properties always expand to fieldsets — CRD
  // structural schemas are finite trees, and anything bulky below (arrays,
  // maps) renders lazily via its dynamic section, so there is no depth to
  // cap. Only schema-less shapes are left to the JSON fallback.
  if (schema.type === 'object' && schema.properties) {
    var requiredChildren = schema.required || [];
    var children = Object.keys(schema.properties).map(function (key) {
      return fieldHtml(path + '.' + key, key, schema.properties[key], requiredChildren.indexOf(key) >= 0, depth + 1, rel);
    });
    return '<fieldset><legend>' + esc(name) + '</legend>' + hintHtml(schema) + children.join('') + '</fieldset>';
  }
  // Free-form/map object (additionalProperties or preserve-unknown-fields):
  // key/value rows. Values follow the declared value schema, otherwise they
  // are auto-typed (10000 → number, true/false → boolean). Sections nest
  // (inside object-array entries too); rows render lazily on Add and the
  // DOM-walking collector scopes each section's rows to itself.
  if (schema.type === 'object' && !schema.properties) {
    var valueSchema = typeof schema.additionalProperties === 'object' ? schema.additionalProperties : null;
    return dynSection('map', path, name, schema, valueSchema);
  }
  if (schema.type === 'array') {
    var items = schema.items || {};
    if (items.type === 'object' && items.properties) {
      return dynSection('objarr', path, name, schema, items);
    }
    if (isScalar(items) || items.enum) {
      return dynSection('arr', path, name, schema, items);
    }
  }
  if (schema.type === 'boolean') {
    return '<label><input type="checkbox" data-kind="boolean"' + attrs + '>' + esc(name) + '</label>' + hintHtml(schema);
  }
  if (schema.type === 'integer' || schema.type === 'number') {
    return labelHtml(name, required) + '<input type="number" data-kind="' + schema.type + '"' + attrs + '>' + hintHtml(schema);
  }
  if (schema.type === 'string' && schema.enum) {
    var options = (required ? [] : ['<option value=""></option>']).concat(schema.enum.map(function (value) {
      return '<option>' + esc(value) + '</option>';
    }));
    return labelHtml(name, required) + '<select data-kind="string"' + attrs + '>' + options.join('') + '</select>' + hintHtml(schema);
  }
  if (schema.type === 'string') {
    return labelHtml(name, required) + '<input type="text" data-kind="string"' + attrs + ' autocomplete="off">' + hintHtml(schema);
  }
  // Only truly schema-less shapes are left to raw JSON.
  return labelHtml(name + ' (JSON)', required) +
    '<textarea rows="3" data-kind="json"' + attrs + ' placeholder=\\'{"key": "value"}\\'></textarea>' + hintHtml(schema);
}

function renderSpec() {
  DYN.length = 0;
  var properties = (state.schema && state.schema.properties) || {};
  var required = (state.schema && state.schema.required) || [];
  var parts = [];
  Object.keys(properties).forEach(function (key) {
    if (key === 'apiVersion' || key === 'kind' || key === 'metadata' || key === 'status') { return; }
    parts.push(fieldHtml(key, key, properties[key], required.indexOf(key) >= 0, 0));
  });
  specBox.innerHTML = parts.length ? parts.join('') :
    '<div class="kdf-hint">This CRD declares no openAPI properties; only metadata will be set.</div>';
}

function setPath(target, segments, value) {
  for (var i = 0; i < segments.length - 1; i++) {
    if (typeof target[segments[i]] !== 'object' || target[segments[i]] === null) {
      target[segments[i]] = {};
    }
    target = target[segments[i]];
  }
  target[segments[segments.length - 1]] = value;
}

function coerceAuto(value) {
  if (value === 'true') { return true; }
  if (value === 'false') { return false; }
  if (/^-?\\d+(\\.\\d+)?$/.test(value)) { return Number(value); }
  return value;
}

// Value of a dynamic-row input, typed by the section's value schema when it
// declares one, auto-typed otherwise. undefined = empty, skip.
function scalarValue(el, schema) {
  var value = el.value;
  if (value === '' || value == null) { return undefined; }
  if (schema && (schema.type === 'integer' || schema.type === 'number')) {
    var n = Number(value);
    if (isNaN(n)) { throw new Error('Invalid number: ' + value); }
    return n;
  }
  if (schema && schema.type === 'boolean') { return value === 'true'; }
  if (schema) { return value; }
  return coerceAuto(value);
}

// Value of a schema-rendered leaf input (data-path/data-rel + data-kind).
function leafValue(el) {
  var where = el.getAttribute('data-path') || el.getAttribute('data-rel');
  var kind = el.getAttribute('data-kind');
  if (kind === 'boolean') { return el.checked ? true : undefined; }
  if (el.value === '' || el.value == null) { return undefined; }
  if (kind === 'integer' || kind === 'number') {
    var n = Number(el.value);
    if (isNaN(n)) { throw new Error('Invalid number in ' + where); }
    return n;
  }
  if (kind === 'json') {
    try {
      return JSON.parse(el.value);
    } catch (err) {
      throw new Error('Invalid JSON in ' + where);
    }
  }
  return el.value;
}

// Value of one dynamic section. Row queries are :scope-anchored so an outer
// section never swallows the rows/entries of a section nested inside one of
// its entries.
function sectionValue(box) {
  var d = DYN[Number(box.getAttribute('data-dyn'))];
  if (d.kind === 'map') {
    var map = {};
    var rows = box.querySelectorAll(':scope > .kdf-rows > .kdf-row');
    for (var k = 0; k < rows.length; k++) {
      var key = rows[k].querySelector('.kdf-k').value.trim();
      var v = scalarValue(rows[k].querySelector('.kdf-v'), d.schema);
      if (key && v !== undefined) { map[key] = v; }
    }
    return Object.keys(map).length ? map : undefined;
  }
  if (d.kind === 'arr') {
    var list = [];
    var inputs = box.querySelectorAll(':scope > .kdf-rows > .kdf-row > .kdf-v');
    for (var m = 0; m < inputs.length; m++) {
      var item = scalarValue(inputs[m], d.schema);
      if (item !== undefined) { list.push(item); }
    }
    return list.length ? list : undefined;
  }
  var entries = [];
  var entryEls = box.querySelectorAll(':scope > .kdf-rows > .kdf-entry');
  for (var n2 = 0; n2 < entryEls.length; n2++) {
    var obj = {};
    walkCollect(entryEls[n2], 'data-rel', obj);
    if (Object.keys(obj).length) { entries.push(obj); }
  }
  return entries.length ? entries : undefined;
}

// Recursive DOM walk: schema-rendered leaves keyed by the attr argument,
// dynamic sections (any nesting depth) delegated to sectionValue and stopped
// there — their internals use their own scope.
function walkCollect(rootEl, attr, out) {
  var kids = rootEl.children;
  for (var i = 0; i < kids.length; i++) {
    var el = kids[i];
    if (el.classList.contains('kdf-dyn')) {
      var v = sectionValue(el);
      if (v !== undefined) { setPath(out, el.getAttribute('data-dynpath').split('.'), v); }
      continue;
    }
    if (el.hasAttribute(attr)) {
      var lv = leafValue(el);
      if (lv !== undefined) { setPath(out, el.getAttribute(attr).split('.'), lv); }
      continue;
    }
    walkCollect(el, attr, out);
  }
}

function collect() {
  var out = {};
  walkCollect(specBox, 'data-path', out);
  return out;
}

function submit() {
  if (!state.crd) { return; }
  errBox.style.display = 'none';
  var nameEl = metaBox.querySelector('.kdf-name');
  var name = nameEl ? nameEl.value.trim() : '';
  if (!name) { showError('Name is required'); return; }
  var obj;
  try {
    obj = collect();
  } catch (err) {
    showError(err.message);
    return;
  }
  obj.apiVersion = state.crd.spec.group + '/' + state.version;
  obj.kind = state.crd.spec.names.kind;
  obj.metadata = {name: name};
  if (state.scope === 'Namespaced') {
    var nsEl = metaBox.querySelector('.kdf-ns');
    obj.metadata.namespace = nsEl ? nsEl.value : ctx.namespace;
  }
  ctx.buttons.patch('create', {disabled: true});
  ctx.submit(obj).then(function () {
    ctx.close();
  }, function (err) {
    ctx.buttons.patch('create', {disabled: false});
    showError('Create failed: ' + fmtErr(err));
  });
}
`;
