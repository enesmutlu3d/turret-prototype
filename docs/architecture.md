# Architecture

Plain browser scripts sharing globals. `index.html` loads them in this order, each one may use what the
earlier ones define:

| File | Role |
|---|---|
| `js/data.js` | All static data and tuning: `MAPS`, constants, `DEFAULT_SETTINGS`, `CHARACTERS`, `CHESTS`, `WEAPONS`, `ITEMS` (+ `ITEM_BY_ID`), `ENEMIES`, `BOSS_ORDER`, tier names/colors. |
| `js/audio.js` | `Sfx`: procedural WebAudio sound effects, mute state. |
| `js/game.js` | Simulation: run state, stats, spawning, weapons, damage and procs, player, chests, maps, teleporter, equipment, allies, enemies, bosses, loot, FX, main `update(dt)` and the `frame` loop. |
| `js/render.js` | `Render`: canvas drawing of the world, HUD, minimap, status row, boss bar. |
| `js/ui.js` | `UI`: DOM overlays (menu, character pick, run settings, item pick, pause, run end), the DOM item/weapon/equipment bar, tooltips, input. |
| `css/style.css` | Styles for the DOM overlays and HUD bar. |

## State

- `Game.run`: everything about the current run (hp, gold, xp, level, items, weapons, timers, buffs,
  map number, difficulty coefficient). Created by `newRun` / `startRun` in `js/game.js`.
- `Game.run.stats` (`S`): derived stats rebuilt by `recomputeStats()`; `S.core[id]` is the count of each
  character-scope item. Each weapon has `w.stats` from `computeWeaponStats`, with `w.stats.n[id]` the
  count of each weapon-scope item.
- `Game.meta` / `Game.settings`: persisted in `localStorage` (`turretproto_meta`, `turretproto_settings`).
- Module-level arrays at the top of `js/game.js`: `enemies`, `bullets`, `ebullets` (enemy bullets),
  `drops`, `chests`, `allies`, `zones`, `mines`, `orbs`, `particles`, `texts`, FX lines/rings; plus
  `player`, `rocks`/`rockGrid` and `teleporter`. Enemies, bullets and particles reuse objects from
  `*Free` pools.
- Enemies are indexed in a spatial grid (`rebuildGrid`, `queryRadius`, `nearestEnemy`).

## Frame

`frame(t)` (end of `js/game.js`) clamps `dt` to 1/30 s and, while playing, runs `update(dt)`
`Game.speed` times, opens the item pick if choices are pending, calls `UI.tickHud()`, then always
`Render.draw()`. `js/game.js` is split by `// ---------- Section ----------` banners (Run setup, Stats,
Run flow, Spawning, Grid, Targeting, Weapons, Damage & procs, Player, Chests, Maps, Teleporter, Movement,
Equipment, Allies…, Enemies, Enemy special attacks, Boss patterns, Loot, FX, Main update); search for a
banner to jump to a system.

## Rendering

- The map background (ground, rocks) is pre-painted once per map in `Render.buildBackground`, and only
  the visible sub-rectangle is drawn each frame. The minimap and its fog canvas are built at the same time.
- HUD is drawn on the canvas in `Render.drawHud` (HP, XP, gold, status row, difficulty, objective, boss bar,
  minimap); the item/weapon/equipment bar at the bottom is DOM (`UI.renderHud` / `UI.tickHud`).
- Item icons are `assets/items/<id>.png`, loaded lazily by `Render.icon(id)`.
