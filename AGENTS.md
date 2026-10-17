# Turret Prototype

A Risk of Rain-like top-down shooter roguelike in plain JavaScript and a 2D canvas. No build step, no
dependencies: open `index.html` through a static server and play.

```bash
python3 -m http.server 8000 --bind 127.0.0.1   # then open http://127.0.0.1:8000
```

## Item table (read this before touching items)

The source of truth for every item is this Google Sheet:

**https://docs.google.com/spreadsheets/d/1uPRXiHfty9kSLOXt1RiWTKBP9hps7g4SHuq4Qchq1eo/edit**

Columns: `id, name, tier, scope, description, stacking`. It mirrors `ITEMS` in `js/data.js` and the
generated `items.csv`. Anyone with the link can edit it, so agents update it themselves (see
[docs/items.md](docs/items.md#updating-the-sheet)).

Whenever items are added, removed or changed (name, tier, scope, description, stacking or behavior):

1. `node tools/diff_items_sheet.js` lists how the sheet and the game differ.
2. Update `ITEMS` in `js/data.js` and the game code so the game does what the sheet says.
3. `node tools/export_items_csv.js` regenerates `items.csv`. Never edit `items.csv` by hand.
4. If the game now differs from the sheet, update the sheet, then rerun step 1 until it reports
   `sheet and game items match`.

Details: [docs/items.md](docs/items.md).

## Where things are

| Need | Look in |
|---|---|
| How the code is organized, globals, frame loop, script order | [docs/architecture.md](docs/architecture.md) |
| Items: data fields, how effects are wired, buff status row, CSV/sheet tools, icons | [docs/items.md](docs/items.md) |
| Maps, rocks, chests, shrines, teleporter, bosses, difficulty, minimap | [docs/gameplay.md](docs/gameplay.md) |

## Conventions

- Match the surrounding code: terse, no framework, globals shared across files.
- No unnecessary null checks.
- Tunable numbers live in `js/data.js` as constants or `DEFAULT_SETTINGS` (exposed in the run settings
  panel in `js/ui.js`).
- Test in the browser: serve the folder, start a run with `startRun(CHARACTERS[0].id)` from the console,
  and inspect or change the state (`Game.run`, `player`, `enemies`, `chests`, `teleporter`). `addItem(id, n)` followed
  by `recomputeStats()` gives items.
