'use strict';

const WEAPON_TURN_SPEED = 14;
const WEAPON_AIM_TOLERANCE = 0.12;
// Engineer turrets: roaming distance band around the player, base speed, and the distance at which they rush back.
const TURRET_ROAM_MIN = 60;
const TURRET_ROAM_MAX = 150;
const TURRET_SPEED = 120;
const TURRET_LEASH = 230;
const TURRET_R = 11;

const CELL = 64;
const GOFF = 200;
const GW = Math.ceil((MAX_WORLD_W + GOFF * 2) / CELL);
const GH = Math.ceil((MAX_WORLD_H + GOFF * 2) / CELL);
// Rock lookup grid (cells of ROCK_CELL world units), rebuilt when a map loads.
const ROCK_CELL = 200;
const RGW = Math.ceil(MAX_WORLD_W / ROCK_CELL) + 1;
const RGH = Math.ceil(MAX_WORLD_H / ROCK_CELL) + 1;

const MAX_ENEMIES = 700;
const MAX_BULLETS = 6000;
const MAX_EBULLETS = 800;
const MAX_PARTICLES = 2500;
const MAX_TEXTS = 140;
const MAX_EVENTS_PER_FRAME = 1000;

const Game = {
  state: 'menu', // menu | play | ui
  paused: false,
  speed: 1,
  showDmg: true,
  run: null,
  meta: loadMeta(),
  settings: loadSettings(),
  // sx/sy: screen position in CSS px; x/y: world position, refreshed every frame as the camera moves.
  mouse: { x: 0, y: 0, sx: 0, sy: 0 },
  // Held movement keys and one-shot actions queued by input until the next update.
  keys: { up: false, down: false, left: false, right: false },
  dashQueued: false,
  interactQueued: false,
  equipQueued: false,
  fps: 60,
};

// fx/fy: facing (last move direction). dashT > 0 while dashing; iframeT > 0 while dash-invulnerable.
const player = {
  x: WORLD_W / 2, y: WORLD_H / 2, vx: 0, vy: 0, fx: 1, fy: 0,
  dashT: 0, dashDx: 0, dashDy: 0, dashRe: 0, charges: 0, iframeT: 0, dashHits: [],
  moveT: 0, stillT: 0, trailT: 0,
};

const enemies = [];
const enemyFree = [];
const bullets = [];
const bulletFree = [];
const ebullets = [];
const ebulletFree = [];
const particles = [];
const particleFree = [];
const texts = [];
const drops = [];
const fxLines = [];
const fxRings = [];
const allies = [];
const zones = [];
const mines = [];
const orbs = [];
const chests = [];
// Telegraphed ground blasts (boss slams, mortar shells): they damage the player if still inside when
// the timer runs out. sx/sy, when set, is where a mortar shell was fired from.
const hazards = [];
// Fired lasers { x, y, a, va, len, w, t, maxT, dmg, hit, owner }: hit the player once while active.
const beams = [];
// Expanding shockwave rings { x, y, r, speed, w, maxR, delay, dmg, hit, owner }: dash through them.
const waves = [];
// Fire trail patches left by Fireman's Boots / Burning Witness.
const trail = [];
// Equipment projectiles with custom behaviour (Preon Accumulator orbs).
const gadgets = [];
const delayed = [];
let events = [];
const grid = Array.from({ length: GW * GH }, () => []);
// Current map layout: circular rocks { x, y, r } that block the player and enemies,
// and the teleporter { x, y, state: 'idle' | 'charging' | 'done', charge (0-1), bosses, seen }.
const rocks = [];
const rockGrid = Array.from({ length: RGW * RGH }, () => []);
const teleporter = { x: 0, y: 0, state: 'idle', charge: 0, bosses: 0, seen: false };
const queryBuf = [];
let enemyIdSeq = 1;

// ---------- Run records ----------

function loadMeta() {
  const saved = JSON.parse(localStorage.getItem('turretproto_meta') || '{}');
  return { bestTime: saved.bestTime || 0, bestMaps: saved.bestMaps || 0, runs: saved.runs || 0 };
}

function saveMeta() {
  localStorage.setItem('turretproto_meta', JSON.stringify(Game.meta));
}

function loadSettings() {
  const raw = localStorage.getItem('turretproto_settings');
  const saved = raw ? JSON.parse(raw) : {};
  const s = structuredClone(DEFAULT_SETTINGS);
  for (const k in s) {
    if (!(k in saved)) continue;
    if (k === 'loadouts') { for (const c in s.loadouts) if (saved.loadouts[c]) s.loadouts[c] = saved.loadouts[c]; }
    else s[k] = saved[k];
  }
  return s;
}

// Weapon ids of a character's starting loadout, falling back to the default when the debug loadout is empty.
function loadoutWeapons(charId, settings) {
  const out = [];
  for (const id in settings.loadouts[charId]) {
    if (!WEAPONS[id]) continue;
    for (let k = 0; k < settings.loadouts[charId][id] && out.length < MAX_WEAPONS; k++) out.push(id);
  }
  return out.length ? out : CHARACTER_BY_ID[charId].weapons;
}

function saveSettings() {
  localStorage.setItem('turretproto_settings', JSON.stringify(Game.settings));
}

// ---------- Run setup ----------

function newRun(charId) {
  const settings = structuredClone(Game.settings);
  const char = CHARACTER_BY_ID[charId];
  Game.run = {
    settings,
    char,
    weapons: loadoutWeapons(charId, settings).map(id => makeWeapon(id, 0)),
    // Owned items, one stack per id. Every owned item is active.
    items: [],
    // The single equipment slot: held id, ready charges and seconds until the next charge.
    equip: { id: '', charges: 0, cdT: 0 },
    // Seconds left on timed equipment effects, by equipment id.
    buffT: {},
    tonicOn: false, eggOn: false, eggHits: [], meteorTick: 0,
    // Permanent Tonic Afflictions (-5% to all stats each).
    afflictions: 0,
    // Opened chests waiting for the player to pick an item: { tier, n }.
    itemChoices: [],
    gold: 0,
    goldEarned: 0,
    chestsOpened: 0,
    // Wave director: phase id ('build' | 'surge' | 'lull' | 'event' | 'clear' | 'none'), its spawn multiplier
    // and seconds left. The build/surge/lull cycle restarts at waveT0 on every map.
    phase: 'none', phaseMult: 1, phaseLeft: 0, waveT0: 0,
    bossAlive: 0,
    // Current map number (1-based; MAPS loop) and the difficulty coefficient / threat level derived from it.
    mapN: 1, mapsCleared: 0, map: MAPS[0], coeff: 1, threat: 1, fadeT: 0, mapTitleT: 0, travelQueued: false,
    cloakT: 0, shadowT: 0, shadowDur: 0, decoyX: 0, decoyY: 0,
    harpoonT: 0, harpoonDur: 1, witnessT: 0, antlerN: 0, antlerT: 0, antlerSpawnT: 0,
    faraday: 0, discipleT: 0, trailTick: 0, dynMove: 0, moving: false,
    time: 0,
    hp: 100,
    level: 1,
    xp: 0,
    infusionHp: 0,
    kills: 0,
    bossKills: 0,
    dmgDealt: 0,
    spawnAcc: 0,
    groupT: 0.5,
    minuteT: 60,
    dropHeat: 0,
    bossRedGiven: false,
    teslaT: 0,
    hurtFlash: 0,
    levelFlash: 0,
    shield: 0,
    barrier: 0,
    hitListDmg: 0,
    egoBombs: 0, egoT: 0, egoA: 0,
    fireworks: 0,
    compulsionN: 0, compulsionT: 0, compulsionKills: 0,
    // Item effect state. cd holds named item cooldowns.
    hurtT: 99, invulnT: 0, healPool: 0, soul: 0,
    medkits: [], echoQ: [], plants: [], urnTargets: [], cd: {},
    chronicN: 0, chronicT: 0, bannerT: 0, brainT: 0,
    frostT: 0, frostR: 0, frostTick: 0, chargeT: 0, chargeR: 0, chargeTick: 0,
    timekeeperUsed: false, hitListT: 3, savingsT: 0, barbedT: 0, urnT: 0, microT: 0,
    dynDmg: 1, dynRate: 1, dynCrit: 0, nearCount: 0,
  };
  clearEntities();
  Object.assign(player, {
    x: WORLD_W / 2, y: WORLD_H / 2, vx: 0, vy: 0, fx: 1, fy: 0,
    dashT: 0, dashRe: 0, iframeT: 0, moveT: 0, stillT: 0, trailT: 0,
  });
  player.dashHits.length = 0;
  recomputeStats();
  Game.run.hp = Game.run.stats.maxHp;
  Game.run.shield = Game.run.stats.maxShield;
  player.charges = Game.run.stats.dashCharges;
}

function makeWeapon(id, tier) {
  return {
    id, tier,
    targeting: 'closest',
    cd: Math.random() * 0.2, angle: -Math.PI / 2,
    // World position the weapon fires from; turrets also roam towards the player-relative offset (hx, hy),
// picking a new one every roamT.
    x: WORLD_W / 2, y: WORLD_H / 2, hx: 0, hy: 0, roamT: 0, busy: false,
    stats: null,
    predStacks: 0, predT: 0, pauldronT: 0, kjaroCd: 0, runaldCd: 0,
    singCd: 0, wormCd: 0, shuriken: 99, shurikenT: 0,
    turbine: 0, shotN: 0, disc: 0, discT: 0,
  };
}

function hyperbolic(per, stacks) {
  return 1 - 1 / (1 + per * stacks);
}

function spawnRate(threat) { return SPAWN_RATE_MULT * (0.6 + 0.3 * threat + 0.02 * threat * threat + 0.0006 * threat * threat * threat); }

function weaponTierForLevel(level) {
  let t = 0;
  while (t + 1 < WEAPON_TIER_LEVELS.length && level >= WEAPON_TIER_LEVELS[t + 1]) t++;
  return t;
}

// Risk of Rain style difficulty: grows with run time and compounds with every cleared map.
function difficultyCoeff() {
  return Game.run.coeff;
}

function computeCoeff(r) {
  return (1 + TIME_DIFFICULTY * r.time / 60) * Math.pow(MAP_DIFFICULTY, r.mapN - 1);
}

// Threat level drives the enemy pool, item tiers, item damage and pattern counts. These were tuned against
// the curve coeff = (1 + 0.2333 (s - 1)) * 1.06^(s - 1), so the level is read back from the coefficient.
function threatForCoeff(c) {
  let lo = 1, hi = 80;
  for (let i = 0; i < 24; i++) {
    const s = (lo + hi) / 2;
    if ((1 + 0.2333 * (s - 1)) * Math.pow(1.06, s - 1) < c) lo = s; else hi = s;
  }
  return lo;
}
// Chest prices and time-scaled gold (bosses, Life Savings, treasure) grow with this. Kill gold
// does not scale, but kill counts grow with the spawn rate (~c^2), so prices need the steep exponent
// to keep chests near 1.5-2.5 per minute.
function goldScale() { return Math.pow(difficultyCoeff(), 1.55); }
// Superlinear in the coefficient: flat for the first stages, steep after ~stage 10.
function enemyHpMult(c) { return Math.max(1, 0.385 * Math.pow(c, 1.59)); }
function enemyDmgMult(c) { return Math.max(1, 0.5 * Math.pow(c, 0.97)); }
function xpToNext(level) { return (level + 3) * (level + 3); }

// ---------- Stats ----------

function recomputeStats() {
  const r = Game.run, ch = r.char, st = r.settings;
  const s = {
    // Each level past the first adds 1 max HP.
    maxHp: ch.hp + (r.level - 1) + r.infusionHp,
    regen: ch.regen,
    armor: ch.armor,
    dodge: 0,
    dmg: 0,
    rate: 0,
    crit: ch.crit,
    range: 0,
    luck: 0,
    xpPct: 0,
    pickup: 110 + (ch.pickup || 0),
    procLuck: 0,
    healMult: 1,
    dmgMult: st.playerDmg * ch.dmgMult,
    teslacoil: 0,
    crown: 0,
    maxShield: 0,
    cdMult: 1,
    cdFlat: 0,
    rateMult: 1,
    burnMult: 1,
    dropMult: 1,
    goldMult: 1,
    enemyDmgMult: 1,
    movePct: 0,
    speed: 0,
    dashCharges: 1,
    dashCd: 1,
    dashDist: DASH_DIST,
    core: null,
  };

  const core = {};
  let shrimp = false;
  for (const slot of r.items) {
    if (ITEM_BY_ID[slot.id].scope === 'core') core[slot.id] = slot.n;
    if (slot.id === 'shrimp') shrimp = true;
  }
  s.core = core;
  for (const id in core) {
    const n = core[id];
    const m = ITEM_BY_ID[id].mods || {};
    if (m.maxHp) s.maxHp += m.maxHp * n;
    if (m.regen) s.regen += m.regen * n;
    if (m.armor) s.armor += m.armor * n;
    if (m.xpPct) s.xpPct += m.xpPct * n;
    if (m.procLuck) s.procLuck += m.procLuck * n;
    if (m.healPct) s.healMult += m.healPct / 100 * n;
    if (m.movePct) s.movePct += m.movePct * n;
  }
  const c = id => core[id] || 0;
  s.maxHp *= (1 + 0.08 * c('bitter')) * Math.pow(1.1, c('pearl')) * (1 + c('stoneflux'));
  if (c('irradiant')) {
    const k = 1 + 0.1 * c('irradiant');
    s.maxHp *= k; s.regen *= k; s.armor *= k; s.dmgMult *= k;
    s.rate += 10 * c('irradiant');
  }
  s.maxHp *= r.settings.playerHp;
  if (r.buffT.tonic > 0) { s.maxHp *= 1.5; s.regen *= 4; s.armor += 20; }
  if (r.afflictions) {
    const k = Math.pow(0.95, r.afflictions);
    s.maxHp *= k; s.regen *= k; s.armor *= k; s.dmgMult *= k;
  }
  if (core.tougher) s.dodge += hyperbolic(0.08, core.tougher) * 100;
  if (core.glass) { s.dmgMult *= 1 + core.glass; s.maxHp *= Math.pow(0.5, core.glass); }
  if (core.rachis) { s.dmgMult *= 1 + 0.5 * core.rachis; s.enemyDmgMult = 1 + 0.5 * core.rachis; }
  s.dmg += 20 * c('watch');
  s.procLuck -= c('purity');
  s.cdMult = Math.pow(0.5, c('lightflux')) * (ch.cdMult || 1);
  s.cdFlat = core.purity ? 1 + core.purity : 0;
  s.rateMult = Math.pow(0.65, c('lightflux')) * Math.pow(0.95, r.afflictions);
  s.rate += 7.5 * c('mocha');
  s.burnMult = 1 + 1.5 * c('ignition');
  s.dropMult = 1;
  s.goldMult = st.goldMult * (1 + (ch.gold || 0) / 100 + 0.25 * c('smartshopper'));
  s.speed = ch.speed * st.moveSpeed * Math.pow(0.7, c('stoneflux')) * Math.pow(0.95, r.afflictions);
  s.dashCharges = ch.dashCharges + c('feather') + 2 * c('afterburner');
  s.dashCd = ch.dashCd * st.dashCooldown * (core.afterburner ? 0.89 : 1) / (1 + 0.07 * c('jetpack'));
  if (core.strides) s.dashCd = Math.max(6, s.dashCd);
  s.dashDist = DASH_DIST * (1 + 0.13 * c('quail') + 0.03 * c('jetpack'));
  s.healMult += c('corpsebloom');
  s.teslacoil = core.teslacoil || 0;
  s.crown = core.crown || 0;
  s.maxHp = Math.max(1, Math.round(s.maxHp));
  s.maxShield = s.maxHp * (0.08 * c('shieldgen') + (core.kinetic ? 0.08 : 0) + (shrimp ? 0.1 : 0)) + 30 * c('heart');
  if (core.transcendence) {
    s.maxShield += s.maxHp * (1.5 + 0.25 * (core.transcendence - 1));
    s.maxHp = 1;
  }
  s.maxShield = Math.round(s.maxShield);
  s.dodge = Math.min(60, s.dodge);
  r.stats = s;

  const tier = weaponTierForLevel(r.level);
  for (const w of r.weapons) {
    w.tier = tier;
    w.stats = computeWeaponStats(w, s);
  }
  r.hp = Math.min(r.hp, s.maxHp);
  r.shield = Math.min(r.shield, s.maxShield);
  player.charges = Math.min(player.charges, s.dashCharges);
  syncAllies();
  UI.renderHud();
}

function computeWeaponStats(w, s) {
  const b = WEAPONS[w.id];
  const n = {};
  let dmgPct = 0, ratePct = 0, crit = 0, critDmg = 0, lanes = 1;
  for (const slot of Game.run.items) {
    if (ITEM_BY_ID[slot.id].scope !== 'core') n[slot.id] = slot.n;
  }
  for (const id in n) {
    const it = ITEM_BY_ID[id];
    const k = n[id];
    const m = it.mods || {};
    const o = it.firstStack || {};
    dmgPct += (m.dmgPct || 0) * k;
    ratePct += (m.ratePct || 0) * k;
    crit += (m.crit || 0) * k + (o.crit || 0);
    critDmg += (m.critDmg || 0) * k;
    lanes += (m.lanes || 0) * k;
  }
  const dmg = b.dmg * WEAPON_TIER_DMG[w.tier] * (1 + (s.dmg + dmgPct) / 100) * s.dmgMult;
  const rate = b.rate * WEAPON_TIER_RATE[w.tier] * Math.max(0.2, 1 + (s.rate + ratePct) / 100) * s.rateMult;
  const ws = {
    kind: b.kind,
    dmg, rate,
    crit: Math.min(100, 5 + (b.critBonus || 0) + s.crit + crit),
    critMult: (b.critMult || 2) + critDmg,
    range: b.range + s.range,
    count: b.kind === 'chain' ? 1 : b.count,
    chains: b.kind === 'chain' ? b.chains : 0,
    // Parallel copies of every shot (Backup Magazine).
    lanes,
    pierce: b.pierce || 0,
    aoe: b.aoe || 0,
    proc: b.proc,
    n,
  };
  ws.killDmg = dmg * (b.count || 1) * rate * 0.35;
  ws.dps = dmg * (b.kind === 'chain' ? 1 + ws.chains : ws.count) * lanes * rate * (1 + ws.crit / 100 * (ws.critMult - 1));
  return ws;
}

// ---------- Run flow ----------

function startRun(charId) {
  newRun(charId);
  const r = Game.run, c = r.stats.core;
  if (c.warbanner) r.bannerT = 4 + 4 * c.warbanner;
  if (c.fireworks) r.fireworks++;
  if (r.settings.startEquip) setEquipment(r.settings.startEquip);
  loadMap();
  Game.state = 'play';
  Game.paused = false;
  UI.hideOverlay();
  UI.renderHud();
}

function clearEntities() {
  clearMapEntities();
  allies.length = 0;
}

// Everything that belongs to the current map; allies follow the player to the next one.
function clearMapEntities() {
  for (const e of enemies) { e.alive = false; enemyFree.push(e); }
  enemies.length = 0;
  for (const b of bullets) { b.w = null; b.target = null; bulletFree.push(b); }
  bullets.length = 0;
  for (const b of ebullets) ebulletFree.push(b);
  ebullets.length = 0;
  drops.length = 0;
  fxLines.length = 0;
  fxRings.length = 0;
  texts.length = 0;
  events.length = 0;
  zones.length = 0;
  mines.length = 0;
  orbs.length = 0;
  coinCount = 0;
  chests.length = 0;
  hazards.length = 0;
  beams.length = 0;
  waves.length = 0;
  trail.length = 0;
  gadgets.length = 0;
  delayed.length = 0;
  rocks.length = 0;
  for (const cell of rockGrid) cell.length = 0;
}

// Effects that Risk of Rain ties to stages run once per minute here.
function minuteTick() {
  const r = Game.run, c = r.stats.core;
  r.timekeeperUsed = false;
  if (c.squid) spawnAlly('drone', 'squid', player.x, player.y, 30, 12, 2 * c.squid, '#3bc9db');
  for (let i = 0; i < Math.ceil((c.shipping || 0) / 2); i++) {
    dropItem(player.x + (Math.random() - 0.5) * 120, player.y + (Math.random() - 0.5) * 120, rollDropTier());
  }
  if (c.ego) egoConvert();
  if (c.benthic) benthicUpgrade(3 * c.benthic);
  if (c.ego || c.benthic) recomputeStats();
}

