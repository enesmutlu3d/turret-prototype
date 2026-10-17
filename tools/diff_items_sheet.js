'use strict';

// Compares the item sheet (Google Sheets, the source of truth for items) with ITEMS in js/data.js and
// lists every added, removed or changed item. Run before applying sheet edits to the game:
//   node tools/diff_items_sheet.js
// The sheet columns match items.csv: id, name, tier, scope, description, stacking.

const fs = require('fs');
const path = require('path');

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1uPRXiHfty9kSLOXt1RiWTKBP9hps7g4SHuq4Qchq1eo/export?format=csv';
const root = path.join(__dirname, '..');

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter(r => r.some(c => c.trim()));
  return body.map(r => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] || '').trim()])));
}

function byId(rows) {
  return new Map(rows.map(r => [r.id, r]));
}

(async () => {
  const res = await fetch(SHEET_URL);
  if (!res.ok) throw new Error(`sheet download failed: ${res.status}`);
  const sheet = byId(parseCsv((await res.text()).replace(/^\ufeff/, '')));
  require('./export_items_csv.js');
  const local = byId(parseCsv(fs.readFileSync(path.join(root, 'items.csv'), 'utf8').replace(/^\ufeff/, '')));

  let n = 0;
  for (const [id, r] of sheet) {
    if (!local.has(id)) { n++; console.log(`+ ${id}: new in sheet\n    ${JSON.stringify(r)}`); continue; }
    const l = local.get(id);
    for (const k in r) {
      if (r[k] !== l[k]) { n++; console.log(`~ ${id}.${k}\n    game:  ${l[k]}\n    sheet: ${r[k]}`); }
    }
  }
  for (const id of local.keys()) if (!sheet.has(id)) { n++; console.log(`- ${id}: missing from sheet`); }
  console.log(n ? `${n} difference(s)` : 'sheet and game items match');
})();
