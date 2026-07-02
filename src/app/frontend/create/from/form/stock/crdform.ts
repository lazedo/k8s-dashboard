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

function fieldHtml(path, name, schema, required, depth) {
  schema = schema || {};
  var attrs = ' data-path="' + esc(path) + '"';
  if (schema.type === 'object' && schema.properties && depth < 3) {
    var requiredChildren = schema.required || [];
    var children = Object.keys(schema.properties).map(function (key) {
      return fieldHtml(path + '.' + key, key, schema.properties[key], requiredChildren.indexOf(key) >= 0, depth + 1);
    });
    return '<fieldset><legend>' + esc(name) + '</legend>' + hintHtml(schema) + children.join('') + '</fieldset>';
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
  // Arrays, maps and deeply nested/free-form objects fall back to JSON.
  return labelHtml(name + ' (JSON)', required) + '<textarea rows="3" data-kind="json"' + attrs + '></textarea>' + hintHtml(schema);
}

function renderSpec() {
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

function collect() {
  var out = {};
  var els = specBox.querySelectorAll('[data-path]');
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    var kind = el.getAttribute('data-kind');
    var value;
    if (kind === 'boolean') {
      if (!el.checked) { continue; }
      value = true;
    } else if (el.value === '' || el.value == null) {
      continue;
    } else if (kind === 'integer' || kind === 'number') {
      value = Number(el.value);
      if (isNaN(value)) { throw new Error('Invalid number in ' + el.getAttribute('data-path')); }
    } else if (kind === 'json') {
      try {
        value = JSON.parse(el.value);
      } catch (err) {
        throw new Error('Invalid JSON in ' + el.getAttribute('data-path'));
      }
    } else {
      value = el.value;
    }
    setPath(out, el.getAttribute('data-path').split('.'), value);
  }
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