// Bosses rise out of the ground a short distance from the player. hpK scales their HP (several bosses at once).
function spawnBoss(type, hpK) {
  const r = Game.run, c = r.stats.core;
  const a = Math.random() * Math.PI * 2, d = 380 + Math.random() * 80;
  const p = freeSpot(player.x + Math.cos(a) * d, player.y + Math.sin(a) * d, ENEMIES[type].r + 10);
  const boss = spawnEnemy(type, p.x, p.y, false);
  boss.maxHp *= hpK;
  boss.hp = boss.maxHp;
  r.bossAlive++;
  burst(p.x, p.y, boss.def.color, 40, 300);
  addRing(p.x, p.y, 160, 'rgba(255,107,107,0.35)');
  addText(p.x, p.y - boss.r - 30, `${boss.def.name.toUpperCase()} AWAKENS`, '#ff6b6b');
  if (c.warbonds) fireMissiles(player.x, player.y, 5 * c.warbonds, boss.maxHp * 0.025, null, boss);
  if (c.warbanner) r.bannerT = 4 + 4 * c.warbanner;
  if (c.fireworks) r.fireworks++;
}

function endRun() {
  const r = Game.run;
  Game.state = 'ui';
  Game.paused = false;
  const best = r.time > Game.meta.bestTime;
  Game.meta.bestTime = Math.max(Game.meta.bestTime, r.time);
  Game.meta.bestMaps = Math.max(Game.meta.bestMaps, r.mapsCleared);
  Game.meta.runs++;
  saveMeta();
  clearEntities();
  UI.showRunEnd(best);
}

function onPlayerDeath() {
  Sfx.death();
  endRun();
}

function formatTime(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// ---------- Spawning ----------

// A random point just outside the visible area. Points beyond the arena are pulled to its border, so
// when the camera rests against a wall, enemies walk in through that wall.
function spawnPoint() {
  const m = 60;
  const x0 = Render.camX - m, y0 = Render.camY - m;
  const w = Render.viewW + 2 * m, h = Render.viewH + 2 * m;
  const p = Math.random() * 2 * (w + h);
  let x, y;
  if (p < w) { x = x0 + p; y = y0; }
  else if (p < 2 * w) { x = x0 + p - w; y = y0 + h; }
  else if (p < 2 * w + h) { x = x0; y = y0 + p - 2 * w; }
  else { x = x0 + w; y = y0 + p - 2 * w - h; }
  return { x: Math.max(-40, Math.min(WORLD_W + 40, x)), y: Math.max(-40, Math.min(WORLD_H + 40, y)) };
}

function pickEnemyType(w) {
  const pool = [['grunt', 10]];
  if (w >= 2) pool.push(['runner', 6]);
  if (w >= 2.5) pool.push(['charger', 2.5]);
  if (w >= 3) pool.push(['spitter', 3]);
  if (w >= 3.5) pool.push(['lancer', 1.2 + w * 0.08]);
  if (w >= 4) pool.push(['brute', 2 + w * 0.2]);
  if (w >= 4) pool.push(['juggernaut', 0.5 + w * 0.06]);
  if (w >= 5) pool.push(['bombard', 1.2 + w * 0.06]);
  if (w >= 6) pool.push(['splitter', 3]);
  if (w >= 6) pool.push(['scatterer', 2]);
  if (w >= 7) pool.push(['bomber', 2.5]);
  if (w >= 8) pool.push(['gunner', 0.3 + (w - 8) * 0.25]);
  let total = 0;
  for (const p of pool) total += p[1];
  let x = Math.random() * total;
  for (const p of pool) { x -= p[1]; if (x <= 0) return p[0]; }
  return 'grunt';
}

function rollElite() {
  const r = Game.run;
  if (r.phase === 'lull') return false;
  const k = r.phase === 'surge' ? 1.5 : 1;
  return Math.random() < Math.max(0, difficultyCoeff() - 1.3) * 0.008 * k;
}

function spawnEnemy(type, x, y, elite) {
  const d = ENEMIES[type];
  if (enemies.length >= MAX_ENEMIES && !d.boss) return null;
  const w = Game.run.threat;
  const st = Game.run.settings;
  const c = difficultyCoeff();
  const e = enemyFree.pop() || {};
  const hpM = st.enemyHp * enemyHpMult(c) * (elite ? 6 : 1) * (d.boss ? BOSS_HP_MULT : ENEMY_HP_MULT);
  e.id = enemyIdSeq++;
  e.type = type;
  e.def = d;
  e.alive = true;
  e.x = x; e.y = y; e.vx = 0; e.vy = 0;
  e.r = d.r * (elite ? 1.35 : 1);
  e.maxHp = e.hp = d.hp * hpM;
  e.speed = st.enemySpeed * d.speed * (1 + Math.min(0.3, (w - 1) * 0.015)) * (0.9 + Math.random() * 0.2);
  e.dmg = st.enemyDmg * d.dmg * enemyDmgMult(c) * (elite ? 1.6 : 1);
  e.lvl = d.lvl + (elite ? 3 : 0);
  e.elite = !!elite;
  e.boss = !!d.boss;
  e.atkCd = 0.4;
  e.shootCd = 0.8 + Math.random() * 1.5;
  e.burstLeft = 0; e.burstT = 0;
  e.slowT = 0; e.freezeT = 0;
  e.bleedDps = 0; e.bleedT = 0; e.burnDps = 0; e.burnT = 0;
  e.stickyT = 0; e.stickyDmg = 0; e.stickyW = null;
  e.justiceT = 0; e.flash = 0; e.dotW = null;
  e.stunT = 0; e.rootT = 0; e.fearT = 0;
  e.poisonDps = 0; e.poisonT = 0; e.infect = false;
  e.tetherT = 0; e.tetherDps = 0; e.tetherW = null;
  e.shred = 0; e.marked = false;
  e.patT = d.patternEvery || 0; e.pat = 0;
  // atk: special attack state (0 idle, see ATK_*); atkT counts down the current state.
  e.atk = 0; e.atkT = 0; e.aimA = 0; e.lz = null; e.hitDone = false;
  e.age = 0; e.enraged = false;
  // Boss state: second phase, bullet spiral (seconds left, angle, direction, tick) and aimed volleys left.
  e.phase2 = false; e.spiralT = 0; e.spiralA = 0; e.spiralDir = 1; e.spiralTick = 0; e.volleyN = 0; e.volleyT = 0;
  pushOutOfRocks(e, e.r);
  enemies.push(e);
  return e;
}

// Wave pacing: each cycle builds up, peaks in a surge, then gives a short breather.
// The multipliers average to ~1 over a cycle, so overall difficulty stays where it was.
// While the teleporter charges the director runs a constant 'event' rate; once it is done nothing spawns.
function updatePhase() {
  const r = Game.run, st = r.settings;
  if (teleporter.state === 'charging') { r.phase = 'event'; r.phaseMult = TELEPORTER_SPAWN_MULT; r.phaseLeft = 0; return; }
  if (teleporter.state === 'done') { r.phase = 'clear'; r.phaseMult = 0; r.phaseLeft = 0; return; }
  if (!st.wavePacing) { r.phase = 'none'; r.phaseMult = 1; r.phaseLeft = 0; return; }
  const surge = st.surgeSeconds, lull = st.breatherSeconds;
  const build = Math.max(5, st.waveCycle - surge - lull);
  const t = (r.time - r.waveT0) % (build + surge + lull);
  const prev = r.phase;
  if (t < build) {
    r.phase = 'build'; r.phaseMult = 0.75 + 0.4 * t / build; r.phaseLeft = build - t;
  } else if (t < build + surge) {
    r.phase = 'surge'; r.phaseMult = st.surgeMult; r.phaseLeft = build + surge - t;
  } else {
    r.phase = 'lull'; r.phaseMult = 0.1; r.phaseLeft = build + surge + lull - t;
  }
  if (prev === r.phase || prev === 'none' || prev === 'clear') return;
  if (r.phase === 'surge') { addText(player.x, player.y - 110, 'SURGE!', '#ff6b6b'); Sfx.surge(); }
  if (r.phase === 'lull') addText(player.x, player.y - 110, 'BREATHER', '#69db7c');
}

function updateSpawner(dt) {
  const r = Game.run;
  updatePhase();
  if (r.phase === 'clear') return;
  r.spawnAcc += dt * spawnRate(r.threat) * r.phaseMult;
  r.groupT -= dt;
  if (r.groupT > 0) return;
  r.groupT = 1.2;
  const n = Math.floor(r.spawnAcc);
  r.spawnAcc -= n;
  // Surges come from several directions at once.
  const groups = r.phase === 'surge' ? Math.min(n, 3) : 1;
  for (let g = 0; g < groups; g++) {
    const p = spawnPoint();
    const k = Math.floor(n / groups) + (g < n % groups ? 1 : 0);
    for (let i = 0; i < k; i++) {
      spawnEnemy(pickEnemyType(r.threat), p.x + (Math.random() - 0.5) * 80, p.y + (Math.random() - 0.5) * 80, rollElite());
    }
  }
}

// ---------- Grid ----------

function rebuildGrid() {
  for (let i = 0; i < grid.length; i++) grid[i].length = 0;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    const x0 = clampCell(((e.x - e.r + GOFF) / CELL) | 0, GW);
    const x1 = clampCell(((e.x + e.r + GOFF) / CELL) | 0, GW);
    const y0 = clampCell(((e.y - e.r + GOFF) / CELL) | 0, GH);
    const y1 = clampCell(((e.y + e.r + GOFF) / CELL) | 0, GH);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) grid[cy * GW + cx].push(e);
    }
  }
}

function clampCell(v, max) {
  return v < 0 ? 0 : v >= max ? max - 1 : v;
}

let queryStamp = 1;
function queryRadius(x, y, r) {
  queryBuf.length = 0;
  queryStamp++;
  const x0 = clampCell(((x - r + GOFF) / CELL) | 0, GW);
  const x1 = clampCell(((x + r + GOFF) / CELL) | 0, GW);
  const y0 = clampCell(((y - r + GOFF) / CELL) | 0, GH);
  const y1 = clampCell(((y + r + GOFF) / CELL) | 0, GH);
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const cell = grid[cy * GW + cx];
      for (let i = 0; i < cell.length; i++) {
        const e = cell[i];
        if (!e.alive || e.stamp === queryStamp) continue;
        e.stamp = queryStamp;
        const dx = e.x - x, dy = e.y - y, rr = r + e.r;
        if (dx * dx + dy * dy <= rr * rr) queryBuf.push(e);
      }
    }
  }
  return queryBuf;
}

function nearestEnemy(x, y, maxR, excludeIds) {
  let best = null, bestD = maxR * maxR;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e.alive || !inWorld(e)) continue;
    const dx = e.x - x, dy = e.y - y, d2 = dx * dx + dy * dy;
    if (d2 < bestD && (!excludeIds || !excludeIds.includes(e.id))) { bestD = d2; best = e; }
  }
  return best;
}

function inWorld(e) {
  return e.x > -e.r && e.y > -e.r && e.x < WORLD_W + e.r && e.y < WORLD_H + e.r;
}

// ---------- Targeting ----------

function findTarget(mode, x, y, range) {
  const R2 = range * range;
  let best = null, bestK = Infinity, bestD = Infinity;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e.alive) continue;
    const dx = e.x - x, dy = e.y - y, d2 = dx * dx + dy * dy;
    if (d2 > R2) continue;
    let k;
    switch (mode) {
      case 'closest': k = d2; break;
      case 'farthest': k = -d2; break;
      case 'weakest': k = e.lvl; break;
      case 'strongest': k = -e.lvl; break;
      case 'lowhp': k = e.hp; break;
      case 'highhp': k = -e.hp; break;
      case 'ranged': k = e.def.ranged ? d2 : 1e12 + d2; break;
      default: k = d2;
    }
    if (k < bestK || (k === bestK && d2 < bestD)) { bestK = k; bestD = d2; best = e; }
  }
  return best;
}

// ---------- Weapons ----------

// Offset of weapon i of n from the player centre: a lone weapon sits in the middle, more are spread on a ring.
function mountOffset(i, n) {
  if (n === 1) return [0, 0];
  const a = -Math.PI * 0.75 + i * Math.PI * 2 / n;
  return [Math.cos(a) * 14, Math.sin(a) * 14];
}

// Each turret roams inside its own sector around the player, so they spread out instead of stacking.
// It slows down while it has a target and hurries back when the player leaves it behind.
// The roam spot (hx, hy) is an offset from the player, so the turrets keep escorting a moving player.
function moveTurret(w, i, n, busy, dt) {
  if ((w.roamT -= dt) <= 0) {
    const a = (i + 0.5) * Math.PI * 2 / n + (Math.random() - 0.5) * Math.PI * 1.4 / n;
    const d = TURRET_ROAM_MIN + Math.random() * (TURRET_ROAM_MAX - TURRET_ROAM_MIN);
    w.hx = Math.cos(a) * d;
    w.hy = Math.sin(a) * d;
    w.roamT = 1.2 + Math.random() * 2;
  }
  const tx = Math.max(30, Math.min(WORLD_W - 30, player.x + w.hx));
  const ty = Math.max(30, Math.min(WORLD_H - 30, player.y + w.hy));
  const dx = tx - w.x, dy = ty - w.y, d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1) return;
  const far = dist2(w.x, w.y, player.x, player.y) > TURRET_LEASH * TURRET_LEASH;
  const playerSpeed = Math.sqrt(player.vx * player.vx + player.vy * player.vy);
  const speed = TURRET_SPEED * (far ? 2 : busy ? 0.5 : 1) + playerSpeed * (far ? 1.3 : 1);
  const step = Math.min(d, speed * dt);
  w.x += dx / d * step;
  w.y += dy / d * step;
}

function updateWeapons(dt) {
  const r = Game.run;
  const turrets = r.char.turrets;
  for (let i = 0; i < r.weapons.length; i++) {
    const w = r.weapons[i];
    const ws = w.stats;
    const n = ws.n;
    if (turrets) {
      moveTurret(w, i, r.weapons.length, w.busy, dt);
    } else {
      const [ox, oy] = mountOffset(i, r.weapons.length);
      w.x = player.x + ox; w.y = player.y + oy;
    }
    const mx = w.x, my = w.y;
    if (w.predT > 0) { w.predT -= dt; if (w.predT <= 0) w.predStacks = 0; }
    if (w.pauldronT > 0) w.pauldronT -= dt;
    if (w.kjaroCd > 0) w.kjaroCd -= dt;
    if (w.runaldCd > 0) w.runaldCd -= dt;
    if (w.singCd > 0) w.singCd -= dt;
    if (w.wormCd > 0) w.wormCd -= dt;
    if (w.discT > 0) { w.discT -= dt; if (w.discT <= 0) w.disc = 0; }
    if (n.shuriken) {
      const max = 2 + n.shuriken;
      if (w.shuriken >= max) { w.shuriken = max; w.shurikenT = 0; }
      else if ((w.shurikenT += dt) >= itemCd(3)) { w.shurikenT = 0; w.shuriken++; }
    }

    let target = null, tx = 0, ty = 0, canFire = false;
    if (w.targeting === 'manual') {
      tx = Game.mouse.x; ty = Game.mouse.y;
      if (ws.kind === 'chain') {
        target = nearestEnemy(tx, ty, 90, null);
        if (target && dist2(target.x, target.y, mx, my) > ws.range * ws.range) target = null;
        canFire = !!target;
      } else {
        canFire = true;
      }
    } else {
      target = findTarget(w.targeting, mx, my, ws.range);
      if (target) {
        tx = target.x; ty = target.y;
        if (ws.kind !== 'chain') {
          const t = Math.sqrt(dist2(tx, ty, mx, my)) / WEAPONS[w.id].speed;
          tx += target.vx * t; ty += target.vy * t;
        }
        canFire = true;
      }
    }
    w.busy = canFire;
    let aimed = false;
    if (canFire) {
      let diff = Math.atan2(ty - my, tx - mx) - w.angle;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const step = WEAPON_TURN_SPEED * dt;
      w.angle += Math.abs(diff) <= step ? diff : Math.sign(diff) * step;
      aimed = Math.abs(diff) - step <= WEAPON_AIM_TOLERANCE;
    }

    w.cd -= dt;
    if (w.cd > 0) continue;
    if (!aimed || r.shadowT > 0) { w.cd = 0; continue; }
    let rate = ws.rate * r.dynRate;
    if (w.predStacks > 0) rate *= 1 + 0.12 * w.predStacks;
    if (w.pauldronT > 0) rate *= 1 + 0.35 * (n.pauldron || 0);
    if (n.lantern) rate *= 1 + 0.1 * Math.min(r.nearCount, 3 * n.lantern);
    let shots = 0;
    while (w.cd <= 0 && shots < 6) {
      fireWeapon(w, mx, my, target, tx, ty);
      w.cd += 1 / rate;
      shots++;
    }
    if (w.cd < 0) w.cd = 0;
  }
}

function fireWeapon(w, mx, my, target, tx, ty) {
  const ws = w.stats, n = ws.n;
  const b = WEAPONS[w.id];
  w.shotN++;
  Sfx.shoot(ws.kind);
  const crack = n.heavencracker && w.shotN % Math.max(1, 5 - n.heavencracker) === 0;
  if (n.hyperthreader && target) {
    pushEvent({ t: 'chain', x: mx, y: my, e: target, dmg: ws.dmg * 0.4, w, n: 1 + n.hyperthreader, direct: false, color: '#ff8787', depth: 1 });
  }
  if (n.shuriken && w.shuriken > 0) {
    w.shuriken--;
    spawnBullet(mx, my, w.angle, 700, 1.5, ws.dps * (0.5 + 0.5 * n.shuriken), w, 3, '#ced4da', 4, 0, 0, false, target);
  }
  if (n.laserturbine) {
    w.turbine += (1 + 0.5 * (n.laserturbine - 1)) / (8 * ws.rate);
    if (w.turbine >= 1) { w.turbine = 0; fireBeam(mx, my, w.angle, ws.dps * 5, w); }
  }
  // Extra lanes of a chain weapon start at other enemies near the target, so the bolts spread out.
  if (ws.kind === 'chain') {
    const used = [target.id];
    for (let l = 0; l < ws.lanes; l++) {
      let e = target;
      if (l > 0) {
        e = nearestEnemy(target.x, target.y, ws.range, used) || target;
        used.push(e.id);
      }
      pushEvent({ t: 'chain', x: mx, y: my, e, dmg: ws.dmg, w, n: ws.chains + (crack ? 3 : 0), direct: true, color: b.color, depth: 0 });
    }
    return;
  }
  const cnt = ws.count;
  const fan = cnt > 1 ? b.spread : 0;
  const manual = w.targeting === 'manual';
  let manualLife = 0;
  if (manual && ws.kind === 'rocket') manualLife = Math.min(ws.range, Math.sqrt(dist2(tx, ty, mx, my)));
  const kind = ws.kind === 'rocket' ? 1 : ws.kind === 'flame' ? 2 : 0;
  const ca = Math.cos(w.angle), sa = Math.sin(w.angle);
  // Lanes are parallel copies of the shot, offset sideways so they all still hit the aimed enemy.
  const gap = Math.max(8, b.size * 2.5);
  for (let l = 0; l < ws.lanes; l++) {
    const off = (l - (ws.lanes - 1) / 2) * gap;
    const tipX = mx + ca * b.barrel - sa * off;
    const tipY = my + sa * b.barrel + ca * off;
    for (let k = 0; k < cnt; k++) {
      let a = w.angle;
      if (cnt > 1) a += -fan / 2 + fan * (k / (cnt - 1));
      a += (Math.random() - 0.5) * b.jitter;
      const speed = b.speed * (kind === 2 ? 0.85 + Math.random() * 0.3 : 1);
      const life = (manualLife || ws.range) / speed;
      spawnBullet(tipX, tipY, a, speed, life, ws.dmg, w, kind, b.color, b.size, crack ? 99 : ws.pierce, ws.proc, true, null);
    }
  }
}

function fireBeam(x, y, a, dmg, w) {
  const dx = Math.cos(a), dy = Math.sin(a);
  addBeam(x, y, x + dx * 2000, y + dy * 2000, '#ff6b6b');
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e.alive) continue;
    const ox = e.x - x, oy = e.y - y;
    if (ox * dx + oy * dy < 0 || Math.abs(ox * dy - oy * dx) > e.r + 12) continue;
    applyDamage(e, dmg, false, w, 1, false);
  }
}

