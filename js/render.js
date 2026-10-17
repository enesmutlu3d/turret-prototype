'use strict';

const MINIMAP_W = 260;

const Render = {
  canvas: null,
  ctx: null,
  // CSS px per world unit. The visible world area (viewW × viewH) is at least VIEW_W × VIEW_H.
  scale: 1,
  dpr: 1,
  viewW: VIEW_W,
  viewH: VIEW_H,
  camX: 0,
  camY: 0,
  // Pre-painted ground + rocks of the current map, its minimap (MINIMAP_W wide) and the minimap's fog.
  bg: null,
  minimap: null,
  fog: null,
  icons: {},

  init() {
    this.canvas = document.getElementById('game');
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.buildBackground(MAPS[0]);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  },

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = window.innerHeight;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.scale = Math.min(w / VIEW_W, h / VIEW_H);
    this.viewW = w / this.scale;
    this.viewH = h / this.scale;
    this.updateCamera();
  },

  // Follows the player, clamped so the camera does not show past the arena walls.
  updateCamera() {
    const focus = Game.run && Game.state !== 'menu' ? player : { x: WORLD_W / 2, y: WORLD_H / 2 };
    this.camX = this.viewW >= WORLD_W ? (WORLD_W - this.viewW) / 2 : Math.max(0, Math.min(WORLD_W - this.viewW, focus.x - this.viewW / 2));
    this.camY = this.viewH >= WORLD_H ? (WORLD_H - this.viewH) / 2 : Math.max(0, Math.min(WORLD_H - this.viewH, focus.y - this.viewH / 2));
  },

  icon(id) {
    let img = this.icons[id];
    if (!img) {
      img = this.icons[id] = new Image();
      img.src = `assets/items/${id}.png`;
    }
    return img;
  },

  // Paints the map once: ground tone, soft patches, specks, a faint grid, then the rocks with their shadows.
  buildBackground(def) {
    const W = WORLD_W, H = WORLD_H;
    const c = this.bg && this.bg.width === W && this.bg.height === H ? this.bg : document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = def.ground;
    g.fillRect(0, 0, W, H);
    for (let i = Math.round(W * H / 150000); i > 0; i--) {
      const x = Math.random() * W, y = Math.random() * H, rad = 120 + Math.random() * 320;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, def.patch);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    g.fillStyle = def.speck;
    for (let i = Math.round(W * H / 2500); i > 0; i--) {
      const x = Math.random() * W, y = Math.random() * H, s = 1.5 + Math.random() * 2.5;
      if (Math.random() < 0.5) g.fillRect(x, y, s, s);
      else { g.fillRect(x, y, 1.5, -s * 2); g.fillRect(x + 3, y, 1.5, -s * 1.4); g.fillRect(x - 3, y, 1.5, -s * 1.6); }
    }
    g.strokeStyle = 'rgba(255,255,255,0.025)';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x <= W; x += 100) { g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); }
    for (let y = 0; y <= H; y += 100) { g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); }
    g.stroke();
    const glow = g.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, Math.max(W, H) * 0.7);
    glow.addColorStop(0, def.glow);
    glow.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);

    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (const k of rocks) { rockPath(g, k, 8, 10, 1); g.fill(); }
    for (const k of rocks) {
      rockPath(g, k, 0, 0, 1);
      g.fillStyle = def.rock;
      g.fill();
      g.strokeStyle = def.rockEdge;
      g.lineWidth = 3;
      g.stroke();
      rockPath(g, k, -k.r * 0.18, -k.r * 0.22, 0.55);
      g.fillStyle = 'rgba(255,255,255,0.07)';
      g.fill();
    }
    g.strokeStyle = '#495057';
    g.lineWidth = 6;
    g.strokeRect(3, 3, W - 6, H - 6);
    this.bg = c;
    this.buildMinimap(def);
  },

  buildMinimap(def) {
    const s = MINIMAP_W / WORLD_W;
    const c = document.createElement('canvas');
    c.width = MINIMAP_W; c.height = Math.round(WORLD_H * s);
    const g = c.getContext('2d');
    g.fillStyle = def.ground;
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = def.rock;
    g.beginPath();
    for (const k of rocks) { g.moveTo(k.x * s + k.r * s, k.y * s); g.arc(k.x * s, k.y * s, Math.max(1, k.r * s), 0, Math.PI * 2); }
    g.fill();
    this.minimap = c;
    const fog = document.createElement('canvas');
    fog.width = c.width; fog.height = c.height;
    const f = fog.getContext('2d');
    f.fillStyle = 'rgba(6,7,10,0.6)';
    f.fillRect(0, 0, fog.width, fog.height);
    this.fog = fog;
  },

  // Clears the fog around the player with a soft edge; cleared parts stay clear for the rest of the map.
  revealFog() {
    const s = MINIMAP_W / WORLD_W, f = this.fog.getContext('2d');
    const x = player.x * s, y = player.y * s, rad = MAP_REVEAL_R * s;
    const grad = f.createRadialGradient(x, y, rad * 0.6, x, y, rad);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    f.globalCompositeOperation = 'destination-out';
    f.fillStyle = grad;
    f.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    f.globalCompositeOperation = 'source-over';
  },

  draw() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#07080a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const s = this.scale * this.dpr;
    if (Game.state === 'menu') this.updateCamera();
    ctx.setTransform(s, 0, 0, s, -this.camX * s, -this.camY * s);
    const bx = Math.max(0, this.camX), by = Math.max(0, this.camY);
    const bw = Math.min(WORLD_W, this.camX + this.viewW) - bx, bh = Math.min(WORLD_H, this.camY + this.viewH) - by;
    if (bw > 0 && bh > 0) ctx.drawImage(this.bg, bx, by, bw, bh, bx, by, bw, bh);

    const r = Game.run;
    if (!r || Game.state === 'menu') return;

    this.drawRanges(ctx, r);
    this.drawAreas(ctx, r);
    this.drawTeleporter(ctx, r);
    this.drawChests(ctx, r);
    this.drawLoot(ctx);
    this.drawEnemies(ctx);
    this.drawEnemyAttacks(ctx);
    this.drawAllies(ctx);
    this.drawTurrets(ctx, r);
    this.drawEquipment(ctx, r);
    this.drawBullets(ctx);
    this.drawEnemyBullets(ctx);
    this.drawPlayer(ctx, r);
    this.drawFx(ctx);
    this.drawParticles(ctx);
    this.drawTexts(ctx);
    this.drawLabels(ctx, r);

    ctx.setTransform(s, 0, 0, s, 0, 0);
    if (r.buffT.unstablewatch > 0) {
      ctx.fillStyle = `rgba(80,140,255,${0.12 + 0.04 * Math.sin(r.time * 8)})`;
      ctx.fillRect(0, 0, this.viewW, this.viewH);
    }
    if (r.hurtFlash > 0) {
      ctx.fillStyle = `rgba(255,40,40,${r.hurtFlash * 0.8})`;
      ctx.fillRect(0, 0, this.viewW, this.viewH);
    }
    if (r.fadeT > 0) {
      ctx.fillStyle = `rgba(0,0,0,${Math.min(1, r.fadeT)})`;
      ctx.fillRect(0, 0, this.viewW, this.viewH);
    }
    this.drawIndicators(ctx, r);
    this.drawHud(ctx, r);
    this.drawMapTitle(ctx, r);
  },

  // Map name card shown for a few seconds after landing on a map.
  drawMapTitle(ctx, r) {
    if (r.mapTitleT <= 0) return;
    ctx.globalAlpha = Math.min(1, r.mapTitleT, (4 - r.mapTitleT) * 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cx = this.viewW / 2, y = this.viewH * 0.3;
    ctx.fillStyle = '#ced4da';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(`MAP ${r.mapN}`, cx, y - 34);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 44px sans-serif';
    ctx.fillText(r.map.name.toUpperCase(), cx, y);
    ctx.fillStyle = '#adb5bd';
    ctx.font = '14px sans-serif';
    ctx.fillText('Explore, loot the chests, then find the teleporter', cx, y + 36);
    ctx.globalAlpha = 1;
  },

  // Pad with four prongs. While charging: the dashed zone the player must stay in and a charge ring.
  drawTeleporter(ctx, r) {
    const tp = teleporter, t = r.time;
    if (tp.state === 'charging') {
      ctx.fillStyle = tp.inside ? 'rgba(255,60,60,0.07)' : 'rgba(255,60,60,0.03)';
      ctx.strokeStyle = `rgba(255,107,107,${tp.inside ? 0.6 : 0.4 + 0.25 * Math.sin(t * 6)})`;
      ctx.lineWidth = 3;
      ctx.setLineDash([18, 12]);
      ctx.lineDashOffset = -t * 30;
      ctx.beginPath();
      ctx.arc(tp.x, tp.y, TELEPORTER_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }
    const col = tp.state === 'done' ? '105,219,124' : tp.state === 'charging' ? '255,107,107' : '255,168,168';
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(tp.x + 6, tp.y + 10, 56, 44, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2b2f36';
    ctx.strokeStyle = '#495057';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(tp.x, tp.y, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = `rgba(${col},${0.25 + 0.15 * Math.sin(t * 4)})`;
    ctx.beginPath();
    ctx.arc(tp.x, tp.y, 32, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#868e96';
    const spin = tp.state === 'charging' ? t * 0.8 : 0;
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + k * Math.PI / 2 + spin, ca = Math.cos(a), sa = Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(tp.x + ca * 70, tp.y + sa * 70);
      ctx.lineTo(tp.x + ca * 42 - sa * 9, tp.y + sa * 42 + ca * 9);
      ctx.lineTo(tp.x + ca * 42 + sa * 9, tp.y + sa * 42 - ca * 9);
      ctx.closePath();
      ctx.fill();
    }
    if (tp.state === 'idle') return;
    ctx.strokeStyle = `rgb(${col})`;
    ctx.lineWidth = 6;
    ctx.beginPath();
    const f = tp.state === 'done' ? 1 : tp.charge;
    ctx.arc(tp.x, tp.y, 56, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f);
    ctx.stroke();
  },

  drawRanges(ctx, r) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(105,219,124,0.08)';
    ctx.beginPath();
    ctx.arc(player.x, player.y, r.stats.pickup, 0, Math.PI * 2);
    ctx.stroke();
  },

  drawAreas(ctx, r) {
    const c = r.stats.core;
    if (trail.length) {
      ctx.fillStyle = 'rgba(255,146,43,0.35)';
      ctx.beginPath();
      for (const p of trail) {
        const rad = 14 + 8 * Math.min(1, p.t);
        ctx.moveTo(p.x + rad, p.y);
        ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    if (c.fungus && player.stillT >= 1) {
      ctx.fillStyle = 'rgba(105,219,124,0.12)';
      ctx.strokeStyle = 'rgba(105,219,124,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(player.x, player.y, 70 + 30 * (c.fungus - 1), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (r.frostR > 0) {
      ctx.fillStyle = 'rgba(165,216,255,0.10)';
      ctx.beginPath();
      ctx.arc(player.x, player.y, r.frostR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineWidth = 2;
    if (r.chargeR > 0) {
      ctx.strokeStyle = 'rgba(177,151,252,0.6)';
      ctx.beginPath();
      ctx.arc(player.x, player.y, r.chargeR, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (c.barbed) {
      ctx.setLineDash([4, 8]);
      ctx.strokeStyle = 'rgba(206,212,218,0.35)';
      ctx.beginPath();
      ctx.arc(player.x, player.y, barbedRadius(c.barbed), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const z of zones) {
      ctx.fillStyle = z.color;
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Ground blasts: the inner disc grows until it fills the ring, then the blast lands.
    for (const h of hazards) {
      const k = 1 - h.t / h.maxT;
      ctx.fillStyle = 'rgba(255,60,60,0.12)';
      ctx.strokeStyle = 'rgba(255,107,107,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,60,60,0.25)';
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.r * k, 0, Math.PI * 2);
      ctx.fill();
    }
    // Shockwave rings: a thick band with a bright leading edge.
    for (const w of waves) {
      if (w.delay > 0) continue;
      const fade = 1 - w.r / w.maxR;
      ctx.strokeStyle = `rgba(116,143,252,${0.35 * fade + 0.1})`;
      ctx.lineWidth = w.w;
      ctx.beginPath();
      ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `rgba(219,228,255,${0.8 * fade + 0.2})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(w.x, w.y, w.r + w.w / 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.drawTelegraphs(ctx);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,212,59,0.5)';
    ctx.beginPath();
    for (const d of delayed) {
      if (d.ev.t !== 'explode') continue;
      ctx.moveTo(d.ev.x + d.ev.r, d.ev.y);
      ctx.arc(d.ev.x, d.ev.y, d.ev.r, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.fillStyle = '#ff8787';
    ctx.beginPath();
    for (const m of mines) {
      ctx.moveTo(m.x + 6, m.y);
      ctx.arc(m.x, m.y, 6, 0, Math.PI * 2);
    }
    ctx.fill();
  },

  // Warnings for attacks that are about to happen, drawn under the enemies.
  drawTelegraphs(ctx) {
    const now = performance.now() / 1000;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.atk || !e.alive) continue;
      const d = e.def;
      switch (e.atk) {
        case ATK_LASER: {
          const z = e.lz;
          const k = 1 - e.atkT / z.charge;
          const locked = e.atkT <= z.lock;
          const blink = locked && Math.sin(now * 40) > 0;
          if (z.sweep) {
            const a0 = e.aimA - z.sweep / 2 * z.dir, a1 = e.aimA + z.sweep / 2 * z.dir;
            ctx.fillStyle = `rgba(255,212,59,${0.05 + 0.1 * k})`;
            ctx.beginPath();
            ctx.moveTo(e.x, e.y);
            ctx.arc(e.x, e.y, z.len, Math.min(a0, a1), Math.max(a0, a1));
            ctx.closePath();
            ctx.fill();
            this.beamLine(ctx, e.x, e.y, a0, z.len, blink ? z.w * 0.6 : 2 + 4 * k, blink ? 'rgba(255,255,255,0.9)' : `rgba(255,212,59,${0.35 + 0.5 * k})`);
            break;
          }
          for (let n = 0; n < z.n; n++) {
            const a = e.aimA + (n - (z.n - 1) / 2) * z.spread;
            this.beamLine(ctx, e.x, e.y, a, z.len, blink ? z.w * 0.6 : 1 + 3 * k, blink ? 'rgba(255,255,255,0.9)' : `rgba(255,212,59,${0.25 + 0.55 * k})`);
          }
          // Gathering energy at the muzzle.
          ctx.fillStyle = `rgba(255,236,153,${0.3 + 0.6 * k})`;
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.r * 0.4 + z.w * 0.4 * k, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case ATK_WINDUP:
          this.beamLine(ctx, e.x, e.y, e.aimA, d.dashSpeed * d.dashTime, e.r * 2, `rgba(240,101,149,${0.12 + 0.25 * (1 - e.atkT / d.windup)})`);
          break;
        case ATK_SHOCK: {
          const k = 1 - e.atkT / 0.9;
          ctx.strokeStyle = `rgba(145,167,255,${0.4 + 0.5 * k})`;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.r + 40 * (1 - k) + 6, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case ATK_FUSE: {
          const k = 1 - e.atkT / d.fuse;
          ctx.fillStyle = 'rgba(255,212,59,0.10)';
          ctx.strokeStyle = 'rgba(255,212,59,0.8)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(e.x, e.y, d.blastR, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = 'rgba(255,212,59,0.22)';
          ctx.beginPath();
          ctx.arc(e.x, e.y, d.blastR * k, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
      }
    }
  },

  beamLine(ctx, x, y, a, len, w, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  },

  // Fired lasers and mortar shells in flight, drawn above the enemies.
  drawEnemyAttacks(ctx) {
    ctx.lineCap = 'round';
    for (const b of beams) {
      const fade = Math.min(1, b.t / Math.min(b.maxT, 0.15));
      this.beamLine(ctx, b.x, b.y, b.a, b.len, b.w * 1.9, `rgba(255,146,43,${0.25 * fade})`);
      this.beamLine(ctx, b.x, b.y, b.a, b.len, b.w, `rgba(255,212,59,${0.85 * fade})`);
      this.beamLine(ctx, b.x, b.y, b.a, b.len, b.w * 0.35, `rgba(255,255,255,${fade})`);
    }
    ctx.lineCap = 'butt';
    ctx.fillStyle = '#ff922b';
    ctx.strokeStyle = '#212529';
    ctx.lineWidth = 2;
    for (const h of hazards) {
      if (h.sx === undefined) continue;
      const k = 1 - h.t / h.maxT;
      const x = h.sx + (h.x - h.sx) * k, y = h.sy + (h.y - h.sy) * k - Math.sin(k * Math.PI) * 140;
      const s = 6 + Math.sin(k * Math.PI) * 4;
      ctx.beginPath();
      ctx.arc(x, y, s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  },

  drawChests(ctx, r) {
    const near = nearestChest();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const c of chests) {
      const def = CHESTS[c.type];
      if (def.shrine) { this.drawShrine(ctx, r, c, def, c === near); continue; }
      const bob = Math.sin(c.t * 3) * 1.5;
      const x = c.x - def.w / 2, y = c.y - def.h / 2 + bob;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(c.x, c.y + def.h / 2 + 4, def.w * 0.55, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      if (c === near) {
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 4, y - 4, def.w + 8, def.h + 8);
      }
      ctx.fillStyle = def.color;
      ctx.fillRect(x, y, def.w, def.h);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(x, y + def.h * 0.38, def.w, 3);
      ctx.fillStyle = '#ffd43b';
      ctx.fillRect(c.x - 3, y + def.h * 0.3, 6, 7);
      ctx.strokeStyle = '#212529';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, def.w, def.h);
      const price = c.price;
      ctx.font = 'bold 13px sans-serif';
      ctx.fillStyle = r.gold >= price ? '#ffd43b' : '#868e96';
      ctx.fillText(`$${price}`, c.x, y - 12);
    }
  },

  // A stone obelisk on a plinth with a glowing core; the price sits above it.
  drawShrine(ctx, r, c, def, near) {
    const x = c.x, y = c.y;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(x + 4, y + 22, 24, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#495057';
    ctx.fillRect(x - 17, y + 10, 34, 10);
    ctx.fillStyle = '#343a40';
    ctx.strokeStyle = near ? '#fff' : '#212529';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 11, y + 10);
    ctx.lineTo(x - 8, y - 22);
    ctx.lineTo(x, y - 32);
    ctx.lineTo(x + 8, y - 22);
    ctx.lineTo(x + 11, y + 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(c.t * 4);
    ctx.fillStyle = def.color;
    ctx.beginPath();
    ctx.arc(x, y - 10, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = r.gold >= c.price ? '#ffd43b' : '#868e96';
    ctx.fillText(`$${c.price}`, x, y - 46);
  },

  drawLoot(ctx) {
    ctx.beginPath();
    let any = false;
    ctx.fillStyle = '#ff6b6b';
    for (const o of orbs) {
      if (o.kind) continue;
      any = true;
      ctx.moveTo(o.x + 4, o.y);
      ctx.arc(o.x, o.y, 4, 0, Math.PI * 2);
    }
    if (any) ctx.fill();
    // Coins: gold disc with a dark rim, plus a small highlight.
    ctx.beginPath();
    any = false;
    for (const o of orbs) {
      if (o.kind !== 'gold') continue;
      any = true;
      ctx.moveTo(o.x + 4.5, o.y);
      ctx.arc(o.x, o.y, 4.5, 0, Math.PI * 2);
    }
    if (any) {
      ctx.fillStyle = '#fab005';
      ctx.strokeStyle = '#7a5200';
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffe066';
      ctx.beginPath();
      for (const o of orbs) {
        if (o.kind !== 'gold') continue;
        ctx.moveTo(o.x - 0.5, o.y - 1.5);
        ctx.arc(o.x - 1.5, o.y - 1.5, 1.6, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    for (const o of orbs) {
      if (o.kind !== 'antler') continue;
      ctx.globalAlpha = Math.min(1, o.t);
      ctx.fillStyle = 'rgba(99,230,190,0.25)';
      ctx.beginPath();
      ctx.arc(o.x, o.y, 14 + 2 * Math.sin(o.t * 8), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#63e6be';
      ctx.beginPath();
      ctx.arc(o.x, o.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    // Ground items show their icon on a tier-coloured disc with a soft pulse.
    for (const d of drops) {
      const col = TIER_COLORS[d.tier];
      const pulse = 1 + 0.12 * Math.sin(d.t * 5);
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 24 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#1c1f24';
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 17, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      const img = this.icon(d.id);
      if (img.complete && img.naturalWidth) ctx.drawImage(img, d.x - 13, d.y - 13, 26, 26);
    }
  },

  drawEnemies(ctx) {
    for (const type in ENEMIES) {
      const def = ENEMIES[type];
      ctx.fillStyle = def.color;
      ctx.beginPath();
      let any = false;
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (e.type !== type || !e.alive) continue;
        any = true;
        shapePath(ctx, def.shape, e.x, e.y, e.r);
      }
      if (any) ctx.fill();
    }

    ctx.beginPath();
    let flash = false;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.flash > 0 && e.alive) { flash = true; ctx.moveTo(e.x + e.r * 0.7, e.y); ctx.arc(e.x, e.y, e.r * 0.7, 0, Math.PI * 2); }
    }
    if (flash) { ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill(); }

    // Enraged enemies (alive too long) get a dark core with a red rim, visible on every enemy colour.
    ctx.beginPath();
    let angry = false;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.enraged && e.alive) { angry = true; ctx.moveTo(e.x + e.r * 0.45, e.y); ctx.arc(e.x, e.y, e.r * 0.45, 0, Math.PI * 2); }
    }
    if (angry) {
      ctx.fillStyle = '#1a0505';
      ctx.strokeStyle = '#ff4040';
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
    }

    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffd43b';
    ctx.beginPath();
    let elite = false;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if ((e.elite || e.boss) && e.alive) { elite = true; ctx.moveTo(e.x + e.r + 3, e.y); ctx.arc(e.x, e.y, e.r + 3, 0, Math.PI * 2); }
    }
    if (elite) ctx.stroke();

    // Bosses in their second phase pulse with a red aura.
    const pulse = 10 + 4 * Math.sin(performance.now() / 120);
    ctx.strokeStyle = 'rgba(255,64,64,0.7)';
    ctx.beginPath();
    let enraged = false;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.boss && e.phase2 && e.alive) { enraged = true; ctx.moveTo(e.x + e.r + pulse, e.y); ctx.arc(e.x, e.y, e.r + pulse, 0, Math.PI * 2); }
    }
    if (enraged) ctx.stroke();

    ctx.lineWidth = 2;
    statusRings(ctx, '#a5d8ff', 1, e => e.freezeT > 0 || e.slowT > 0);
    statusRings(ctx, '#ffe066', 5, e => e.stunT > 0);
    statusRings(ctx, '#94d82d', 5, e => e.rootT > 0);
    statusRings(ctx, '#cc5de8', 7, e => e.fearT > 0);
    statusRings(ctx, '#ff6b6b', 9, e => e.marked);

    ctx.fillStyle = '#ff922b';
    ctx.beginPath();
    let hot = false;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if ((e.burnT > 0 || e.bleedT > 0 || e.stickyT > 0) && e.alive) { hot = true; ctx.rect(e.x - 2, e.y - e.r - 6, 4, 4); }
    }
    if (hot) ctx.fill();
    ctx.fillStyle = '#94d82d';
    ctx.beginPath();
    let toxic = false;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.poisonT > 0 && e.alive) { toxic = true; ctx.rect(e.x + 3, e.y - e.r - 6, 4, 4); }
    }
    if (toxic) ctx.fill();

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.hp < e.maxHp && e.alive) ctx.rect(e.x - e.r, e.y + e.r + 3, e.r * 2, 3);
    }
    ctx.fill();
    ctx.fillStyle = '#ff8787';
    ctx.beginPath();
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.hp < e.maxHp && e.alive) ctx.rect(e.x - e.r, e.y + e.r + 3, e.r * 2 * Math.max(0, e.hp / e.maxHp), 3);
    }
    ctx.fill();
  },

  drawAllies(ctx) {
    for (const a of allies) {
      ctx.fillStyle = a.color;
      ctx.globalAlpha = a.kind === 'ghost' ? 0.7 : 1;
      ctx.beginPath();
      if (a.kind === 'ghost') ctx.arc(a.x, a.y, 9, 0, Math.PI * 2);
      else shapePath(ctx, 'diamond', a.x, a.y, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },

  // Engineer turrets: tripod base, rotating barrel, and the HUD slot number used to change their targeting.
  drawTurrets(ctx, r) {
    if (!r.char.turrets) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 11px sans-serif';
    for (let i = 0; i < r.weapons.length; i++) {
      const w = r.weapons[i], b = WEAPONS[w.id];
      ctx.save();
      ctx.translate(w.x, w.y);
      ctx.strokeStyle = '#495057';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const a = Math.PI / 2 + k * Math.PI * 2 / 3;
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * (TURRET_R + 5), Math.sin(a) * (TURRET_R + 5));
      }
      ctx.stroke();
      ctx.fillStyle = '#343a40';
      ctx.beginPath();
      ctx.arc(0, 0, TURRET_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = r.char.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.rotate(w.angle);
      ctx.fillStyle = b.color;
      ctx.fillRect(0, -b.width / 2, b.barrel, b.width);
      ctx.fillStyle = WEAPON_TIER_COLORS[w.tier];
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#212529';
      ctx.beginPath();
      ctx.arc(0, 0, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      label(ctx, String(i + 1), w.x, w.y - TURRET_R - 12, r.char.color);
    }
  },

  drawBullets(ctx) {
    const groups = this.bulletGroups || (this.bulletGroups = new Map());
    groups.clear();
    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i];
      let g = groups.get(b.color);
      if (!g) { g = []; groups.set(b.color, g); }
      g.push(b);
    }
    ctx.lineCap = 'round';
    for (const [color, list] of groups) {
      const flames = [];
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (b.kind === 2) { flames.push(b); continue; }
        const k = b.kind === 0 ? 0.018 : 0.03;
        ctx.moveTo(b.x - b.vx * k, b.y - b.vy * k);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
      if (flames.length) {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.45;
        ctx.beginPath();
        for (const b of flames) {
          const t = 1 - b.life / b.maxLife;
          const rad = 3 + t * 10;
          ctx.moveTo(b.x + rad, b.y);
          ctx.arc(b.x, b.y, rad, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    ctx.lineCap = 'butt';
  },

  drawEnemyBullets(ctx) {
    if (!ebullets.length) return;
    ctx.fillStyle = '#e599f7';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < ebullets.length; i++) {
      const b = ebullets[i];
      ctx.moveTo(b.x + 5, b.y);
      ctx.arc(b.x, b.y, 5, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();
  },

  // World-space visuals of active equipment: Preon orbs, lantern posts, the Buddy decoy.
  drawEquipment(ctx, r) {
    for (const g of gadgets) {
      const pulse = 1 + 0.15 * Math.sin(g.t * 20);
      ctx.fillStyle = 'rgba(153,233,242,0.25)';
      ctx.beginPath();
      ctx.arc(g.x, g.y, 26 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e3fafc';
      ctx.beginPath();
      ctx.arc(g.x, g.y, 11, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const z of zones) {
      if (!z.fear) continue;
      ctx.fillStyle = '#495057';
      ctx.fillRect(z.x - 2, z.y - 6, 4, 22);
      ctx.fillStyle = `rgba(255,224,102,${0.7 + 0.3 * Math.sin(r.time * 6)})`;
      ctx.beginPath();
      ctx.arc(z.x, z.y - 12, 8, 0, Math.PI * 2);
      ctx.fill();
    }
    if (r.buffT.buddy > 0) {
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#ffa94d';
      ctx.beginPath();
      ctx.arc(r.decoyX, r.decoyY, PLAYER_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#212529';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', r.decoyX, r.decoyY + 1);
      ctx.globalAlpha = 1;
    }
  },

  drawPlayer(ctx, r) {
    const S = r.stats, R = PLAYER_R;
    const px = player.x, py = player.y;
    const hpRatio = Math.max(0, r.hp / S.maxHp);
    if (r.buffT.egg > 0) {
      ctx.fillStyle = `rgba(255,146,43,${0.35 + 0.15 * Math.sin(r.time * 30)})`;
      ctx.beginPath();
      ctx.arc(px, py, R + 14, 0, Math.PI * 2);
      ctx.fill();
    }
    if (r.buffT.elephant > 0) {
      ctx.strokeStyle = 'rgba(206,212,218,0.8)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(px, py, R + 8, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = r.cloakT > 0 || r.shadowT > 0 ? 0.35 : player.iframeT > 0 ? 0.6 : 1;
    ctx.fillStyle = r.char.color;
    ctx.beginPath();
    ctx.arc(px, py, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#212529';
    ctx.beginPath();
    ctx.arc(px, py, R - 6, 0, Math.PI * 2);
    ctx.fill();
    // Facing notch
    ctx.fillStyle = r.char.color;
    ctx.beginPath();
    ctx.arc(px + player.fx * (R - 3), py + player.fy * (R - 3), 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = hpRatio > 0.5 ? '#69db7c' : hpRatio > 0.25 ? '#ffd43b' : '#ff6b6b';
    ctx.beginPath();
    ctx.arc(px, py, R + 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hpRatio);
    ctx.stroke();
    ctx.lineWidth = 2.5;
    if (r.shield > 0) {
      ctx.strokeStyle = '#74c0fc';
      ctx.beginPath();
      ctx.arc(px, py, R + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * r.shield / S.maxShield);
      ctx.stroke();
    }
    if (r.barrier > 0) {
      ctx.strokeStyle = '#ffd43b';
      ctx.beginPath();
      ctx.arc(px, py, R + 11, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * r.barrier / (S.maxHp + S.maxShield));
      ctx.stroke();
    }
    if (r.invulnT > 0) {
      ctx.strokeStyle = `rgba(255,255,255,${0.4 + 0.4 * Math.sin(r.invulnT * 20)})`;
      ctx.beginPath();
      ctx.arc(px, py, R + 15, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (r.egoBombs > 0) {
      ctx.fillStyle = '#74c0fc';
      ctx.beginPath();
      for (let k = 0; k < r.egoBombs; k++) {
        const a = r.egoA + k * Math.PI * 2 / r.egoBombs;
        const bx = px + Math.cos(a) * 70, by = py + Math.sin(a) * 70;
        ctx.moveTo(bx + 6, by);
        ctx.arc(bx, by, 6, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    for (let i = 0; i < r.weapons.length && !r.char.turrets; i++) {
      const w = r.weapons[i];
      const b = WEAPONS[w.id];
      const [ox, oy] = mountOffset(i, r.weapons.length);
      ctx.save();
      ctx.translate(px + ox, py + oy);
      ctx.rotate(w.angle);
      ctx.fillStyle = b.color;
      ctx.fillRect(0, -b.width / 2, b.barrel * 0.8, b.width * 0.8);
      ctx.fillStyle = WEAPON_TIER_COLORS[w.tier];
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#212529';
      ctx.beginPath();
      ctx.arc(0, 0, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    // Dash charges under the player; the next charge fills up while recharging.
    const n = S.dashCharges, pw = 10, gap = 3;
    const x0 = px - (n * pw + (n - 1) * gap) / 2, y0 = py + R + 16;
    for (let k = 0; k < n; k++) {
      const x = x0 + k * (pw + gap);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x, y0, pw, 4);
      const f = k < player.charges ? 1 : k === player.charges ? player.dashRe / S.dashCd : 0;
      ctx.fillStyle = k < player.charges ? '#74c0fc' : 'rgba(116,192,252,0.45)';
      ctx.fillRect(x, y0, pw * f, 4);
    }

    if (r.levelFlash > 0) {
      ctx.strokeStyle = `rgba(255,212,59,${r.levelFlash})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(px, py, R + 10 + (1 - r.levelFlash) * 40, 0, Math.PI * 2);
      ctx.stroke();
    }
  },

  drawFx(ctx) {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(177,151,252,0.7)';
    ctx.beginPath();
    for (const e of enemies) {
      if (!e.alive || e.tetherT <= 0) continue;
      ctx.moveTo(player.x, player.y);
      ctx.lineTo(e.x, e.y);
    }
    ctx.stroke();
    const urn = Game.run.urnTargets;
    if (urn.length) {
      ctx.strokeStyle = 'rgba(47,158,68,0.8)';
      ctx.beginPath();
      for (const e of urn) {
        if (!e.alive) continue;
        ctx.moveTo(player.x, player.y);
        ctx.lineTo(e.x, e.y);
      }
      ctx.stroke();
    }
    ctx.lineWidth = 2;
    for (const l of fxLines) {
      ctx.strokeStyle = l.color;
      ctx.beginPath();
      if (l.beam) {
        ctx.lineWidth = 8 * l.life / 0.25 + 1;
        ctx.moveTo(l.x1, l.y1);
        ctx.lineTo(l.x2, l.y2);
        ctx.stroke();
        ctx.lineWidth = 2;
        continue;
      }
      const mx = (l.x1 + l.x2) / 2 + (Math.random() - 0.5) * 14;
      const my = (l.y1 + l.y2) / 2 + (Math.random() - 0.5) * 14;
      ctx.moveTo(l.x1, l.y1);
      ctx.lineTo(mx, my);
      ctx.lineTo(l.x2, l.y2);
      ctx.stroke();
    }
    for (const ring of fxRings) {
      const t = 1 - ring.life / 0.2;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = ring.color;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.r * (0.5 + t * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },

  drawParticles(ctx) {
    let last = null;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (p.color !== last) { ctx.fillStyle = p.color; last = p.color; }
      const s = p.size * (p.life / p.maxLife);
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
  },

  drawTexts(ctx) {
    if (!texts.length) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let lastFont = '', lastColor = '';
    for (let i = 0; i < texts.length; i++) {
      const t = texts[i];
      const font = t.big ? 'bold 16px sans-serif' : '12px sans-serif';
      if (font !== lastFont) { ctx.font = font; lastFont = font; }
      if (t.color !== lastColor) { ctx.fillStyle = t.color; lastColor = t.color; }
      ctx.globalAlpha = Math.min(1, t.life * 3);
      ctx.fillText(t.s, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  },

  // Names of nearby ground items and the open prompt of the chest in reach.
  drawLabels(ctx, r) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 12px sans-serif';
    const swap = swappableEquipDrop();
    for (const d of drops) {
      if (dist2(d.x, d.y, player.x, player.y) > 160 * 160) continue;
      const it = ITEM_BY_ID[d.id];
      label(ctx, d === swap ? `[E] Swap for ${it.name}` : it.name, d.x, d.y - 32, TIER_COLORS[d.tier]);
    }
    const c = nearestChest();
    if (c && !swap) {
      const def = CHESTS[c.type], price = c.price;
      const ok = r.gold >= price;
      const verb = def.shrine ? 'Use' : 'Open';
      label(ctx, ok ? `[E] ${verb} ${def.name}` : `${def.name}: need $${price - Math.floor(r.gold)} more`, c.x, c.y - def.h / 2 - (def.shrine ? 44 : 32), ok ? '#fff' : '#ff8787');
    } else if (!swap && nearTeleporter()) {
      const idle = teleporter.state === 'idle';
      label(ctx, idle ? '[E] Activate Teleporter · starts the boss fight' : '[E] Travel to the next map', teleporter.x, teleporter.y - 86, idle ? '#ff8787' : '#69db7c');
    }
  },

  // Corner minimap under a fog that clears as the player explores. Only what has been discovered is shown:
  // chests (boxes, yellow when affordable), shrines (diamonds), ground items (the in-world item disc in its
  // tier colour), the teleporter (pad with prongs), plus bosses and the player's facing arrow.
  drawMinimap(ctx, r) {
    const mm = this.minimap, s = MINIMAP_W / WORLD_W;
    const x0 = this.viewW - 12 - mm.width, y0 = 60;
    this.revealFog();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x0 - 3, y0 - 3, mm.width + 6, mm.height + 6);
    ctx.drawImage(mm, x0, y0);
    ctx.drawImage(this.fog, x0, y0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, mm.width, mm.height);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + this.camX * s, y0 + this.camY * s, this.viewW * s, this.viewH * s);

    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    for (const c of chests) {
      if (!c.seen) continue;
      const def = CHESTS[c.type], px = x0 + c.x * s, py = y0 + c.y * s;
      ctx.fillStyle = r.gold >= c.price ? '#ffd43b' : def.color;
      ctx.beginPath();
      if (def.shrine) shapePath(ctx, 'diamond', px, py, 4.5);
      else ctx.rect(px - 3.5, py - 2.5, 7, 5);
      ctx.fill();
      ctx.stroke();
    }
    for (const d of drops) {
      if (!d.seen) continue;
      const px = x0 + d.x * s, py = y0 + d.y * s;
      ctx.fillStyle = '#1c1f24';
      ctx.strokeStyle = TIER_COLORS[d.tier];
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = TIER_COLORS[d.tier];
      ctx.fillRect(px - 1, py - 1, 2, 2);
    }

    const tp = teleporter;
    if (tp.seen) {
      const px = x0 + tp.x * s, py = y0 + tp.y * s;
      const col = tp.state === 'done' ? '#69db7c' : '#ff6b6b';
      if (tp.state === 'charging') {
        ctx.strokeStyle = 'rgba(255,107,107,0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(px, py, TELEPORTER_R * s, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = '#adb5bd';
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 4 + k * Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a);
        ctx.beginPath();
        ctx.moveTo(px + ca * 9, py + sa * 9);
        ctx.lineTo(px + ca * 4 - sa * 2.5, py + sa * 4 + ca * 2.5);
        ctx.lineTo(px + ca * 4 + sa * 2.5, py + sa * 4 - ca * 2.5);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = col;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py, 4.5 + (tp.state === 'idle' ? 0 : Math.sin(r.time * 6)), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.fillStyle = '#ff4040';
    for (const e of enemies) {
      if (!e.alive || !e.boss) continue;
      ctx.beginPath();
      ctx.arc(x0 + e.x * s, y0 + e.y * s, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    const px = x0 + player.x * s, py = y0 + player.y * s, a = Math.atan2(player.fy, player.fx);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(px + Math.cos(a) * 6, py + Math.sin(a) * 6);
    ctx.lineTo(px + Math.cos(a + 2.5) * 4.5, py + Math.sin(a + 2.5) * 4.5);
    ctx.lineTo(px + Math.cos(a - 2.5) * 4.5, py + Math.sin(a - 2.5) * 4.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = '#495057';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x0 - 0.5, y0 - 0.5, mm.width + 1, mm.height + 1);
  },

  // Edge arrows pointing at the teleporter, nearby off-screen chests and ground items.
  drawIndicators(ctx, r) {
    const vw = this.viewW, vh = this.viewH, cx = vw / 2, cy = vh / 2, pad = 26;
    const arrow = (wx, wy, color, size) => {
      const sx = wx - this.camX, sy = wy - this.camY;
      if (sx > 0 && sy > 0 && sx < vw && sy < vh) return;
      const dx = sx - cx, dy = sy - cy;
      const k = Math.min((cx - pad) / Math.abs(dx || 1e-6), (cy - pad - 40) / Math.abs(dy || 1e-6));
      const x = cx + dx * k, y = cy + dy * k, a = Math.atan2(dy, dx);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(size, 0);
      ctx.lineTo(-size * 0.7, -size * 0.7);
      ctx.lineTo(-size * 0.7, size * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    for (const d of drops) arrow(d.x, d.y, TIER_COLORS[d.tier], 7);
    for (const c of chests) {
      if (!c.seen || dist2(c.x, c.y, player.x, player.y) > 1600 * 1600) continue;
      arrow(c.x, c.y, r.gold >= c.price ? '#ffd43b' : 'rgba(201,163,107,0.7)', 10);
    }
    if (teleporter.seen) arrow(teleporter.x, teleporter.y, teleporter.state === 'done' ? '#69db7c' : '#ff6b6b', 14);
  },

  // Active item buffs as icons: a dark sweep shows the time used up, the stack count sits in the corner
  // and the effect is written underneath. A timed buff's full length is the longest time it has shown
  // since it last started, so refreshes refill the ring.
  drawStatuses(ctx, x0, y0) {
    const list = activeStatuses(), max = this.statusMax || (this.statusMax = {});
    const size = 32, cellW = 70, perRow = 4;
    for (const id in max) if (!list.some(s => s.id === id && s.t !== undefined)) delete max[id];
    ctx.textBaseline = 'middle';
    for (let i = 0; i < list.length; i++) {
      const s = list[i], it = ITEM_BY_ID[s.id];
      const x = x0 + (i % perRow) * cellW + (cellW - size) / 2, y = y0 + Math.floor(i / perRow) * 54;
      const col = TIER_COLORS[it.tier];
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(x, y, size, size);
      const img = this.icon(s.id);
      if (img.complete && img.naturalWidth) ctx.drawImage(img, x + 2, y + 2, size - 4, size - 4);
      if (s.t !== undefined) {
        const m = max[s.id] = Math.max(max[s.id] || 0, s.t);
        const used = 1 - s.t / m;
        if (used > 0.01) {
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.beginPath();
          ctx.moveTo(x + size / 2, y + size / 2);
          ctx.arc(x + size / 2, y + size / 2, size * 0.72, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * used);
          ctx.closePath();
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, size, size);
          ctx.clip();
          ctx.fill();
          ctx.restore();
        }
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'left';
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#000';
        ctx.strokeText(`${Math.ceil(s.t)}s`, x + 2, y + 7);
        ctx.fillStyle = '#fff';
        ctx.fillText(`${Math.ceil(s.t)}s`, x + 2, y + 7);
      }
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, size, size);
      if (s.n !== undefined) {
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'right';
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#000';
        ctx.strokeText(`×${s.n}`, x + size + 3, y + size - 3);
        ctx.fillStyle = '#ffd43b';
        ctx.fillText(`×${s.n}`, x + size + 3, y + size - 3);
      }
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = col;
      ctx.fillText(s.text, x + size / 2, y + size + 9, cellW - 4);
    }
    ctx.textAlign = 'left';
  },

  drawDifficulty(ctx, cx) {
    const c = difficultyCoeff();
    let i = 0;
    while (i + 1 < DIFFICULTY_TIERS.length && c >= DIFFICULTY_TIERS[i + 1][0]) i++;
    const [lo, label, color] = DIFFICULTY_TIERS[i];
    const hi = i + 1 < DIFFICULTY_TIERS.length ? DIFFICULTY_TIERS[i + 1][0] : lo * 1.5;
    const w = 220, h = 8, x = cx - w / 2, y = 92;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * Math.min(1, (c - lo) / (hi - lo)), h);
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(label, cx, y + 22);
    ctx.font = '11px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText(`x${c.toFixed(2)}`, cx + w / 2 + 28, y + 4);
  },

  // The teleporter objective while it charges or is ready; otherwise the wave phase and an exploring hint.
  drawObjective(ctx, r, cx) {
    const tp = teleporter, y = 138;
    ctx.textAlign = 'center';
    if (tp.state === 'charging') {
      const w = 260, h = 10, x = cx - w / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x, y + 4, w, h);
      ctx.fillStyle = '#ff6b6b';
      ctx.fillRect(x, y + 4, w * tp.charge, h);
      ctx.font = 'bold 13px sans-serif';
      ctx.fillStyle = '#ffa8a8';
      ctx.fillText(`TELEPORTER ${Math.floor(tp.charge * 100)}%`, cx, y - 6);
      let hint = '';
      if (!tp.inside) hint = 'Return to the teleporter zone to keep charging!';
      else if (tp.charge >= 1 && r.bossAlive > 0) hint = `Kill the boss${r.bossAlive > 1 ? 'es' : ''} to finish the event`;
      if (hint && (tp.inside || Math.sin(r.time * 8) > -0.3)) {
        ctx.fillStyle = tp.inside ? '#ffd43b' : '#ff6b6b';
        ctx.fillText(hint, cx, y + 30);
      }
      return;
    }
    if (tp.state === 'done') {
      ctx.font = 'bold 14px sans-serif';
      ctx.fillStyle = '#69db7c';
      ctx.fillText('Map cleared · finish looting, then press E at the teleporter to travel', cx, y);
      return;
    }
    this.drawPhase(ctx, r, cx);
    ctx.font = '12px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText('Explore and loot, then activate the teleporter [E] to summon the boss', cx, y + 18);
  },

  drawPhase(ctx, r, cx) {
    if (r.phase === 'none') return;
    const y = 138;
    const info = {
      build: [`Next surge in ${Math.ceil(r.phaseLeft)}s`, '#adb5bd'],
      surge: [`SURGE · ${Math.ceil(r.phaseLeft)}s`, '#ff6b6b'],
      lull: [`BREATHER · ${Math.ceil(r.phaseLeft)}s`, '#69db7c'],
    }[r.phase];
    ctx.textAlign = 'center';
    ctx.font = r.phase === 'build' ? '12px sans-serif' : 'bold 15px sans-serif';
    ctx.fillStyle = info[1];
    ctx.fillText(info[0], cx, y);
  },

  // Top-of-screen bar for the oldest living boss (enemy ids grow with spawn order); later bosses wait their turn.
  // The bar opens from the centre when a boss takes it over, and a pale strip trails recent damage.
  drawBossBar(ctx, r, cx) {
    let boss = null, waiting = 0;
    for (const e of enemies) {
      if (!e.alive || !e.boss) continue;
      if (!boss || e.id < boss.id) { if (boss) waiting++; boss = e; } else waiting++;
    }
    if (!boss) { this.bossBarId = 0; return; }
    if (boss.id !== this.bossBarId) {
      this.bossBarId = boss.id;
      this.bossBarOpen = 0;
      this.bossBarLag = boss.hp / boss.maxHp;
    }
    const frac = Math.max(0, boss.hp / boss.maxHp);
    this.bossBarOpen = Math.min(1, this.bossBarOpen + 0.04);
    this.bossBarLag = Math.max(frac, this.bossBarLag - 0.006);
    const open = 1 - Math.pow(1 - this.bossBarOpen, 3);
    const fullW = 560, w = fullW * open, h = 16, x = cx - w / 2, y = 200;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(x, y, w * this.bossBarLag, h);
    ctx.fillStyle = boss.phase2 ? '#ff2d2d' : '#e03131';
    ctx.fillRect(x, y, w * frac, h);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(x, y, w * frac, 4);
    if (!boss.phase2) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(x + w * BOSS_PHASE2 - 1, y, 2, h);
    }
    ctx.strokeStyle = boss.def.color;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
    if (open < 0.6) return;
    ctx.globalAlpha = (open - 0.6) / 0.4;
    ctx.textAlign = 'center';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillStyle = boss.def.color;
    ctx.fillText(boss.def.name.toUpperCase(), cx, y - 12);
    ctx.font = 'bold 11px sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText(`${Math.ceil(Math.max(0, boss.hp)).toLocaleString()} / ${Math.round(boss.maxHp).toLocaleString()}`, cx, y + h / 2 + 1);
    if (waiting) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffa8a8';
      ctx.fillText(`+${waiting} more boss${waiting > 1 ? 'es' : ''}`, cx + fullW / 2, y - 12);
    }
    ctx.globalAlpha = 1;
  },

  drawHud(ctx, r) {
    const S = r.stats, vw = this.viewW, cx = vw / 2;
    ctx.textBaseline = 'middle';

    // HP
    const x = 20, y = 20, w = 260;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x, y, w, 22);
    ctx.fillStyle = '#e03131';
    ctx.fillRect(x, y, w * Math.max(0, r.hp / S.maxHp), 22);
    if (S.maxShield > 0) {
      ctx.fillStyle = '#74c0fc';
      ctx.fillRect(x, y, w * r.shield / S.maxShield, 4);
    }
    if (r.barrier > 0) {
      ctx.fillStyle = '#ffd43b';
      ctx.fillRect(x, y + 18, w * r.barrier / (S.maxHp + S.maxShield), 4);
    }
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    const extra = (r.shield > 0 ? `  +${Math.ceil(r.shield)} shield` : '') + (r.barrier >= 1 ? `  +${Math.floor(r.barrier)} barrier` : '');
    ctx.fillText(`${Math.max(0, Math.ceil(r.hp))} / ${Math.round(S.maxHp)}${extra}`, x + 8, y + 11);

    // XP
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x, y + 28, w, 14);
    ctx.fillStyle = '#69db7c';
    ctx.fillRect(x, y + 28, w * (r.xp / xpToNext(r.level)), 14);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    const next = WEAPON_TIER_LEVELS.find(l => l > r.level);
    ctx.fillText(`LV ${r.level}${next ? `   ·   weapons tier up at LV ${next}` : ''}`, x + 8, y + 35);

    ctx.fillStyle = '#ffd43b';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(`$ ${Math.floor(r.gold)}`, x, y + 64);

    this.drawStatuses(ctx, x, y + 84);

    // Run time + boss timer
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText(formatTime(r.time), cx, 34);
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = '#ced4da';
    ctx.fillText(`MAP ${r.mapN}  ·  ${r.map.name.toUpperCase()}`, cx, 68);

    this.drawDifficulty(ctx, cx);
    this.drawObjective(ctx, r, cx);
    this.drawBossBar(ctx, r, cx);
    this.drawMinimap(ctx, r);

    // Debug / perf
    ctx.textAlign = 'right';
    ctx.font = '12px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText(`${Game.fps} fps | E ${enemies.length} | B ${bullets.length} | EB ${ebullets.length} | P ${particles.length}`, vw - 12, 16);
    ctx.fillText(`move [WASD]  dash [Space]  use item [Shift]  interact [E]  targeting [${r.weapons.length > 1 ? `1-${r.weapons.length}` : '1'}]`, vw - 12, 32);
    ctx.fillText(`speed x${Game.speed} [F]  dmg numbers ${Game.showDmg ? 'on' : 'off'} [N]  pause [P/Esc]  sound ${Sfx.muted ? 'off' : 'on'} [M]`, vw - 12, 48);

    if (Game.paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, vw, this.viewH);
    }
  },
};

function label(ctx, s, x, y, color) {
  const w = ctx.measureText(s).width + 12;
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(x - w / 2, y - 9, w, 18);
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

function statusRings(ctx, color, pad, pred) {
  ctx.strokeStyle = color;
  ctx.beginPath();
  let any = false;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e.alive || !pred(e)) continue;
    any = true;
    ctx.moveTo(e.x + e.r + pad, e.y);
    ctx.arc(e.x, e.y, e.r + pad, 0, Math.PI * 2);
  }
  if (any) ctx.stroke();
}

// Irregular outline of a rock (stable per rock through its seed), offset by (ox, oy) and scaled around its centre.
function rockPath(g, k, ox, oy, scale) {
  const n = 11;
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const a = i * Math.PI * 2 / n;
    const rad = k.r * scale * (0.9 + 0.16 * Math.abs(Math.sin(k.seed + i * 12.9898) * 43758.5453 % 1));
    const x = k.x + ox + Math.cos(a) * rad, y = k.y + oy + Math.sin(a) * rad;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
}

function shapePath(ctx, shape, x, y, r) {
  switch (shape) {
    case 'circle':
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
      break;
    case 'square':
      ctx.rect(x - r, y - r, r * 2, r * 2);
      break;
    case 'diamond':
      ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
      break;
    case 'tri': {
      const a = Math.atan2(player.y - y, player.x - x);
      ctx.moveTo(x + Math.cos(a) * r * 1.3, y + Math.sin(a) * r * 1.3);
      ctx.lineTo(x + Math.cos(a + 2.4) * r, y + Math.sin(a + 2.4) * r);
      ctx.lineTo(x + Math.cos(a - 2.4) * r, y + Math.sin(a - 2.4) * r);
      ctx.closePath();
      break;
    }
    case 'hex':
      for (let k = 0; k < 6; k++) {
        const a = k * Math.PI / 3;
        if (k === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      ctx.closePath();
      break;
    case 'oct':
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4 + Math.PI / 8;
        if (k === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      ctx.closePath();
      break;
  }
}
