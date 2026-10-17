# Items

## Source of truth

Items are designed in the Google Sheet:
https://docs.google.com/spreadsheets/d/1uPRXiHfty9kSLOXt1RiWTKBP9hps7g4SHuq4Qchq1eo/edit

| Column | `ITEMS` field in `js/data.js` |
|---|---|
| id | `id` (also the icon file name `assets/items/<id>.png`) |
| name | `name` |
| tier | `tier` index into `TIER_NAMES` (`Common, Uncommon, Legendary, Lunar, Boss, Void, Equipment`); `lunar: true` marks Lunar equipment |
| scope | `scope`: `weapon` = "All weapons", `core` = "Character", `equip` = "Equipment"; `corrupts` adds "corrupts X" |
| description | `desc` |
| stacking | `stack` (every non-equipment item must have one; equipment gets a fixed line) |

Any item change must keep the sheet, `js/data.js` and `items.csv` in agreement:

```bash
node tools/diff_items_sheet.js     # sheet vs game, prints every differing field
node tools/export_items_csv.js     # regenerate items.csv from js/data.js (fails if a stack field is missing)
```

## Updating the sheet

The sheet is editable by anyone with the link (no sign-in), but the Sheets API still needs OAuth, so
edit it through the browser tool:

1. Open the sheet's `/edit` URL in the Cursor browser. The user may have formatted the sheet (table style,
   column layout), so paste values into cells instead of re-importing the whole sheet.
2. Select the target cell from the page with `Runtime.evaluate`: focus `#t-name-box`, set its value
   (e.g. `F2`) and dispatch `keydown`/`keypress`/`keyup` Enter. Focus moves to the grid's `.cell-input`.
3. Dispatch a `ClipboardEvent('paste')` on `document.activeElement` with a `DataTransfer` holding
   `text/plain`: tabs between columns, newlines between rows, so one paste fills a whole block.
4. Prefix any value starting with `+`, `-`, `=` or `@` with `'`, otherwise Sheets parses it as a
   formula and shows `#ERROR!`. The `'` is not stored in the value.
5. Wait a few seconds for the save, then run `node tools/diff_items_sheet.js` to confirm the match.

Rows follow the order of `ITEMS`; when adding or removing items, insert or delete the matching sheet
rows so the order stays the same.

## Item fields

- `mods`: flat stat bonuses per stack (e.g. `{ ratePct: 15 }`, `{ crit: 10 }`), applied in
  `computeWeaponStats` / `recomputeStats`.
- `firstStack`: bonuses given only by the first copy (e.g. the +5% crit on Predatory Instincts).
- `corrupts`: Void items replace every owned copy of that item (`applyCorruption`).
- `cd`: equipment cooldown in seconds.
- "base damage" in descriptions is character-wide item damage (100% = 10), see `baseDmg(v)`;
  "damage" alone is the hitting weapon's damage; "kill-damage" is the killing hit's damage.

## Where effects live (`js/game.js`)

Behavior is hand-written per item, keyed by id. Search the id to find all of it.

| Trigger | Function |
|---|---|
| Stat bonuses | `recomputeStats`, `computeWeaponStats` |
| On hit | `hitEnemy`, `applyDamage` |
| On kill | `killEnemy` |
| On getting hurt / low HP | `onHurt`, `onLowHealth`, `takeDamage` |
| Movement and dash | `updateMovementItems`, `moveSpeed`, `tryDash`, `onDashEnd` |
| Timers, regen, auras, time-based buffs | `updatePlayer` |
| Equipment | `useEquipment`, `updateEquipment` |
| Allies (drones, ghosts, turrets) | `syncAllies`, `updateAllies` |
| Drops and item choice | `dropItem`, `rollItemTier`, `rollItemChoices`, `collectDrop` |

Character-scope counts are `S.core[id]` (usually `c.<id>`), weapon-scope counts `w.stats.n[id]`
(usually `n.<id>`). Chance rolls go through `roll(p)` so luck items apply; `KILL_BUFF_CHANCE` is the
shared on-kill buff chance.

## Buff status row

Temporary or conditional buffs are shown under the gold counter as icons with remaining time and stack
count. `activeStatuses()` in `js/game.js` builds the list, `Render.drawStatuses` draws it. When adding an
item that grants a buff, add one line to `activeStatuses()`.

## Icons

`python3 tools/item_icons/generate_item_icons.py` generates `assets/items/<id>.png` for every item in
`js/data.js` (needs Pillow) and fails if one is missing. New items need a motif added to that script.