function fireMissiles(x, y, count, dmg, w, target) {
  const icbm = Game.run.stats.core.icbm;
  if (icbm) { count *= 3; dmg *= 1 + 0.5 * (icbm - 1); }
  for (let i = 0; i < count; i++) spawnBullet(x, y, Math.random() * Math.PI * 2, 520, 3, dmg, w, 3, '#ff8787', 4, 0, 0, false, target);
}

function spawnBullet(x, y, a, speed, life, dmg, w, kind, color, size, pierce, proc, direct, target) {
  if (bullets.length >= MAX_BULLETS) return null;
  const b = bulletFree.pop() || { hits: [] };
  b.x = x; b.y = y;
  b.vx = Math.cos(a) * speed; b.vy = Math.sin(a) * speed;
  b.spd = speed;
  b.life = life; b.maxLife = life;
  b.dmg = dmg; b.w = w; b.kind = kind; b.color = color; b.size = size;
  b.pierce = pierce; b.proc = proc; b.direct = direct; b.target = target;
  b.back = false;
  b.hits.length = 0;
  bullets.push(b);
  return b;
}

function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    let dead = false;
    if (b.kind === 3) steerHoming(b, dt);
    else if (b.kind === 4 && !b.back && b.life < b.maxLife / 2) {
      b.back = true; b.vx = -b.vx; b.vy = -b.vy; b.hits.length = 0;
    }
    const steps = Math.max(1, Math.ceil(b.spd * dt / 14));
    const sdt = dt / steps;
    for (let s = 0; s < steps; s++) {
      b.x += b.vx * sdt;
      b.y += b.vy * sdt;
      if (collideBullet(b)) { dead = true; break; }
    }
    b.life -= dt;
    if (!dead && b.life <= 0) {
      if (b.kind === 1) explodeRocket(b);
      dead = true;
    }
    if (dead) {
      bullets[i] = bullets[bullets.length - 1];
      bullets.pop();
      b.w = null; b.target = null;
      bulletFree.push(b);
    }
  }
}

function steerHoming(b, dt) {
  if (!b.target || !b.target.alive) b.target = nearestEnemy(b.x, b.y, 500, null);
  if (!b.target) return;
  const desired = Math.atan2(b.target.y - b.y, b.target.x - b.x);
  const cur = Math.atan2(b.vy, b.vx);
  let diff = desired - cur;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const turn = 9 * dt;
  const na = cur + Math.max(-turn, Math.min(turn, diff));
  b.vx = Math.cos(na) * b.spd;
  b.vy = Math.sin(na) * b.spd;
}

function collideBullet(b) {
  const cx = ((b.x + GOFF) / CELL) | 0;
  const cy = ((b.y + GOFF) / CELL) | 0;
  if (cx < 0 || cy < 0 || cx >= GW || cy >= GH) return true;
  const cell = grid[cy * GW + cx];
  for (let j = 0; j < cell.length; j++) {
    const e = cell[j];
    if (!e.alive) continue;
    const dx = e.x - b.x, dy = e.y - b.y, rr = e.r + b.size;
    if (dx * dx + dy * dy > rr * rr) continue;
    if (b.hits.length && b.hits.includes(e.id)) continue;
    if (b.kind === 1) { explodeRocket(b); return true; }
    b.hits.push(e.id);
    if (b.kind === 4 && !e.boss) e.stunT = Math.max(e.stunT, 0.5);
    if (b.direct) hitEnemy(e, b.dmg, b.w, b.proc);
    else applyDamage(e, b.dmg, false, b.w, 1, false);
    if (--b.pierce < 0) return true;
  }
  return false;
}

function explodeRocket(b) {
  pushEvent({ t: 'explode', x: b.x, y: b.y, r: b.w.stats.aoe, dmg: b.dmg, w: b.w, direct: true, color: b.color, depth: 0 });
}

// ---------- Damage & procs ----------

// Negative procLuck (Purity) rolls extra times for an unfavorable outcome.
function roll(p) {
  const luck = Game.run.stats.procLuck;
  if (luck >= 0) {
    for (let i = 0; i <= luck; i++) if (Math.random() < p) return true;
    return false;
  }
  for (let i = 0; i <= -luck; i++) if (Math.random() >= p) return false;
  return true;
}

function itemCd(base) {
  const S = Game.run.stats;
  return Math.max(0.5, base * S.cdMult - S.cdFlat);
}

function baseDmg(v) {
  const S = Game.run.stats;
  return v * (1 + S.dmg / 100) * S.dmgMult * (1 + (Game.run.threat - 1) * 0.12);
}

function delay(t, ev) {
  if (delayed.length < 400) delayed.push({ t, ev });
}

function poison(e, dps, t, w) {
  e.poisonDps = Math.max(e.poisonDps, dps);
  e.poisonT = Math.max(e.poisonT, t);
  e.dotW = w;
}

function knockback(e, d) {
  const dx = e.x - player.x, dy = e.y - player.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  if (e.boss) d *= 0.2;
  e.x += dx / len * d;
  e.y += dy / len * d;
}

function execute(e, w) {
  addText(e.x, e.y - 14, 'EXECUTE', '#ffd43b');
  applyDamage(e, e.hp + 1, false, w, 0, true);
}

function debuffCount(e) {
  return (e.bleedT > 0) + (e.burnT > 0) + (e.poisonT > 0) + (e.slowT > 0) + (e.freezeT > 0) + (e.stunT > 0)
    + (e.rootT > 0) + (e.fearT > 0) + (e.stickyT > 0) + (e.justiceT > 0) + (e.shred > 0) + (e.tetherT > 0);
}

function tetherCount(w) {
  let k = 0;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (e.alive && e.tetherT > 0 && e.tetherW === w) k++;
  }
  return k;
}

function hitEnemy(e, dmg, w, proc) {
  if (!e.alive) return;
  const r = Game.run, ws = w.stats, n = ws.n, S = r.stats;
  dmg *= r.dynDmg;
  let crit = Math.random() * 100 < ws.crit + r.dynCrit;
  if (n.lopper && e.hp < e.maxHp * Math.min(0.35, 0.1 + 0.05 * n.lopper)) crit = true;
  if (crit) dmg *= ws.critMult;
  const full = e.hp >= e.maxHp;
  if (n.crowbar && e.hp >= e.maxHp * 0.9) dmg *= 1 + 0.75 * n.crowbar;
  if (n.focus && dist2(e.x, e.y, w.x, w.y) < 220 * 220) dmg *= 1 + 0.25 * n.focus;
  if (n.apr && (e.elite || e.boss)) dmg *= 1 + 0.3 * n.apr;
  if (n.justice) e.justiceT = 6 * n.justice;
  const ex = e.x, ey = e.y;

  applyDamage(e, dmg, crit, w, 0, false);

  if (n.seed) heal(0.6 * n.seed * proc);
  if (crit && n.scythe) heal(3 + 1.5 * (n.scythe - 1));
  if (crit && n.predatory) {
    w.predStacks = Math.min(w.predStacks + 1, 1 + 2 * n.predatory);
    w.predT = 2;
  }
  if (S.crown && Math.random() < 0.3 * proc) gainXp(S.crown);
  if (n.nugget && roll(0.08 * proc)) {
    for (let k = 0; k < 2; k++) orbs.push({ x: ex + (Math.random() - 0.5) * 30, y: ey + (Math.random() - 0.5) * 30, v: 3 * n.nugget, magnet: false });
  }

  if (e.alive && !e.boss) {
    if (n.guillotine && e.hp < e.maxHp * hyperbolic(0.15, n.guillotine)) execute(e, w);
    else if (n.telescope && roll(Math.min(0.03, 0.005 + 0.005 * n.telescope) * proc)) execute(e, w);
    else if (n.lostseer && roll(0.005 * n.lostseer * proc)) execute(e, w);
  }
  if (e.alive) {
    const bleedN = (n.tritip || 0) + (n.thorn || 0);
    if (bleedN && roll(0.1 * bleedN * proc)) {
      e.bleedDps += dmg * 2.4 / 3; e.bleedT = 3; e.dotW = w;
    }
    if (crit && n.shatterspleen) {
      e.bleedDps += dmg * 2.4 / 3; e.bleedT = 3; e.dotW = w;
    }
    if (n.sticky && e.stickyT <= 0 && roll(0.08 * n.sticky * proc)) {
      e.stickyT = 1.2; e.stickyDmg = dmg * 1.8; e.stickyW = w;
    }
    if (n.chrono) e.slowT = 2 * n.chrono;
    if (WEAPONS[w.id].burn) {
      e.burnDps = Math.max(e.burnDps, dmg * WEAPONS[w.id].burn * 2); e.burnT = 2; e.dotW = w;
    }
    if (n.stungren && !e.boss && roll(hyperbolic(0.05, n.stungren) * proc)) e.stunT = Math.max(e.stunT, 2);
    if (n.taser && roll(0.07 * proc)) e.rootT = Math.max(e.rootT, 1 + 0.5 * n.taser);
    if (n.tentabauble && roll(0.05 * n.tentabauble * proc)) e.rootT = Math.max(e.rootT, n.tentabauble);
    if (n.boxing && roll(hyperbolic(0.06, n.boxing) * proc)) knockback(e, 120);
    if (n.permafrost && roll((0.03 + 0.03 * n.permafrost) * proc)) {
      e.freezeT = Math.max(e.freezeT, 1.5); e.slowT = Math.max(e.slowT, 3);
    }
    if (n.thallium && roll(0.1 * proc)) {
      poison(e, dmg * (2.5 + 2.5 * n.thallium) / 3, 3, w);
      e.slowT = Math.max(e.slowT, 3);
    }
    if (n.toxicworm && w.wormCd <= 0) {
      w.wormCd = itemCd(4 / n.toxicworm);
      poison(e, dmg, 6, w);
      e.infect = true;
    }
    if (n.scorpion) e.shred = Math.min(0.5, e.shred + 0.01 * n.scorpion * proc);
    if (n.plasmachain && e.tetherT <= 0 && roll(0.15 * proc) && tetherCount(w) < n.plasmachain) {
      e.tetherT = 4; e.tetherDps = dmg * 1.5; e.tetherW = w;
    }
  }
  if (n.ukulele && roll(0.25 * proc)) {
    pushEvent({ t: 'chain', x: ex, y: ey, e, dmg: dmg * 0.8, w, n: 1 + 2 * n.ukulele, range: 200 + 40 * (n.ukulele - 1), direct: false, color: '#99e9f2', depth: 1, skipFirst: true });
  }
  if (n.polylute && roll(0.25 * proc)) {
    for (let k = 0; k < 3 * n.polylute; k++) delay(0.1 * (k + 1), { t: 'hit', e, id: e.id, dmg: dmg * 0.6, w, color: '#cc5de8' });
  }
  if (n.needletick && roll(0.1 * n.needletick * proc)) delay(1, { t: 'hit', e, id: e.id, dmg: dmg * 4, w, color: '#cc5de8' });
  if (n.atg && roll(0.1 * proc)) fireMissiles(w.x, w.y, 1, dmg * 3 * n.atg, w, e);
  if (n.atg2 && roll(0.07 * n.atg2 * proc)) fireMissiles(w.x, w.y, 3, dmg * 3, w, e);
  if (n.shrimp && r.shield > 0 && roll(proc)) fireMissiles(w.x, w.y, 1, dmg * 0.4 * n.shrimp, w, e);
  if (n.mortar && roll(0.09 * proc)) {
    delay(0.5, { t: 'explode', x: ex, y: ey, r: 75, dmg: dmg * 1.7 * n.mortar, w, direct: false, color: '#adb5bd', depth: 1 });
  }
  if (n.perforatorC && roll(0.1 * proc)) {
    addLine(ex, ey - 300, ex, ey, '#ffe066');
    pushEvent({ t: 'explode', x: ex, y: ey, r: 50, dmg: dmg * 5 * n.perforatorC, w, direct: false, color: '#ffe066', depth: 1 });
  }
  if (n.perforatorM && roll(0.1 * proc)) {
    for (let k = 0; k < 3; k++) {
      delay(0.2 + 0.15 * k, { t: 'explode', x: ex + (Math.random() - 0.5) * 80, y: ey + (Math.random() - 0.5) * 80, r: 50, dmg: dmg * 3 * n.perforatorM, w, direct: false, color: '#ff922b', depth: 1 });
    }
  }
  if (n.ifrit && roll(0.08 * proc)) {
    pushEvent({ t: 'explode', x: w.x, y: w.y, r: 450, dmg: dmg * 2.2 * n.ifrit, w, direct: false, color: 'rgba(255,107,107,0.25)', depth: 1, burn: dmg });
  }
  if (n.meathook && roll(hyperbolic(0.2, n.meathook) * proc)) {
    const list = queryRadius(ex, ey, 300);
    const max = Math.min(list.length, 5 + 5 * n.meathook);
    for (let k = 0; k < max; k++) {
      const t = list[k];
      spawnBullet(ex, ey, Math.atan2(t.y - ey, t.x - ex), 700, 1, dmg, w, 3, '#c92a2a', 3, 0, 0, false, t);
    }
  }
  if (n.boomerang && roll(0.15 * proc)) {
    spawnBullet(w.x, w.y, Math.atan2(ey - w.y, ex - w.x), 650, 2 * ws.range / 650, dmg * 1.2 * n.boomerang, w, 4, '#74c0fc', 8, 99, 0, false, null);
  }
  if (n.runiclens && roll(Math.min(0.25, 0.002 * ws.dmg) * proc)) {
    delay(0.6, { t: 'explode', x: ex, y: ey, r: 110, dmg: dmg * 8 * n.runiclens, w, direct: false, color: '#ffd43b', depth: 1 });
  }
  if (n.behemoth) {
    pushEvent({ t: 'explode', x: ex, y: ey, r: 75 + 45 * (n.behemoth - 1), dmg: dmg * 0.6, w, direct: false, color: '#ffd8a8', depth: 1 });
  }
  if (n.voidsent && full) {
    pushEvent({ t: 'explode', x: ex, y: ey, r: 110, dmg: dmg * (1.04 + 1.56 * n.voidsent), w, direct: false, color: '#f06595', depth: 1 });
  }
  if (n.kjaro && w.kjaroCd <= 0) {
    w.kjaroCd = itemCd(5);
    pushEvent({ t: 'explode', x: ex, y: ey, r: 110, dmg: dmg * 3 * n.kjaro, w, direct: false, color: '#ff922b', depth: 1, burn: dmg });
  }
  if (n.runald && w.runaldCd <= 0) {
    w.runaldCd = itemCd(5);
    pushEvent({ t: 'explode', x: ex, y: ey, r: 125, dmg: dmg * 2 * n.runald, w, direct: false, color: '#a5d8ff', depth: 1, freeze: 1.5 + 0.75 * (n.runald - 1) });
  }
  if (n.singularity && w.singCd <= 0) {
    w.singCd = itemCd(10);
    zones.push({ x: ex, y: ey, r: 140, t: 5, slow: false, pull: 220, color: 'rgba(204,93,232,0.15)', endDmg: dmg * n.singularity, w });
  }
}

function applyDamage(e, dmg, crit, w, depth, silent) {
  if (!e.alive) return;
  if (e.justiceT > 0) dmg *= 1.3;
  if (e.shred > 0) dmg *= 1 + e.shred;
  const mark = Game.run.stats.core.deathmark;
  if (mark && debuffCount(e) >= 3) dmg *= 1.25 + 0.25 * mark;
  if (Game.run.buffT.leech > 0) heal(Math.min(dmg, e.hp) * 0.2);
  e.hp -= dmg;
  e.flash = 0.05;
  Game.run.dmgDealt += dmg;
  if (!silent && Game.showDmg) addDmgText(e.x, e.y - e.r, dmg, crit);
  if (e.hp <= 0) killEnemy(e, w, depth);
}

function killEnemy(e, w, depth) {
  const r = Game.run;
  e.alive = false;
  r.kills++;
  Sfx.kill(e);
  burst(e.x, e.y, e.def.color, e.boss ? 40 : 6, e.boss ? 260 : 140);

  const d = e.def;
  const S = r.stats, core = S.core;
  gainXp(d.xp * (e.elite ? 5 : 1));
  if (e.boss) dropGold(e.x, e.y, CHESTS.small.cost * 1.5 * goldScale() * S.goldMult, 12);
  else dropGold(e.x, e.y, d.xp * (e.elite ? 3 : 1) * S.goldMult, e.elite ? 3 : 1);
  if (r.settings.enemyDrops) dropLoot(e);
  if (e.boss) onBossKilled(e);
  if (core.harpoon && !(r.cd.harpoon > 0)) {
    r.cd.harpoon = 3;
    r.harpoonDur = 1 + 0.5 * (core.harpoon - 1);
    r.harpoonT = r.harpoonDur;
  }
  if (core.witness) r.witnessT = 6;
  if (core.compulsion && ++r.compulsionKills >= 20) {
    r.compulsionKills = 0;
    r.compulsionN = Math.min(3 * core.compulsion, r.compulsionN + 1);
    r.compulsionT = 20;
  }
  if (d.split) {
    for (let i = 0; i < d.splitN; i++) {
      const c = spawnEnemy(d.split, e.x + (Math.random() - 0.5) * 30, e.y + (Math.random() - 0.5) * 30, false);
      if (c) { c.maxHp *= 0.6; c.hp = c.maxHp; c.lvl = 1; }
    }
  }

  if (core.topaz && roll(KILL_BUFF_CHANCE)) addBarrier(3 * core.topaz);
  if (core.chronic && roll(KILL_BUFF_CHANCE)) { r.chronicN = Math.min(5 + 5 * core.chronic, r.chronicN + 1); r.chronicT = 7; }
  if (core.frostrelic && roll(KILL_BUFF_CHANCE)) { r.frostT = 3; r.frostR = Math.min(260, Math.max(80, r.frostR + 8)); }
  if (core.chargefield && roll(KILL_BUFF_CHANCE)) { r.chargeT = 6; r.chargeR = Math.min(300, Math.max(100, r.chargeR + 10)); }
  if (core.ghor && roll(0.01 * core.ghor)) {
    dropGold(e.x, e.y, 10 * goldScale(), 5);
    addText(e.x, e.y - 10, 'TREASURE', '#ffd43b');
  }
  if (core.mask && roll(0.07) && countAllies('mask') < 6) spawnAlly('ghost', 'mask', e.x, e.y, 15, 30 * core.mask, 0, '#e9ecef');
  if (core.deskplant && roll(0.1) && r.plants.length < 3) r.plants.push(5);
  if (e.elite || e.boss) {
    if (core.brainstalks) r.brainT = 4 * core.brainstalks;
    if (core.nucleus && countAllies('construct') < 4) spawnAlly('drone', 'construct', e.x, e.y, Infinity, 15 * core.nucleus, 2, '#ced4da');
  }
  if (e.marked && core.hitlist && r.hitListDmg < 10 + 10 * core.hitlist) {
    r.hitListDmg++;
    addText(e.x, e.y - 10, 'MARK +1%', '#ff6b6b');
  }
  if (e.infect && e.poisonT > 0) {
    const t = nearestEnemy(e.x, e.y, 220, [e.id]);
    if (t) {
      poison(t, e.poisonDps, 6, e.dotW);
      t.infect = true;
      addLine(e.x, e.y, t.x, t.y, '#94d82d');
    }
  }

  if (!w || depth > 2) return;
  const ws = w.stats, n = ws.n;
  if (n.shatterspleen && e.bleedT > 0) {
    pushEvent({ t: 'explode', x: e.x, y: e.y, r: 110, dmg: ws.killDmg * 4 * n.shatterspleen + e.maxHp * 0.15, w, direct: false, color: '#c92a2a', depth: depth + 1 });
  }
  if (n.thorn && (e.bleedT > 0 || e.burnT > 0 || e.poisonT > 0)) {
    const t = nearestEnemy(e.x, e.y, 200, [e.id]);
    if (t) {
      const k = Math.min(1, 0.33 * n.thorn);
      if (e.bleedT > 0) { t.bleedDps += e.bleedDps * k; t.bleedT = Math.max(t.bleedT, e.bleedT); }
      if (e.burnT > 0) { t.burnDps = Math.max(t.burnDps, e.burnDps * k); t.burnT = Math.max(t.burnT, e.burnT); }
      if (e.poisonT > 0) poison(t, e.poisonDps * k, e.poisonT, w);
      t.dotW = w;
      addLine(e.x, e.y, t.x, t.y, '#69db7c');
    }
  }
  if (n.resonance) {
    w.disc++; w.discT = 7;
    if (w.disc >= 4) {
      w.disc = 0;
      const t = nearestEnemy(w.x, w.y, 2000, null);
      const a = t ? Math.atan2(t.y - w.y, t.x - w.x) : Math.random() * Math.PI * 2;
      spawnBullet(w.x, w.y, a, 600, 2.5, ws.dps * 1.5 * n.resonance, w, 0, '#da77f2', 10, 99, 0, false, null);
    }
  }
  if (n.wisp && roll(0.3)) {
    pushEvent({ t: 'explode', x: e.x, y: e.y, r: 110, dmg: ws.killDmg * (2.5 + 2 * (n.wisp - 1)), w, direct: false, color: '#ffe066', depth: depth + 1 });
  }
  if (n.gasoline) {
    pushEvent({ t: 'explode', x: e.x, y: e.y, r: 100, dmg: ws.killDmg * 0.3 * n.gasoline, w, direct: false, color: '#ff922b', depth: depth + 1, burn: ws.killDmg * 1.5 * n.gasoline / 3 });
  }
  if (n.dagger) {
    spawnBullet(e.x, e.y, Math.random() * Math.PI * 2, 480, 2.5, ws.killDmg * 1.5 * n.dagger, w, 3, '#e599f7', 3, 0, 0, false, null);
  }
  if (n.tooth) heal(1 + r.stats.maxHp * 0.01 * n.tooth);
  if (n.pauldron && roll(KILL_BUFF_CHANCE)) w.pauldronT = 2.5 + 1.5 * (n.pauldron - 1);
  if (n.infusion) {
    const cap = 40 * n.infusion;
    if (r.infusionHp < cap) {
      const added = Math.min(cap, r.infusionHp + 0.25 * n.infusion) - r.infusionHp;
      r.infusionHp += added;
      r.stats.maxHp += added;
    }
  }
}

