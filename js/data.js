'use strict';

// Maps are played in order and loop. Each one is much larger than the view; the camera follows the player.
// rocks: block movement; patch/speck: ground decoration colours.
const MAPS = [
  { name: 'Distant Roost', w: 4400, h: 2800, ground: '#141c17', patch: '#1a271e', speck: '#2b3d2f', rock: '#4a5a4c', rockEdge: '#2a332b', glow: 'rgba(120,200,140,0.07)' },
  { name: 'Scorched Acres', w: 4600, h: 2800, ground: '#1e1712', patch: '#2a1f16', speck: '#4a3524', rock: '#6b5038', rockEdge: '#3a2a1d', glow: 'rgba(255,150,60,0.07)' },
  { name: 'Abandoned Aqueduct', w: 4200, h: 3000, ground: '#1f1b13', patch: '#2b2618', speck: '#4d4429', rock: '#7a6a48', rockEdge: '#40381f', glow: 'rgba(255,220,120,0.06)' },
  { name: 'Rallypoint Delta', w: 4600, h: 3000, ground: '#151b23', patch: '#1c2530', speck: '#3a4a5c', rock: '#6a7d92', rockEdge: '#34404d', glow: 'rgba(160,210,255,0.08)' },
  { name: 'Abyssal Depths', w: 4400, h: 3000, ground: '#1b1012', patch: '#26151a', speck: '#4a2229', rock: '#663339', rockEdge: '#331a1e', glow: 'rgba(255,80,80,0.07)' },
  { name: 'Sky Meadow', w: 4600, h: 2800, ground: '#12171f', patch: '#18202c', speck: '#2d3f4f', rock: '#56607e', rockEdge: '#2c3247', glow: 'rgba(180,140,255,0.07)' },
];
const MAX_WORLD_W = Math.max(...MAPS.map(m => m.w));
const MAX_WORLD_H = Math.max(...MAPS.map(m => m.h));
// Size of the current map, set when a map loads.
let WORLD_W = MAPS[0].w;
let WORLD_H = MAPS[0].h;
// Logical view size; the canvas is scaled so at least this much of the world is visible.
const VIEW_W = 1600;
const VIEW_H = 900;
// The minimap starts covered in fog; it clears within this radius of the player, and chests, shrines,
// ground items and the teleporter appear on it once they have been inside that radius.
const MAP_REVEAL_R = 750;
// Teleporter: charge zone radius, enemy spawn rate multiplier while it charges, extra boss per this many maps.
const TELEPORTER_R = 520;
const TELEPORTER_SPAWN_MULT = 1.4;
const MAPS_PER_EXTRA_BOSS = 3;
// Difficulty coefficient: +TIME_DIFFICULTY per minute, compounding ×MAP_DIFFICULTY per cleared map.
const TIME_DIFFICULTY = 0.3;
const MAP_DIFFICULTY = 1.15;
// Boss HP multiplier on top of normal enemy scaling, and the HP fraction where they enter their second phase.
const BOSS_HP_MULT = 1;
const BOSS_PHASE2 = 0.5;
// Items offered when a chest is opened.
const ITEM_CHOICES = 3;
// The first boss killed after this many seconds drops a guaranteed Legendary item.
const GUARANTEED_RED_TIME = 600;
// Kills are near-constant, so on-kill buff items only trigger on this chance.
const KILL_BUFF_CHANCE = 0.2;
// Base chance for a normal enemy to drop an item on the ground (elites: ELITE_ITEM_DROP_CHANCE).
const ITEM_DROP_CHANCE = 0.0138;
const ELITE_ITEM_DROP_CHANCE = 0.29;
// Scales the HP of every non-boss enemy (bosses use BOSS_HP_MULT).
const ENEMY_HP_MULT = 0.8;
// Scales the enemy spawn rate at every threat level.
const SPAWN_RATE_MULT = 0.8;

const PLAYER_R = 18;
const DASH_TIME = 0.15;
const DASH_DIST = 160;
// Weapons upgrade to the next tier when the player reaches these levels.
const WEAPON_TIER_LEVELS = [1, 6, 14, 24];

// Balance-testing knobs, editable on the run start screen.
const DEFAULT_SETTINGS = {
  enemyDrops: true,
  itemDropMult: 1,
  goldMult: 1,
  chestCostMult: 1,
  mapChests: 12,
  shrineCount: 2,
  teleporterCharge: 60,
  enrageSeconds: 25,
  enemyHp: 1,
  enemyDmg: 1,
  enemySpeed: 1,
  playerDmg: 1,
  playerHp: 1,
  moveSpeed: 1,
  dashCooldown: 1,
  dashIframes: 0.3,
  wavePacing: true,
  waveCycle: 60,
  surgeSeconds: 12,
  breatherSeconds: 12,
  surgeMult: 2.2,
  // Equipment id the run starts with ('' = none) and a multiplier on equipment cooldowns.
  startEquip: '',
  equipCdMult: 1,
};

// weapons is the default starting loadout (overridable per run in settings.loadouts).
// dmgMult scales all damage; gold/pickup/cdMult are utility perks; drone adds a permanent drone.
const CHARACTERS = [
  {
    id: 'vanguard', name: 'Vanguard', role: 'Balanced', color: '#74c0fc',
    weapons: ['rifle'],
    hp: 110, regen: 0.6, armor: 5, speed: 175, dmgMult: 1, crit: 0,
    dashCharges: 1, dashCd: 2.5,
    desc: 'All-rounder with a steady automatic rifle, decent HP and some armor.',
  },
  {
    id: 'deadeye', name: 'Deadeye', role: 'Glass Cannon', color: '#f783ac',
    weapons: ['marksman'],
    hp: 60, regen: 0.3, armor: 0, speed: 190, dmgMult: 1.3, crit: 10,
    dashCharges: 2, dashCd: 2.2,
    desc: 'Precise long-range shots, +30% damage and +10% crit, but very fragile. Keep your distance and keep moving.',
  },
  {
    id: 'bulwark', name: 'Bulwark', role: 'Tank', color: '#ffa94d',
    weapons: ['shotgun'],
    hp: 200, regen: 2, armor: 20, speed: 155, dmgMult: 1, crit: 0,
    dashCharges: 1, dashCd: 3.5,
    desc: 'Close-range brawler with lots of HP, armor and regen. Wade into the swarm and blast it apart.',
  },
  {
    // turrets: the loadout weapons are mobile turrets that roam around the character instead of guns on its body.
    id: 'engineer', name: 'Engineer', role: 'Turrets', color: '#fab005',
    weapons: ['gauss', 'gauss'], turrets: true,
    hp: 130, regen: 1, armor: 10, speed: 160, dmgMult: 1, crit: 0,
    dashCharges: 1, dashCd: 3,
    desc: 'Carries no gun. Two mobile Gauss Turrets roam around him and fire on their own, with all of his items. Set each turret\'s targeting in the HUD.',
  },
];
const CHARACTER_BY_ID = Object.fromEntries(CHARACTERS.map(c => [c.id, c]));
// Debug loadouts: per character, weapon id -> starting copies.
DEFAULT_SETTINGS.loadouts = Object.fromEntries(CHARACTERS.map(c => {
  const lo = {};
  for (const w of c.weapons) lo[w] = (lo[w] || 0) + 1;
  return [c.id, lo];
}));
// Weapons a loadout may hold in total; more do not fit around the player.
const MAX_WEAPONS = 8;

// cost is the price at difficulty 1; prices scale with difficulty. tiers: [item tier, weight].
// minThreat: earliest threat level the chest can be rolled at. weight 0: never rolled as a random chest.
// shrine: Shrine of Chance - each use costs more and pays out an item with `chance`, at most `wins` times.
const CHESTS = {
  small: { name: 'Chest', cost: 30, color: '#c9a36b', w: 30, h: 22, weight: 10, minThreat: 1, tiers: [[0, 79], [1, 20], [2, 1]] },
  large: { name: 'Large Chest', cost: 75, color: '#69db7c', w: 40, h: 28, weight: 3, minThreat: 3, tiers: [[1, 80], [2, 20]] },
  legendary: { name: 'Legendary Chest', cost: 240, color: '#ff6b6b', w: 46, h: 32, weight: 0.6, minThreat: 10, tiers: [[2, 100]] },
  equipment: { name: 'Equipment Barrel', cost: 35, color: '#ff922b', w: 26, h: 32, weight: 2.5, minThreat: 1, tiers: [[6, 100]] },
  shrine: {
    name: 'Shrine of Chance', cost: 20, color: '#a5d8ff', w: 26, h: 44, weight: 0, minThreat: 1, tiers: [[0, 70], [1, 26], [2, 4]],
    shrine: true, chance: 0.45, wins: 2, priceGrowth: 1.4,
  },
};

// Boss items only drop from bosses. Void items corrupt (replace) their counterpart item.
// Equipment (EQUIP_TIER) sits in its own slot and is activated with Shift.
const TIER_COLORS = ['#e9ecef', '#69db7c', '#ff6b6b', '#74c0fc', '#ffd43b', '#cc5de8', '#ff922b'];
const TIER_NAMES = ['Common', 'Uncommon', 'Legendary', 'Lunar', 'Boss', 'Void', 'Equipment'];
const EQUIP_TIER = 6;
// Chance for a random item drop to be equipment instead.
const EQUIP_DROP_CHANCE = 0.04;
const WEAPON_TIER_COLORS = ['#e9ecef', '#74c0fc', '#da77f2', '#ff6b6b'];
// Tier multipliers, applied automatically as the player levels up (WEAPON_TIER_LEVELS).
const WEAPON_TIER_NAMES = ['I', 'II', 'III', 'IV'];
const WEAPON_TIER_DMG = [1, 1.6, 2.5, 3.8];
const WEAPON_TIER_RATE = [1, 1.1, 1.2, 1.35];

