'use strict';

const UI = {
  overlay: null,
  hud: null,
  tooltip: null,
  pickOpen: false,
  pickOptions: null,

  init() {
    this.overlay = document.getElementById('overlay');
    this.hud = document.getElementById('hud');
    this.tooltip = document.getElementById('tooltip');

    this.overlay.addEventListener('click', e => this.onClick(e));
    this.overlay.addEventListener('change', e => this.onChange(e));
    this.hud.addEventListener('click', e => this.onClick(e));
    this.hud.addEventListener('contextmenu', e => this.onHudContextMenu(e));
    document.addEventListener('mouseover', e => this.onHover(e));
    document.addEventListener('mousemove', e => this.moveTooltip(e));

    this.showMenu();
  },

  show(html) {
    this.overlay.innerHTML = html;
    this.overlay.classList.remove('hidden');
    this.tooltip.classList.add('hidden');
  },

  hideOverlay() {
    this.overlay.classList.add('hidden');
    this.overlay.innerHTML = '';
    this.tooltip.classList.add('hidden');
  },

  // ---------- Screens ----------

  showMenu() {
    Game.state = 'menu';
    this.hud.innerHTML = '';
    const m = Game.meta;
    this.show(`
      <div class="screen menu">
        <h1>TURRET PROTOTYPE</h1>
        <p class="sub">Shooter · Survival · Roguelike</p>
        <div class="menu-buttons">
          <button class="big" data-act="pickChar">New Run</button>
        </div>
        <div class="menu-info">Best time: ${formatTime(m.bestTime)} · Most maps cleared: ${m.bestMaps} · Runs: ${m.runs}</div>
        <div class="howto">
          <b>How to play</b><br>
          Move with <b>WASD</b> and dash with <b>Space</b>. You are invulnerable for a moment while dashing, and enemy shots pass through you.<br>
          Your weapons fire on their own. Each character has a fixed loadout, and the weapons get stronger at levels ${WEAPON_TIER_LEVELS.slice(1).join(', ')}.<br>
          Each <b>map</b> is large: explore it, kill enemies for <b>gold</b> and spend it on the <b>chests</b> scattered around (<b>E</b> to open, then pick 1 of 3 items). <b>Shrines of Chance</b> may pay out an item, and get pricier with every try. The minimap starts dark and clears as you explore; chests, shrines, items and the teleporter you have found stay marked on it. Enemies sometimes drop an item; walk over it to pick it up.<br>
          When you are ready, find the <b>teleporter</b> and press <b>E</b>: the map's <b>boss</b> appears and enemies swarm. Stay inside the red zone until the teleporter is fully charged and kill the boss. Then enemies stop coming, and <b>E</b> at the teleporter takes you to the next, harder map. Difficulty also rises with time, so do not dawdle.<br>
          Bosses enrage at half HP: they get faster and use new attacks. While exploring, enemies come in waves: a <b>surge</b> swarms you, then a <b>breather</b> lets you recover.<br>
          Watch for warnings: laser lines, red blast circles and charge paths. Dash through beams and shockwaves. Enemies left alive too long <b>enrage</b> (dark core with a red rim): faster and harder hitting.<br>
          Every item you own is always active; hover an item at the bottom of the screen to see what it does.<br>
          <b>Equipment</b> (orange, from Equipment Barrels and rare drops) goes in a single slot and is used with <b>Shift</b>. Aimed equipment targets the mouse cursor. Holding one, press <b>E</b> on another to swap.<br>
          Each weapon has its own targeting mode (keys <b>1-4</b> or click a weapon to cycle). The <b>Engineer</b> has no gun: his numbered turrets roam around him, carry all his items, and each one's targeting is set the same way. You have one life: dying ends the run.
        </div>
      </div>`);
  },

  showCharacterPick() {
    const cards = CHARACTERS.map(ch => {
      const stats = [
        `HP ${ch.hp}`, `Regen ${ch.regen}/s`, `Armor ${ch.armor}`, `Speed ${ch.speed}`,
        `Dash ${ch.dashCharges}× / ${ch.dashCd}s`,
      ];
      if (ch.dmgMult !== 1) stats.push(`Damage ×${ch.dmgMult}`);
      if (ch.crit) stats.push(`Crit +${ch.crit}%`);
      return `
      <div class="card char-card" data-act="startRun" data-arg="${ch.id}" style="--c:${ch.color}">
        <div class="char-badge"></div>
        <div class="card-title" style="color:${ch.color}">${ch.name}</div>
        <div class="char-role">${ch.role}</div>
        <div class="card-desc">${ch.desc}</div>
        <div class="char-weapons" data-char-weapons="${ch.id}">${this.loadoutLabel(ch.id)}</div>
        <div class="card-stats">${stats.join(' · ')}</div>
      </div>`;
    }).join('');
    this.show(`
      <div class="screen">
        <h2>Choose your character</h2>
        <div class="card-row wrap">${cards}</div>
        ${this.runSettingsPanel()}
        <button data-act="menu">Back</button>
      </div>`);
  },

  loadoutLabel(charId) {
    const counts = {};
    for (const id of loadoutWeapons(charId, Game.settings)) counts[id] = (counts[id] || 0) + 1;
    return Object.entries(counts).map(([id, n]) => `<span style="color:${WEAPONS[id].color}">${WEAPONS[id].name}${n > 1 ? ` ×${n}` : ''}</span>`).join(' · ');
  },

  // Debug matrix: starting copies of every weapon for every character.
  loadoutPanel() {
    const ids = Object.keys(WEAPONS);
    const head = ids.map(id => `<th style="color:${WEAPONS[id].color}">${WEAPONS[id].name}</th>`).join('');
    const rows = CHARACTERS.map(ch => {
      const lo = Game.settings.loadouts[ch.id];
      const cells = ids.map(id => `<td><input type="number" data-loadout="${ch.id}:${id}" min="0" max="${MAX_WEAPONS}" step="1" value="${lo[id] || 0}"></td>`).join('');
      return `<tr><th style="color:${ch.color}">${ch.name}</th>${cells}</tr>`;
    }).join('');
    return `
      <div class="rs-group loadouts">
        <h4>Starting weapons (debug) · max ${MAX_WEAPONS} per character · all 0 = default</h4>
        <table class="loadout-table"><tr><th></th>${head}</tr>${rows}</table>
      </div>`;
  },

  runSettingsPanel() {
    const s = Game.settings;
    const toggle = (key, label) => `
      <label class="setting"><span>${label}</span><input type="checkbox" data-setting="${key}" ${s[key] ? 'checked' : ''}></label>`;
    const num = (key, label, min, max, step) => `
      <label class="setting"><span>${label}</span><input type="number" data-setting="${key}" min="${min}" max="${max}" step="${step}" value="${s[key]}"></label>`;
    const select = (key, label, opts) => `
      <label class="setting"><span>${label}</span><select data-setting="${key}">${opts.map(([v, t]) => `<option value="${v}" ${s[key] === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
    const group = (title, rows) => `<div class="rs-group"><h4>${title}</h4>${rows.join('')}</div>`;
    return `
      <div class="run-settings">
        <div class="rs-head"><h3>Run Settings</h3><button class="small" data-act="resetSettings">Defaults</button></div>
        <div class="rs-grid">
          ${group('Loot & economy', [
            toggle('enemyDrops', 'Enemy item drops'),
            num('itemDropMult', 'Item drop chance ×', 0, 20, 0.1),
            num('goldMult', 'Gold gain ×', 0, 20, 0.1),
            num('chestCostMult', 'Chest price ×', 0.1, 20, 0.1),
            num('mapChests', 'Chests per map', 1, 40, 1),
            num('shrineCount', 'Shrines of Chance per map', 0, 10, 1),
          ])}
          ${group('Movement', [
            num('moveSpeed', 'Move speed ×', 0.3, 3, 0.05),
            num('dashCooldown', 'Dash cooldown ×', 0.1, 5, 0.05),
            num('dashIframes', 'Dash invulnerability (s)', 0, 2, 0.05),
          ])}
          ${group('Equipment', [
            select('startEquip', 'Starting equipment', [['', 'None'], ...ITEMS.filter(it => it.tier === EQUIP_TIER).map(it => [it.id, it.name])]),
            num('equipCdMult', 'Equipment cooldown ×', 0.05, 5, 0.05),
          ])}
          ${group('Wave pacing', [
            toggle('wavePacing', 'Surges and breathers'),
            num('waveCycle', 'Cycle length (s)', 20, 300, 1),
            num('surgeSeconds', 'Surge length (s)', 0, 120, 1),
            num('breatherSeconds', 'Breather length (s)', 0, 120, 1),
            num('surgeMult', 'Surge spawn rate ×', 1, 6, 0.1),
          ])}
          ${group('Difficulty', [
            num('teleporterCharge', 'Teleporter charge time (s)', 5, 300, 1),
            num('enrageSeconds', 'Enemies enrage after X s alive (0 = off)', 0, 300, 1),
            num('enemyHp', 'Enemy HP ×', 0.1, 20, 0.1),
            num('enemyDmg', 'Enemy damage ×', 0.1, 20, 0.1),
            num('enemySpeed', 'Enemy speed ×', 0.3, 3, 0.05),
            num('playerHp', 'Player HP ×', 0.1, 20, 0.1),
            num('playerDmg', 'Player damage ×', 0.1, 20, 0.1),
          ])}
        </div>
        ${this.loadoutPanel()}
      </div>`;
  },

  showRunEnd(best) {
    const r = Game.run;
    this.pickOpen = false;
    this.hud.innerHTML = '';
    this.show(`
      <div class="screen">
        <h1 style="color:#ff6b6b">${r.char.name.toUpperCase()} DOWN</h1>
        <div class="end-stats">
          <div>Character: <b style="color:${r.char.color}">${r.char.name}</b> <span class="muted">${r.char.role}</span></div>
          <div>Time survived: <b>${formatTime(r.time)}</b>${best ? ' <b style="color:#ffd43b">NEW BEST</b>' : ''}</div>
          <div>Reached: <b>Map ${r.mapN} · ${r.map.name}</b> · Maps cleared: <b>${r.mapsCleared}</b></div>
          <div>Level: <b>${r.level}</b></div>
          <div>Kills: <b>${r.kills}</b></div>
          <div>Bosses killed: <b>${r.bossKills}</b></div>
          <div>Gold earned: <b>${Math.floor(r.goldEarned).toLocaleString()}</b> · Chests opened: <b>${r.chestsOpened}</b></div>
          <div>Damage dealt: <b>${Math.round(r.dmgDealt).toLocaleString()}</b></div>
        </div>
        <div class="row">
          <button class="big" data-act="menu">Main Menu</button>
          <button class="big" data-act="pickChar">New Run</button>
        </div>
      </div>`);
  },

  showPause() {
    this.show(`
      <div class="screen small">
        <h2>Paused</h2>
        <div class="row">
          <button class="big" data-act="resume">Resume</button>
          <button class="danger" data-act="abandon">Abandon run</button>
        </div>
        ${this.statsPanel()}
      </div>`);
  },

  // ---------- Item pick (chests) ----------

  openItemPick() {
    this.pickOpen = true;
    Game.paused = true;
    Game.keys.up = Game.keys.down = Game.keys.left = Game.keys.right = false;
    this.pickOptions = rollItemChoices(Game.run.itemChoices[0].tier);
    this.renderItemPick();
  },

  renderItemPick() {
    const r = Game.run;
    const { tier, n } = r.itemChoices[0];
    const held = r.equip.id ? ITEM_BY_ID[r.equip.id].name : '';
    const cards = this.pickOptions.map((it, i) => {
      const owned = r.items.find(s => s.id === it.id);
      const note = it.tier === EQUIP_TIER ? (held ? ` · replaces ${held}` : '') : owned ? ` · owned ×${owned.n}` : '';
      return `
      <div class="card item-card" data-act="pickItem" data-arg="${i}" style="--c:${TIER_COLORS[tier]}">
        <img src="assets/items/${it.id}.png" alt="${it.icon}">
        <div class="card-title" style="color:${TIER_COLORS[tier]}">${it.name}</div>
        <div class="muted">${scopeLabel(it)}${note}</div>
        <div class="card-desc">${it.desc}</div>
        <span class="key">${i + 1}</span>
      </div>`;
    }).join('');
    const more = r.itemChoices.length - 1;
    this.show(`
      <div class="screen item-pick">
        <h2 style="color:${TIER_COLORS[tier]}">${TIER_NAMES[tier]} item${n > 1 ? ' ×2' : ''}${more ? ` <span class="muted">(+${more} more)</span>` : ''}</h2>
        <div class="card-row">${cards}</div>
        <button class="small" data-act="skipItem">Skip</button>
      </div>`);
  },

  pickItem(i) {
    const r = Game.run;
    const choice = r.itemChoices.shift();
    if (i !== null) {
      const it = this.pickOptions[i];
      Sfx.pick();
      if (it.tier === EQUIP_TIER) {
        setEquipment(it.id);
      } else {
        addItem(it.id, choice.n);
        recomputeStats();
      }
    }
    this.pickOptions = null;
    if (r.itemChoices.length) {
      this.pickOptions = rollItemChoices(r.itemChoices[0].tier);
      this.renderItemPick();
      return;
    }
    this.pickOpen = false;
    Game.paused = false;
    this.hideOverlay();
  },

  statsPanel() {
    const r = Game.run, S = r.stats;
    const rows = [
      ['Role', r.char.role],
      ['Level', r.level],
      ['Max HP', Math.round(S.maxHp)],
      ['Shield', S.maxShield],
      ['HP Regen', fmt(S.regen) + '/s'],
      ['Armor', S.armor],
      ['Dodge', Math.round(S.dodge) + '%'],
      ['Damage', signed(S.dmg) + '%' + (S.dmgMult !== 1 ? ` ×${fmt(S.dmgMult)}` : '')],
      ['Attack Speed', signed(S.rate) + '%'],
      ['Crit', signed(S.crit) + '%'],
      ['Move Speed', `${Math.round(moveSpeed())} (${signed(Math.round(S.movePct + r.dynMove))}%)`],
      ['Dash', `${S.dashCharges}× · ${fmt(S.dashCd)}s · ${Math.round(S.dashDist)} dist`],
      ['Equipment', r.equip.id ? `${ITEM_BY_ID[r.equip.id].name} · ${equipMaxCharges()}× · ${fmt(equipCd(r.equip.id))}s` : 'none'],
      ['Luck', S.luck],
      ['XP Gain', signed(S.xpPct) + '%'],
      ['Gold Gain', '×' + fmt(S.goldMult)],
      ['Pickup Range', S.pickup],
      ['Gold', Math.floor(r.gold)],
      ['Chests opened', r.chestsOpened],
      ['Kills', r.kills],
    ];
    return `<div class="stats-panel"><h3>${r.char.name}</h3>${rows.map(([k, v]) => `<div class="stat-row"><span>${k}</span><b>${v}</b></div>`).join('')}</div>`;
  },

  // ---------- In-game HUD: items and weapons ----------

  renderHud() {
    const r = Game.run;
    const items = r.items.map(s => {
      const it = ITEM_BY_ID[s.id];
      return `<div class="hud-item" data-item="${s.id}" data-n="${s.n}" style="--c:${TIER_COLORS[it.tier]}"><img src="assets/items/${it.id}.png" alt="${it.icon}">${s.n > 1 ? `<span class="stack">×${s.n}</span>` : ''}</div>`;
    }).join('');
    const weapons = r.weapons.map((w, i) => {
      const b = WEAPONS[w.id];
      return `<div class="hud-w" data-act="mount" data-arg="${i}" data-wtip="${i}" style="--c:${b.color}">
        <div class="hud-n"><b>${i + 1}</b> ${r.char.turrets && w.id !== 'gauss' ? 'Turret · ' : ''}${b.name} <span style="color:${WEAPON_TIER_COLORS[w.tier]}">${WEAPON_TIER_NAMES[w.tier]}</span></div>
        <div class="hud-t">${TARGETING.find(t => t.id === w.targeting).name}</div></div>`;
    }).join('');
    const eq = r.equip.id ? ITEM_BY_ID[r.equip.id] : null;
    const equip = `<div class="hud-equip${eq ? '' : ' empty'}" ${eq ? `data-item="${eq.id}"` : ''} style="--c:${TIER_COLORS[EQUIP_TIER]}">
        ${eq ? `<img src="assets/items/${eq.id}.png" alt="${eq.icon}">` : '<span class="eq-none">no equipment</span>'}
        <div class="eq-cd"></div><span class="eq-n"></span><span class="eq-key">SHIFT</span></div>`;
    this.hud.innerHTML = `
      <div class="hud-items">${items}</div>
      <div class="hud-row"><div class="hud-group">${weapons}</div><div class="hud-sep"></div>${equip}</div>`;
    this.eqCd = this.hud.querySelector('.eq-cd');
    this.eqN = this.hud.querySelector('.eq-n');
  },

  // Per-frame part of the HUD: the equipment cooldown shade and the charge count.
  tickHud() {
    const q = Game.run.equip;
    if (!q.id) return;
    const ready = q.charges > 0;
    const f = q.cdT > 0 ? q.cdT / equipCd(q.id) : 0;
    this.eqCd.style.height = (ready ? 0 : f * 100) + '%';
    this.eqCd.parentElement.classList.toggle('ready', ready);
    const n = equipMaxCharges() > 1 ? String(q.charges) : !ready ? String(Math.ceil(q.cdT)) : '';
    if (this.eqN.textContent !== n) this.eqN.textContent = n;
  },

  // ---------- Events ----------

  onClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const act = el.dataset.act, arg = el.dataset.arg;
    switch (act) {
      case 'menu': this.showMenu(); break;
      case 'pickChar': this.showCharacterPick(); break;
      case 'startRun': startRun(arg); break;
      case 'resetSettings':
        Game.settings = structuredClone(DEFAULT_SETTINGS);
        saveSettings();
        this.showCharacterPick();
        break;
      case 'resume': togglePause(); break;
      case 'abandon': endRun(); break;
      case 'pickItem': this.pickItem(+arg); break;
      case 'skipItem': this.pickItem(null); break;
      case 'mount': cycleTargeting(+arg, 1); break;
    }
  },

  onHudContextMenu(e) {
    e.preventDefault();
    const el = e.target.closest('[data-act]');
    if (el && el.dataset.act === 'mount') cycleTargeting(+el.dataset.arg, -1);
  },

  onChange(e) {
    const el = e.target;
    if (el.dataset.loadout) {
      const [charId, id] = el.dataset.loadout.split(':');
      const v = Math.round(Math.min(MAX_WEAPONS, Math.max(0, +el.value || 0)));
      Game.settings.loadouts[charId][id] = v;
      el.value = v;
      saveSettings();
      this.overlay.querySelector(`[data-char-weapons="${charId}"]`).innerHTML = this.loadoutLabel(charId);
      return;
    }
    const key = el.dataset.setting;
    if (!key) return;
    if (el.type === 'checkbox') {
      Game.settings[key] = el.checked;
    } else if (el.tagName === 'SELECT') {
      Game.settings[key] = el.value;
    } else {
      const v = Math.min(+el.max, Math.max(+el.min, +el.value || 0));
      Game.settings[key] = el.step === '1' ? Math.round(v) : v;
      el.value = Game.settings[key];
    }
    saveSettings();
  },

  onHover(e) {
    const el = e.target.closest && e.target.closest('[data-item],[data-wtip]');
    if (!el) { this.tooltip.classList.add('hidden'); return; }
    if (el.dataset.item) {
      const it = ITEM_BY_ID[el.dataset.item];
      const n = +el.dataset.n || 1;
      this.tooltip.innerHTML = `<b style="color:${TIER_COLORS[it.tier]}">${it.name}${n > 1 ? ` ×${n}` : ''}</b><div class="muted">${TIER_NAMES[it.tier]} · ${scopeLabel(it)}</div><div>${it.desc}</div>`;
    } else {
      const w = Game.run.weapons[+el.dataset.wtip];
      const b = WEAPONS[w.id], s = w.stats;
      const next = WEAPON_TIER_LEVELS[w.tier + 1];
      this.tooltip.innerHTML = `<b style="color:${b.color}">${b.name} ${WEAPON_TIER_NAMES[w.tier]}</b><div>${b.desc}</div>
        <div class="muted">Dmg ${fmt(s.dmg)}${s.count > 1 ? '×' + s.count : ''}${s.chains ? ' +' + s.chains + ' chains' : ''}${s.lanes > 1 ? ` · ${s.lanes} lanes` : ''} · Rate ${fmt(s.rate)}/s · Crit ${Math.round(s.crit)}% ×${s.critMult} · Range ${Math.round(s.range)} · DPS ~${Math.round(s.dps)}</div>
        <div class="muted">${next ? `Next tier at level ${next} · ` : ''}Click: next targeting · Right-click: previous</div>`;
    }
    this.tooltip.classList.remove('hidden');
  },

  moveTooltip(e) {
    if (this.tooltip.classList.contains('hidden')) return;
    const x = Math.min(e.clientX + 16, window.innerWidth - 280);
    const y = Math.min(e.clientY + 16, window.innerHeight - this.tooltip.offsetHeight - 8);
    this.tooltip.style.left = x + 'px';
    this.tooltip.style.top = y + 'px';
  },
};