function dropLoot(e) {
  const r = Game.run, st = r.settings, core = r.stats.core;
  let items = 0;
  if (e.boss) items = Math.floor(st.itemDropMult) + (Math.random() < st.itemDropMult % 1 ? 1 : 0);
  else if (Math.random() < dropChance(e.elite ? ELITE_ITEM_DROP_CHANCE : ITEM_DROP_CHANCE, st.itemDropMult)) items = 1;
  if (e.elite || e.boss) {
    for (let k = 0; k < (core.whispers || 0); k++) if (Math.random() < dropChance(1, st.itemDropMult)) items++;
  }
  for (let i = 0; i < items; i++) {
    dropItem(e.x + (Math.random() - 0.5) * 30, e.y + (Math.random() - 0.5) * 30, e.boss && i === 0 ? 4 : rollDropTier());
  }
  if (e.boss && !r.bossRedGiven && r.time >= GUARANTEED_RED_TIME) {
    r.bossRedGiven = true;
    dropItem(e.x, e.y, 2);
  }
}

// Recent drops (dropHeat) make the next one quadratically less likely; the heat cools over time.
// The drop multiplier scales both the base chance and how much heat fits before the falloff.
function dropChance(base, mult) {
  if (mult <= 0) return 0;
  const r = Game.run;
  const falloff = 1 + r.dropHeat / (3 * mult);
  return base * mult * r.stats.dropMult * (1 + r.stats.luck / 100) / (falloff * falloff);
}

function onBossKilled(e) {
  const r = Game.run, c = r.stats.core;
  r.bossKills++;
  r.bossAlive--;
  for (const list of [hazards, beams, waves]) {
    for (let i = list.length - 1; i >= 0; i--) if (list[i].owner === e.id) list.splice(i, 1);
  }
  if (c.rustedkey) {
    consumeItem('rustedkey');
    dropItem(e.x, e.y, Math.random() < 0.8 ? 0 : 1);
  }
  if (c.encrusted) {
    consumeItem('encrusted');
    const x = Math.random();
    dropItem(e.x, e.y, x < 0.6 ? 0 : x < 0.9 ? 1 : 2);
  }
  if (c.rustedkey || c.encrusted) recomputeStats();
}

function pushEvent(ev) {
  events.push(ev);
}

function processEvents() {
  let count = 0;
  for (let i = 0; i < events.length; i++) {
    if (++count > MAX_EVENTS_PER_FRAME) break;
    const ev = events[i];
    if (ev.t === 'explode') doExplode(ev);
    else if (ev.t === 'hit') doDelayedHit(ev);
    else doChain(ev);
  }
  events.length = 0;
}

function doDelayedHit(ev) {
  const e = ev.e;
  if (!e.alive || e.id !== ev.id) return;
  addLine(e.x, e.y - 120, e.x, e.y, ev.color);
  applyDamage(e, ev.dmg, false, ev.w, 1, false);
}

function doExplode(ev) {
  addRing(ev.x, ev.y, ev.r, ev.color);
  const list = queryRadius(ev.x, ev.y, ev.r);
  const targets = list.slice();
  for (let i = 0; i < targets.length; i++) {
    const e = targets[i];
    if (!e.alive) continue;
    if (ev.burn) { e.burnDps = Math.max(e.burnDps, ev.burn); e.burnT = 3; e.dotW = ev.w; }
    if (ev.freeze) e.freezeT = ev.freeze;
    if (ev.stun && !e.boss) e.stunT = Math.max(e.stunT, ev.stun);
    if (ev.knock) knockback(e, ev.knock);
    if (ev.direct) hitEnemy(e, ev.dmg, ev.w, ev.w.stats.proc);
    else applyDamage(e, ev.dmg, false, ev.w, ev.depth, targets.length > 6);
  }
}

function doChain(ev) {
  const hit = [];
  let x = ev.x, y = ev.y;
  let cur = ev.e;
  let jumps = ev.n + (ev.skipFirst ? 0 : 1);
  const range = ev.range || 200;
  if (ev.skipFirst) {
    hit.push(cur.id);
    x = cur.x; y = cur.y;
    cur = nearestEnemy(x, y, range, hit);
  }
  while (cur && jumps > 0) {
    addLine(x, y, cur.x, cur.y, ev.color);
    hit.push(cur.id);
    x = cur.x; y = cur.y;
    if (ev.direct) hitEnemy(cur, ev.dmg, ev.w, ev.w.stats.proc);
    else applyDamage(cur, ev.dmg, false, ev.w, ev.depth, false);
    jumps--;
    if (jumps > 0) cur = nearestEnemy(x, y, range, hit);
  }
}

// ---------- Player ----------

// Dashing and Shadowfade make the player intangible: attacks pass through instead of being absorbed.
function intangible() {
  return player.iframeT > 0 || Game.run.shadowT > 0;
}

// Cloaked (Stealthkit), faded (Strides) or decoyed (Crudely Drawn Buddy) players are invisible:
// enemies go to the decoy point and hold fire.
function hidden() {
  const r = Game.run;
  return r.cloakT > 0 || r.shadowT > 0 || r.buffT.buddy > 0;
}

function damagePlayer(dmg) {
  const r = Game.run, S = r.stats, c = S.core;
  if (r.invulnT > 0 || intangible()) return;
  if (Math.random() * 100 < S.dodge) {
    addText(player.x + (Math.random() - 0.5) * 40, player.y - 50, 'DODGE', '#74c0fc');
    return;
  }
  if (c.safer && !(r.cd.safer > 0)) {
    r.cd.safer = itemCd(15 / (1 + 0.1 * (c.safer - 1)));
    addText(player.x + (Math.random() - 0.5) * 40, player.y - 50, 'BLOCKED', '#cc5de8');
    return;
  }
  const a = S.armor + (c.opal && r.hurtT >= 4 ? 20 * c.opal : 0) + (c.buckler && r.moving ? 30 * c.buckler : 0)
    + (r.buffT.elephant > 0 ? 500 : 0);
  const red = a >= 0 ? a / (a + 15) : a / 15;
  dmg = Math.max(1, dmg * S.enemyDmgMult * (1 - red));
  if (c.echo && !(r.cd.echo > 0)) {
    r.cd.echo = itemCd(15);
    dmg *= 0.3;
    r.echoQ.push({ t: 0.5, v: dmg }, { t: 1, v: dmg });
  }
  takeDamage(dmg);
}

function takeDamage(dmg) {
  const r = Game.run, S = r.stats, c = S.core;
  r.hurtT = 0;
  r.hurtFlash = 0.15;
  Sfx.hurt();
  addText(player.x + (Math.random() - 0.5) * 40, player.y - 50, '-' + Math.round(dmg), '#ff6b6b');
  let left = dmg;
  if (r.barrier > 0) {
    const a = Math.min(r.barrier, left);
    r.barrier -= a; left -= a;
  }
  if (r.shield > 0 && left > 0) {
    const a = Math.min(r.shield, left);
    r.shield -= a; left -= a;
    if (r.shield <= 0 && c.kinetic) {
      pushEvent({ t: 'explode', x: player.x, y: player.y, r: 250, dmg: baseDmg(10) + S.maxShield * c.kinetic, w: null, direct: false, color: 'rgba(116,192,252,0.35)', depth: 1, stun: 1.5 });
    }
  }
  r.hp -= left;
  if (S.crown) r.xp = Math.max(0, r.xp - 3 * S.crown);
  onHurt(dmg);
  if (r.hp <= 0 && !tryRevive()) onPlayerDeath();
}

function onHurt(dmg) {
  const r = Game.run, S = r.stats, c = S.core;
  if (c.medkit && r.medkits.length < 20) r.medkits.push(2);
  if (c.planula) heal(5 * c.planula);
  if (c.fireshield && dmg >= S.maxHp * 0.1) {
    pushEvent({ t: 'explode', x: player.x, y: player.y, r: 225, dmg: baseDmg(40 * c.fireshield), w: null, direct: false, color: 'rgba(255,146,43,0.35)', depth: 1, knock: 60 });
  }
  if (c.spikestrip && !(r.cd.spike > 0)) {
    r.cd.spike = 1;
    zones.push({ x: player.x, y: player.y, r: 150, t: 1 + c.spikestrip, slow: true, pull: 0, color: 'rgba(173,181,189,0.10)', endDmg: 0, w: null });
  }
  if (c.razorwire && !(r.cd.razor > 0)) {
    r.cd.razor = 0.3;
    const list = queryRadius(player.x, player.y, 300).slice();
    const max = Math.min(list.length, 3 + 2 * c.razorwire);
    const d = baseDmg(16);
    for (let i = 0; i < max; i++) {
      addLine(player.x, player.y, list[i].x, list[i].y, '#ced4da');
      applyDamage(list[i], d, false, null, 1, false);
    }
  }
  if (r.hp <= 0) return;
  if (c.panicmines && r.hp < S.maxHp * 0.5 && !(r.cd.panic > 0)) {
    r.cd.panic = 3;
    for (let i = 0; i < c.panicmines; i++) {
      const a = Math.random() * Math.PI * 2, d = 55 + Math.random() * 70;
      mines.push({ x: player.x + Math.cos(a) * d, y: player.y + Math.sin(a) * d, arm: 0.4, t: 20, dmg: baseDmg(50), r: 100 });
    }
  }
  if (c.oldbox && r.hp < S.maxHp * (0.15 + 0.1 * c.oldbox) && !(r.cd.oldbox > 0)) {
    r.cd.oldbox = itemCd(15);
    for (const e of queryRadius(player.x, player.y, 400)) if (!e.boss) e.fearT = 3;
    addText(player.x, player.y - 70, 'FEAR', '#cc5de8');
  }
  if (r.hp < S.maxHp * 0.25) onLowHealth();
}

function onLowHealth() {
  const r = Game.run, S = r.stats, c = S.core;
  if (c.elixir) {
    consumeItem('elixir', false);
    r.hp = Math.min(S.maxHp, r.hp + S.maxHp * 0.75);
    addText(player.x, player.y - 70, 'ELIXIR', '#69db7c');
  }
  if (c.watch) {
    consumeItem('watch', true);
    addText(player.x, player.y - 85, 'WATCH BROKE', '#ff6b6b');
  }
  if (c.timekeeper && !r.timekeeperUsed) {
    r.timekeeperUsed = true;
    for (const e of enemies) if (e.alive) e.freezeT = Math.max(e.freezeT, 2 + c.timekeeper);
    for (const b of ebullets) b.life = 0;
    addText(player.x, player.y - 100, 'TIME STOP', '#a5d8ff');
  }
  if (c.genesis && !(r.cd.genesis > 0)) {
    r.cd.genesis = itemCd(30 / c.genesis);
    pushEvent({ t: 'explode', x: player.x, y: player.y, r: 450, dmg: baseDmg(600), w: null, direct: false, color: 'rgba(204,93,232,0.3)', depth: 1 });
  }
  if (c.transmitter && !(r.cd.transmitter > 0)) {
    r.cd.transmitter = itemCd(30);
    addBarrier(S.maxHp * 0.25);
    const bleed = baseDmg(30 * c.transmitter) / 3;
    for (const e of queryRadius(player.x, player.y, 250)) {
      knockback(e, 200);
      e.bleedDps += bleed; e.bleedT = 3;
    }
    addRing(player.x, player.y, 250, 'rgba(204,93,232,0.3)');
  }
  if (c.stealthkit && !(r.cd.stealth > 0)) {
    r.cd.stealth = itemCd(30 * Math.pow(0.5, c.stealthkit - 1));
    r.cloakT = 5;
    r.decoyX = player.x; r.decoyY = player.y;
    addText(player.x, player.y - 115, 'CLOAKED', '#adb5bd');
  }
  if (c.elixir || c.watch) recomputeStats();
}

function tryRevive() {
  const r = Game.run, c = r.stats.core;
  const id = c.dio ? 'dio' : c.larva ? 'larva' : null;
  if (!id) return false;
  consumeItem(id, false);
  if (id === 'larva') applyCorruption(true);
  recomputeStats();
  r.hp = r.stats.maxHp * 0.4;
  r.invulnT = 2;
  burst(player.x, player.y, '#ffd43b', 40, 300);
  addText(player.x, player.y - 70, 'REVIVED', '#ffd43b');
  return true;
}

function heal(v) {
  const r = Game.run, S = r.stats;
  v *= S.healMult;
  if (S.core.nkuhana) r.soul += v;
  if (S.core.corpsebloom) r.healPool += v;
  else applyHeal(v);
}

function applyHeal(v) {
  const r = Game.run, S = r.stats;
  const over = r.hp + v - S.maxHp;
  r.hp = Math.min(S.maxHp, r.hp + v);
  if (over > 0 && S.core.aegis) addBarrier(over * 0.5 * S.core.aegis);
}

function addBarrier(v) {
  const r = Game.run;
  r.barrier = Math.min(r.stats.maxHp + r.stats.maxShield, r.barrier + v);
}

function gainXp(v) {
  const r = Game.run, c = r.stats.core;
  r.xp += v * (1 + r.stats.xpPct / 100);
  while (r.xp >= xpToNext(r.level)) {
    r.xp -= xpToNext(r.level);
    r.level++;
    r.stats.maxHp += 1;
    r.hp += 1;
    r.levelFlash = 1;
    Sfx.levelUp();
    if (c.warbanner) r.bannerT = 4 + 4 * c.warbanner;
    if (c.fireworks) r.fireworks++;
    const tier = weaponTierForLevel(r.level);
    if (tier !== r.weapons[0].tier) {
      recomputeStats();
      addText(player.x, player.y - 95, `WEAPONS → TIER ${WEAPON_TIER_NAMES[tier]}`, WEAPON_TIER_COLORS[tier]);
    }
  }
}

function gainGold(v) {
  const r = Game.run;
  r.gold += v;
  r.goldEarned += v;
}

// Gold pops out as n coins that rest briefly, then fly to the player on their own (no pickup range).
// Past MAX_COINS the gold is granted directly so huge swarms do not flood the orb list.
const MAX_COINS = 250;
let coinCount = 0;
function dropGold(x, y, v, n) {
  if (coinCount + n > MAX_COINS) { gainGold(v); return; }
  coinCount += n;
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2, s = 60 + Math.random() * (n > 1 ? 160 : 60);
    orbs.push({ kind: 'gold', x, y, v: v / n, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: -(0.35 + Math.random() * 0.25), magnet: false });
  }
}

function addItem(id, n) {
  const items = Game.run.items;
  const slot = items.find(s => s.id === id);
  if (slot) slot.n += n;
  else items.push({ id, n });
  applyCorruption(false);
}

// Removes one copy (or every copy with all) of an owned item.
function consumeItem(id, all) {
  const items = Game.run.items;
  const i = items.findIndex(s => s.id === id);
  if (i < 0) return;
  if (!all && items[i].n > 1) items[i].n--;
  else items.splice(i, 1);
}

function randomOwnedItem(pred) {
  const cands = Game.run.items.filter(s => pred(ITEM_BY_ID[s.id]));
  return cands.length ? cands[(Math.random() * cands.length) | 0] : null;
}

function egoConvert() {
  const slot = randomOwnedItem(it => it.id !== 'ego');
  if (!slot) return;
  consumeItem(slot.id, false);
  addItem('ego', 1);
}

function benthicUpgrade(count) {
  for (let k = 0; k < count; k++) {
    const slot = randomOwnedItem(it => it.tier === 0 || it.tier === 1);
    if (!slot) break;
    const tier = ITEM_BY_ID[slot.id].tier;
    consumeItem(slot.id, false);
    addItem(randomItemOfTier(tier + 1).id, 1);
  }
}

// Void items replace every owned copy of their counterpart. With all, every corruptible item is converted.
function applyCorruption(all) {
  const r = Game.run;
  const owned = new Set();
  for (const s of r.items) if (ITEM_BY_ID[s.id].corrupts) owned.add(s.id);
  const map = {};
  for (const it of ITEMS) if (it.corrupts && (all || owned.has(it.id))) map[it.corrupts] = it.id;
  let changed = false;
  for (const s of r.items) if (map[s.id]) { s.id = map[s.id]; changed = true; }
  if (!changed) return;
  const merged = [];
  for (const s of r.items) {
    const m = merged.find(x => x.id === s.id);
    if (m) m.n += s.n;
    else merged.push(s);
  }
  r.items = merged;
}

// Ground drops are a concrete item that waits where it fell until the player walks over it.
// vx/vy: the short pop out of the enemy.
function dropItem(x, y, tier) {
  Game.run.dropHeat++;
  const it = randomItemOfTier(tier);
  const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 80;
  drops.push({ id: it.id, tier, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, seen: false });
}

function collectDrop(d) {
  const r = Game.run;
  const it = ITEM_BY_ID[d.id];
  if (it.tier === EQUIP_TIER) {
    Sfx.pick();
    setEquipment(d.id);
    return;
  }
  const sale = r.stats.core.salestar;
  const n = sale && roll(0.1 * sale) ? 2 : 1;
  Sfx.pick();
  addItem(d.id, n);
  recomputeStats();
  addText(player.x, player.y - 60, `+ ${it.name}${n > 1 ? ' ×2' : ''}`, TIER_COLORS[it.tier]);
}

// ---------- Chests ----------

// Price for a chest spawned now; a chest keeps the price it spawned with.
function chestPrice(type) {
  return Math.round(CHESTS[type].cost * goldScale() * Game.run.settings.chestCostMult);
}

function rollChestType() {
  const threat = Game.run.threat;
  let total = 0;
  for (const id in CHESTS) if (CHESTS[id].weight && threat >= CHESTS[id].minThreat) total += CHESTS[id].weight;
  let x = Math.random() * total;
  for (const id in CHESTS) {
    if (!CHESTS[id].weight || threat < CHESTS[id].minThreat) continue;
    if ((x -= CHESTS[id].weight) <= 0) return id;
  }
  return 'small';
}

// Chests are scattered over the whole map, clear of rocks and away from each other and the teleporter,
// so looting a map means exploring it. seen: has been on screen (shown on the minimap from then on).
function spawnChest(type) {
  let best = null, bestD = -1;
  for (let tries = 0; tries < 40; tries++) {
    const x = 150 + Math.random() * (WORLD_W - 300), y = 150 + Math.random() * (WORLD_H - 300);
    if (rockAt(x, y, 50)) continue;
    let d = Math.min(dist2(x, y, player.x, player.y) * 2, dist2(x, y, teleporter.x, teleporter.y) * 2);
    for (const c of chests) d = Math.min(d, dist2(x, y, c.x, c.y));
    if (d > 700 * 700) { best = { x, y }; break; }
    if (d > bestD) { bestD = d; best = { x, y }; }
  }
  chests.push({ type, price: chestPrice(type), x: best.x, y: best.y, t: 0, uses: 0, wins: 0, seen: false });
}