// [min difficulty coefficient, label, color], shown in the HUD like Risk of Rain's difficulty bar.
const DIFFICULTY_TIERS = [
  [0, 'EASY', '#69db7c'],
  [2, 'MEDIUM', '#a9e34b'],
  [3, 'HARD', '#ffd43b'],
  [4.5, 'VERY HARD', '#ffa94d'],
  [6.5, 'INSANE', '#ff6b6b'],
  [9, 'IMPOSSIBLE', '#f03e3e'],
  [13, 'I SEE YOU', '#c92a2a'],
  [18, "I'M COMING FOR YOU", '#a61e4d'],
  [24, 'HAHAHAHA', '#862e9c'],
];

const TARGETING = [
  { id: 'closest', name: 'Closest' },
  { id: 'farthest', name: 'Farthest' },
  { id: 'weakest', name: 'Weakest (lvl)' },
  { id: 'strongest', name: 'Strongest (lvl)' },
  { id: 'lowhp', name: 'Lowest HP' },
  { id: 'highhp', name: 'Highest HP' },
  { id: 'ranged', name: 'Ranged first' },
  { id: 'manual', name: 'Manual (mouse)' },
];

// proc: RoR-style proc coefficient, scales on-hit item chances. Weapons only come from character loadouts.
const WEAPONS = {
  // Ballistic weapons
  smg: {
    name: 'Buzz SMG', color: '#63e6be', kind: 'bullet',
    dmg: 2.6, rate: 11.2, range: 340, speed: 900, count: 1, spread: 0, jitter: 0.16,
    pierce: 0, size: 3, proc: 0.3, barrel: 20, width: 5,
    desc: 'Very high fire rate, low damage, inaccurate. Great proc spreader at short range.',
  },
  rifle: {
    name: 'Pulse Rifle', color: '#ffe066', kind: 'bullet',
    dmg: 5, rate: 5.6, range: 420, speed: 950, count: 1, spread: 0, jitter: 0.06,
    pierce: 0, size: 3, proc: 0.6, barrel: 26, width: 5,
    desc: 'Fast, accurate stream of bullets.',
  },
  marksman: {
    name: 'Marksman Rifle', color: '#a9e34b', kind: 'bullet',
    dmg: 16, rate: 1.75, range: 540, speed: 1400, count: 1, spread: 0, jitter: 0.02,
    pierce: 0, size: 3, proc: 0.8, critBonus: 5, barrel: 30, width: 5,
    desc: 'Semi-auto. Slow, precise shots with high damage per hit.',
  },
  sniper: {
    name: 'Longshot Sniper', color: '#f783ac', kind: 'bullet',
    dmg: 55, rate: 0.75, range: 760, speed: 2400, count: 1, spread: 0, jitter: 0,
    pierce: 2, size: 3, proc: 1, critMult: 2.5, critBonus: 15, barrel: 38, width: 4,
    desc: 'Very slow, very heavy shots. Pierces 2, +15% crit, x2.5 crits. Longest range.',
  },

  gauss: {
    name: 'Gauss Turret', color: '#fab005', kind: 'bullet',
    dmg: 7, rate: 2.4, range: 400, speed: 1150, count: 1, spread: 0, jitter: 0.04,
    pierce: 0, size: 3, proc: 1, barrel: 22, width: 6,
    desc: "Engineer's TR12 auto-turret. Steady, accurate shots with a full proc coefficient.",
  },

  // Special weapons
  shotgun: {
    name: 'Scatter Cannon', color: '#ffa94d', kind: 'bullet',
    dmg: 4, rate: 1.05, range: 280, speed: 760, count: 6, spread: 0.55, jitter: 0.08,
    pierce: 1, size: 3, proc: 0.35, barrel: 20, width: 9,
    desc: 'Short range pellet spread. Pierces 1 enemy.',
  },
  railgun: {
    name: 'Rail Lance', color: '#74c0fc', kind: 'bullet',
    dmg: 38, rate: 0.75, range: 700, speed: 2200, count: 1, spread: 0, jitter: 0,
    pierce: 4, size: 3, proc: 1, critMult: 3, critBonus: 10, barrel: 36, width: 4,
    desc: 'Pierces 4 enemies, x3 crits. Best against lined-up crowds.',
  },
  rocket: {
    name: 'Hornet Launcher', color: '#ff6b6b', kind: 'rocket',
    dmg: 10, rate: 0.6, range: 500, speed: 380, count: 1, spread: 0.25, jitter: 0.06,
    pierce: 0, size: 5, proc: 0.3, aoe: 55, barrel: 22, width: 10,
    desc: 'Slow explosive rockets (radius 55). Low proc coefficient. Manual: detonates at cursor.',
  },
  tesla: {
    name: 'Arc Coil', color: '#b197fc', kind: 'chain',
    dmg: 6, rate: 2.2, range: 320, count: 1, chains: 3, proc: 0.5, barrel: 14, width: 8,
    desc: 'Instant lightning that chains to 3 more enemies.',
  },
  flamer: {
    name: 'Inferno Nozzle', color: '#ff922b', kind: 'flame',
    dmg: 2, rate: 18, range: 190, speed: 430, count: 1, spread: 0, jitter: 0.45,
    pierce: 99, size: 7, proc: 0.15, burn: 0.5, barrel: 18, width: 9,
    desc: 'Short range cone of fire. Pierces everything, sets enemies on fire.',
  },
};

