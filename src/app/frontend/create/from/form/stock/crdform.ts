// Copyright 2026 The Kubernetes Authors.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.

// Stock FormPlugin: generates an HTML form for any installed CRD from its
// openAPI v3 schema and creates the object through ctx.submit. Runs through
// kd-form-plugin-host exactly like FormPlugin CRs do — it is the reference
// implementation of the script contract.
//
// The form itself comes from window.kdSchemaForm (common/schemaform), the
// shared schema→form generator also consumed by plugins (e.g. the Apps
// helm-values form) — one implementation, one interface.
//
// ctx.args.presetPattern (regex source) preselects the first matching CRD —
// product cards reuse the script that way.

export const CRD_FORM_SCRIPT = `'use strict';
var state = {crds: [], crd: null, version: null, scope: 'Namespaced', schema: null, namespaces: []};
var form = null;

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
host.addEventListener('click', function (ev) {
  var cls = ev.target.classList;
  if (cls && (cls.contains('kdf-add') || cls.contains('kdf-remove'))) { ctx.markDirty(true); }
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

function renderSpec() {
  if (form) { form.destroy(); form = null; }
  var lib = window.kdSchemaForm;
  if (!lib) { specBox.textContent = 'kdSchemaForm is unavailable in this dashboard build.'; return; }
  var properties = (state.schema && state.schema.properties) || {};
  var renderable = Object.keys(properties).filter(function (key) {
    return ['apiVersion', 'kind', 'metadata', 'status'].indexOf(key) < 0;
  });
  if (!renderable.length) {
    specBox.innerHTML = '<div class="kdf-hint">This CRD declares no openAPI properties; only metadata will be set.</div>';
    return;
  }
  form = lib.render(specBox, state.schema, {
    skipKeys: ['apiVersion', 'kind', 'metadata', 'status'],
    requiredMarkers: true,
  });
}

function submit() {
  if (!state.crd) { return; }
  errBox.style.display = 'none';
  var nameEl = metaBox.querySelector('.kdf-name');
  var name = nameEl ? nameEl.value.trim() : '';
  if (!name) { showError('Name is required'); return; }
  var obj;
  try {
    obj = form ? form.collect() : {};
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