function nearestChest() {
  let best = null, bestD = (PLAYER_R + 45) * (PLAYER_R + 45);
  for (const c of chests) {
    const d = dist2(c.x, c.y, player.x, player.y);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

function rollChestTier(type) {
  const table = CHESTS[type].tiers;
  let total = 0;
  for (const [, w] of table) total += w;
  let x = Math.random() * total;
  for (const [tier, w] of table) if ((x -= w) <= 0) return modifyTier(tier);
  return modifyTier(table[0][0]);
}

function tryOpenChest() {
  const r = Game.run;
  const c = nearestChest();
  if (!c) return;
  const price = c.price;
  if (r.gold < price) {
    addText(c.x, c.y - 40, 'NOT ENOUGH GOLD', '#ff6b6b');
    Sfx.denied();
    return;
  }
  r.gold -= price;
  const def = CHESTS[c.type];
  if (def.shrine) { useShrine(c, def); return; }
  r.chestsOpened++;
  chests.splice(chests.indexOf(c), 1);
  burst(c.x, c.y, def.color, 20, 200);
  Sfx.chest();
  const sale = r.stats.core.salestar;
  r.itemChoices.push({ tier: rollChestTier(c.type), n: sale && roll(0.1 * sale) ? 2 : 1 });
}

// Shrine of Chance: every use raises the price; a win drops an item next to it. It crumbles after its last win.
function useShrine(c, def) {
  c.uses++;
  c.price = Math.round(c.price * def.priceGrowth);
  if (Math.random() >= def.chance) {
    addText(c.x, c.y - 50, 'NOTHING HAPPENS', '#adb5bd');
    Sfx.denied();
    return;
  }
  c.wins++;
  addText(c.x, c.y - 50, 'THE SHRINE REWARDS YOU', def.color);
  burst(c.x, c.y, def.color, 16, 180);
  Sfx.chest();
  dropItem(c.x, c.y + 20, rollChestTier(c.type));
  if (c.wins >= def.wins) chests.splice(chests.indexOf(c), 1);
}

function revealed(o) {
  return dist2(o.x, o.y, player.x, player.y) < MAP_REVEAL_R * MAP_REVEAL_R;
}

function updateInteract(dt) {
  for (const c of chests) {
    c.t += dt;
    if (!c.seen && revealed(c)) c.seen = true;
  }
  for (const d of drops) if (!d.seen && revealed(d)) d.seen = true;
  if (!teleporter.seen && revealed(teleporter)) teleporter.seen = true;
  if (!Game.interactQueued) return;
  Game.interactQueued = false;
  const d = swappableEquipDrop();
  if (d) swapEquipDrop(d);
  else if (nearestChest()) tryOpenChest();
  else if (nearTeleporter()) useTeleporter();
}

// ---------- Maps ----------

// Builds map number r.mapN: rocks, the landing spot, the teleporter at the far end, chests and shrines.
function loadMap() {
  const r = Game.run, def = MAPS[(r.mapN - 1) % MAPS.length];
  clearMapEntities();
  r.map = def;
  WORLD_W = def.w;
  WORLD_H = def.h;
  r.coeff = computeCoeff(r);
  r.threat = threatForCoeff(r.coeff);

  const flip = Math.random() < 0.5;
  const sx = flip ? WORLD_W - 450 : 450, sy = 400 + Math.random() * (WORLD_H - 800);
  const tx = flip ? 300 + Math.random() * WORLD_W * 0.25 : WORLD_W * 0.75 + Math.random() * (WORLD_W * 0.25 - 300);
  const ty = 300 + Math.random() * (WORLD_H - 600);
  Object.assign(player, { x: sx, y: sy, vx: 0, vy: 0, dashT: 0 });
  Object.assign(teleporter, { x: tx, y: ty, state: 'idle', charge: 0, bosses: 0, inside: false, seen: false });
  generateRocks([{ x: sx, y: sy, r: 320 }, { x: tx, y: ty, r: 300 }]);

  spawnChest('equipment');
  for (let i = 1; i < r.settings.mapChests; i++) spawnChest(rollChestType());
  for (let i = 0; i < r.settings.shrineCount; i++) spawnChest('shrine');

  for (const w of r.weapons) { w.x = player.x; w.y = player.y; w.roamT = 0; }
  for (const a of allies) { a.x = player.x; a.y = player.y; a.target = null; }
  r.waveT0 = r.time;
  r.spawnAcc = 0;
  r.groupT = 3;
  r.phase = 'none';
  r.fadeT = 1;
  r.mapTitleT = 4;
  Render.buildBackground(def);
  Render.updateCamera();
  for (let i = 0; i < 6; i++) {
    const p = spawnPoint();
    spawnEnemy(pickEnemyType(r.threat), p.x, p.y, false);
  }
}

// Rock clusters and loose boulders, kept away from the circles in `keep` (landing spot, teleporter).
function generateRocks(keep) {
  const add = (x, y, rad) => {
    if (x < rad || y < rad || x > WORLD_W - rad || y > WORLD_H - rad) return;
    for (const k of keep) if (dist2(x, y, k.x, k.y) < (k.r + rad) * (k.r + rad)) return;
    rocks.push({ x, y, r: rad, seed: Math.random() * 1000 });
  };
  const area = WORLD_W * WORLD_H;
  for (let i = Math.round(area / 900000); i > 0; i--) {
    const cx = Math.random() * WORLD_W, cy = Math.random() * WORLD_H;
    for (let k = 2 + ((Math.random() * 4) | 0); k > 0; k--) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * 150;
      add(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 40 + Math.random() * 80);
    }
  }
  for (let i = Math.round(area / 400000); i > 0; i--) add(Math.random() * WORLD_W, Math.random() * WORLD_H, 22 + Math.random() * 40);

  // Each rock is listed in every cell its circle, grown by the largest enemy radius, touches.
  const m = 70;
  for (const k of rocks) {
    const x0 = clampCell(((k.x - k.r - m) / ROCK_CELL) | 0, RGW), x1 = clampCell(((k.x + k.r + m) / ROCK_CELL) | 0, RGW);
    const y0 = clampCell(((k.y - k.r - m) / ROCK_CELL) | 0, RGH), y1 = clampCell(((k.y + k.r + m) / ROCK_CELL) | 0, RGH);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) rockGrid[cy * RGW + cx].push(k);
  }
}

function rockCell(x, y) {
  return rockGrid[clampCell((y / ROCK_CELL) | 0, RGH) * RGW + clampCell((x / ROCK_CELL) | 0, RGW)];
}

function rockAt(x, y, rad) {
  for (const k of rockCell(x, y)) if (dist2(x, y, k.x, k.y) < (k.r + rad) * (k.r + rad)) return true;
  return false;
}

// Moves o ({ x, y }) out of every rock it overlaps; returns the last rock it touched.
function pushOutOfRocks(o, rad) {
  const cell = rockCell(o.x, o.y);
  let hit = null;
  for (let i = 0; i < cell.length; i++) {
    const k = cell[i];
    const dx = o.x - k.x, dy = o.y - k.y, rr = k.r + rad, d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr) continue;
    const d = Math.sqrt(d2) || 1;
    o.x = k.x + dx / d * rr;
    o.y = k.y + dy / d * rr;
    hit = k;
  }
  return hit;
}

// The nearest spot to (x, y) inside the map and clear of rocks.
function freeSpot(x, y, rad) {
  const p = { x: Math.max(rad, Math.min(WORLD_W - rad, x)), y: Math.max(rad, Math.min(WORLD_H - rad, y)) };
  for (let k = 0; k < 3 && pushOutOfRocks(p, rad); k++);
  return p;
}

// Enemies blocked by a rock slide around it instead of stalling: the part of their step that pointed into
// the rock is redirected along its edge, towards the side they were already heading (or a fixed side per enemy).
function collideEnemiesWithRocks(dt) {
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e.alive) continue;
    const k = pushOutOfRocks(e, e.r);
    if (!k) continue;
    const nx = e.x - k.x, ny = e.y - k.y, nl = Math.sqrt(nx * nx + ny * ny) || 1;
    const into = -(e.vx * nx + e.vy * ny) / nl;
    if (into <= 0) continue;
    let tx = ny / nl, ty = -nx / nl;
    const along = e.vx * tx + e.vy * ty;
    if (along < 0 || (along === 0 && e.id & 1)) { tx = -tx; ty = -ty; }
    e.x += tx * into * dt;
    e.y += ty * into * dt;
    pushOutOfRocks(e, e.r);
  }
}

// ---------- Teleporter ----------

function nearTeleporter() {
  const rr = PLAYER_R + 70;
  return teleporter.state !== 'charging' && dist2(teleporter.x, teleporter.y, player.x, player.y) < rr * rr;
}

function useTeleporter() {
  if (teleporter.state === 'idle') startTeleporterEvent();
  else Game.run.travelQueued = true;
}

// Boss event: the map's boss (plus one more every MAPS_PER_EXTRA_BOSS maps) rises, spawns intensify and the
// teleporter charges while the player stays in its zone. It completes once fully charged with every boss dead.
function startTeleporterEvent() {
  const r = Game.run;
  const n = 1 + Math.floor((r.mapN - 1) / MAPS_PER_EXTRA_BOSS);
  Object.assign(teleporter, { state: 'charging', charge: 0, bosses: n });
  for (let k = 0; k < n; k++) spawnBoss(BOSS_ORDER[(r.mapN - 1 + k) % BOSS_ORDER.length], n > 1 ? 0.75 : 1);
  addText(teleporter.x, teleporter.y - 90, 'THE TELEPORTER IS ACTIVATING', '#ff6b6b');
  addRing(teleporter.x, teleporter.y, TELEPORTER_R, 'rgba(255,107,107,0.25)');
  Sfx.bossIncoming();
}

function updateTeleporter(dt) {
  const r = Game.run, tp = teleporter;
  if (tp.state !== 'charging') return;
  tp.inside = dist2(tp.x, tp.y, player.x, player.y) < TELEPORTER_R * TELEPORTER_R;
  if (tp.inside) tp.charge = Math.min(1, tp.charge + dt / r.settings.teleporterCharge);
  if (tp.charge >= 1 && r.bossAlive <= 0) completeTeleporter();
}

// Spawning stops and every remaining enemy and attack is wiped out; the map is safe to finish looting.
function completeTeleporter() {
  const r = Game.run, tp = teleporter;
  tp.state = 'done';
  r.mapsCleared++;
  for (const e of enemies) {
    if (!e.alive) continue;
    e.alive = false;
    burst(e.x, e.y, e.def.color, 5, 140);
  }
  for (const b of ebullets) ebulletFree.push(b);
  ebullets.length = 0;
  hazards.length = 0;
  beams.length = 0;
  waves.length = 0;
  dropItem(tp.x, tp.y + 40, modifyTier(Math.random() < 0.2 ? 2 : 1));
  addText(tp.x, tp.y - 90, 'TELEPORTER CHARGED', '#69db7c');
  addRing(tp.x, tp.y, TELEPORTER_R, 'rgba(105,219,124,0.3)');
  Sfx.levelUp();
}

// Uncollected coins are banked; anything else left on the map is lost.
function travelToNextMap() {
  const r = Game.run;
  for (const o of orbs) if (o.kind === 'gold') gainGold(o.v);
  r.mapN++;
  Sfx.teleport();
  loadMap();
}

// ---------- Movement ----------

function moveInput() {
  const k = Game.keys;
  let x = (k.right ? 1 : 0) - (k.left ? 1 : 0), y = (k.down ? 1 : 0) - (k.up ? 1 : 0);
  const len = Math.sqrt(x * x + y * y);
  if (len) { x /= len; y /= len; }
  return { x, y };
}

function moveSpeed() {
  const S = Game.run.stats;
  return S.speed * Math.max(0.2, 1 + (S.movePct + Game.run.dynMove) / 100);
}

function tryDash(dir) {
  const r = Game.run, S = r.stats, c = S.core;
  if (player.charges <= 0 || player.dashT > 0 || r.shadowT > 0) return;
  player.charges--;
  if (c.strides) {
    r.shadowDur = 3 + 1.5 * (c.strides - 1);
    r.shadowT = r.shadowDur;
    r.decoyX = player.x; r.decoyY = player.y;
    addRing(player.x, player.y, 60, 'rgba(116,192,252,0.35)');
    Sfx.dash();
    return;
  }
  if (dir.x || dir.y) { player.fx = dir.x; player.fy = dir.y; }
  player.dashDx = player.fx; player.dashDy = player.fy;
  player.dashT = DASH_TIME;
  player.iframeT = Math.max(DASH_TIME, r.settings.dashIframes);
  player.dashHits.length = 0;
  if (c.faraday && r.faraday >= 0.25) {
    const k = r.faraday;
    pushEvent({ t: 'explode', x: player.x, y: player.y, r: 100 + 150 * k, dmg: baseDmg((40 + 28 * (c.faraday - 1)) * k), w: null, direct: false, color: 'rgba(116,192,252,0.35)', depth: 1 });
    r.faraday = 0;
  }
  Sfx.dash();
}

function onDashEnd() {
  const r = Game.run, c = r.stats.core;
  if (c.headset && !(r.cd.headset > 0)) {
    r.cd.headset = itemCd(10 * Math.pow(0.5, c.headset - 1));
    pushEvent({ t: 'explode', x: player.x, y: player.y, r: 190, dmg: baseDmg(100 * c.headset), w: null, direct: false, color: 'rgba(255,212,59,0.35)', depth: 1, stun: 1 });
  }
}

function updateMovement(dt) {
  const r = Game.run, S = r.stats, c = S.core;
  const dir = moveInput();
  if (player.charges < S.dashCharges) {
    if ((player.dashRe += dt) >= S.dashCd) { player.dashRe -= S.dashCd; player.charges++; }
  } else {
    player.dashRe = 0;
  }
  if (Game.dashQueued) {
    Game.dashQueued = false;
    tryDash(dir);
  }
  if (player.iframeT > 0) player.iframeT -= dt;

  let step;
  const dashing = player.dashT > 0;
  if (dashing) {
    player.dashT -= dt;
    const sp = S.dashDist / DASH_TIME;
    player.vx = player.dashDx * sp; player.vy = player.dashDy * sp;
    step = sp * dt;
    if (c.headstompers) {
      for (const e of queryRadius(player.x, player.y, PLAYER_R + 4)) {
        if (player.dashHits.includes(e.id)) continue;
        player.dashHits.push(e.id);
        if (!e.boss) e.stunT = Math.max(e.stunT, 0.5);
        applyDamage(e, baseDmg(25 * c.headstompers), false, null, 1, false);
      }
    }
    if (Math.random() < 0.6) burst(player.x, player.y, r.char.color, 1, 40);
  } else {
    const sp = moveSpeed();
    player.vx = dir.x * sp; player.vy = dir.y * sp;
    step = sp * dt;
    if (dir.x || dir.y) { player.fx = dir.x; player.fy = dir.y; }
  }
  player.x = Math.max(PLAYER_R, Math.min(WORLD_W - PLAYER_R, player.x + player.vx * dt));
  player.y = Math.max(PLAYER_R, Math.min(WORLD_H - PLAYER_R, player.y + player.vy * dt));
  pushOutOfRocks(player, PLAYER_R);
  if (dashing && player.dashT <= 0) onDashEnd();

  r.moving = player.dashT > 0 || dir.x !== 0 || dir.y !== 0;
  if (r.moving) { player.moveT += dt; player.stillT = 0; }
  else { player.stillT += dt; player.moveT = 0; }
  if (r.moving && (c.boots || r.witnessT > 0) && (player.trailT -= step) <= 0) {
    player.trailT = 22;
    if (trail.length < 120) trail.push({ x: player.x, y: player.y, t: 2 });
  }
}

// Movement item effects and the per-frame movement speed bonus (additive %, like Risk of Rain).
function updateMovementItems(dt) {
  const r = Game.run, S = r.stats, c = S.core;
  if (r.cloakT > 0) r.cloakT -= dt;
  if (r.shadowT > 0) {
    r.shadowT -= dt;
    heal(S.maxHp * 0.18 * (c.strides || 1) / r.shadowDur * dt);
  }
  if (r.harpoonT > 0) r.harpoonT -= dt;
  if (r.witnessT > 0) r.witnessT -= dt;
  if (r.antlerT > 0 && (r.antlerT -= dt) <= 0) r.antlerN = 0;
  if (c.faraday) r.faraday = r.moving ? Math.min(1, r.faraday + dt / 4) : Math.max(0, r.faraday - dt / 2);

  let pct = 0;
  if (c.energydrink && player.moveT >= 1) pct += 8 * c.energydrink;
  if (c.whip && r.hurtT >= 2) pct += 10 * c.whip;
  if (r.harpoonT > 0) pct += 40 * r.harpoonT / r.harpoonDur;
  if (r.cloakT > 0) pct += 13;
  if (r.shadowT > 0) pct += 10;
  if (r.bannerT > 0) pct += 10;
  if (r.antlerN > 0) pct += 4 * r.antlerN;
  if (c.faraday) pct += 13 * r.faraday;
  if (r.witnessT > 0) pct += 3 + 2 * ((c.witness || 1) - 1);
  if (r.buffT.opus > 0) pct += 50;
  if (r.buffT.tonic > 0) pct += 30;
  if (r.buffT.egg > 0) pct += 100;
  r.dynMove = pct;

  if (c.fungus && player.stillT >= 1) heal(S.maxHp * (0.045 + 0.0225 * (c.fungus - 1)) * dt);
  if (c.weeping && r.moving) heal(S.maxHp * 0.02 * c.weeping * dt);
  if (c.antlers && (r.antlerSpawnT += dt) >= 10 * Math.pow(0.9, c.antlers - 1)) {
    r.antlerSpawnT = 0;
    const a = Math.random() * Math.PI * 2, d = 110 + Math.random() * 120;
    const p = freeSpot(player.x + Math.cos(a) * d, player.y + Math.sin(a) * d, 30);
    orbs.push({ kind: 'antler', magnet: false, v: 0, t: 10, x: p.x, y: p.y });
  }
  if (c.disciple && r.moving) {
    r.discipleT += dt * moveSpeed() / r.char.speed;
    if (r.discipleT >= 1.6) {
      r.discipleT = 0;
      const t = nearestEnemy(player.x, player.y, 600, null);
      if (t) spawnBullet(player.x, player.y, Math.atan2(t.y - player.y, t.x - player.x), 460, 2.5, baseDmg(30 * c.disciple), null, 3, '#c0eb75', 5, 0, 0, false, t);
    }
  }
  if (trail.length && (r.trailTick -= dt) <= 0) {
    r.trailTick = 0.25;
    const dps = (c.boots ? baseDmg(15 + 10 * (c.boots - 1)) : 0) + (r.witnessT > 0 ? baseDmg(30) : 0);
    for (const p of trail) {
      for (const e of queryRadius(p.x, p.y, 22)) {
        e.burnDps = Math.max(e.burnDps, dps);
        e.burnT = Math.max(e.burnT, 1);
      }
    }
  }
  for (let i = trail.length - 1; i >= 0; i--) {
    if ((trail[i].t -= dt) > 0) continue;
    trail[i] = trail[trail.length - 1];
    trail.pop();
  }
}