// scope 'weapon': applied per weapon (on-hit and weapon stats).
// scope 'core': affects the whole character.
// "base damage": character-wide item damage (100% = 10), scaled by damage stats and stage like Unstable Tesla Coil.
// corrupts: Void items replace every owned copy of that item.
// stack: how extra copies behave, required on every non-equipment item (the "stacking" column of the item sheet).
const ITEMS = [
  // Common
  { id: 'syringe', name: "Soldier's Syringe", icon: 'SY', tier: 0, scope: 'weapon', mods: { ratePct: 15 }, stack: '+15% attack speed per stack.', desc: '+15% attack speed (+15% per stack).' },
  { id: 'glasses', name: "Lens-Maker's Glasses", icon: 'LG', tier: 0, scope: 'weapon', mods: { crit: 10 }, stack: '+10% crit chance per stack.', desc: '+10% crit chance (+10% per stack).' },
  { id: 'tritip', name: 'Tri-Tip Dagger', icon: 'TT', tier: 0, scope: 'weapon', stack: '+10% bleed chance per stack.', desc: '10% (+10% per stack) chance on hit to bleed for 240% damage over 3s.' },
  { id: 'crowbar', name: 'Crowbar', icon: 'CB', tier: 0, scope: 'weapon', stack: '+75% damage to enemies above 90% HP per stack.', desc: '+75% (+75% per stack) damage to enemies above 90% HP.' },
  { id: 'focus', name: 'Focus Crystal', icon: 'FC', tier: 0, scope: 'weapon', stack: '+25% damage to nearby enemies per stack.', desc: '+25% (+25% per stack) damage to enemies within 220 of the shooter (you, or an Engineer turret).' },
  { id: 'apr', name: 'Armor-Piercing Rounds', icon: 'AP', tier: 0, scope: 'weapon', stack: '+30% damage to elites and bosses per stack.', desc: '+30% (+30% per stack) damage to elites and bosses.' },
  { id: 'sticky', name: 'Sticky Bomb', icon: 'SB', tier: 0, scope: 'weapon', stack: '+8% bomb chance per stack.', desc: '8% (+8% per stack) chance on hit to attach a bomb that explodes for 180% damage.' },
  { id: 'gasoline', name: 'Gasoline', icon: 'GA', tier: 0, scope: 'weapon', stack: '+30% explosion and +150% burn kill-damage per stack.', desc: 'Kills explode in radius 100 for 30% (+30% per stack) kill-damage and ignite enemies for 150% (+150% per stack) kill-damage burn.' },
  { id: 'tooth', name: 'Monster Tooth', icon: 'MT', tier: 0, scope: 'weapon', stack: '+1% max HP healed per kill per stack.', desc: 'Kills heal 1 HP + 1% (+1% per stack) max HP.' },
  { id: 'steak', name: 'Bison Steak', icon: 'BS', tier: 0, scope: 'core', mods: { maxHp: 20 }, stack: '+20 max HP per stack.', desc: '+20 max HP (+20 per stack).' },
  { id: 'slug', name: 'Cautious Slug', icon: 'CS', tier: 0, scope: 'core', mods: { regen: 1.2 }, stack: '+1.2 HP regen/s per stack.', desc: '+1.2 HP regen/s (+1.2 per stack).' },
  { id: 'tougher', name: 'Tougher Times', icon: 'TO', tier: 0, scope: 'core', stack: '+8% dodge chance per stack (hyperbolic).', desc: '8% (+8% per stack, hyperbolic) dodge chance.' },
  { id: 'plate', name: 'Repulsion Armor Plate', icon: 'RP', tier: 0, scope: 'core', mods: { armor: 4 }, stack: '+4 armor per stack.', desc: '+4 armor (+4 per stack).' },
  { id: 'pennies', name: 'Roll of Pennies', icon: 'RO', tier: 0, scope: 'core', mods: { xpPct: 15 }, stack: '+15% XP gain per stack.', desc: '+15% XP gain (+15% per stack).' },
  { id: 'mortar', name: 'Mortar Tube', icon: 'MO', tier: 0, scope: 'weapon', stack: '+170% mortar damage per stack.', desc: '9% chance on hit to lob a mortar that lands after 0.5s for 170% (+170% per stack) damage in radius 75.' },
  { id: 'stungren', name: 'Stun Grenade', icon: 'GR', tier: 0, scope: 'weapon', stack: '+5% stun chance per stack (hyperbolic).', desc: '5% (+5% per stack, hyperbolic) chance on hit to stun non-boss enemies for 2s.' },
  { id: 'taser', name: 'Taser', icon: 'TS', tier: 0, scope: 'weapon', stack: '+0.5s root duration per stack.', desc: '7% chance on hit to root enemies for 1.5s (+0.5s per stack). Rooted enemies cannot move but still attack.' },
  { id: 'nugget', name: 'Meat Nugget', icon: 'MN', tier: 0, scope: 'weapon', stack: '+3 HP healed per nugget per stack.', desc: '8% chance on hit to drop 2 meat nuggets that heal 3 (+3 per stack) HP when picked up.' },
  { id: 'lantern', name: 'Bolstering Lantern', icon: 'BL', tier: 0, scope: 'weapon', stack: '+3 counted enemies (max +30% attack speed) per stack.', desc: '+10% attack speed for each enemy within 200 of you, up to 3 (+3 per stack) enemies.' },
  { id: 'medkit', name: 'Medkit', icon: 'MK', tier: 0, scope: 'core', stack: '+3% max HP healed per stack.', desc: '2s after getting hurt, heal 4 HP + 3% (+3% per stack) max HP.' },
  { id: 'barbed', name: 'Barbed Wire', icon: 'BW', tier: 0, scope: 'core', stack: '+15 radius and +40% base damage per stack.', desc: 'Every 0.5s, enemies within 130 (+15 per stack) of you take 80% (+40% per stack) base damage.' },
  { id: 'fireshield', name: 'Fire Shield', icon: 'FS', tier: 0, scope: 'core', stack: '+400% blast damage per stack.', desc: 'Taking a hit of at least 10% max HP releases a blast (radius 225) for 400% (+400% per stack) base damage that knocks enemies back.' },
  { id: 'spikestrip', name: 'Spikestrip', icon: 'SS', tier: 0, scope: 'core', stack: '+1s slow duration per stack.', desc: 'Getting hurt drops spikes around you (radius 150) that slow enemies by 50% for 2s (+1s per stack). Once per second.' },
  { id: 'bitter', name: 'Bitter Root', icon: 'BR', tier: 0, scope: 'core', stack: '+8% max HP per stack.', desc: '+8% max HP (+8% per stack).' },
  { id: 'opal', name: 'Oddly-shaped Opal', icon: 'OP', tier: 0, scope: 'core', stack: '+20 armor per stack.', desc: '+20 armor (+20 per stack) while you have not been hurt for 4s.' },
  { id: 'elixir', name: 'Power Elixir', icon: 'PE', tier: 0, scope: 'core', stack: 'Each stack is one more use; one Elixir is consumed per trigger.', desc: 'Taking damage to below 25% HP consumes one Elixir and heals 75% max HP.' },
  { id: 'watch', name: 'Delicate Watch', icon: 'DW', tier: 0, scope: 'core', stack: '+20% damage per stack. All stacks break together.', desc: '+20% damage (+20% per stack). Taking damage to below 25% HP breaks all Watches.' },
  { id: 'shieldgen', name: 'Personal Shield Generator', icon: 'PS', tier: 0, scope: 'core', stack: '+8% max HP as shield per stack.', desc: 'Gain a shield equal to 8% (+8% per stack) max HP. Shields recharge after 4s without getting hurt.' },
  { id: 'topaz', name: 'Topaz Brooch', icon: 'TB', tier: 0, scope: 'core', stack: '+3 barrier per proc per stack.', desc: '20% chance on kill to grant 3 (+3 per stack) temporary barrier. Barrier absorbs damage and decays over time.' },
  { id: 'chronic', name: 'Chronic Expansion', icon: 'CE', tier: 0, scope: 'core', stack: '+5 max buff stacks per stack (+15% max damage).', desc: '20% chance on kill to grant +3% damage for 7s, stacking up to 10 (+5 per stack) times. Each proc refreshes the duration.' },
  { id: 'warbanner', name: 'Warbanner', icon: 'WB', tier: 0, scope: 'core', stack: '+4s banner duration per stack.', desc: 'On level up and when a boss appears, raise a banner: +30% attack speed, +10% movement speed and +15% damage for 8s (+4s per stack).' },
  { id: 'fireworks', name: 'Bundle of Fireworks', icon: 'FW', tier: 0, scope: 'core', stack: '+4 fireworks per stack.', desc: 'On level up and when a boss appears, launch 8 (+4 per stack) homing fireworks for 300% base damage each.' },
  { id: 'echo', name: 'Warped Echo', icon: 'WE', tier: 0, scope: 'core', stack: 'Extra stacks have no effect.', desc: 'Every 15s, the next hit you take is reduced by 10% and split into 3 hits over 1s.' },
  { id: 'savings', name: 'Life Savings', icon: 'L$', tier: 0, scope: 'core', stack: '+1 gold every 3s per stack.', desc: 'Gain 1 (+1 per stack) gold every 3s. Scales with time.' },
  { id: 'rustedkey', name: 'Rusted Key', icon: 'RK', tier: 0, scope: 'core', stack: 'Each stack opens one cache; one Key is consumed per boss kill.', desc: 'When a boss dies, one Key is consumed to open a hidden cache: 1 item (80% Common / 20% Uncommon).' },
  { id: 'hoof', name: "Paul's Goat Hoof", icon: 'PH', tier: 0, scope: 'core', mods: { movePct: 5 }, stack: '+5% movement speed per stack.', desc: '+5% movement speed (+5% per stack).' },
  { id: 'energydrink', name: 'Energy Drink', icon: 'ED', tier: 0, scope: 'core', stack: '+8% movement speed per stack.', desc: 'After moving for 1s without stopping, gain +8% (+8% per stack) movement speed.' },
  { id: 'mocha', name: 'Mocha', icon: 'MC', tier: 0, scope: 'core', mods: { movePct: 2.5 }, stack: '+7.5% attack speed and +2.5% movement speed per stack.', desc: '+7.5% attack speed and +2.5% movement speed (+7.5% and +2.5% per stack).' },
  { id: 'fungus', name: 'Bustling Fungus', icon: 'BF', tier: 0, scope: 'core', stack: '+30 zone radius and +2.25% max HP healed per second per stack.', desc: 'After standing still for 1s, create a zone (radius 70, +30 per stack) that heals 4.5% (+2.25% per stack) max HP per second. Moving ends the zone.' },
  { id: 'headstompers', name: 'Headstompers', icon: 'HD', tier: 0, scope: 'core', stack: '+250% dash damage per stack.', desc: 'Dashing through enemies deals 250% (+250% per stack) base damage to each of them and stuns non-bosses for 0.5s.' },

  // Uncommon
  { id: 'ukulele', name: 'Ukulele', icon: 'UK', tier: 1, scope: 'weapon', stack: '+2 targets and +40 chain range per stack.', desc: '25% chance on hit to fire chain lightning for 80% damage to 3 (+2 per stack) targets within 200 (+40 per stack).' },
  { id: 'atg', name: 'AtG Missile Mk. 1', icon: 'AT', tier: 1, scope: 'weapon', stack: '+300% missile damage per stack.', desc: '10% chance on hit to fire a homing missile for 300% (+300% per stack) damage.' },
  { id: 'wisp', name: "Will-o'-the-wisp", icon: 'WW', tier: 1, scope: 'weapon', stack: '+200% explosion kill-damage per stack.', desc: '30% chance on kill to detonate for 250% (+200% per stack) kill-damage in radius 110.' },
  { id: 'scythe', name: "Harvester's Scythe", icon: 'HS', tier: 1, scope: 'weapon', firstStack: { crit: 5 }, stack: '+1.5 HP healed per crit per stack. The +5% crit does not stack.', desc: '+5% crit. Crits heal 3 (+1.5 per stack) HP.' },
  { id: 'predatory', name: 'Predatory Instincts', icon: 'PI', tier: 1, scope: 'weapon', firstStack: { crit: 5 }, stack: '+2 max buff stacks (+24% max attack speed) per stack. The +5% crit does not stack.', desc: '+5% crit. Crits grant +12% attack speed for 2s, up to 3 (+2 per stack) times.' },
  { id: 'seed', name: 'Leeching Seed', icon: 'LS', tier: 1, scope: 'weapon', stack: '+0.6 HP healed per hit per stack.', desc: 'Hits heal 0.6 (+0.6 per stack) HP, scaled by proc coefficient.' },
  { id: 'chrono', name: 'Chronobauble', icon: 'CH', tier: 1, scope: 'weapon', stack: '+2s slow duration per stack.', desc: 'Hits slow enemies by 50% for 2s (+2s per stack).' },
  { id: 'pauldron', name: "Berzerker's Pauldron", icon: 'BP', tier: 1, scope: 'weapon', stack: '+35% attack speed and +1.5s duration per stack.', desc: '20% chance on kill to grant +35% (+35% per stack) attack speed for 2.5s (+1.5s per stack).' },
  { id: 'kjaro', name: "Kjaro's Band", icon: 'KB', tier: 1, scope: 'weapon', stack: '+300% fire blast damage per stack.', desc: 'Every 5s, the next hit blasts fire for 300% (+300% per stack) damage in radius 110 and burns.' },
  { id: 'runald', name: "Runald's Band", icon: 'RB', tier: 1, scope: 'weapon', stack: '+200% blast damage and +0.75s freeze per stack.', desc: 'Every 5s, the next hit deals 200% (+200% per stack) damage in radius 125 and freezes for 1.5s (+0.75s per stack).' },
  { id: 'infusion', name: 'Infusion', icon: 'IN', tier: 1, scope: 'weapon', stack: '+0.25 max HP per kill and +40 max cap per stack.', desc: 'Kills permanently grant +0.25 (+0.25 per stack) max HP, up to 40 (+40 per stack).' },
  { id: 'guillotine', name: 'Old Guillotine', icon: 'OG', tier: 1, scope: 'weapon', stack: '+13% execute threshold per stack (hyperbolic).', desc: 'Instantly kill non-boss enemies below 13% (+13% per stack, hyperbolic) HP.' },
  { id: 'boxing', name: 'Boxing Gloves', icon: 'BG', tier: 1, scope: 'weapon', stack: '+6% knockback chance per stack (hyperbolic).', desc: '6% (+6% per stack, hyperbolic) chance on hit to knock enemies back. Bosses are pushed less.' },
  { id: 'thorn', name: 'Noxious Thorn', icon: 'NT', tier: 1, scope: 'weapon', stack: '+10% bleed chance and +33% debuff transfer per stack.', desc: '+10% (+10% per stack) chance on hit to bleed (adds to Tri-Tip). Kills transfer 33% (+33% per stack) of the victim\'s bleed, burn and poison to the nearest enemy.' },
  { id: 'toxicworm', name: 'Toxic Worm', icon: 'TW', tier: 1, scope: 'weapon', stack: 'Infection cooldown divided by the stack count.', desc: 'Every 4s (divided by stacks), the next hit infects the enemy for 100% damage per second over 6s. When an infected enemy dies, the infection jumps to the nearest enemy.' },
  { id: 'shuriken', name: 'Shuriken', icon: 'SH', tier: 1, scope: 'weapon', stack: '+50% of DPS per shuriken and +1 shuriken held per stack.', desc: 'Firing also throws a homing shuriken for 100% (+50% per stack) of the weapon\'s DPS. Holds 3 (+1 per stack) shurikens, reloading one every 3s.' },
  { id: 'chargefield', name: 'Chargefield Generator', icon: 'CG', tier: 1, scope: 'core', stack: '+60% base damage per pulse per stack.', desc: '20% chance on kill to create a lightning ring around you for 6s that deals 60% (+60% per stack) base damage every 0.5s. Each proc refreshes it and grows the ring (radius 100 up to 300).' },
  { id: 'goldengun', name: 'Golden Gun', icon: 'GG', tier: 1, scope: 'core', stack: '+1% damage per level per stack, up to +40% total.', desc: '+1% (+1% per stack) damage per level, up to +40%.' },
  { id: 'energycell', name: 'Energy Cell', icon: 'EC', tier: 1, scope: 'core', stack: '+40% max attack speed per stack.', desc: 'Up to +40% (+40% per stack) attack speed as HP drops from 50% to 10%.' },
  { id: 'heart', name: "Guardian's Heart", icon: 'GH', tier: 1, scope: 'core', stack: '+30 shield per stack.', desc: 'Gain 30 (+30 per stack) shield. Shields recharge after 4s without getting hurt.' },
  { id: 'kinetic', name: 'Kinetic Dampener', icon: 'KD', tier: 1, scope: 'core', stack: '+100% of max shield as pulse damage per stack. The 8% shield does not stack.', desc: 'Gain a shield equal to 8% max HP. When your shield breaks, release a pulse (radius 250) that stuns for 1.5s and deals 100% base damage + 100% (+100% per stack) of max shield.' },
  { id: 'razorwire', name: 'Razorwire', icon: 'RW', tier: 1, scope: 'core', stack: '+2 razor targets per stack.', desc: 'Getting hurt fires razors at up to 5 (+2 per stack) enemies within 300 for 160% base damage each. Once per 0.3s.' },
  { id: 'panicmines', name: 'Panic Mines', icon: 'PM', tier: 1, scope: 'core', stack: '+1 mine per trigger per stack.', desc: 'Getting hurt below 50% HP drops 1 (+1 per stack) mines around you (once per 3s). Mines explode on contact for 500% base damage in radius 100.' },
  { id: 'timekeeper', name: "Time Keeper's Secret", icon: 'TK', tier: 1, scope: 'core', stack: '+1s freeze duration per stack.', desc: 'Once per minute, taking damage to below 25% HP freezes all enemies for 3s (+1s per stack) and destroys enemy projectiles.' },
  { id: 'transmitter', name: 'Unstable Transmitter', icon: 'UX', tier: 1, scope: 'core', stack: '+300% bleed base damage per stack.', desc: 'Taking damage to below 25% HP grants a barrier of 25% max HP and blasts enemies within 250 away, bleeding them for 300% (+300% per stack) base damage. Recharges every 30s.' },
  { id: 'ignition', name: 'Ignition Tank', icon: 'IT', tier: 1, scope: 'core', stack: '+150% burn damage per stack.', desc: 'Burn damage +150% (+150% per stack).' },
  { id: 'deathmark', name: 'Death Mark', icon: 'DM', tier: 1, scope: 'core', stack: '+25% damage taken by marked enemies per stack.', desc: 'Enemies with 3 or more different debuffs (bleed, burn, poison, slow, stun, root...) take +50% (+25% per stack) damage from all sources.' },
  { id: 'ghor', name: "Ghor's Tome", icon: 'GT', tier: 1, scope: 'core', stack: '+1% treasure chance per stack.', desc: 'Kills have a 1% (+1% per stack) chance to drop a treasure worth 10 gold. Scales with time.' },
  { id: 'smartshopper', name: 'Smart Shopper', icon: 'SM', tier: 1, scope: 'core', stack: '+25% gold from kills per stack.', desc: '+25% (+25% per stack) gold from kills.' },
  { id: 'compulsion', name: "Collector's Compulsion", icon: 'CC', tier: 1, scope: 'core', stack: '+3 max buff stacks (+9% max damage and attack speed) per stack.', desc: 'Every 20 kills grants +3% damage and attack speed for 20s, up to 3 (+3 per stack) times.' },
  { id: 'salestar', name: 'Sale Star', icon: 'ST', tier: 1, scope: 'core', stack: '+10% extra copy chance per stack.', desc: 'Picked up items have a 10% (+10% per stack) chance to come with an extra copy.' },
  { id: 'chancedoll', name: 'Chance Doll', icon: 'DL', tier: 1, scope: 'core', stack: '+15% upgrade chance per stack.', desc: 'Dropped Common items have a 15% (+15% per stack) chance to be Uncommon instead.' },
  { id: 'shipping', name: 'Shipping Request Form', icon: 'SR', tier: 1, scope: 'core', stack: '+1 item per delivery for every 2 additional stacks.', desc: 'Every 60s, receive a delivery of 1 item (+1 per 2 additional stacks).' },
  { id: 'squid', name: 'Squid Polyp', icon: 'SQ', tier: 1, scope: 'core', stack: '+2 shots per second per stack.', desc: 'Every 60s, summon a Squid Turret for 30s that shoots 2 (+2 per stack) times per second for 120% base damage.' },
  { id: 'feather', name: 'Hopoo Feather', icon: 'HF', tier: 1, scope: 'core', stack: '+1 dash charge per stack.', desc: '+1 (+1 per stack) dash charge.' },
  { id: 'quail', name: 'Wax Quail', icon: 'WQ', tier: 1, scope: 'core', stack: '+13% dash distance per stack.', desc: 'Dashes travel 13% (+13% per stack) farther.' },
  { id: 'whip', name: 'Red Whip', icon: 'RH', tier: 1, scope: 'core', stack: '+10% movement speed per stack.', desc: '+10% (+10% per stack) movement speed while you have not been hurt for 2s.' },
  { id: 'buckler', name: 'Rose Buckler', icon: 'RS', tier: 1, scope: 'core', stack: '+30 armor per stack.', desc: '+30 armor (+30 per stack) while moving.' },
  { id: 'harpoon', name: "Hunter's Harpoon", icon: 'HH', tier: 1, scope: 'core', stack: '+0.5s buff duration per stack.', desc: 'Kills grant +40% movement speed, fading over 1s (+0.5s per stack). Triggers at most once every 3s.' },
  { id: 'stealthkit', name: 'Old War Stealthkit', icon: 'OW', tier: 1, scope: 'core', stack: 'Recharge time halved per stack.', desc: 'Falling below 25% HP makes you invisible and grants +13% movement speed for 5s: enemies lose track of you and stop attacking. Recharges every 30s (-50% per stack).' },
  { id: 'jetpack', name: 'Rusty Jetpack', icon: 'RJ', tier: 1, scope: 'core', stack: '+7% dash recharge speed and +3% dash distance per stack.', desc: 'Dash recharges 7% (+7% per stack) faster and travels 3% (+3% per stack) farther.' },
  { id: 'antlers', name: 'Elusive Antlers', icon: 'EA', tier: 1, scope: 'core', stack: 'Orb interval -10% (multiplicative) and +3 max buff stacks per stack.', desc: 'Every 10s (-10% per stack), an energy orb appears near you. Picking it up grants +4% movement speed for 12s, up to 3 (+3 per stack) times.' },
  { id: 'faraday', name: 'Faraday Spur', icon: 'FY', tier: 1, scope: 'core', stack: '+280% max discharge base damage per stack.', desc: 'Moving builds charge (full after 4s), granting up to +13% movement speed. Dashing at 25%+ charge spends it on a discharge for up to 400% (+280% per stack) base damage in radius 100-250.' },
  { id: 'fuelcell', name: 'Fuel Cell', icon: 'FU', tier: 1, scope: 'core', stack: '+1 equipment charge and -15% equipment cooldown (multiplicative) per stack.', desc: 'Hold 1 (+1 per stack) extra equipment charge. Equipment cooldowns -15% (-15% per stack, multiplicative).' },

  // Legendary
  { id: 'behemoth', name: 'Brilliant Behemoth', icon: 'BB', tier: 2, scope: 'weapon', stack: '+45 explosion radius per stack.', desc: 'All hits explode for 60% damage in radius 75 (+45 per stack).' },
  { id: 'dagger', name: 'Ceremonial Dagger', icon: 'CD', tier: 2, scope: 'weapon', stack: '+150% dagger kill-damage per stack.', desc: 'Kills fire a homing dagger for 150% (+150% per stack) kill-damage.' },
  { id: 'justice', name: 'Shattering Justice', icon: 'SJ', tier: 2, scope: 'weapon', stack: '+6s armor shatter duration per stack.', desc: 'Hits shatter armor: enemies take +30% damage from all sources for 6s (+6s per stack).' },
  { id: 'scope', name: 'Laser Scope', icon: 'LZ', tier: 2, scope: 'weapon', firstStack: { crit: 10 }, mods: { critDmg: 1 }, stack: '+100% crit damage per stack. The +10% crit does not stack.', desc: '+10% crit. Crits deal +100% (+100% per stack) damage.' },
  { id: 'magazine', name: 'Backup Magazine', icon: 'BM', tier: 2, scope: 'weapon', mods: { lanes: 1 }, stack: '+1 parallel copy per shot (Arc Coil: +1 bolt) per stack.', desc: 'Every shot is fired as 2 (+1 per stack) parallel copies at full damage. Arc Coil: fires 2 (+1 per stack) bolts at different enemies.' },
  { id: 'clover', name: '57 Leaf Clover', icon: '57', tier: 2, scope: 'core', mods: { procLuck: 1 }, stack: '+1 extra roll for chance effects per stack.', desc: 'All chance-based item effects roll 1 (+1 per stack) extra time.' },
  { id: 'teslacoil', name: 'Unstable Tesla Coil', icon: 'UT', tier: 2, scope: 'core', stack: '+2 zap targets per stack.', desc: 'Every 0.5s zaps up to 3 (+2 per stack) enemies within 250.' },
  { id: 'rack', name: 'Rejuvenation Rack', icon: 'RR', tier: 2, scope: 'core', mods: { healPct: 100 }, stack: '+100% healing per stack.', desc: '+100% (+100% per stack) healing.' },
  { id: 'meathook', name: 'Sentient Meat Hook', icon: 'MH', tier: 2, scope: 'weapon', stack: '+20% hook chance (hyperbolic) and +5 hook targets per stack.', desc: '20% (+20% per stack, hyperbolic) chance on hit to fire homing hooks at up to 10 (+5 per stack) enemies within 300 for 100% damage each.' },
  { id: 'boomerang', name: 'Electric Boomerang', icon: 'EB', tier: 2, scope: 'weapon', stack: '+120% boomerang damage per stack.', desc: '15% chance on hit to throw a piercing boomerang that flies out and returns, dealing 120% (+120% per stack) damage and stunning for 0.5s.' },
  { id: 'runiclens', name: 'Runic Lens', icon: 'RL', tier: 2, scope: 'weapon', stack: '+800% meteor damage per stack.', desc: 'Chance on hit to call a meteor for 800% (+800% per stack) damage in radius 110. The chance grows with damage per hit: 2% per 10 damage, up to 25%.' },
  { id: 'lopper', name: "The Ol' Lopper", icon: 'OL', tier: 2, scope: 'weapon', stack: '+5% HP threshold per stack, up to 35%.', desc: 'Hits on enemies below 15% (+5% per stack, up to 35%) HP always crit, bosses included.' },
  { id: 'telescope', name: 'Telescopic Sight', icon: 'TL', tier: 2, scope: 'weapon', stack: '+0.5% instant kill chance per stack, up to 3%.', desc: '1% (+0.5% per stack, up to 3%) chance on hit to instantly kill a non-boss enemy.' },
  { id: 'permafrost', name: 'Permafrost', icon: 'PF', tier: 2, scope: 'weapon', stack: '+3% freeze chance per stack.', desc: '6% (+3% per stack) chance on hit to freeze enemies for 1.5s, then slow them for 3s.' },
  { id: 'plasmachain', name: 'Plasma Chain', icon: 'PC', tier: 2, scope: 'weapon', stack: '+1 tether per weapon per stack.', desc: '15% chance on hit to tether the enemy for 4s, dealing 150% damage per second. Up to 1 (+1 per stack) tethers per weapon.' },
  { id: 'thallium', name: 'Thallium', icon: 'TH', tier: 2, scope: 'weapon', stack: '+250% poison damage per stack.', desc: '10% chance on hit to poison the enemy for 500% (+250% per stack) damage over 3s and slow it.' },
  { id: 'atg2', name: 'AtG Missile Mk. 2', icon: 'A2', tier: 2, scope: 'weapon', stack: '+7% missile chance per stack.', desc: '7% (+7% per stack) chance on hit to fire 3 homing missiles for 300% damage each.' },
  { id: 'hyperthreader', name: 'Hyper-Threader', icon: 'HT', tier: 2, scope: 'weapon', stack: '+1 laser bounce per stack.', desc: 'Every shot also fires a laser for 40% damage that bounces to 2 (+1 per stack) enemies.' },
  { id: 'heavencracker', name: 'Heaven Cracker', icon: 'HC', tier: 2, scope: 'weapon', stack: 'Pierces 1 shot sooner per stack, down to every shot.', desc: 'Every 4th shot (-1 per stack, down to every shot) pierces all enemies. Arc Coil: +3 chains instead.' },
  { id: 'laserturbine', name: 'Laser Turbine', icon: 'LT', tier: 2, scope: 'weapon', stack: '+50% turbine charge rate per stack.', desc: 'Firing charges the turbine (full after 8s of firing, +50% charge rate per stack). When full, fires a laser across the map for 500% of the weapon\'s DPS.' },
  { id: 'resonance', name: 'Resonance Disc', icon: 'RD', tier: 2, scope: 'weapon', stack: '+150% of DPS as disc damage per stack.', desc: 'Kills charge the disc (resets after 7s without a kill). At 4 charges, launch a disc that pierces all enemies for 150% (+150% per stack) of the weapon\'s DPS.' },
  { id: 'scorpion', name: 'Symbiotic Scorpion', icon: 'SC', tier: 2, scope: 'weapon', stack: '+1% damage taken per hit per stack, up to +50%.', desc: 'Hits permanently make the enemy take +1% (+1% per stack) more damage, up to +50%. Scaled by proc coefficient.' },
  { id: 'frostrelic', name: 'Frost Relic', icon: 'FR', tier: 2, scope: 'core', stack: '+150% base damage per second per stack.', desc: '20% chance on kill to create an ice storm around you for 3s that slows enemies and deals 150% (+150% per stack) base damage per second. Each proc refreshes it and grows the storm (radius 80 up to 260).' },
  { id: 'hitlist', name: 'The Hit List', icon: 'HL', tier: 2, scope: 'core', stack: '+1 marked enemy and +10% max damage per stack.', desc: 'Every 10s, mark 1 (+1 per stack) random enemy. Killing a marked enemy permanently grants +1% damage for the rest of the run (max +20%, +10% per stack).' },
  { id: 'dio', name: "Dio's Best Friend", icon: 'DB', tier: 2, scope: 'core', stack: 'Each stack is one more revive.', desc: 'On death, consume this item and revive at 40% HP with 2s of invulnerability.' },
  { id: 'aegis', name: 'Aegis', icon: 'AE', tier: 2, scope: 'core', stack: '+50% of overheal as barrier per stack.', desc: 'Healing past full HP grants a barrier for 50% (+50% per stack) of the overheal.' },
  { id: 'microbots', name: 'Defensive Microbots', icon: 'DF', tier: 2, scope: 'core', stack: '+1 projectile shot down per stack.', desc: 'Every 0.5s, shoot down 1 (+1 per stack) enemy projectile within 220.' },
  { id: 'mask', name: 'Happiest Mask', icon: 'HM', tier: 2, scope: 'core', stack: '+300% ghost base damage per second per stack.', desc: 'Kills have a 7% chance to summon a ghost for 15s that hunts enemies for 300% (+300% per stack) base damage per second. Up to 6 ghosts.' },
  { id: 'deskplant', name: 'Interstellar Desk Plant', icon: 'DP', tier: 2, scope: 'core', stack: '+1% max HP healed per second per stack.', desc: 'Kills have a 10% chance to plant a healing fruit that heals 2% (+1% per stack) max HP per second for 5s. Up to 3 plants at once.' },
  { id: 'brainstalks', name: 'Brainstalks', icon: 'BN', tier: 2, scope: 'core', stack: '+4s buff duration per stack.', desc: 'Killing an elite or boss makes all weapons fire twice as fast for 4s (+4s per stack).' },
  { id: 'whispers', name: 'Sonorous Whispers', icon: 'SW', tier: 2, scope: 'core', stack: '+1 extra item per elite or boss per stack.', desc: 'Elites and bosses drop 1 (+1 per stack) extra item.' },
  { id: 'spareparts', name: 'Spare Drone Parts', icon: 'SD', tier: 2, scope: 'core', stack: '+50% ally attack speed per stack. One drone only.', desc: 'Gain Col. Droneman, a drone that fires 3 times per second for 120% base damage. All allies attack 50% (+50% per stack) faster.' },
  { id: 'nkuhana', name: "N'kuhana's Opinion", icon: 'NO', tier: 2, scope: 'core', stack: '+250% of stored energy as skull damage per stack.', desc: 'Store 100% of healing as soul energy. At 10% max HP worth of energy, fire a skull at the nearest enemy for 250% (+250% per stack) of the stored energy, scaled by damage and stage.' },
  { id: 'warbonds', name: 'War Bonds', icon: 'WR', tier: 2, scope: 'core', stack: '+5 missiles per stack.', desc: 'When a boss spawns, bombard it with 5 (+5 per stack) missiles that each deal 2.5% of its max HP.' },
  { id: 'icbm', name: 'Pocket I.C.B.M.', icon: 'IC', tier: 2, scope: 'core', stack: 'First stack: +2 missiles. Each extra stack: +50% missile damage.', desc: 'Missile items (AtG Mk. 1 and Mk. 2, Plasma Shrimp, War Bonds) fire 2 extra missiles. +50% missile damage per extra stack.' },
  { id: 'oldbox', name: 'Old Box', icon: 'OB', tier: 2, scope: 'core', stack: '+10% HP threshold per stack.', desc: 'Taking damage to below 25% (+10% per stack) HP makes non-boss enemies within 400 flee in fear for 3s. Recharges every 15s.' },
  { id: 'afterburner', name: 'Hardlight Afterburner', icon: 'HA', tier: 2, scope: 'core', stack: '+2 dash charges per stack. The -11% dash cooldown does not stack.', desc: '+2 (+2 per stack) dash charges. Dash cooldown -11%.' },
  { id: 'headset', name: 'H3AD-5T v2', icon: 'H5', tier: 2, scope: 'core', stack: '+1000% slam base damage and recharge time halved per stack.', desc: 'Dashes end in a kinetic slam (radius 190) for 1000% (+1000% per stack) base damage that stuns non-bosses for 1s. Recharges every 10s (-50% per stack).' },
  { id: 'boots', name: "Fireman's Boots", icon: 'FB', tier: 2, scope: 'core', stack: '+100% fire trail base damage per second per stack.', desc: 'Moving leaves a trail of fire that burns enemies for 150% (+100% per stack) base damage per second.' },
  { id: 'bottledchaos', name: 'Bottled Chaos', icon: 'BH', tier: 2, scope: 'core', stack: '+1 random equipment effect per use per stack.', desc: 'Using equipment also triggers 1 (+1 per stack) random other equipment effect.' },

  // Lunar (strong with a downside)
  { id: 'glass', name: 'Shaped Glass', icon: 'SG', tier: 3, scope: 'core', stack: '+100% damage and max HP halved per stack.', desc: '+100% damage (+100% per stack). -50% max HP (-50% per stack, multiplicative).' },
  { id: 'crown', name: 'Brittle Crown', icon: 'BC', tier: 3, scope: 'core', stack: '+1 XP gained per hit and +3 XP lost per hit taken per stack.', desc: 'Hits have a 30% chance (x proc) to give 1 (+1 per stack) XP. Getting hit loses 3 (+3 per stack) XP.' },
  { id: 'corpsebloom', name: 'Corpsebloom', icon: 'CO', tier: 3, scope: 'core', stack: '+100% healing and the per-second healing cap halved per stack.', desc: '+100% healing (+100% per stack). All healing is applied over time, at most 10% max HP per second (-50% per stack).' },
  { id: 'ego', name: 'Egocentrism', icon: 'EG', tier: 3, scope: 'core', stack: 'Bomb interval divided by the stack count and +1 max bomb per stack.', desc: 'Every 3s (divided by stacks), gain an orbiting bomb (max 3, +1 per stack) that detonates on contact for 360% base damage. Every 60s, one random other equipped item turns into Egocentrism.' },
  { id: 'eulogy', name: 'Eulogy Zero', icon: 'EZ', tier: 3, scope: 'core', stack: '+5% Lunar chance per stack.', desc: 'Dropped items have a 5% (+5% per stack) chance to be Lunar instead.' },
  { id: 'lightflux', name: 'Light Flux Pauldron', icon: 'LF', tier: 3, scope: 'core', stack: 'Item cooldowns -50% and attack speed -35% per stack (multiplicative).', desc: 'Item cooldowns -50% (multiplicative per stack). Attack speed -35% (multiplicative per stack).' },
  { id: 'stoneflux', name: 'Stone Flux Pauldron', icon: 'SF', tier: 3, scope: 'core', stack: '+100% max HP and -30% movement speed (multiplicative) per stack.', desc: '+100% max HP (+100% per stack). -30% movement speed (multiplicative per stack).' },
  { id: 'purity', name: 'Purity', icon: 'PU', tier: 3, scope: 'core', stack: '-1s more item cooldown and +1 unfavorable roll per stack.', desc: 'Item cooldowns -2s (+1s per stack, minimum 0.5s). Chance effects roll 1 (+1 per stack) extra time for an unfavorable outcome.' },
  { id: 'transcendence', name: 'Transcendence', icon: 'TR', tier: 3, scope: 'core', stack: '+25% max HP per stack.', desc: 'Convert all but 1 max HP into shield and gain +50% (+25% per stack) max HP. Shields recharge after 4s without getting hurt.' },
  { id: 'rachis', name: 'Mercurial Rachis', icon: 'MR', tier: 3, scope: 'core', stack: '+50% damage dealt and +50% damage taken per stack.', desc: '+50% damage (+50% per stack). Enemies also deal +50% (+50% per stack) damage.' },
  { id: 'strides', name: 'Strides of Heresy', icon: 'SO', tier: 3, scope: 'core', stack: '+1.5s Shadowfade duration and +18% max HP healed per stack.', desc: 'Your dash becomes Shadowfade: turn intangible for 3s (+1.5s per stack) with +10% movement speed, healing 18% (+18% per stack) max HP over the duration. You cannot attack while faded. Cooldown at least 6s.' },

  // Boss (dropped only by bosses)
  { id: 'knurl', name: 'Titanic Knurl', icon: 'KN', tier: 4, scope: 'core', mods: { maxHp: 40, regen: 1.6 }, stack: '+40 max HP and +1.6 HP regen/s per stack.', desc: '+40 max HP and +1.6 HP regen/s (+40 and +1.6 per stack).' },
  { id: 'pearl', name: 'Pearl', icon: 'PR', tier: 4, scope: 'core', stack: '+10% max HP per stack.', desc: '+10% max HP (+10% per stack).' },
  { id: 'irradiant', name: 'Irradiant Pearl', icon: 'IP', tier: 4, scope: 'core', stack: '+10% max HP, regen, armor, damage and attack speed per stack.', desc: '+10% (+10% per stack) max HP, regen, armor, damage and attack speed.' },
  { id: 'gland', name: "Queen's Gland", icon: 'QG', tier: 4, scope: 'core', stack: '+1 Beetle Guard per stack.', desc: 'Summon 1 (+1 per stack) permanent Beetle Guard that hunts enemies for 400% base damage per second.' },
  { id: 'empathy', name: 'Empathy Cores', icon: 'EM', tier: 4, scope: 'core', stack: '+100% probe base damage per stack. Always 2 probes.', desc: 'Summon 2 permanent Solus Probes that fire twice per second for 100% (+100% per stack) base damage.' },
  { id: 'nucleus', name: 'Defense Nucleus', icon: 'NU', tier: 4, scope: 'core', stack: '+150% construct base damage per stack. Up to 4 constructs.', desc: 'Killing an elite or boss summons a permanent Alpha Construct that fires twice per second for 150% (+150% per stack) base damage. Up to 4.' },
  { id: 'genesis', name: 'Genesis Loop', icon: 'GL', tier: 4, scope: 'core', stack: 'Recharge time divided by the stack count.', desc: 'Taking damage to below 25% HP releases a nova (radius 450) for 6000% base damage. Recharges every 30s (divided by stacks).' },
  { id: 'planula', name: 'Planula', icon: 'PL', tier: 4, scope: 'core', stack: '+5 HP healed per hit taken per stack.', desc: 'Heal 5 (+5 per stack) HP whenever you take damage.' },
  { id: 'urn', name: 'Mired Urn', icon: 'MU', tier: 4, scope: 'core', stack: '+1 tethered enemy per stack.', desc: 'Tether the nearest 1 (+1 per stack) enemies within 220, draining 100% base damage per second and healing you for the same amount.' },
  { id: 'perforatorC', name: 'Charged Perforator', icon: 'CP', tier: 4, scope: 'weapon', stack: '+500% lightning damage per stack.', desc: '10% chance on hit to strike the enemy with lightning for 500% (+500% per stack) damage in radius 50.' },
  { id: 'perforatorM', name: 'Molten Perforator', icon: 'MP', tier: 4, scope: 'weapon', stack: '+300% damage per magma ball per stack.', desc: '10% chance on hit to rain 3 magma balls around the enemy for 300% (+300% per stack) damage each.' },
  { id: 'shatterspleen', name: 'Shatterspleen', icon: 'SP', tier: 4, scope: 'weapon', firstStack: { crit: 5 }, stack: '+400% explosion kill-damage per stack. The +5% crit does not stack.', desc: '+5% crit. Crits bleed for 240% damage. Bleeding enemies killed by this weapon explode for 400% (+400% per stack) kill-damage + 15% of their max HP.' },
  { id: 'ifrit', name: "Ifrit's Horn", icon: 'IH', tier: 4, scope: 'weapon', stack: '+220% incinerate damage per stack.', desc: '8% chance on hit to incinerate all enemies within 450 of you for 220% (+220% per stack) damage and set them on fire.' },
  { id: 'witness', name: 'Burning Witness', icon: 'BU', tier: 4, scope: 'core', stack: '+2% movement speed per stack. Damage, fire trail and duration do not stack.', desc: 'Kills grant +3% (+2% per stack) movement speed, +10% damage and a fire trail that burns for 300% base damage per second, for 6s.' },
  { id: 'disciple', name: 'Little Disciple', icon: 'LD', tier: 4, scope: 'core', stack: '+300% wisp base damage per stack.', desc: 'While moving, fire a tracking wisp for 300% (+300% per stack) base damage every 1.6s. Fires faster with higher movement speed.' },

  // Void
  { id: 'needletick', name: 'Needletick', icon: 'NE', tier: 5, scope: 'weapon', corrupts: 'tritip', stack: '+10% collapse chance per stack.', desc: '10% (+10% per stack) chance on hit to collapse the enemy after 1s for 400% damage. Corrupts all Tri-Tip Daggers.' },
  { id: 'lostseer', name: "Lost Seer's Lenses", icon: 'LO', tier: 5, scope: 'weapon', corrupts: 'glasses', stack: '+0.5% instant kill chance per stack.', desc: '0.5% (+0.5% per stack) chance on hit to instantly kill a non-boss enemy. Corrupts all Lens-Maker\'s Glasses.' },
  { id: 'safer', name: 'Safer Spaces', icon: 'SA', tier: 5, scope: 'core', corrupts: 'tougher', stack: 'Recharge time -10% per stack (hyperbolic).', desc: 'Block one hit completely. Recharges after 15s (-10% per stack, hyperbolic). Corrupts all Tougher Times.' },
  { id: 'encrusted', name: 'Encrusted Key', icon: 'EK', tier: 5, scope: 'core', corrupts: 'rustedkey', stack: 'Each stack opens one cache; one Key is consumed per boss kill.', desc: 'When a boss dies, one Key is consumed to open a hidden cache: 1 item (60% Common / 30% Uncommon / 10% Legendary). Corrupts all Rusted Keys.' },
  { id: 'polylute', name: 'Polylute', icon: 'PY', tier: 5, scope: 'weapon', corrupts: 'ukulele', stack: '+3 lightning strikes per stack.', desc: '25% chance on hit to strike the enemy with lightning 3 (+3 per stack) times for 60% damage each. Corrupts all Ukuleles.' },
  { id: 'tentabauble', name: 'Tentabauble', icon: 'TA', tier: 5, scope: 'weapon', corrupts: 'chrono', stack: '+5% root chance and +1s root duration per stack.', desc: '5% (+5% per stack) chance on hit to root the enemy for 1s (+1s per stack). Corrupts all Chronobaubles.' },
  { id: 'shrimp', name: 'Plasma Shrimp', icon: 'PZ', tier: 5, scope: 'weapon', corrupts: 'atg', stack: '+40% missile damage per stack. The 10% shield does not stack.', desc: 'Gain a shield of 10% max HP (does not stack). While you have shield, hits (x proc) fire a homing missile for 40% (+40% per stack) damage. Corrupts all AtG Missile Mk. 1s.' },
  { id: 'singularity', name: 'Singularity Band', icon: 'SI', tier: 5, scope: 'weapon', corrupts: 'runald', stack: '+100% collapse damage per stack.', desc: 'Every 10s, the next hit creates a black hole (radius 140) that pulls enemies in for 5s, then collapses for 100% (+100% per stack) damage. Corrupts all Runald\'s Bands.' },
  { id: 'voidsent', name: 'Voidsent Flame', icon: 'VF', tier: 5, scope: 'weapon', corrupts: 'wisp', stack: '+156% pillar damage per stack.', desc: 'Hits on enemies at full HP erupt in a pillar for 260% (+156% per stack) damage in radius 110. Corrupts all Will-o\'-the-wisps.' },
  { id: 'benthic', name: 'Benthic Bloom', icon: 'BE', tier: 5, scope: 'core', corrupts: 'clover', stack: '+3 upgraded items per stack.', desc: 'Every 60s, upgrade 3 (+3 per stack) random equipped Common or Uncommon items to the next tier. Corrupts all 57 Leaf Clovers.' },
  { id: 'larva', name: 'Pluripotent Larva', icon: 'LA', tier: 5, scope: 'core', corrupts: 'dio', stack: 'Each stack is one more revive.', desc: 'On death, consume this item and revive at 40% HP with 2s of invulnerability, but every item with a Void counterpart is corrupted. Corrupts all Dio\'s Best Friends.' },
  { id: 'weeping', name: 'Weeping Fungus', icon: 'WF', tier: 5, scope: 'core', corrupts: 'fungus', stack: '+2% max HP healed per second per stack.', desc: 'Heal 2% (+2% per stack) max HP per second while moving. Corrupts all Bustling Fungi.' },

  // Equipment (use items, Shift). cd: cooldown in seconds. Aimed ones use the mouse cursor.
  // noChaos: never picked by Bottled Chaos (costs gold or HP, moves the player, or has a drawback).
  { id: 'fruit', name: 'Foreign Fruit', icon: 'FF', tier: 6, scope: 'equip', cd: 45, desc: 'Heal 50% of your max HP.' },
  { id: 'dml', name: 'Disposable Missile Launcher', icon: 'DM', tier: 6, scope: 'equip', cd: 45, desc: 'Fire a swarm of 12 homing missiles for 300% base damage each.' },
  { id: 'capacitor', name: 'Royal Capacitor', icon: 'RC', tier: 6, scope: 'equip', cd: 20, desc: 'Call lightning on the enemy nearest the cursor (or the toughest one on screen) for 3000% base damage, stunning enemies within 120 for 1.5s.' },
  { id: 'sawmerang', name: 'Sawmerang', icon: 'SW', tier: 6, scope: 'equip', cd: 45, desc: 'Throw 3 saw blades toward the cursor. They pierce everything for 400% base damage, stun, and hit again on the way back.' },
  { id: 'cube', name: 'Primordial Cube', icon: 'PC', tier: 6, scope: 'equip', cd: 60, desc: 'Open a black hole at the cursor for 6s that pulls non-boss enemies within 320 into its center, then collapses for 300% base damage.' },
  { id: 'molotov', name: 'Molotov (6-Pack)', icon: 'MV', tier: 6, scope: 'equip', cd: 45, desc: 'Throw 6 molotovs around the cursor. Each ignites enemies for 500% base damage and leaves a fire pool burning for 200% base damage per second for 6s.' },
  { id: 'preon', name: 'Preon Accumulator', icon: 'PA', tier: 6, scope: 'equip', cd: 100, desc: 'Fire a slow preon orb toward the cursor that zaps nearby enemies for 120% base damage 5 times per second, then detonates (radius 260) for 4000% base damage.' },
  { id: 'minefield', name: 'Instant Minefield', icon: 'IM', tier: 6, scope: 'equip', cd: 45, desc: 'Drop 7 mines around you. Each explodes on contact for 400% base damage in radius 80.' },
  { id: 'goldbomb', name: 'Gold-plated Bomb', icon: 'GB', tier: 6, scope: 'equip', cd: 45, noChaos: true, desc: 'Spend 50% of your gold on a blast (radius 260) dealing 10 damage per gold spent, scaled by your damage bonuses.' },
  { id: 'lostdoll', name: 'Lost Doll', icon: 'LD', tier: 6, scope: 'equip', cd: 45, noChaos: true, desc: 'Sacrifice 25% of your current HP to hit the toughest enemy on screen for 500% of your max HP.' },
  { id: 'elephant', name: 'Jade Elephant', icon: 'JE', tier: 6, scope: 'equip', cd: 45, desc: 'Gain 500 armor for 5s.' },
  { id: 'blastshower', name: 'Blast Shower', icon: 'BS', tier: 6, scope: 'equip', cd: 20, desc: 'Destroy all enemy projectiles and incoming blasts within 500, and interrupt nearby lasers that are charging.' },
  { id: 'unstablewatch', name: 'Unstable Watch', icon: 'UW', tier: 6, scope: 'equip', cd: 70, desc: 'Stop time for 5s: enemies, their projectiles and their attacks freeze while you keep moving and shooting.' },
  { id: 'buddy', name: 'Crudely Drawn Buddy', icon: 'CB', tier: 6, scope: 'equip', cd: 45, desc: 'Leave a decoy where you stand for 6s. Enemies lose track of you, go for the decoy and hold their fire.' },
  { id: 'safelantern', name: 'Safeguard Lantern', icon: 'SL', tier: 6, scope: 'equip', cd: 45, desc: 'Drop a lantern for 10s. Non-boss enemies within 220 of it flee from you in fear and take 20% base damage per second.' },
  { id: 'egg', name: 'Volcanic Egg', icon: 'VE', tier: 6, scope: 'equip', cd: 40, desc: 'Turn into an invulnerable fireball for 3s with +100% movement speed. Ramming enemies deals 500% base damage and knocks them back; ends with a blast (radius 160) for 800% base damage.' },
  { id: 'vase', name: 'Eccentric Vase', icon: 'EV', tier: 6, scope: 'equip', cd: 25, noChaos: true, desc: 'Teleport toward the cursor (up to 450) and become invulnerable for 0.5s.' },
  { id: 'amethyst', name: 'Gigantic Amethyst', icon: 'GA', tier: 6, scope: 'equip', cd: 12, desc: 'Refill all dash charges and reset every item cooldown.' },
  { id: 'ocular', name: 'Ocular HUD', icon: 'OH', tier: 6, scope: 'equip', cd: 60, desc: '+100% crit chance for 8s.' },
  { id: 'opus', name: "Gorag's Opus", icon: 'GO', tier: 6, scope: 'equip', cd: 45, desc: 'Frenzy for 7s: you and your allies gain +100% attack speed, and you gain +50% movement speed.' },
  { id: 'leech', name: 'Super Massive Leech', icon: 'SM', tier: 6, scope: 'equip', cd: 60, desc: 'For 8s, heal for 20% of all damage you deal.' },
  { id: 'backup', name: 'The Back-up', icon: 'BU', tier: 6, scope: 'equip', cd: 80, desc: 'Call 4 strike drones for 25s. Each fires 3 times per second for 120% base damage.' },
  { id: 'jar', name: 'Jar of Souls', icon: 'JS', tier: 6, scope: 'equip', cd: 45, desc: 'For every non-boss enemy on screen (up to 10), summon a ghost for 10s that hunts enemies for 300% base damage per second.' },
  { id: 'brooch', name: "Captain's Brooch", icon: 'CA', tier: 6, scope: 'equip', cd: 120, noChaos: true, desc: 'Call down a chest next to you. It still has to be paid for.' },
  { id: 'meteorite', name: 'Glowing Meteorite', icon: 'GM', tier: 6, scope: 'equip', cd: 70, noChaos: true, lunar: true, desc: 'Lunar. For 8s meteors rain on the screen, each blasting everything in radius 80 for 600% base damage. They hurt you too (15% max HP per hit); their landing spots are marked.' },
  { id: 'tonic', name: 'Spinel Tonic', icon: 'ST', tier: 6, scope: 'equip', cd: 60, noChaos: true, lunar: true, desc: 'Lunar. For 20s: +100% damage, +70% attack speed, +20 armor, +50% max HP, +300% regen, +30% movement speed. When it wears off, 20% chance of a permanent Tonic Affliction: -5% to all stats (stacks).' },
];
const ITEM_BY_ID = Object.fromEntries(ITEMS.map(i => [i.id, i]));

