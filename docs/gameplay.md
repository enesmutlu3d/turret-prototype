# Gameplay systems

## Run loop

A run is a chain of maps. On each map the player explores, opens chests and shrines, then activates the
teleporter with E to start the boss event. Once the teleporter is fully charged and every boss is dead,
enemies are wiped and spawning stops; pressing E at the teleporter again travels to the next map
(`travelToNextMap`). A map takes about 5–8 minutes.

## Maps (`MAPS` in `js/data.js`, `// ---------- Maps ----------` in `js/game.js`)

- Six themed maps, ~4200–4600 × 2800–3000. `WORLD_W` / `WORLD_H` are set per map in `loadMap()`.
- Rocks are circular colliders in a lookup grid (`generateRocks`, `rockAt`, `pushOutOfRocks`,
  `freeSpot`); enemies slide around them in `collideEnemiesWithRocks`.
- Interactables are scattered on load: `mapChests` chests and `shrineCount` Shrines of Chance (settings).
  `updateInteract` handles the E key: equipment swap, then chest/shrine, then teleporter.

## Teleporter (`// ---------- Teleporter ----------`)

`teleporter.state`: `idle` → `charging` → `done`. Charges only while the player is within `TELEPORTER_R`;
charge time is the `teleporterCharge` setting. Spawning is ×`TELEPORTER_SPAWN_MULT` during the event.
Completion drops an Uncommon item (20% Legendary) and sets the run phase to `clear`.

## Difficulty

`Game.run.coeff = (1 + TIME_DIFFICULTY × minutes) × MAP_DIFFICULTY^(map − 1)` (`computeCoeff`).
`Game.run.threat` is the coeff mapped back onto the old stage curve (`threatForCoeff`) and drives spawn
rate, enemy pool, elites and chest tiers. Enemy HP/damage scale with `enemyHpMult` / `enemyDmgMult`.
Waves alternate surges and breathers (settings).

## Bosses (`ENEMIES` with `boss: true`, `BOSS_ORDER`, `// ---------- Boss patterns ----------`)

- Spawned by the teleporter event (`spawnBoss`), one more every `MAPS_PER_EXTRA_BOSS` maps (each at ×0.75 HP).
- Below `BOSS_PHASE2` HP a boss enters phase 2: faster, uses `patterns2`, attacks more often, red aura.
- Patterns are handled in `updateBoss`: nova, slam, spiral, volley, charge, summon.

## Minimap (`Render.drawMinimap`)

Top-right corner. The map shape is visible under a semi-transparent fog that clears permanently within
`MAP_REVEAL_R` of the player (`Render.revealFog`). Chests, shrines, ground items and the teleporter only
appear once their `seen` flag is set (by `revealed(o)` in `updateInteract`). Bosses and the player arrow
are always shown.