function updatePlayer(dt) {
  const r = Game.run, S = r.stats, c = S.core;
  for (const k in r.cd) r.cd[k] -= dt;
  r.hurtT += dt;
  if (r.invulnT > 0) r.invulnT -= dt;
  if (S.regen > 0) heal(S.regen * dt);
  if (r.hurtFlash > 0) r.hurtFlash -= dt;
  if (r.levelFlash > 0) r.levelFlash -= dt;
  if (r.shield < S.maxShield && r.hurtT >= 4) r.shield = Math.min(S.maxShield, r.shield + S.maxShield * 0.5 * dt);
  if (r.barrier > 0) r.barrier = Math.max(0, r.barrier - (S.maxHp + S.maxShield) / 20 * dt);
  if (r.healPool > 0) {
    const v = Math.min(r.healPool, S.maxHp * 0.1 * Math.pow(0.5, (c.corpsebloom || 1) - 1) * dt);
    r.healPool -= v;
    applyHeal(v);
  }
  for (let i = r.medkits.length - 1; i >= 0; i--) {
    if ((r.medkits[i] -= dt) > 0) continue;
    r.medkits.splice(i, 1);
    heal(4 + S.maxHp * 0.03 * (c.medkit || 0));
  }
  for (let i = r.plants.length - 1; i >= 0; i--) {
    heal(S.maxHp * (0.01 + 0.01 * (c.deskplant || 0)) * dt);
    if ((r.plants[i] -= dt) <= 0) r.plants.splice(i, 1);
  }
  for (let i = r.echoQ.length - 1; i >= 0; i--) {
    if ((r.echoQ[i].t -= dt) > 0) continue;
    const v = r.echoQ[i].v;
    r.echoQ.splice(i, 1);
    takeDamage(v);
    if (Game.state !== 'play') return;
  }

  if (S.teslacoil > 0) {
    r.teslaT -= dt;
    if (r.teslaT <= 0) {
      r.teslaT = 0.5;
      const dmg = baseDmg(14);
      const list = queryRadius(player.x, player.y, 250).slice();
      const max = 1 + 2 * S.teslacoil;
      for (let i = 0; i < list.length && i < max; i++) {
        const e = list[i];
        addLine(player.x, player.y, e.x, e.y, '#d0bfff');
        applyDamage(e, dmg, false, null, 1, false);
      }
    }
  }
  if (c.barbed && (r.barbedT -= dt) <= 0) {
    r.barbedT = 0.5;
    const d = baseDmg(4 + 4 * c.barbed);
    for (const e of queryRadius(player.x, player.y, barbedRadius(c.barbed)).slice()) applyDamage(e, d, false, null, 1, true);
  }
  if (r.frostT > 0) {
    r.frostT -= dt;
    if ((r.frostTick -= dt) <= 0) {
      r.frostTick = 0.25;
      const d = baseDmg(15 * (c.frostrelic || 0)) * 0.25;
      for (const e of queryRadius(player.x, player.y, r.frostR).slice()) {
        e.slowT = Math.max(e.slowT, 0.4);
        applyDamage(e, d, false, null, 1, true);
      }
    }
    if (r.frostT <= 0) r.frostR = 0;
  }
  if (r.chargeT > 0) {
    r.chargeT -= dt;
    if ((r.chargeTick -= dt) <= 0) {
      r.chargeTick = 0.5;
      const d = baseDmg(6 * (c.chargefield || 0));
      for (const e of queryRadius(player.x, player.y, r.chargeR).slice()) applyDamage(e, d, false, null, 1, true);
    }
    if (r.chargeT <= 0) r.chargeR = 0;
  }
  if (c.urn && (r.urnT -= dt) <= 0) {
    r.urnT = 0.25;
    const list = queryRadius(player.x, player.y, 220).slice();
    list.sort((a, b) => dist2(a.x, a.y, player.x, player.y) - dist2(b.x, b.y, player.x, player.y));
    r.urnTargets = list.slice(0, c.urn);
    const d = baseDmg(10) * 0.25;
    for (const e of r.urnTargets) {
      applyDamage(e, d, false, null, 1, true);
      heal(d);
    }
  }
  if (c.microbots && (r.microT -= dt) <= 0) {
    r.microT = 0.5;
    let k = c.microbots;
    for (let i = 0; i < ebullets.length && k > 0; i++) {
      const b = ebullets[i];
      if (b.life <= 0 || dist2(b.x, b.y, player.x, player.y) > 220 * 220) continue;
      b.life = 0;
      k--;
      addLine(player.x, player.y, b.x, b.y, '#99e9f2');
    }
  }
  if (c.hitlist && (r.hitListT -= dt) <= 0) {
    r.hitListT = 10;
    for (let k = 0; k < c.hitlist && enemies.length; k++) {
      for (let tries = 0; tries < 10; tries++) {
        const e = enemies[(Math.random() * enemies.length) | 0];
        if (e.alive && !e.marked && inWorld(e)) { e.marked = true; break; }
      }
    }
  }
  if (c.savings && (r.savingsT += dt) >= 3) {
    r.savingsT -= 3;
    gainGold(c.savings * goldScale());
  }
  if (r.fireworks > 0) {
    const n = c.fireworks ? (4 + 4 * c.fireworks) * r.fireworks : 0;
    r.fireworks = 0;
    for (let i = 0; i < n; i++) spawnBullet(player.x, player.y, Math.random() * Math.PI * 2, 420, 3, baseDmg(30), null, 3, '#ffd43b', 3, 0, 0, false, null);
  }
  if (c.ego) updateEgo(dt, c.ego);
  if (c.nkuhana && r.soul >= S.maxHp * 0.1) {
    const t = nearestEnemy(player.x, player.y, 600, null);
    if (t) {
      spawnBullet(player.x, player.y, Math.atan2(t.y - player.y, t.x - player.x), 500, 2, baseDmg(r.soul * 2.5 * c.nkuhana), null, 3, '#cc5de8', 6, 0, 0, false, t);
      r.soul = 0;
    }
  }

  if (r.chronicT > 0 && (r.chronicT -= dt) <= 0) r.chronicN = 0;
  if (r.compulsionT > 0 && (r.compulsionT -= dt) <= 0) r.compulsionN = 0;
  if (r.bannerT > 0) r.bannerT -= dt;
  if (r.brainT > 0) r.brainT -= dt;
  let dmgPct = r.chronicN * 3 + r.hitListDmg + r.compulsionN * 3;
  if (r.bannerT > 0) dmgPct += 15;
  if (r.witnessT > 0) dmgPct += 10;
  if (c.goldengun) dmgPct += Math.min(40, r.level * c.goldengun);
  if (r.buffT.tonic > 0) dmgPct += 100;
  r.dynDmg = 1 + dmgPct / 100;
  r.dynCrit = r.buffT.ocular > 0 ? 100 : 0;
  let rate = 1 + r.compulsionN * 0.03;
  if (r.bannerT > 0) rate += 0.3;
  if (r.buffT.opus > 0) rate += 1;
  if (r.buffT.tonic > 0) rate += 0.7;
  if (c.energycell) rate += 0.4 * c.energycell * Math.min(1, Math.max(0, (0.5 - r.hp / S.maxHp) / 0.4));
  if (r.brainT > 0) rate *= 2;
  r.dynRate = rate;
  r.nearCount = queryRadius(player.x, player.y, 200).length;
}

// Item and equipment effects that are currently buffing the player, for the HUD status row:
// { id: item whose icon is shown, n: stack count (stacking buffs only), t: seconds left (timed buffs only), text }.
function activeStatuses() {
  const r = Game.run, S = r.stats, c = S.core, out = [];
  const add = (id, text, t, n) => out.push({ id, text, t, n });
  if (r.chronicN > 0) add('chronic', `+${3 * r.chronicN}% dmg`, r.chronicT, r.chronicN);
  if (r.compulsionN > 0) add('compulsion', `+${3 * r.compulsionN}% dmg/AS`, r.compulsionT, r.compulsionN);
  let pred = 0, predT = 0, pauld = null, lantern = 0;
  for (const w of r.weapons) {
    if (w.predStacks > pred) { pred = w.predStacks; predT = w.predT; }
    if (w.pauldronT > 0 && (!pauld || w.pauldronT > pauld.pauldronT)) pauld = w;
    lantern = Math.max(lantern, w.stats.n.lantern || 0);
  }
  if (pred > 0) add('predatory', `+${12 * pred}% AS`, predT, pred);
  if (pauld) add('pauldron', `+${35 * pauld.stats.n.pauldron}% AS`, pauld.pauldronT);
  if (r.bannerT > 0) add('warbanner', '+30% AS +15% dmg', r.bannerT);
  if (r.brainT > 0) add('brainstalks', '×2 AS', r.brainT);
  if (r.witnessT > 0) add('witness', '+10% dmg', r.witnessT);
  if (r.harpoonT > 0) add('harpoon', `+${Math.round(40 * r.harpoonT / r.harpoonDur)}% MS`, r.harpoonT);
  if (r.antlerN > 0) add('antlers', `+${4 * r.antlerN}% MS`, r.antlerT, r.antlerN);
  if (r.frostT > 0) add('frostrelic', 'ice storm', r.frostT);
  if (r.chargeT > 0) add('chargefield', 'lightning ring', r.chargeT);
  if (r.cloakT > 0) add('stealthkit', 'invisible', r.cloakT);
  if (r.shadowT > 0) add('strides', 'shadowfade', r.shadowT);
  if (r.hitListDmg > 0) add('hitlist', `+${r.hitListDmg}% dmg`, undefined, r.hitListDmg);
  if (r.infusionHp >= 1) add('infusion', `+${Math.floor(r.infusionHp)} HP`);
  if (r.egoBombs > 0) add('ego', 'orbiting bombs', undefined, r.egoBombs);
  if (lantern && r.nearCount > 0) {
    const k = Math.min(r.nearCount, 3 * lantern);
    add('lantern', `+${10 * k}% AS`, undefined, k);
  }
  if (c.energycell) {
    const p = Math.round(40 * c.energycell * Math.min(1, Math.max(0, (0.5 - r.hp / S.maxHp) / 0.4)));
    if (p > 0) add('energycell', `+${p}% AS`);
  }
  if (c.energydrink && player.moveT >= 1) add('energydrink', `+${8 * c.energydrink}% MS`);
  if (c.whip && r.hurtT >= 2) add('whip', `+${10 * c.whip}% MS`);
  if (c.opal && r.hurtT >= 4) add('opal', `+${20 * c.opal} armor`);
  if (c.buckler && r.moving) add('buckler', `+${30 * c.buckler} armor`);
  if (c.faraday && r.faraday >= 0.25) add('faraday', `${Math.round(r.faraday * 100)}% charged`);
  if (c.fungus && player.stillT >= 1) add('fungus', 'healing');
  if (c.safer && !(r.cd.safer > 0)) add('safer', 'block ready');
  for (const k in r.buffT) if (r.buffT[k] > 0) add(k, 'active', r.buffT[k]);
  return out;
}

function barbedRadius(n) {
  return 115 + 15 * n;
}

function updateEgo(dt, n) {
  const r = Game.run;
  if (r.egoBombs < 2 + n && (r.egoT += dt) >= 3 / n) {
    r.egoT = 0;
    r.egoBombs++;
  }
  r.egoA += dt * 2;
  for (let k = 0; k < r.egoBombs; k++) {
    const a = r.egoA + k * Math.PI * 2 / r.egoBombs;
    const bx = player.x + Math.cos(a) * 70, by = player.y + Math.sin(a) * 70;
    if (!queryRadius(bx, by, 8).length) continue;
    pushEvent({ t: 'explode', x: bx, y: by, r: 50, dmg: baseDmg(36), w: null, direct: false, color: '#74c0fc', depth: 1 });
    r.egoBombs--;
    break;
  }
}

// ---------- Equipment ----------

function equipCd(id) {
  const r = Game.run;
  return ITEM_BY_ID[id].cd * Math.pow(0.85, r.stats.core.fuelcell || 0) * (r.char.cdMult || 1) * r.settings.equipCdMult;
}

function equipMaxCharges() {
  return 1 + (Game.run.stats.core.fuelcell || 0);
}

// The previous equipment drops at the player's feet. Charges and cooldown stay with the slot, so
// swapping cannot skip a cooldown; equipment taken into an empty slot starts fully charged.
function setEquipment(id) {
  const q = Game.run.equip;
  if (q.id) drops.push({ id: q.id, tier: EQUIP_TIER, x: player.x, y: player.y, vx: 0, vy: 0, t: 0, seen: true });
  else { q.charges = equipMaxCharges(); q.cdT = 0; }
  q.id = id;
  addText(player.x, player.y - 60, `+ ${ITEM_BY_ID[id].name} [Shift]`, TIER_COLORS[EQUIP_TIER]);
  UI.renderHud();
}

// Equipment on the ground within reach that E would swap with the held one.
function swappableEquipDrop() {
  if (!Game.run.equip.id) return null;
  let best = null, bestD = (PLAYER_R + 30) * (PLAYER_R + 30);
  for (const d of drops) {
    if (d.tier !== EQUIP_TIER) continue;
    const dd = dist2(d.x, d.y, player.x, player.y);
    if (dd < bestD) { bestD = dd; best = d; }
  }
  return best;
}

function swapEquipDrop(d) {
  drops.splice(drops.indexOf(d), 1);
  Sfx.pick();
  setEquipment(d.id);
}

function updateEquipment(dt) {
  const r = Game.run, q = r.equip, S = r.stats;
  for (const k in r.buffT) r.buffT[k] -= dt;
  if (q.id) {
    const max = equipMaxCharges();
    q.charges = Math.min(q.charges, max);
    if (q.charges < max) {
      if (q.cdT <= 0) q.cdT = equipCd(q.id);
      if ((q.cdT -= dt) <= 0) { q.charges++; q.cdT = 0; }
    } else {
      q.cdT = 0;
    }
  }
  if (Game.equipQueued) {
    Game.equipQueued = false;
    useEquipment();
  }

  if (r.tonicOn && !(r.buffT.tonic > 0)) {
    r.tonicOn = false;
    if (Math.random() < 0.2) {
      r.afflictions++;
      addText(player.x, player.y - 80, 'TONIC AFFLICTION', '#74c0fc');
    }
    recomputeStats();
  }
  if (r.buffT.egg > 0) {
    for (const e of queryRadius(player.x, player.y, PLAYER_R + 14).slice()) {
      if (r.eggHits.includes(e.id)) continue;
      r.eggHits.push(e.id);
      knockback(e, 90);
      if (!e.boss) e.stunT = Math.max(e.stunT, 0.6);
      applyDamage(e, baseDmg(50), false, null, 1, false);
    }
    if (Math.random() < 0.8) burst(player.x, player.y, '#ff922b', 2, 90);
  } else if (r.eggOn) {
    r.eggOn = false;
    pushEvent({ t: 'explode', x: player.x, y: player.y, r: 160, dmg: baseDmg(80), w: null, direct: false, color: 'rgba(255,146,43,0.4)', depth: 1, burn: baseDmg(10) });
    Sfx.boom(true);
  }
  if (r.buffT.meteorite > 0 && (r.meteorTick -= dt) <= 0) {
    r.meteorTick = 0.3;
    const x = Render.camX + 40 + Math.random() * (Render.viewW - 80);
    const y = Render.camY + 40 + Math.random() * (Render.viewH - 80);
    hazards.push({ x, y, r: 80, t: 1, maxT: 1, dmg: S.maxHp * 0.15, foeDmg: baseDmg(60), owner: 0 });
  }
}

// An empty slot does nothing; without a charge, or when the effect has no valid target, the press is refused.
function useEquipment() {
  const r = Game.run, q = r.equip;
  if (!q.id) return;
  if (q.charges <= 0 || !EQUIP_EFFECTS[q.id]()) { Sfx.denied(); return; }
  q.charges--;
  Sfx.equip();
  const chaos = r.stats.core.bottledchaos || 0;
  if (!chaos) return;
  const pool = ITEMS.filter(it => it.tier === EQUIP_TIER && !it.noChaos && it.id !== q.id);
  for (let k = 0; k < chaos; k++) {
    const it = pool[(Math.random() * pool.length) | 0];
    EQUIP_EFFECTS[it.id]();
    addText(player.x, player.y - 84 - k * 18, it.name, TIER_COLORS[EQUIP_TIER]);
  }
}

function aimPoint() {
  return { x: Game.mouse.x, y: Game.mouse.y };
}

function aimAngle() {
  const dx = Game.mouse.x - player.x, dy = Game.mouse.y - player.y;
  return dx * dx + dy * dy > 100 ? Math.atan2(dy, dx) : Math.atan2(player.fy, player.fx);
}

function toughestOnScreen() {
  let best = null;
  for (const e of enemies) if (e.alive && onScreen(e) && (!best || e.hp > best.hp)) best = e;
  return best;
}

// Each effect returns false when it cannot be used right now (no target, no gold); the charge is kept.
const EQUIP_EFFECTS = {
  fruit() {
    heal(Game.run.stats.maxHp * 0.5);
    burst(player.x, player.y, '#69db7c', 16, 160);
    return true;
  },
  dml() {
    fireMissiles(player.x, player.y, 12, baseDmg(30), null, null);
    return true;
  },
  capacitor() {
    const m = aimPoint();
    const t = nearestEnemy(m.x, m.y, 200, null) || toughestOnScreen();
    if (!t) return false;
    addBeam(t.x, t.y - 700, t.x, t.y, '#a5d8ff');
    addRing(t.x, t.y, 120, 'rgba(165,216,255,0.4)');
    for (const e of queryRadius(t.x, t.y, 120)) if (!e.boss) e.stunT = Math.max(e.stunT, 1.5);
    applyDamage(t, baseDmg(300), true, null, 1, false);
    Sfx.laser(true);
    return true;
  },
  sawmerang() {
    const a = aimAngle();
    for (let k = -1; k <= 1; k++) spawnBullet(player.x, player.y, a + k * 0.28, 560, 1.5, baseDmg(40), null, 4, '#dee2e6', 10, 99, 0, false, null);
    return true;
  },
  cube() {
    const p = aimPoint();
    zones.push({ x: p.x, y: p.y, r: 320, t: 6, slow: false, pull: 260, color: 'rgba(132,46,166,0.16)', endDmg: baseDmg(30), w: null });
    return true;
  },
  molotov() {
    const p = aimPoint();
    for (let k = 0; k < 6; k++) {
      const a = k * Math.PI / 3 + Math.random() * 0.5, d = 40 + Math.random() * 80;
      const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
      pushEvent({ t: 'explode', x, y, r: 60, dmg: baseDmg(10), w: null, direct: false, color: 'rgba(255,146,43,0.4)', depth: 1, burn: baseDmg(50) / 3 });
      zones.push({ x, y, r: 60, t: 6, slow: false, pull: 0, color: 'rgba(255,107,0,0.16)', endDmg: 0, w: null, burn: baseDmg(20) });
    }
    return true;
  },
  preon() {
    const a = aimAngle();
    gadgets.push({ x: player.x, y: player.y, vx: Math.cos(a) * 200, vy: Math.sin(a) * 200, t: 3.5, zapT: 0 });
    return true;
  },
  minefield() {
    for (let k = 0; k < 7; k++) {
      const a = k * Math.PI * 2 / 7, d = 45 + Math.random() * 35;
      mines.push({ x: player.x + Math.cos(a) * d, y: player.y + Math.sin(a) * d, arm: 0.3, t: 30, dmg: baseDmg(40), r: 80 });
    }
    return true;
  },
  goldbomb() {
    const r = Game.run, S = r.stats;
    const spent = Math.floor(r.gold / 2);
    if (spent < 1) return false;
    r.gold -= spent;
    pushEvent({ t: 'explode', x: player.x, y: player.y, r: 260, dmg: spent * 10 * (1 + S.dmg / 100) * S.dmgMult, w: null, direct: false, color: 'rgba(250,176,5,0.4)', depth: 1 });
    addText(player.x, player.y - 70, `-$${spent}`, '#ffd43b');
    Sfx.boom(true);
    return true;
  },
  lostdoll() {
    const r = Game.run;
    const t = toughestOnScreen();
    if (!t) return false;
    const cost = r.hp * 0.25;
    r.hp -= cost;
    addText(player.x, player.y - 50, '-' + Math.round(cost), '#ff6b6b');
    addBeam(player.x, player.y, t.x, t.y, '#c92a2a');
    applyDamage(t, r.stats.maxHp * 5, true, null, 1, false);
    return true;
  },
  elephant() {
    Game.run.buffT.elephant = 5;
    return true;
  },
  blastshower() {
    const R2 = 500 * 500;
    for (const b of ebullets) if (dist2(b.x, b.y, player.x, player.y) < R2) b.life = 0;
    for (let i = hazards.length - 1; i >= 0; i--) if (dist2(hazards[i].x, hazards[i].y, player.x, player.y) < R2) hazards.splice(i, 1);
    for (const e of queryRadius(player.x, player.y, 500)) if (e.atk === ATK_LASER) e.atk = 0;
    addRing(player.x, player.y, 500, 'rgba(116,192,252,0.25)');
    return true;
  },
  unstablewatch() {
    Game.run.buffT.unstablewatch = 5;
    addText(player.x, player.y - 100, 'TIME STOP', '#a5d8ff');
    return true;
  },
  buddy() {
    const r = Game.run;
    r.buffT.buddy = 6;
    r.decoyX = player.x; r.decoyY = player.y;
    return true;
  },
  safelantern() {
    zones.push({ x: player.x, y: player.y, r: 220, t: 10, slow: false, pull: 0, color: 'rgba(255,224,102,0.08)', endDmg: 0, w: null, fear: true, dps: baseDmg(2) });
    return true;
  },
  egg() {
    const r = Game.run;
    r.buffT.egg = 3;
    r.eggOn = true;
    r.eggHits.length = 0;
    r.invulnT = Math.max(r.invulnT, 3);
    return true;
  },
  vase() {
    const r = Game.run, m = aimPoint();
    const dx = m.x - player.x, dy = m.y - player.y;
    const k = Math.min(1, 450 / (Math.sqrt(dx * dx + dy * dy) || 1));
    addRing(player.x, player.y, 40, 'rgba(116,192,252,0.5)');
    player.x = Math.max(PLAYER_R, Math.min(WORLD_W - PLAYER_R, player.x + dx * k));
    player.y = Math.max(PLAYER_R, Math.min(WORLD_H - PLAYER_R, player.y + dy * k));
    addRing(player.x, player.y, 60, 'rgba(116,192,252,0.5)');
    r.invulnT = Math.max(r.invulnT, 0.5);
    return true;
  },
  amethyst() {
    const r = Game.run;
    player.charges = r.stats.dashCharges;
    player.dashRe = 0;
    for (const k in r.cd) r.cd[k] = 0;
    for (const w of r.weapons) {
      w.kjaroCd = 0; w.runaldCd = 0; w.singCd = 0; w.wormCd = 0;
      if (w.stats.n.shuriken) w.shuriken = 2 + w.stats.n.shuriken;
    }
    burst(player.x, player.y, '#b197fc', 16, 160);
    return true;
  },
  ocular() {
    Game.run.buffT.ocular = 8;
    return true;
  },
  opus() {
    Game.run.buffT.opus = 7;
    return true;
  },
  leech() {
    Game.run.buffT.leech = 8;
    return true;
  },
  backup() {
    for (let k = 0; k < 4; k++) spawnAlly('drone', 'backup', player.x, player.y, 25, 12, 3, '#ffa94d');
    return true;
  },
  jar() {
    let n = 0;
    for (const e of enemies) {
      if (n >= 10) break;
      if (!e.alive || e.boss || !onScreen(e)) continue;
      spawnAlly('ghost', 'jar', e.x, e.y, 10, 30, 0, '#e9ecef');
      n++;
    }
    return n > 0;
  },
  brooch() {
    const type = rollChestType(), a = Math.random() * Math.PI * 2;
    const { x, y } = freeSpot(player.x + Math.cos(a) * 90, player.y + Math.sin(a) * 90, 60);
    chests.push({ type, price: chestPrice(type), x, y, t: 0, uses: 0, wins: 0, seen: true });
    burst(x, y, CHESTS[type].color, 20, 200);
    addText(x, y - 40, 'SUPPLY DROP', '#ffd43b');
    return true;
  },
  meteorite() {
    const r = Game.run;
    r.buffT.meteorite = 8;
    r.meteorTick = 0;
    return true;
  },
  tonic() {
    const r = Game.run;
    r.buffT.tonic = 20;
    r.tonicOn = true;
    recomputeStats();
    return true;
  },
};