// level: used by the weakest/strongest targeting modes. xp is also the gold reward.
// ranged: stop distance of shooters; without `attack` they fire single bullets at shootRate.
// attack: a telegraphed special attack (see startEnemyAttack), repeated every cd seconds while in reach:
//   laser  - charges a beam that tracks the player, locks `lock` seconds before firing.
//   mortar - lobs a shell at the player's position that lands after `delay`.
//   spread - a fan of n bullets.
//   charge - winds up, then lunges in a straight line.
//   bomb   - stops next to the player and explodes after a fuse (the bomber dies).
// Damage fields (beamDmg, blastDmg, hitDmg) multiply the enemy's scaled damage.
const ENEMIES = {
  grunt: { hp: 12, speed: 75, dmg: 5, r: 11, lvl: 1, color: '#e03131', shape: 'circle', xp: 1 },
  runner: { hp: 7, speed: 145, dmg: 3, r: 8, lvl: 1, color: '#f08c00', shape: 'tri', xp: 1 },
  spitter: { hp: 19, speed: 60, dmg: 4, r: 12, lvl: 2, color: '#2f9e44', shape: 'diamond', xp: 1, ranged: 300, shootRate: 0.5, projSpeed: 220 },
  gunner: { hp: 26, speed: 55, dmg: 7, r: 13, lvl: 3, color: '#1c7ed6', shape: 'diamond', xp: 2, ranged: 330, shootRate: 0.35, projSpeed: 340 },
  brute: { hp: 65, speed: 50, dmg: 12, r: 19, lvl: 3, color: '#7048e8', shape: 'square', xp: 3 },
  splitter: { hp: 32, speed: 65, dmg: 6, r: 15, lvl: 2, color: '#d6336c', shape: 'circle', xp: 2, split: 'runner', splitN: 3 },
  juggernaut: { hp: 180, speed: 38, dmg: 18, r: 27, lvl: 5, color: '#868e96', shape: 'oct', xp: 6 },
  charger: {
    hp: 30, speed: 62, dmg: 6, r: 14, lvl: 2, color: '#f06595', shape: 'tri', xp: 2,
    attack: 'charge', trigger: 300, cd: 2.6, windup: 0.7, dashSpeed: 560, dashTime: 0.5, hitDmg: 1.8,
  },
  lancer: {
    hp: 22, speed: 52, dmg: 7, r: 12, lvl: 3, color: '#fcc419', shape: 'diamond', xp: 2, ranged: 430,
    attack: 'laser', cd: 3.4, charge: 1.2, lock: 0.35, beamW: 10, beamLen: 760, beamDur: 0.18, beamDmg: 2,
  },
  bombard: {
    hp: 34, speed: 42, dmg: 7, r: 15, lvl: 3, color: '#e8590c', shape: 'square', xp: 2, ranged: 470,
    attack: 'mortar', cd: 3.2, delay: 1.3, blastR: 62, blastDmg: 1.6,
  },
  scatterer: {
    hp: 24, speed: 55, dmg: 5, r: 12, lvl: 3, color: '#15aabf', shape: 'diamond', xp: 2, ranged: 290,
    attack: 'spread', cd: 2.3, n: 5, fan: 0.75, projSpeed: 210,
  },
  bomber: {
    hp: 9, speed: 125, dmg: 6, r: 10, lvl: 2, color: '#ffd43b', shape: 'circle', xp: 1,
    attack: 'bomb', trigger: 60, fuse: 0.75, blastR: 95, blastDmg: 2.5,
  },

  // The teleporter summons the boss of the map (BOSS_ORDER by map number). patterns are cycled every
  // patternEvery seconds (see BOSS_PATTERNS); below BOSS_PHASE2 HP the boss enrages and switches to patterns2,
  // attacking faster. charge (windup, dashSpeed, dashTime, hitDmg) is a telegraphed lunge.
  boss: {
    name: 'Warden', hp: 4400, speed: 52, dmg: 20, r: 46, lvl: 10, color: '#a61e4d', shape: 'hex', xp: 40,
    ranged: 340, shootRate: 0.7, burst: 3, projSpeed: 200, boss: true,
    patterns: ['nova', 'slam', 'volley'], patterns2: ['nova', 'spiral', 'slam', 'summon', 'volley'], patternEvery: 4.2,
    novaBullets: 16, novaSpeed: 170, slamR: 110, slamDelay: 1.1,
  },
  overseer: {
    name: 'Overseer', hp: 3800, speed: 56, dmg: 20, r: 42, lvl: 10, color: '#f59f00', shape: 'oct', xp: 40,
    ranged: 400, shootRate: 0.45, burst: 2, projSpeed: 230, boss: true,
    patterns: ['laser', 'sweep', 'volley', 'nova'], patterns2: ['laser', 'sweep', 'spiral', 'laser', 'volley', 'nova'], patternEvery: 3.8,
    novaBullets: 12, novaSpeed: 160,
  },
  colossus: {
    name: 'Colossus', hp: 6000, speed: 42, dmg: 24, r: 58, lvl: 10, color: '#5c7cfa', shape: 'square', xp: 40, boss: true,
    patterns: ['shockwave', 'charge', 'quake', 'meteors'], patterns2: ['shockwave', 'charge', 'meteors', 'charge', 'quake', 'summon'], patternEvery: 4,
    windup: 0.85, dashSpeed: 640, dashTime: 0.7, hitDmg: 2.5,
  },
  matriarch: {
    name: 'Matriarch', hp: 4600, speed: 60, dmg: 18, r: 50, lvl: 10, color: '#e64980', shape: 'circle', xp: 40,
    ranged: 380, shootRate: 0.6, burst: 2, projSpeed: 210, boss: true,
    patterns: ['summon', 'spiral', 'slam'], patterns2: ['summon', 'spiral', 'nova', 'meteors', 'spiral', 'slam'], patternEvery: 4,
    novaBullets: 18, novaSpeed: 170, slamR: 120, slamDelay: 1,
  },
};
const BOSS_ORDER = ['boss', 'overseer', 'colossus', 'matriarch'];
// Non-boss enemies alive this long become enraged (faster, harder hitting, faster attacks).
const ENRAGE_SPEED = 1.3;
const ENRAGE_DMG = 1.5;
const ENRAGE_CD = 0.7;