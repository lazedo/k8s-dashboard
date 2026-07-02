// Copyright 2026 The Kubernetes Authors.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.

// Stock FormPlugin: renders docs/plugins/form-plugins.md (served as an asset)
// inside a card — the gallery documents itself. No submit; the bar is a
// single Close. Also a live example of a read-only form plugin.

export const DOCS_FORM_SCRIPT = `'use strict';
ctx.buttons.set([{id: 'close', label: 'Close'}]);
ctx.onAction(function () { ctx.close(); });

host.innerHTML = '<div class="kdf-doc">Loading…</div>';
var box = host.querySelector('.kdf-doc');

function esc(value) {
  return String(value).replace(/[&<>]/g, function (c) {
    return {'&': '&amp;', '<': '&lt;', '>': '&gt;'}[c];
  });
}

// Minimal markdown: headings, fenced code, inline code, bold, tables, lists.
function render(md) {
  var out = [];
  var lines = md.split('\\n');
  var inCode = false;
  var inTable = false;
  var inList = false;
  function closeBlocks() {
    if (inTable) { out.push('</table>'); inTable = false; }
    if (inList) { out.push('</ul>'); inList = false; }
  }
  function inline(s) {
    return esc(s)
      .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
      .replace(/\\*\\*([^*]+)\\*\\*/g, '<b>$1</b>');
  }
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.slice(0, 3) === '\`\`\`') {
      closeBlocks();
      out.push(inCode ? '</pre>' : '<pre>');
      inCode = !inCode;
      continue;
    }
    if (inCode) { out.push(esc(line)); continue; }
    if (/^#{1,3} /.test(line)) {
      closeBlocks();
      var level = line.indexOf(' ');
      out.push('<h' + (level + 1) + '>' + inline(line.slice(level + 1)) + '</h' + (level + 1) + '>');
      continue;
    }
    if (/^\\| /.test(line) || /^\\|[\\s:|-]+$/.test(line)) {
      if (/^\\|[\\s:|-]+$/.test(line)) { continue; }  // |---|---| separator row
      if (!inTable) { closeBlocks(); out.push('<table>'); inTable = true; }
      var cells = line.split('|').slice(1, -1).map(function (c) { return '<td>' + inline(c.trim()) + '</td>'; });
      out.push('<tr>' + cells.join('') + '</tr>');
      continue;
    }
    if (/^- /.test(line)) {
      if (!inList) { closeBlocks(); out.push('<ul>'); inList = true; }
      out.push('<li>' + inline(line.slice(2)) + '</li>');
      continue;
    }
    closeBlocks();
    if (line.trim() === '') { out.push(''); continue; }
    out.push('<p>' + inline(line) + '</p>');
  }
  closeBlocks();
  return out.join('\\n');
}

fetch('assets/docs/form-plugins.md').then(function (res) {
  if (!res.ok) { throw new Error(res.status); }
  return res.text();
}).then(function (md) {
  box.innerHTML = render(md);
}, function () {
  box.textContent = 'Documentation asset not found (assets/docs/form-plugins.md).';
});
`;