// Preon orbs fly slowly, zapping enemies around them, and detonate on the first enemy they touch.
function updateGadgets(dt) {
  for (let i = gadgets.length - 1; i >= 0; i--) {
    const g = gadgets[i];
    g.x += g.vx * dt; g.y += g.vy * dt;
    g.t -= dt;
    if ((g.zapT -= dt) <= 0) {
      g.zapT = 0.2;
      for (const e of queryRadius(g.x, g.y, 200).slice(0, 4)) {
        addLine(g.x, g.y, e.x, e.y, '#99e9f2');
        applyDamage(e, baseDmg(12), false, null, 1, true);
      }
    }
    const out = g.x < 0 || g.y < 0 || g.x > WORLD_W || g.y > WORLD_H;
    if (g.t > 0 && !out && !queryRadius(g.x, g.y, 14).length) continue;
    pushEvent({ t: 'explode', x: g.x, y: g.y, r: 260, dmg: baseDmg(400), w: null, direct: false, color: 'rgba(153,233,242,0.4)', depth: 1 });
    Sfx.boom(true);
    gadgets.splice(i, 1);
  }
}

// ---------- Allies, zones, mines, pickups ----------

function spawnAlly(kind, tag, x, y, life, dmg, rate, color) {
  allies.push({ kind, tag, x, y, life, dmg, rate, color, cd: Math.random() * 0.5, a: Math.random() * Math.PI * 2, orbit: 55 + Math.random() * 35, target: null, tid: 0 });
}

function countAllies(tag) {
  let k = 0;
  for (const a of allies) if (a.tag === tag) k++;
  return k;
}

// Permanent allies follow the equipped items: missing ones are summoned, extra ones dismissed.
function syncAllies() {
  const r = Game.run, c = r.stats.core;
  syncAllyCount('droneman', c.spareparts ? 1 : 0, () => spawnAlly('drone', 'droneman', player.x, player.y, Infinity, 12, 3, '#ffd43b'));
  syncAllyCount('probe', c.empathy ? 2 : 0, () => spawnAlly('drone', 'probe', player.x, player.y, Infinity, 10 * c.empathy, 2, '#74c0fc'));
  syncAllyCount('beetle', c.gland || 0, () => spawnAlly('ghost', 'beetle', player.x, player.y, Infinity, 40, 0, '#94d82d'));
  for (const a of allies) if (a.tag === 'probe') a.dmg = 10 * c.empathy;
  if (!c.nucleus) syncAllyCount('construct', 0, null);
  for (const a of allies) if (a.tag === 'construct') a.dmg = 15 * c.nucleus;
}

function syncAllyCount(tag, want, spawn) {
  let have = countAllies(tag);
  for (; have < want; have++) spawn();
  for (let i = allies.length - 1; i >= 0 && have > want; i--) {
    if (allies[i].tag !== tag) continue;
    allies.splice(i, 1);
    have--;
  }
}

function updateAllies(dt) {
  const speedUp = (1 + 0.5 * (Game.run.stats.core.spareparts || 0)) * (Game.run.buffT.opus > 0 ? 2 : 1);
  for (let i = allies.length - 1; i >= 0; i--) {
    const al = allies[i];
    if ((al.life -= dt) <= 0) { allies[i] = allies[allies.length - 1]; allies.pop(); continue; }
    if (al.kind === 'drone') {
      al.a += dt * 0.9;
      al.x = player.x + Math.cos(al.a) * al.orbit;
      al.y = player.y + Math.sin(al.a) * al.orbit;
      if ((al.cd -= dt * speedUp) > 0) continue;
      const t = nearestEnemy(al.x, al.y, 380, null);
      if (!t) { al.cd = 0; continue; }
      al.cd = 1 / al.rate;
      spawnBullet(al.x, al.y, Math.atan2(t.y - al.y, t.x - al.x), 800, 0.6, baseDmg(al.dmg), null, 0, al.color, 3, 0, 0, false, null);
      continue;
    }
    if (!al.target || !al.target.alive || al.target.id !== al.tid) {
      al.target = nearestEnemy(al.x, al.y, 2000, null);
      al.tid = al.target ? al.target.id : 0;
    }
    const t = al.target;
    const tx = t ? t.x : player.x, ty = t ? t.y : player.y;
    const dx = tx - al.x, dy = ty - al.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
    const reach = t ? t.r + 8 : 50;
    if (d > reach) {
      const step = Math.min(d - reach, 170 * dt);
      al.x += dx / d * step; al.y += dy / d * step;
    } else if (t && (al.cd -= dt * speedUp) <= 0) {
      al.cd = 0.5;
      applyDamage(t, baseDmg(al.dmg) * 0.5, false, null, 1, false);
    }
  }
}

function updateZones(dt) {
  for (let i = zones.length - 1; i >= 0; i--) {
    const z = zones[i];
    for (const e of queryRadius(z.x, z.y, z.r).slice()) {
      if (z.slow) e.slowT = Math.max(e.slowT, 0.3);
      if (z.burn) { e.burnDps = Math.max(e.burnDps, z.burn); e.burnT = Math.max(e.burnT, 0.5); }
      if (z.fear && !e.boss) e.fearT = Math.max(e.fearT, 0.25);
      if (z.dps) applyDamage(e, z.dps * dt, false, null, 1, true);
      if (z.pull && !e.boss) {
        const dx = z.x - e.x, dy = z.y - e.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        const step = Math.min(d, z.pull * dt);
        e.x += dx / d * step; e.y += dy / d * step;
      }
    }
    if ((z.t -= dt) > 0) continue;
    if (z.endDmg) pushEvent({ t: 'explode', x: z.x, y: z.y, r: z.r, dmg: z.endDmg, w: z.w, direct: false, color: '#cc5de8', depth: 1 });
    zones[i] = zones[zones.length - 1];
    zones.pop();
  }
}

function updateMines(dt) {
  for (let i = mines.length - 1; i >= 0; i--) {
    const m = mines[i];
    m.arm -= dt;
    m.t -= dt;
    const trigger = m.arm <= 0 && queryRadius(m.x, m.y, 14).length > 0;
    if (trigger) pushEvent({ t: 'explode', x: m.x, y: m.y, r: m.r, dmg: m.dmg, w: null, direct: false, color: '#ff8787', depth: 1 });
    if (trigger || m.t <= 0) { mines[i] = mines[mines.length - 1]; mines.pop(); }
  }
}

function updateDelayed(dt) {
  for (let i = delayed.length - 1; i >= 0; i--) {
    const d = delayed[i];
    if ((d.t -= dt) > 0) continue;
    pushEvent(d.ev);
    delayed[i] = delayed[delayed.length - 1];
    delayed.pop();
  }
}

// ---------- Enemies ----------

// frozen (Unstable Watch): enemies do not act, but dead ones are still cleaned up.
function updateEnemies(dt, frozen) {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (e.alive && !frozen) updateEnemy(e, dt);
    if (Game.state !== 'play') return;
    if (!e.alive) {
      enemies[i] = enemies[enemies.length - 1];
      enemies.pop();
      e.dotW = null; e.stickyW = null; e.tetherW = null;
      enemyFree.push(e);
    }
  }
}

function updateEnemy(e, dt) {
  if (e.bleedT > 0) {
    e.bleedT -= dt;
    applyDamage(e, e.bleedDps * dt, false, e.dotW, 1, true);
    if (e.bleedT <= 0) e.bleedDps = 0;
  }
  if (e.alive && e.burnT > 0) {
    e.burnT -= dt;
    applyDamage(e, e.burnDps * Game.run.stats.burnMult * dt, false, e.dotW, 1, true);
    if (e.burnT <= 0) e.burnDps = 0;
  }
  if (e.alive && e.poisonT > 0) {
    e.poisonT -= dt;
    applyDamage(e, e.poisonDps * dt, false, e.dotW, 1, true);
    if (e.poisonT <= 0) { e.poisonDps = 0; e.infect = false; }
  }
  if (e.alive && e.tetherT > 0) {
    e.tetherT -= dt;
    applyDamage(e, e.tetherDps * dt, false, e.tetherW, 1, true);
  }
  if (!e.alive) return;
  if (e.stickyT > 0) {
    e.stickyT -= dt;
    if (e.stickyT <= 0) pushEvent({ t: 'explode', x: e.x, y: e.y, r: 75, dmg: e.stickyDmg, w: e.stickyW, direct: false, color: '#ffa8a8', depth: 1 });
  }
  if (e.justiceT > 0) e.justiceT -= dt;
  if (e.flash > 0) e.flash -= dt;

  const d = e.def, r = Game.run;
  const enrageAt = r.settings.enrageSeconds;
  if (!e.boss && !e.enraged && enrageAt > 0 && (e.age += dt) >= enrageAt) {
    e.enraged = true;
    e.speed *= ENRAGE_SPEED;
    e.dmg *= ENRAGE_DMG;
  }
  const blind = hidden();
  const dx = (blind ? r.decoyX : player.x) - e.x, dy = (blind ? r.decoyY : player.y) - e.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const stop = blind ? e.r : d.ranged ? d.ranged : PLAYER_R + e.r;
  let sp = e.speed;
  if (e.freezeT > 0) { e.freezeT -= dt; sp = 0; }
  else if (e.stunT > 0) { e.stunT -= dt; sp = 0; }
  else if (e.slowT > 0) { e.slowT -= dt; sp *= 0.5; }

  if (e.fearT > 0 && sp > 0) {
    e.fearT -= dt;
    e.atk = 0;
    e.vx = -dx / dist * sp; e.vy = -dy / dist * sp;
    e.x += e.vx * dt; e.y += e.vy * dt;
    return;
  }
  let move = sp;
  if (e.rootT > 0) { e.rootT -= dt; move = 0; }
  // Committed to an attack (charging, winding up, lunging, fuse): no regular movement.
  if (e.atk) move = 0;

  if (dist > stop) {
    const step = Math.min(move * dt, dist - stop);
    e.vx = dx / dist * move; e.vy = dy / dist * move;
    e.x += dx / dist * step; e.y += dy / dist * step;
  } else {
    e.vx = 0; e.vy = 0;
  }
  // Crowd control and cloaking interrupt attacks in progress.
  if (sp === 0 || blind) { e.atk = 0; return; }

  if (e.boss) updateBoss(e, dt);
  if (e.atk) {
    updateEnemyAttack(e, dx, dy, dist, dt);
    if (!e.alive || Game.state !== 'play') return;
  } else {
    const seen = onScreen(e);
    if (e.boss && seen && (e.patT -= dt) <= 0) {
      const list = e.phase2 ? d.patterns2 : d.patterns;
      e.patT = d.patternEvery * (e.phase2 ? 0.7 : 1) * (0.85 + Math.random() * 0.3);
      BOSS_PATTERNS[list[e.pat++ % list.length]](e);
    }
    if (d.attack && !e.atk) tryEnemyAttack(e, dist, seen, dt);
  }
  if (d.ranged && !d.attack) {
    if (!e.atk && dist <= stop + 6 && onScreen(e)) {
      e.shootCd -= dt;
      if (e.shootCd <= 0) {
        e.shootCd = 1 / d.shootRate * (e.enraged ? ENRAGE_CD : 1);
        e.burstLeft = e.boss ? Math.min(d.burst, 1 + Math.floor(r.threat / 10)) + (e.phase2 ? 1 : 0) : 1;
        e.burstT = 0;
      }
    }
    if (e.burstLeft > 0) {
      e.burstT -= dt;
      if (e.burstT <= 0) {
        e.burstT = 0.15;
        e.burstLeft--;
        spawnEnemyBullet(e.x, e.y, Math.atan2(dy, dx), d.projSpeed, e.dmg * (e.boss ? 0.5 : 1));
      }
    }
  } else if (!d.ranged && dist <= stop + 3) {
    e.atkCd -= dt;
    if (e.atkCd <= 0) {
      e.atkCd = 1;
      damagePlayer(e.dmg);
    }
  } else {
    // Stepping out of reach resets the swing, so moving away actually avoids the hit.
    e.atkCd = Math.max(e.atkCd, 0.35);
  }
}

// Ranged attacks only start from enemies the player can see, so nothing hits from off-screen.
function onScreen(e) {
  return e.x > Render.camX && e.x < Render.camX + Render.viewW && e.y > Render.camY && e.y < Render.camY + Render.viewH;
}

// ---------- Enemy special attacks ----------

const ATK_LASER = 1, ATK_WINDUP = 2, ATK_LUNGE = 3, ATK_SHOCK = 4, ATK_FUSE = 5;

function tryEnemyAttack(e, dist, seen, dt) {
  const d = e.def;
  const reach = d.ranged ? d.ranged + 6 : d.trigger;
  if (!seen || dist > reach) return;
  if (d.attack === 'bomb') { e.atk = ATK_FUSE; e.atkT = d.fuse; return; }
  if ((e.shootCd -= dt) > 0) return;
  e.shootCd = d.cd * (e.enraged ? ENRAGE_CD : 1) * (0.85 + Math.random() * 0.3);
  const a = Math.atan2(player.y - e.y, player.x - e.x);
  switch (d.attack) {
    case 'laser':
      startLaser(e, { charge: d.charge, lock: d.lock, w: d.beamW, len: d.beamLen, dur: d.beamDur, dmg: e.dmg * d.beamDmg, n: 1, spread: 0, sweep: 0 });
      break;
    case 'mortar':
      // Leads the player a little, so walking in a straight line is not enough.
      hazards.push({
        x: player.x + player.vx * d.delay * 0.5, y: player.y + player.vy * d.delay * 0.5,
        r: d.blastR, t: d.delay, maxT: d.delay, dmg: e.dmg * d.blastDmg, owner: e.id, sx: e.x, sy: e.y,
      });
      break;
    case 'spread':
      for (let k = 0; k < d.n; k++) spawnEnemyBullet(e.x, e.y, a - d.fan / 2 + d.fan * k / (d.n - 1), d.projSpeed, e.dmg);
      break;
    case 'charge':
      e.atk = ATK_WINDUP; e.atkT = d.windup; e.aimA = a;
      break;
  }
}

// z: { charge, lock, w, len, dur, dmg, n, spread, sweep }. The aim tracks the player until `lock`
// seconds before firing; n beams fan out by `spread`; sweep > 0 rotates the beam through that arc.
function startLaser(e, z) {
  e.atk = ATK_LASER;
  e.atkT = z.charge;
  e.aimA = Math.atan2(player.y - e.y, player.x - e.x);
  z.dir = Math.random() < 0.5 ? -1 : 1;
  e.lz = z;
}

function fireLaser(e) {
  const z = e.lz;
  for (let k = 0; k < z.n; k++) {
    let a = e.aimA + (k - (z.n - 1) / 2) * z.spread, va = 0;
    if (z.sweep) { a -= z.sweep / 2 * z.dir; va = z.sweep * z.dir / z.dur; }
    beams.push({ x: e.x, y: e.y, a, va, len: z.len, w: z.w, t: z.dur, maxT: z.dur, dmg: z.dmg, hit: false, owner: e.id });
  }
  Sfx.laser(z.w > 20);
}

function updateEnemyAttack(e, dx, dy, dist, dt) {
  const d = e.def;
  e.atkT -= dt;
  switch (e.atk) {
    case ATK_LASER:
      if (e.atkT > e.lz.lock) e.aimA = Math.atan2(dy, dx);
      if (e.atkT <= 0) { e.atk = 0; fireLaser(e); }
      break;
    case ATK_WINDUP:
      if (e.atkT <= 0) { e.atk = ATK_LUNGE; e.atkT = d.dashTime; e.hitDone = false; }
      break;
    case ATK_LUNGE: {
      e.vx = Math.cos(e.aimA) * d.dashSpeed; e.vy = Math.sin(e.aimA) * d.dashSpeed;
      e.x += e.vx * dt; e.y += e.vy * dt;
      const rr = PLAYER_R + e.r;
      if (!e.hitDone && dist2(e.x, e.y, player.x, player.y) < rr * rr) {
        e.hitDone = true;
        damagePlayer(e.dmg * d.hitDmg);
      }
      if (e.atkT <= 0) e.atk = 0;
      break;
    }
    case ATK_SHOCK:
      if (e.atkT <= 0) { e.atk = 0; releaseShockwave(e); }
      break;
    case ATK_FUSE:
      if (e.atkT > 0) break;
      e.atk = 0;
      e.alive = false;
      Sfx.boom(false);
      burst(e.x, e.y, d.color, 14, 220);
      addRing(e.x, e.y, d.blastR, 'rgba(255,212,59,0.45)');
      if (dist2(e.x, e.y, player.x, player.y) < (d.blastR + PLAYER_R * 0.5) ** 2) damagePlayer(e.dmg * d.blastDmg);
      break;
  }
}

function releaseShockwave(e) {
  const n = 1 + Math.min(2, Math.floor(Game.run.threat / 10));
  for (let k = 0; k < n; k++) {
    waves.push({ x: e.x, y: e.y, r: e.r, speed: 270, w: 26, maxR: 1100, delay: k * 0.6, dmg: e.dmg * 1.2, hit: false, owner: e.id });
  }
  Sfx.boom(true);
}

// ---------- Boss patterns ----------

