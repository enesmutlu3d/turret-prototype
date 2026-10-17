'use strict';

// Writes items.csv (every item in js/data.js) at the project root. Run after changing items:
//   node tools/export_items_csv.js
// Stacking comes from an item's `stack` field (equipment gets a fixed line).

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'js/data.js'), 'utf8') + ';this.ITEMS = ITEMS; this.TIER_NAMES = TIER_NAMES; this.EQUIP_TIER = EQUIP_TIER;', ctx);
const { ITEMS, TIER_NAMES, EQUIP_TIER } = ctx;

const SCOPES = { core: 'Character', weapon: 'All weapons', equip: 'Equipment (Shift)' };

function stacking(it) {
  if (it.stack) return it.stack;
  if (it.tier === EQUIP_TIER) return 'Does not stack: one equipment slot. Fuel Cell adds extra charges.';
  throw new Error(`${it.id}: give it a stack field describing how extra copies behave`);
}

function cell(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const rows = [['id', 'name', 'tier', 'scope', 'description', 'stacking']];
for (const it of ITEMS) {
  const tier = TIER_NAMES[it.tier] + (it.lunar ? ' (Lunar)' : '');
  const scope = SCOPES[it.scope] + (it.corrupts ? `, corrupts ${it.corrupts}` : '');
  rows.push([it.id, it.name, tier, scope, it.desc, stacking(it)]);
}
// The BOM makes Excel read the file as UTF-8.
fs.writeFileSync(path.join(root, 'items.csv'), '\ufeff' + rows.map(r => r.map(cell).join(',')).join('\n') + '\n');
console.log(`items.csv: ${ITEMS.length} items`);