function cycleTargeting(i, dir) {
  const w = Game.run.weapons[i];
  if (!w) return;
  const idx = TARGETING.findIndex(t => t.id === w.targeting);
  w.targeting = TARGETING[(idx + dir + TARGETING.length) % TARGETING.length].id;
  UI.renderHud();
}

function togglePause() {
  if (Game.state !== 'play' || UI.pickOpen) return;
  Game.paused = !Game.paused;
  if (Game.paused) UI.showPause();
  else UI.hideOverlay();
}

function scopeLabel(it) {
  if (it.scope === 'equip') return `Use with Shift · ${Game.run ? fmt(equipCd(it.id)) : it.cd}s cooldown`;
  return it.scope === 'core' ? 'Character' : 'All weapons';
}

function signed(v) {
  return (v >= 0 ? '+' : '') + v;
}

function fmt(v) {
  return v >= 10 ? Math.round(v).toString() : v.toFixed(1);
}

// ---------- Input ----------

const MOVE_KEYS = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
};

function initInput() {
  const canvas = Render.canvas;
  window.addEventListener('mousemove', e => {
    Game.mouse.sx = e.clientX;
    Game.mouse.sy = e.clientY;
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('blur', () => {
    const k = Game.keys;
    k.up = k.down = k.left = k.right = false;
  });
  window.addEventListener('keyup', e => {
    const dir = MOVE_KEYS[e.code];
    if (dir) Game.keys[dir] = false;
  });
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    const dir = MOVE_KEYS[e.code];
    if (dir) { Game.keys[dir] = true; if (e.code.startsWith('Arrow')) e.preventDefault(); }
    if (e.code === 'Space') e.preventDefault();
    if (e.repeat) return;
    if (UI.pickOpen) {
      const i = e.code.startsWith('Digit') ? +e.code.slice(5) - 1 : -1;
      if (i >= 0 && i < UI.pickOptions.length) UI.pickItem(i);
      return;
    }
    if (e.code === 'KeyM') Sfx.toggleMute();
    if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
    if (Game.state !== 'play' || Game.paused) return;
    if (e.code === 'Space') Game.dashQueued = true;
    if (e.code === 'KeyE') Game.interactQueued = true;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') Game.equipQueued = true;
    if (/^Digit[1-9]$/.test(e.code)) cycleTargeting(+e.code.slice(5) - 1, 1);
    if (e.code === 'KeyF') Game.speed = Game.speed >= 3 ? 1 : Game.speed + 1;
    if (e.code === 'KeyN') Game.showDmg = !Game.showDmg;
  });
}

window.addEventListener('load', () => {
  Render.init();
  UI.init();
  Sfx.init();
  initInput();
  requestAnimationFrame(frame);
});