// Below BOSS_PHASE2 HP the boss enrages once: faster, and from then on it uses patterns2 at a quicker pace.
// Spirals and volleys are streamed over several frames from here.
function updateBoss(e, dt) {
  if (!e.phase2 && e.hp < e.maxHp * BOSS_PHASE2) {
    e.phase2 = true;
    e.speed *= 1.25;
    e.patT = 0.6;
    e.pat = 0;
    addText(e.x, e.y - e.r - 30, `${e.def.name.toUpperCase()} IS ENRAGED`, '#ff6b6b');
    addRing(e.x, e.y, e.r + 120, 'rgba(255,60,60,0.35)');
    Sfx.bossIncoming();
  }
  if (e.spiralT > 0) {
    e.spiralT -= dt;
    if ((e.spiralTick -= dt) <= 0) {
      e.spiralTick += 0.09;
      const arms = e.phase2 ? 4 : 3;
      for (let k = 0; k < arms; k++) spawnEnemyBullet(e.x, e.y, e.spiralA + k * Math.PI * 2 / arms, 190, e.dmg * 0.45);
      e.spiralA += 0.21 * e.spiralDir;
    }
  }
  if (e.volleyN > 0 && (e.volleyT -= dt) <= 0) {
    e.volleyN--;
    e.volleyT = 0.28;
    const n = e.phase2 ? 9 : 7, fan = 0.9, a = Math.atan2(player.y - e.y, player.x - e.x);
    for (let k = 0; k < n; k++) spawnEnemyBullet(e.x, e.y, a - fan / 2 + fan * k / (n - 1), 260, e.dmg * 0.5);
  }
}

const BOSS_PATTERNS = {
  nova: bossNova,
  slam: bossSlam,
  // Rotating arms of bullets: walk around the boss with the gaps.
  spiral(e) {
    e.spiralT = e.phase2 ? 3 : 2.2;
    e.spiralA = Math.random() * Math.PI * 2;
    e.spiralDir = Math.random() < 0.5 ? -1 : 1;
    e.spiralTick = 0;
  },
  // Several quick fans aimed at the player.
  volley(e) {
    e.volleyN = e.phase2 ? 4 : 3;
    e.volleyT = 0.2;
  },
  // A telegraphed lunge along a line through the player.
  charge(e) {
    e.atk = ATK_WINDUP;
    e.atkT = e.def.windup * (e.phase2 ? 0.75 : 1);
    e.aimA = Math.atan2(player.y - e.y, player.x - e.x);
  },
  // A ring of adds around the boss; in the second phase one of them is an elite.
  summon(e) {
    const r = Game.run, n = Math.min(8, 3 + Math.floor(r.threat / 6));
    for (let k = 0; k < n; k++) {
      const a = k * Math.PI * 2 / n;
      spawnEnemy(pickEnemyType(r.threat), e.x + Math.cos(a) * (e.r + 40), e.y + Math.sin(a) * (e.r + 40), k === 0 && e.phase2);
    }
    addRing(e.x, e.y, e.r + 60, 'rgba(230,73,128,0.35)');
  },
  // Thick tracking lasers; more of them, fanned out, in later stages.
  laser(e) {
    const n = 1 + Math.min(2, Math.floor(Game.run.threat / 8));
    startLaser(e, { charge: 1.5, lock: 0.4, w: 34, len: 1300, dur: 0.35, dmg: e.dmg * 2.2, n, spread: 0.45, sweep: 0 });
  },
  // A beam that sweeps through a wide arc: outrun its edge or dash through it.
  sweep(e) {
    startLaser(e, { charge: 1.3, lock: 0.6, w: 26, len: 1200, dur: 1.4, dmg: e.dmg * 1.6, n: 1, spread: 0, sweep: 2.4 });
  },
  // Expanding rings faster than the player: dash through them with the invulnerability window.
  shockwave(e) {
    e.atk = ATK_SHOCK;
    e.atkT = 0.9;
  },
  // One huge slam on the player.
  quake(e) {
    hazards.push({ x: player.x, y: player.y, r: 230, t: 1.7, maxT: 1.7, dmg: e.dmg * 2, owner: e.id });
  },
  // Many small blasts around the player, landing one after another.
  meteors(e) {
    const n = 6 + Math.min(6, Math.floor(Game.run.threat / 4));
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, off = k ? 60 + Math.random() * 280 : 0;
      const t = 0.8 + k * 0.15 + Math.random() * 0.3;
      hazards.push({ x: player.x + Math.cos(a) * off, y: player.y + Math.sin(a) * off, r: 70, t, maxT: t, dmg: e.dmg * 1.1, owner: e.id });
    }
  },
};

// A ring of slow bullets with a gap, aimed so the gap is not always in the same place.
function bossNova(e) {
  const d = e.def;
  const n = d.novaBullets + Math.min(12, Math.floor(Game.run.threat / 3));
  const a0 = Math.random() * Math.PI * 2;
  for (let k = 0; k < n; k++) {
    if (k % Math.ceil(n / 3) === 0) continue;
    spawnEnemyBullet(e.x, e.y, a0 + k * Math.PI * 2 / n, d.novaSpeed, e.dmg * 0.6);
  }
  addRing(e.x, e.y, e.r + 20, 'rgba(229,153,247,0.4)');
}

// Telegraphed slams at (and later also around) the player's position. Leaving the circle avoids them.
function bossSlam(e) {
  const d = e.def;
  const count = 1 + Math.min(2, Math.floor(Game.run.threat / 10));
  for (let k = 0; k < count; k++) {
    const off = k ? 90 + Math.random() * 60 : 0, a = Math.random() * Math.PI * 2;
    hazards.push({ x: player.x + Math.cos(a) * off, y: player.y + Math.sin(a) * off, r: d.slamR, t: d.slamDelay, maxT: d.slamDelay, dmg: e.dmg * 1.5, owner: e.id });
  }
}

function updateHazards(dt) {
  for (let i = hazards.length - 1; i >= 0; i--) {
    const h = hazards[i];
    if ((h.t -= dt) > 0) continue;
    hazards.splice(i, 1);
    addRing(h.x, h.y, h.r, 'rgba(255,107,107,0.45)');
    Sfx.boom(h.r > 150);
    // Glowing Meteorite blasts hit enemies as well as the player.
    if (h.foeDmg) pushEvent({ t: 'explode', x: h.x, y: h.y, r: h.r, dmg: h.foeDmg, w: null, direct: false, color: 'rgba(116,192,252,0.4)', depth: 1 });
    const rr = h.r + PLAYER_R * 0.5;
    if (dist2(h.x, h.y, player.x, player.y) < rr * rr) damagePlayer(h.dmg);
    if (Game.state !== 'play') return;
  }
}

function updateBeams(dt) {
  const ghost = intangible();
  for (let i = beams.length - 1; i >= 0; i--) {
    const b = beams[i];
    b.a += b.va * dt;
    if (!b.hit && !ghost) {
      const ox = player.x - b.x, oy = player.y - b.y;
      const ux = Math.cos(b.a), uy = Math.sin(b.a);
      const along = ox * ux + oy * uy;
      if (along > 0 && along < b.len && Math.abs(ox * uy - oy * ux) < b.w / 2 + PLAYER_R * 0.6) {
        b.hit = true;
        damagePlayer(b.dmg);
        if (Game.state !== 'play') return;
      }
    }
    if ((b.t -= dt) <= 0) beams.splice(i, 1);
  }
}

function updateWaves(dt) {
  const ghost = intangible();
  for (let i = waves.length - 1; i >= 0; i--) {
    const w = waves[i];
    if (w.delay > 0) { w.delay -= dt; continue; }
    w.r += w.speed * dt;
    if (!w.hit && !ghost && Math.abs(Math.sqrt(dist2(w.x, w.y, player.x, player.y)) - w.r) < w.w / 2 + PLAYER_R * 0.6) {
      w.hit = true;
      damagePlayer(w.dmg);
      if (Game.state !== 'play') return;
    }
    if (w.r > w.maxR) waves.splice(i, 1);
  }
}

function separateEnemies() {
  for (let c = 0; c < grid.length; c++) {
    const cell = grid[c];
    const len = Math.min(cell.length, 24);
    for (let i = 0; i < len; i++) {
      const a = cell[i];
      for (let j = i + 1; j < len; j++) {
        const b = cell[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const rr = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 < 0.0001) continue;
        const d = Math.sqrt(d2);
        const push = (rr - d) * 0.25 / d;
        const wa = a.boss ? 0.1 : 1, wb = b.boss ? 0.1 : 1;
        a.x -= dx * push * wa; a.y -= dy * push * wa;
        b.x += dx * push * wb; b.y += dy * push * wb;
      }
    }
  }
  // Enemies are solid: the player and an overlapping enemy push each other apart, so crowds can trap
  // you. Dashing and Shadowfade pass straight through.
  if (player.dashT > 0 || Game.run.shadowT > 0) return;
  let px = 0, py = 0;
  for (const e of queryRadius(player.x, player.y, PLAYER_R)) {
    const dx = e.x - player.x, dy = e.y - player.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const o = PLAYER_R + e.r - d;
    if (o <= 0) continue;
    const we = e.boss ? 0.1 : 0.5;
    e.x += dx / d * o * we; e.y += dy / d * o * we;
    px -= dx / d * o * (1 - we); py -= dy / d * o * (1 - we);
  }
  const pl = Math.sqrt(px * px + py * py);
  if (pl > 8) { px *= 8 / pl; py *= 8 / pl; }
  player.x = Math.max(PLAYER_R, Math.min(WORLD_W - PLAYER_R, player.x + px));
  player.y = Math.max(PLAYER_R, Math.min(WORLD_H - PLAYER_R, player.y + py));
  pushOutOfRocks(player, PLAYER_R);
}

function spawnEnemyBullet(x, y, a, speed, dmg) {
  if (ebullets.length >= MAX_EBULLETS) return;
  const b = ebulletFree.pop() || {};
  b.x = x; b.y = y; b.vx = Math.cos(a) * speed; b.vy = Math.sin(a) * speed; b.dmg = dmg; b.life = 6;
  ebullets.push(b);
}

function updateEnemyBullets(dt) {
  const hitR = PLAYER_R + 2;
  const ghost = intangible();
  for (let i = ebullets.length - 1; i >= 0; i--) {
    const b = ebullets[i];
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    let dead = b.life <= 0;
    if (!dead && !ghost && dist2(b.x, b.y, player.x, player.y) < hitR * hitR) {
      dead = true;
      damagePlayer(b.dmg);
      if (Game.state !== 'play') return;
    }
    if (dead) {
      ebullets[i] = ebullets[ebullets.length - 1];
      ebullets.pop();
      ebulletFree.push(b);
    }
  }
}

// ---------- Loot ----------

function updateLoot(dt) {
  const S = Game.run.stats;
  const pr2 = S.pickup * S.pickup;
  const r = Game.run;
  // Heal nuggets fly to the player inside the pickup range; antler orbs must be walked over.
  // Coins wait while t < 0, then home in with growing speed from anywhere.
  for (let i = orbs.length - 1; i >= 0; i--) {
    const o = orbs[i];
    const dx = player.x - o.x, dy = player.y - o.y, d2 = dx * dx + dy * dy;
    const d = Math.sqrt(d2) || 1;
    if (o.kind === 'gold') {
      if ((o.t += dt) < 0) {
        const f = Math.max(0, 1 - 7 * dt);
        o.vx *= f; o.vy *= f;
        o.x += o.vx * dt; o.y += o.vy * dt;
        continue;
      }
      const step = Math.min(d, (350 + 1400 * o.t) * dt);
      if (d - step < PLAYER_R * 0.6) {
        gainGold(o.v);
        Sfx.coin();
        coinCount--;
        orbs[i] = orbs[orbs.length - 1];
        orbs.pop();
        continue;
      }
      o.x += dx / d * step;
      o.y += dy / d * step;
      continue;
    }
    if (o.kind === 'antler') {
      const gone = (o.t -= dt) <= 0;
      if (d < PLAYER_R + 12) {
        r.antlerN = Math.min(3 * (S.core.antlers || 1), r.antlerN + 1);
        r.antlerT = 12;
        Sfx.pickup();
      }
      if (gone || d < PLAYER_R + 12) { orbs[i] = orbs[orbs.length - 1]; orbs.pop(); }
      continue;
    }
    if (!o.magnet && d2 > pr2) continue;
    o.magnet = true;
    if (d < 20) {
      heal(o.v);
      orbs[i] = orbs[orbs.length - 1];
      orbs.pop();
      continue;
    }
    o.x += dx / d * 600 * dt;
    o.y += dy / d * 600 * dt;
  }
  // Item drops pop out of the enemy, then wait on the ground until the player touches them.
  // Equipment is only picked up by walking over it while the slot is empty; otherwise E swaps it.
  const reach = PLAYER_R + 16;
  for (let i = drops.length - 1; i >= 0; i--) {
    const c = drops[i];
    c.t += dt;
    if (c.vx || c.vy) {
      c.x = Math.max(20, Math.min(WORLD_W - 20, c.x + c.vx * dt));
      c.y = Math.max(20, Math.min(WORLD_H - 20, c.y + c.vy * dt));
      pushOutOfRocks(c, 18);
      const f = Math.max(0, 1 - 6 * dt);
      c.vx *= f; c.vy *= f;
      if (Math.abs(c.vx) + Math.abs(c.vy) < 2) c.vx = c.vy = 0;
    }
    if (c.t < 0.3 || dist2(c.x, c.y, player.x, player.y) > reach * reach) continue;
    if (c.tier === EQUIP_TIER && r.equip.id) continue;
    drops.splice(i, 1);
    collectDrop(c);
  }
}

// Legendaries stay out of the pool until ~5.5 min, then ramp slowly so a strong run finds about
// 1-2 by 20 min from random drops, plus the guaranteed one from the first boss after GUARANTEED_RED_TIME.
function rollItemTier(threat, luck) {
  const lm = 1 + luck / 100;
  const pLeg = Math.max(0, threat - 9.25) * 0.0013 * lm;
  const pUnc = Math.min(0.5, 0.15 + (threat - 1) * 0.04) * lm;
  const pLun = threat >= 3 ? 0.03 : 0;
  const pVoid = threat >= 5 ? 0.02 : 0;
  if (Math.random() < EQUIP_DROP_CHANCE) return EQUIP_TIER;
  const x = Math.random();
  if (x < pLeg) return 2;
  if (x < pLeg + pLun) return 3;
  if (x < pLeg + pLun + pVoid) return 5;
  if (x < pLeg + pLun + pVoid + pUnc) return 1;
  return 0;
}

function randomItemOfTier(tier) {
  const list = ITEMS.filter(i => i.tier === tier);
  return list[(Math.random() * list.length) | 0];
}

// Chance Doll and Eulogy Zero apply to both ground drops and chests.
function modifyTier(tier) {
  const c = Game.run.stats.core;
  if (c.chancedoll && tier === 0 && roll(0.15 * c.chancedoll)) tier = 1;
  if (c.eulogy && tier !== 3 && tier !== EQUIP_TIER && Math.random() < 0.05 * c.eulogy) tier = 3;
  return tier;
}

function rollDropTier() {
  const r = Game.run;
  return modifyTier(rollItemTier(r.threat, r.stats.luck));
}

// Up to ITEM_CHOICES distinct random items of a tier (never the equipment already held).
function rollItemChoices(tier) {
  const pool = ITEMS.filter(i => i.tier === tier && i.id !== Game.run.equip.id);
  const out = [];
  while (out.length < ITEM_CHOICES && pool.length) out.push(pool.splice((Math.random() * pool.length) | 0, 1)[0]);
  return out;
}

// ---------- FX ----------

function burst(x, y, color, n, speed) {
  for (let i = 0; i < n; i++) {
    if (particles.length >= MAX_PARTICLES) return;
    const p = particleFree.pop() || {};
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.3 + Math.random() * 0.7);
    p.x = x; p.y = y; p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s;
    p.life = p.maxLife = 0.25 + Math.random() * 0.3;
    p.color = color;
    p.size = 2 + Math.random() * 3;
    particles.push(p);
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      particles[i] = particles[particles.length - 1];
      particles.pop();
      particleFree.push(p);
      continue;
    }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 0.92; p.vy *= 0.92;
  }
  for (let i = texts.length - 1; i >= 0; i--) {
    const t = texts[i];
    t.life -= dt;
    t.y -= 40 * dt;
    if (t.life <= 0) { texts[i] = texts[texts.length - 1]; texts.pop(); }
  }
  for (let i = fxLines.length - 1; i >= 0; i--) {
    fxLines[i].life -= dt;
    if (fxLines[i].life <= 0) { fxLines[i] = fxLines[fxLines.length - 1]; fxLines.pop(); }
  }
  for (let i = fxRings.length - 1; i >= 0; i--) {
    fxRings[i].life -= dt;
    if (fxRings[i].life <= 0) { fxRings[i] = fxRings[fxRings.length - 1]; fxRings.pop(); }
  }
}

function addDmgText(x, y, dmg, crit) {
  if (texts.length >= MAX_TEXTS) return;
  texts.push({ x: x + (Math.random() - 0.5) * 16, y, s: dmg >= 10 ? Math.round(dmg).toString() : dmg.toFixed(1), color: crit ? '#ffd43b' : '#ffffff', life: 0.5, big: crit });
}

function addText(x, y, s, color) {
  if (texts.length >= MAX_TEXTS) texts.shift();
  texts.push({ x, y, s, color, life: 0.8, big: true });
}

function addLine(x1, y1, x2, y2, color) {
  if (fxLines.length > 300) return;
  fxLines.push({ x1, y1, x2, y2, color, life: 0.1 });
}

function addBeam(x1, y1, x2, y2, color) {
  fxLines.push({ x1, y1, x2, y2, color, life: 0.25, beam: true });
}

function addRing(x, y, r, color) {
  if (fxRings.length > 200) return;
  fxRings.push({ x, y, r, color, life: 0.2 });
}

function dist2(x1, y1, x2, y2) {
  const dx = x1 - x2, dy = y1 - y2;
  return dx * dx + dy * dy;
}

// ---------- Main update ----------

function update(dt) {
  const r = Game.run;
  if (r.travelQueued) {
    r.travelQueued = false;
    travelToNextMap();
  }
  r.time += dt;
  r.coeff = computeCoeff(r);
  r.threat = threatForCoeff(r.coeff);
  if (r.fadeT > 0) r.fadeT -= dt * 1.5;
  if (r.mapTitleT > 0) r.mapTitleT -= dt;
  r.dropHeat = Math.max(0, r.dropHeat - dt / 30);
  if ((r.minuteT -= dt) <= 0) {
    r.minuteT += 60;
    minuteTick();
  }
  // Unstable Watch: enemies, their projectiles and their telegraphed attacks are paused.
  const frozen = r.buffT.unstablewatch > 0;
  updateSpawner(dt);
  updateMovement(dt);
  updatePlayer(dt);
  if (Game.state !== 'play') return;
  updateEquipment(dt);
  updateMovementItems(dt);
  updateEnemies(dt, frozen);
  if (Game.state !== 'play') return;
  collideEnemiesWithRocks(dt);
  rebuildGrid();
  separateEnemies();
  updateTeleporter(dt);
  if (!frozen) {
    updateHazards(dt);
    if (Game.state !== 'play') return;
    updateBeams(dt);
    if (Game.state !== 'play') return;
    updateWaves(dt);
    if (Game.state !== 'play') return;
  }
  updateGadgets(dt);
  updateInteract(dt);
  updateZones(dt);
  updateWeapons(dt);
  updateAllies(dt);
  updateMines(dt);
  updateDelayed(dt);
  updateBullets(dt);
  processEvents();
  if (Game.state !== 'play') return;
  if (!frozen) updateEnemyBullets(dt);
  if (Game.state !== 'play') return;
  updateLoot(dt);
  updateParticles(dt);
}

let lastT = performance.now();
let fpsAcc = 0, fpsFrames = 0;

function frame(t) {
  let dt = (t - lastT) / 1000;
  lastT = t;
  fpsAcc += dt; fpsFrames++;
  if (fpsAcc >= 0.5) { Game.fps = Math.round(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; }
  dt = Math.min(dt, 1 / 30);
  if (!Game.paused && Game.state === 'play') {
    Render.updateCamera();
    Game.mouse.x = Render.camX + Game.mouse.sx / Render.scale;
    Game.mouse.y = Render.camY + Game.mouse.sy / Render.scale;
    for (let i = 0; i < Game.speed && Game.state === 'play'; i++) update(dt);
    if (Game.state === 'play' && Game.run.itemChoices.length) UI.openItemPick();
    if (Game.state === 'play') UI.tickHud();
  }
  Render.draw();
  requestAnimationFrame(frame);
}
