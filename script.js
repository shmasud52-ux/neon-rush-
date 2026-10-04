/* =========================================================================
   NEON RUSH — Cyber Highway Survival
   Pure vanilla JS + HTML5 Canvas. Mobile-first.
   Sections:
     1. ASSETS config  (edit here to add images/audio)
     2. Storage         (localStorage)
     3. Audio system
     4. Asset loader    (with Canvas fallbacks)
     5. Game state      (global)
     6. Vehicles
     7. Missions
     8. Player
     9. Enemies
    10. Obstacles
    11. Powerups
    12. Coins
    13. Particles
    14. Environment / themes
    15. Collision + scoring
    16. UI + screens
    17. Input (touch, swipe, keyboard)
    18. Game loop
   ========================================================================= */

/* =========================================================
   1. ASSETS CONFIG
   ---------------------------------------------------------
   HOW TO ADD YOUR OWN IMAGES:
   - Just drop a file with one of the names below into the
     matching folder (assets/player/, assets/enemies/, etc.)
   - The loader will pick it up automatically.
   - If a file is missing, a Canvas fallback is drawn instead.
   ========================================================= */
const ASSETS = {
  // Player + vehicles
  player:        'assets/player/player.png',
  vehicle_starter:  'assets/vehicles/starter.png',
  vehicle_neon:     'assets/vehicles/neon.png',
  vehicle_cybergt:  'assets/vehicles/cyber-gt.png',
  vehicle_shadowx:  'assets/vehicles/shadow-x.png',

  // Enemies + obstacles
  enemy_car:     'assets/enemies/enemy-car.png',
  barrier:       'assets/obstacles/barrier.png',
  barrel:        'assets/obstacles/barrel.png',
  electric:      'assets/obstacles/electric.png',

  // Powerups
  shield:        'assets/powerups/shield.png',
  nitro:         'assets/powerups/nitro.png',
  magnet:        'assets/powerups/magnet.png',
  ghost:         'assets/powerups/ghost.png',

  // Backgrounds (optional - drawn procedurally if missing)
  bg_city:       'assets/backgrounds/city.png',
  bg_tunnel:     'assets/backgrounds/tunnel.png',
  bg_rain:       'assets/backgrounds/rain.png',
  bg_storm:      'assets/backgrounds/storm.png',
};

// Audio file paths (all optional)
const AUDIO_FILES = {
  music:   'assets/audio/music.mp3',
  coin:    'assets/audio/coin.wav',
  crash:   'assets/audio/crash.wav',
  nitro:   'assets/audio/nitro.wav',
  powerup: 'assets/audio/powerup.wav',
};

/* =========================================================
   2. STORAGE
   ========================================================= */
const SAVE_KEY = 'neonrush_save_v1';

const defaultSave = {
  bestScore: 0,
  coins: 0,
  unlockedVehicles: ['starter'],
  selectedVehicle: 'starter',
  settings: { sound: true, music: true, showTouch: true },
  missions: {
    dist1000: 0,
    dist5000: 0,
    coins50: 0,
    coins100: 0,
    survive60: 0,
    nitro5: 0,
  },
  missionsClaimed: {},
  totalNitroUsed: 0,
};

let save = loadSave();

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return structuredCloneSafe(defaultSave);
    const parsed = JSON.parse(raw);
    // Merge with defaults so missing keys don't break
    const merged = structuredCloneSafe(defaultSave);
    Object.assign(merged, parsed);
    merged.settings = Object.assign({}, defaultSave.settings, parsed.settings || {});
    merged.missions = Object.assign({}, defaultSave.missions, parsed.missions || {});
    return merged;
  } catch (e) {
    return structuredCloneSafe(defaultSave);
  }
}

function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch (e) { /* storage full or disabled — silently ignore */ }
}

function structuredCloneSafe(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/* =========================================================
   3. AUDIO SYSTEM (optional, safe on mobile)
   ========================================================= */
const Audio_ = {
  ctx: null,
  buffers: {},
  music: null,
  loaded: false,
  unlocked: false,

  init() {
    // Lazy: we don't create AudioContext until first user gesture (mobile rule)
    this.audioEls = {};
    for (const key in AUDIO_FILES) {
      const el = new Audio();
      el.src = AUDIO_FILES[key];
      el.preload = 'auto';
      el.volume = key === 'music' ? 0.35 : 0.7;
      el.addEventListener('error', () => { /* missing file — ignore */ });
      this.audioEls[key] = el;
    }
    if (this.audioEls.music) this.audioEls.music.loop = true;
    this.loaded = true;
  },

  // Called on first user interaction (needed on mobile)
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    if (save.settings.music) {
      this.audioEls.music && this.audioEls.music.play().catch(() => {});
    }
  },

  play(name) {
    if (!save.settings.sound) return;
    const el = this.audioEls[name];
    if (!el) return;
    try {
      el.currentTime = 0;
      el.play().catch(() => { /* autoplay blocked — ignore */ });
    } catch (e) { /* ignore */ }
  },

  setMusic(on) {
    if (!this.audioEls || !this.audioEls.music) return;
    if (on && this.unlocked) {
      this.audioEls.music.play().catch(() => {});
    } else {
      this.audioEls.music.pause();
    }
  },
};

/* =========================================================
   4. ASSET LOADER (with Canvas fallback)
   ========================================================= */
const Assets = {
  images: {},   // key -> HTMLImageElement (loaded) or null (missing)

  loadAll(onDone) {
    const keys = Object.keys(ASSETS);
    let remaining = keys.length;
    if (remaining === 0) return onDone();

    keys.forEach((key) => {
      const img = new Image();
      let settled = false;

      img.onload = () => { settled = true; Assets.images[key] = img; next(); };
      img.onerror = () => { settled = true; Assets.images[key] = null; next(); };

      // If the image is cached and already complete, onload may not fire
      img.src = ASSETS[key];
      if (img.complete && img.naturalWidth > 0) {
        settled = true;
        Assets.images[key] = img;
        next();
      }

      function next() {
        remaining--;
        if (remaining <= 0) onDone();
      }
    });

    // Safety net: if loading stalls, proceed after 3s
    setTimeout(() => { if (remaining > 0) onDone(); }, 3000);
  },

  get(key) {
    return this.images[key] || null;
  }
};

/* =========================================================
   5. GAME STATE
   ========================================================= */
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

let VIEW = { w: 0, h: 0, dpr: 1 };
let state = {
  running: false,
  paused: false,
  over: false,
  screen: 'start',      // start | playing | paused | gameover
  time: 0,              // seconds survived
  distance: 0,          // meters
  score: 0,
  coinsRun: 0,
  combo: 0,
  comboTimer: 0,
  speed: 1,             // multiplier
  baseSpeed: 0.35,      // world scroll speed base
  difficulty: 0,        // 0..1
  themeIndex: 0,
  themeTimer: 0,
  shake: 0,
  flash: 0,
  timeScale: 1,
};

/* Vehicle catalog — edit stats/prices here */
const VEHICLES = [
  { id: 'starter',  name: 'STARTER',  asset: 'vehicle_starter', speed: 1.00, handling: 1.00, price: 0,     color: '#00f0ff' },
  { id: 'neon',     name: 'NEON',     asset: 'vehicle_neon',    speed: 1.10, handling: 1.05, price: 300,   color: '#ff2bd6' },
  { id: 'cybergt',  name: 'CYBER GT', asset: 'vehicle_cybergt', speed: 1.25, handling: 1.10, price: 900,   color: '#ffd54a' },
  { id: 'shadowx',  name: 'SHADOW X', asset: 'vehicle_shadowx', speed: 1.40, handling: 1.18, price: 2000,  color: '#8a2be2' },
];

function getSelectedVehicle() {
  return VEHICLES.find(v => v.id === save.selectedVehicle) || VEHICLES[0];
}

/* Mission definitions */
const MISSIONS = [
  { id: 'dist1000', title: 'ROAD RUNNER', desc: 'Travel 1000m in a single run', target: 1000, reward: 50,  type: 'distance' },
  { id: 'dist5000', title: 'HIGHWAY KING', desc: 'Travel 5000m in a single run', target: 5000, reward: 250, type: 'distance' },
  { id: 'coins50',  title: 'COIN HUNTER',  desc: 'Collect 50 coins (total)',     target: 50,   reward: 40,  type: 'coins'    },
  { id: 'coins100', title: 'TREASURE SEEKER', desc: 'Collect 100 coins (total)', target: 100,  reward: 90,  type: 'coins'    },
  { id: 'survive60',title: 'SURVIVOR',     desc: 'Survive 60 seconds in one run', target: 60,  reward: 120, type: 'time'     },
  { id: 'nitro5',   title: 'TURBO JUNKIE', desc: 'Use Nitro 5 times',            target: 5,    reward: 60,  type: 'nitro'    },
];

/* =========================================================
   6. PLAYER
   ========================================================= */
const player = {
  x: 0, y: 0,
  w: 44, h: 72,
  targetX: 0,
  lane: 0,           // -1 | 0 | 1
  laneX: [0, 0, 0],
  shield: 0,
  nitro: 0,
  magnet: 0,
  ghost: 0,
  invuln: 0,         // brief mercy after crash-hit
  tilt: 0,
};

/* =========================================================
   7. ENTITIES arrays
   ========================================================= */
let enemies = [];
let obstacles = [];
let powerups = [];
let coins = [];
let particles = [];

/* =========================================================
   8. ENVIRONMENT / THEMES
   ========================================================= */
const THEMES = [
  { id: 'city',   name: 'NEON CITY',     sky: ['#0a0320', '#1a0a3a'], road: '#120823', line: '#00f0ff', accent: '#ff2bd6', fog: '#0a0320' },
  { id: 'tunnel', name: 'CYBER TUNNEL',  sky: ['#050510', '#0d0322'], road: '#0a0a18', line: '#ff2bd6', accent: '#00f0ff', fog: '#05050f' },
  { id: 'rain',   name: 'RAIN HIGHWAY',  sky: ['#040a18', '#0a1430'], road: '#0a1224', line: '#00b0ff', accent: '#7a2bff', fog: '#050a18' },
  { id: 'storm',  name: 'CYBER STORM',   sky: ['#12001a', '#2a0033'], road: '#160022', line: '#ff00b0', accent: '#ffd54a', fog: '#12001a' },
];

const env = {
  scrollY: 0,
  bgScroll: 0,
  buildings: [],
  stars: [],
  rainDrops: [],
  gridOffset: 0,
};

function initEnvironment() {
  env.buildings = [];
  for (let i = 0; i < 14; i++) {
    env.buildings.push({
      side: i % 2 === 0 ? -1 : 1,
      x: Math.random(),
      y: Math.random(),
      w: 0.06 + Math.random() * 0.10,
      h: 0.15 + Math.random() * 0.35,
      lit: Math.random() > 0.4,
      color: Math.random() > 0.5 ? '#00f0ff' : '#ff2bd6',
    });
  }
  env.stars = [];
  for (let i = 0; i < 60; i++) {
    env.stars.push({
      x: Math.random(), y: Math.random(),
      s: 0.5 + Math.random() * 1.5,
      a: 0.2 + Math.random() * 0.6,
      sp: 0.05 + Math.random() * 0.2,
    });
  }
  env.rainDrops = [];
  for (let i = 0; i < 60; i++) {
    env.rainDrops.push({ x: Math.random(), y: Math.random(), s: 0.4 + Math.random() * 0.8, sp: 1 + Math.random() * 2 });
  }
}

/* =========================================================
   9. RESIZE
   ========================================================= */
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2); // cap for performance
  VIEW.dpr = dpr;
  VIEW.w = window.innerWidth;
  VIEW.h = window.innerHeight;
  canvas.width = Math.floor(VIEW.w * dpr);
  canvas.height = Math.floor(VIEW.h * dpr);
  canvas.style.width = VIEW.w + 'px';
  canvas.style.height = VIEW.h + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Player position (bottom-center)
  player.y = VIEW.h - player.h - 40 - (save.settings.showTouch ? 40 : 0);
  player.x = VIEW.w / 2 - player.w / 2;
  // 3 lanes
  const margin = VIEW.w * 0.14;
  const usable = VIEW.w - margin * 2;
  player.laneX = [margin, margin + usable / 2, margin + usable];
  // snap player to lane center on resize
  player.targetX = player.laneX[player.lane + 1];
  player.x = player.targetX - player.w / 2;

  initEnvironment();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));

/* =========================================================
   10. INPUT — touch buttons, swipe, keyboard
   ========================================================= */
function shiftLane(dir) {
  if (!state.running || state.paused || state.over) return;
  const next = Math.max(-1, Math.min(1, player.lane + dir));
  if (next === player.lane) return;
  player.lane = next;
  player.targetX = player.laneX[player.lane + 1];
  player.tilt = dir * 0.5;
}

document.getElementById('btn-left').addEventListener('pointerdown', (e) => { e.preventDefault(); shiftLane(-1); });
document.getElementById('btn-right').addEventListener('pointerdown', (e) => { e.preventDefault(); shiftLane(1); });

// Swipe on canvas
let touchStart = null;
canvas.addEventListener('touchstart', (e) => {
  Audio_.unlock();
  const t = e.touches[0];
  touchStart = { x: t.clientX, y: t.clientY, time: Date.now() };
}, { passive: true });

canvas.addEventListener('touchend', (e) => {
  if (!touchStart) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStart.x;
  const dy = t.clientY - touchStart.y;
  const dt = Date.now() - touchStart.time;
  touchStart = null;
  if (dt > 500) return;
  if (Math.abs(dx) > 28 && Math.abs(dx) > Math.abs(dy) * 0.7) {
    shiftLane(dx > 0 ? 1 : -1);
  }
}, { passive: true });

// Keyboard
window.addEventListener('keydown', (e) => {
  Audio_.unlock();
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') shiftLane(-1);
  else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') shiftLane(1);
  else if (e.key === 'Escape') togglePause();
  else if (e.key === ' ' && state.over) { /* space restarts */ startGame(); }
  else if (e.key === ' ' && !state.running && state.screen === 'start') startGame();
});

// First-gesture audio unlock
['pointerdown','touchstart','keydown'].forEach(ev =>
  window.addEventListener(ev, () => Audio_.unlock(), { once: true, passive: true })
);

/* =========================================================
   11. SPAWNING
   ========================================================= */
let spawnTimer = 0;
let coinTimer = 0;
let powerTimer = 0;

function spawnEnemy() {
  const lane = Math.floor(Math.random() * 3) - 1;
  const w = 44, h = 74;
  enemies.push({
    lane, x: player.laneX[lane + 1] - w / 2, y: -h - 40,
    w, h, color: Math.random() > 0.5 ? '#ff2bd6' : '#ff5544',
    bob: Math.random() * Math.PI * 2,
    speed: 0.6 + Math.random() * 0.6,
  });
}

function spawnObstacle() {
  const lane = Math.floor(Math.random() * 3) - 1;
  const type = Math.random();
  let kind = 'barrier';
  if (type > 0.75) kind = 'barrel';
  else if (type > 0.5) kind = 'electric';
  const w = kind === 'electric' ? 54 : 50;
  const h = kind === 'electric' ? 30 : 40;
  obstacles.push({
    kind, lane, x: player.laneX[lane + 1] - w / 2, y: -h - 20,
    w, h, phase: Math.random() * Math.PI * 2,
  });
}

function spawnCoin() {
  const lane = Math.floor(Math.random() * 3) - 1;
  coins.push({
    lane, x: player.laneX[lane + 1] - 12, y: -30,
    w: 24, h: 24, spin: 0, alive: true,
  });
}

function spawnPowerup() {
  const kinds = ['shield', 'nitro', 'magnet', 'ghost'];
  const kind = kinds[Math.floor(Math.random() * kinds.length)];
  const lane = Math.floor(Math.random() * 3) - 1;
  powerups.push({
    kind, lane, x: player.laneX[lane + 1] - 18, y: -40,
    w: 36, h: 36, bob: 0,
  });
}

/* =========================================================
   12. UPDATE — main logic
   ========================================================= */
function update(dt) {
  if (!state.running || state.paused || state.over) return;

  state.time += dt;
  state.difficulty = Math.min(1, state.time / 90); // ramp over 90s

  // Speed ramps up over time, boosted by vehicle speed
  const veh = getSelectedVehicle();
  const nitroBoost = player.nitro > 0 ? 1.8 : 1;
  state.speed = (1 + state.difficulty * 1.6) * veh.speed * nitroBoost;

  const scroll = state.speed * 380 * dt;
  env.scrollY += scroll;
  env.bgScroll += scroll * 0.25;
  env.gridOffset = (env.gridOffset + scroll) % 80;

  state.distance += (state.speed * 30) * dt;
  state.score += (state.speed * 12) * dt * (1 + state.combo * 0.1);

  // --- player horizontal smoothing ---
  const handling = veh.handling;
  player.x += (player.targetX - player.w / 2 - player.x) * Math.min(1, dt * 12 * handling);
  player.tilt += (0 - player.tilt) * Math.min(1, dt * 8);

  // --- powerup timers ---
  if (player.shield > 0) player.shield -= dt;
  if (player.nitro  > 0) player.nitro  -= dt;
  if (player.magnet > 0) player.magnet -= dt;
  if (player.ghost  > 0) player.ghost  -= dt;
  if (player.invuln > 0) player.invuln -= dt;

  // --- combo decay ---
  if (state.comboTimer > 0) {
    state.comboTimer -= dt;
    if (state.comboTimer <= 0 && state.combo > 0) {
      state.combo = 0;
    }
  }

  // --- theme auto-switch every 30s ---
  state.themeTimer += dt;
  if (state.themeTimer > 30) {
    state.themeTimer = 0;
    state.themeIndex = (state.themeIndex + 1) % THEMES.length;
    toast(`ENTERING ${THEMES[state.themeIndex].name}`);
  }

  // --- spawning ---
  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    const interval = Math.max(0.35, 1.1 - state.difficulty * 0.7);
    spawnTimer = interval * (0.7 + Math.random() * 0.6);
    if (Math.random() < 0.55) spawnEnemy();
    else spawnObstacle();
  }

  coinTimer -= dt;
  if (coinTimer <= 0) {
    coinTimer = 1.4 + Math.random() * 1.6;
    // spawn a small trail of coins
    const lane = Math.floor(Math.random() * 3) - 1;
    for (let i = 0; i < 3; i++) {
      coins.push({
        lane, x: player.laneX[lane + 1] - 12, y: -30 - i * 50,
        w: 24, h: 24, spin: 0, alive: true,
      });
    }
  }

  powerTimer -= dt;
  if (powerTimer <= 0) {
    powerTimer = 12 + Math.random() * 8;
    spawnPowerup();
  }

  // --- update enemies ---
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    e.y += (scroll * 0.85 + e.speed * 60) * dt;
    e.bob += dt * 6;
    if (e.y > VIEW.h + 100) { enemies.splice(i, 1); addCombo(); }
  }

  // --- update obstacles ---
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const o = obstacles[i];
    o.y += scroll * dt;
    o.phase += dt * 4;
    if (o.y > VIEW.h + 100) { obstacles.splice(i, 1); addCombo(); }
  }

  // --- update coins ---
  const magnetActive = player.magnet > 0;
  for (let i = coins.length - 1; i >= 0; i--) {
    const c = coins[i];
    c.y += scroll * dt;
    c.spin += dt * 5;
    if (magnetActive) {
      const px = player.x + player.w / 2;
      const py = player.y + player.h / 2;
      const cx = c.x + c.w / 2;
      const cy = c.y + c.h / 2;
      const dx = px - cx, dy = py - cy;
      const d = Math.hypot(dx, dy);
      if (d < 260) {
        c.x += (dx / d) * 380 * dt;
        c.y += (dy / d) * 380 * dt;
      }
    }
    if (c.y > VIEW.h + 60) { coins.splice(i, 1); continue; }
    // collect
    if (rectsOverlap(c, { x: player.x, y: player.y, w: player.w, h: player.h })) {
      coins.splice(i, 1);
      state.coinsRun++;
      save.coins++;
      save.missions.coins50  = Math.max(save.missions.coins50,  Math.min(50,  save.missions.coins50 + 1));
      save.missions.coins100 = Math.max(save.missions.coins100, Math.min(100, save.missions.coins100 + 1));
      Audio_.play('coin');
      addParticleBurst(c.x + 12, c.y + 12, '#ffd54a', 8);
    }
  }

  // --- update powerups ---
  for (let i = powerups.length - 1; i >= 0; i--) {
    const p = powerups[i];
    p.y += scroll * dt;
    p.bob += dt * 5;
    if (p.y > VIEW.h + 60) { powerups.splice(i, 1); continue; }
    if (rectsOverlap(p, { x: player.x, y: player.y, w: player.w, h: player.h })) {
      powerups.splice(i, 1);
      activatePowerup(p.kind);
    }
  }

  // --- collisions with enemies & obstacles ---
  const pRect = { x: player.x + 6, y: player.y + 8, w: player.w - 12, h: player.h - 16 };
  if (player.ghost <= 0 && player.invuln <= 0) {
    for (const e of enemies) {
      if (rectsOverlap(e, pRect)) { crash('enemy'); break; }
    }
    for (const o of obstacles) {
      if (rectsOverlap(o, pRect)) { crash('obstacle'); break; }
    }
  }

  // --- particles ---
  for (let i = particles.length - 1; i >= 0; i--) {
    const pt = particles[i];
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt + scroll * 0.3 * dt;
    pt.life -= dt;
    pt.vx *= 0.96;
    pt.vy *= 0.96;
    if (pt.life <= 0) particles.splice(i, 1);
  }

  // --- camera shake / flash decay ---
  if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 3);
  if (state.flash > 0) state.flash = Math.max(0, state.flash - dt * 4);

  // --- mission tracking (single run) ---
  save.missions.dist1000 = Math.max(save.missions.dist1000, Math.min(1000, Math.floor(state.distance)));
  save.missions.dist5000 = Math.max(save.missions.dist5000, Math.min(5000, Math.floor(state.distance)));
  save.missions.survive60 = Math.max(save.missions.survive60, Math.min(60, Math.floor(state.time)));
}

function addCombo() {
  state.combo++;
  state.comboTimer = 2.2; // seconds to keep combo alive
}

function activatePowerup(kind) {
  const dur = { shield: 7, nitro: 4, magnet: 8, ghost: 5 }[kind] || 6;
  player[kind] = dur;
  Audio_.play(kind === 'nitro' ? 'nitro' : 'powerup');
  toast(kind.toUpperCase() + ' ACTIVATED');
  addParticleBurst(player.x + player.w / 2, player.y + player.h / 2, POWERUP_COLORS[kind], 24);
  if (kind === 'nitro') {
    save.totalNitroUsed++;
    save.missions.nitro5 = Math.min(5, save.totalNitroUsed);
  }
  updatePowerupBar();
}

const POWERUP_COLORS = { shield: '#00f0ff', nitro: '#ffd54a', magnet: '#ff2bd6', ghost: '#8a2be2' };
const POWERUP_ICONS  = { shield: '🛡', nitro: '⚡', magnet: '🧲', ghost: '👻' };

function crash(reason) {
  if (player.shield > 0) {
    // shield absorbs the hit
    player.shield = 0;
    player.invuln = 1.2;
    state.shake = 1;
    state.flash = 1;
    Audio_.play('crash');
    addParticleBurst(player.x + player.w / 2, player.y + player.h / 2, '#00f0ff', 30);
    toast('SHIELD BROKEN');
    // remove the offender
    enemies = enemies.filter(e => e.y > VIEW.h || e.y < 0 || !near(e, player));
    obstacles = obstacles.filter(o => !near(o, player));
    return;
  }
  // real crash
  state.shake = 1.4;
  state.flash = 1;
  Audio_.play('crash');
  addParticleBurst(player.x + player.w / 2, player.y + player.h / 2, '#ff2bd6', 40);
  gameOver();
}

function near(a, b) {
  return Math.abs((a.x + (a.w||0)/2) - (player.x + player.w/2)) < 80;
}

/* =========================================================
   13. PARTICLES
   ========================================================= */
const MAX_PARTICLES = 200;

function addParticleBurst(x, y, color, count) {
  const cap = Math.min(count, MAX_PARTICLES - particles.length);
  for (let i = 0; i < cap; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 40 + Math.random() * 180;
    particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 0.4 + Math.random() * 0.6,
      maxLife: 1,
      size: 2 + Math.random() * 3,
      color,
    });
  }
}

/* =========================================================
   14. RENDER
   ========================================================= */
function render() {
  const theme = THEMES[state.themeIndex];

  // shake
  let sx = 0, sy = 0;
  if (state.shake > 0) {
    sx = (Math.random() - 0.5) * 14 * state.shake;
    sy = (Math.random() - 0.5) * 14 * state.shake;
  }
  ctx.save();
  ctx.translate(sx, sy);

  drawBackground(theme);
  drawRoad(theme);
  drawCoins();
  drawPowerups();
  drawObstacles();
  drawEnemies();
  drawPlayer(theme);
  drawParticles();
  drawSpeedLines();

  ctx.restore();

  // flash overlay
  if (state.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${state.flash * 0.5})`;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  }
}

function drawBackground(theme) {
  // sky gradient
  const grad = ctx.createLinearGradient(0, 0, 0, VIEW.h);
  grad.addColorStop(0, theme.sky[0]);
  grad.addColorStop(1, theme.sky[1]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);

  // stars / sparkles
  for (const s of env.stars) {
    s.y += s.sp * 0.002;
    if (s.y > 1) s.y = 0;
    ctx.fillStyle = `rgba(200,240,255,${s.a})`;
    ctx.fillRect(s.x * VIEW.w, ((s.y * VIEW.h * 0.6) + env.bgScroll * 0.03) % (VIEW.h * 0.6), s.s, s.s);
  }

  // skyline silhouettes (procedural)
  const horizon = VIEW.h * 0.42;
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  for (const b of env.buildings) {
    const bx = (b.side < 0 ? b.x * VIEW.w * 0.35 : VIEW.w - b.x * VIEW.w * 0.35 - b.w * VIEW.w);
    const by = horizon - b.h * VIEW.h;
    const bw = b.w * VIEW.w;
    const bh = b.h * VIEW.h;
    ctx.fillStyle = 'rgba(6,2,20,0.9)';
    ctx.fillRect(bx, by, bw, bh);
    // windows
    if (b.lit) {
      ctx.fillStyle = b.color;
      for (let wy = by + 6; wy < by + bh - 6; wy += 12) {
        for (let wx = bx + 4; wx < bx + bw - 4; wx += 10) {
          if ((Math.sin(wx * 12.9898 + wy * 78.233) * 43758.5453) % 1 > 0.5) {
            ctx.globalAlpha = 0.5 + Math.random() * 0.4;
            ctx.fillRect(wx, wy, 2, 3);
          }
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  // tunnel vertical neon strips (for tunnel theme)
  if (theme.id === 'tunnel') {
    for (let i = 0; i < 8; i++) {
      const x = (i / 8) * VIEW.w;
      const offset = (env.gridOffset * 3 + i * 40) % VIEW.h;
      ctx.fillStyle = theme.line;
      ctx.globalAlpha = 0.12;
      ctx.fillRect(x, offset - 60, 2, 60);
      ctx.globalAlpha = 1;
    }
  }

  // rain
  if (theme.id === 'rain' || theme.id === 'storm') {
    ctx.strokeStyle = theme.id === 'storm' ? 'rgba(255,120,255,0.5)' : 'rgba(150,200,255,0.5)';
    ctx.lineWidth = 1.2;
    for (const r of env.rainDrops) {
      r.y += r.sp * 0.02;
      if (r.y > 1) { r.y = 0; r.x = Math.random(); }
      const rx = r.x * VIEW.w, ry = r.y * VIEW.h;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx - 4, ry + 12 * r.s);
      ctx.stroke();
    }
  }
}

function drawRoad(theme) {
  const horizon = VIEW.h * 0.42;
  const bottom = VIEW.h;
  const roadTopW = VIEW.w * 0.32;
  const roadBotW = VIEW.w * 0.94;
  const roadTopX = (VIEW.w - roadTopW) / 2;
  const roadBotX = (VIEW.w - roadBotW) / 2;

  // road surface
  const rg = ctx.createLinearGradient(0, horizon, 0, bottom);
  rg.addColorStop(0, 'rgba(0,0,0,0.6)');
  rg.addColorStop(1, theme.road);
  ctx.fillStyle = rg;
  ctx.beginPath();
  ctx.moveTo(roadTopX, horizon);
  ctx.lineTo(roadTopX + roadTopW, horizon);
  ctx.lineTo(roadBotX + roadBotW, bottom);
  ctx.lineTo(roadBotX, bottom);
  ctx.closePath();
  ctx.fill();

  // grid lines (moving)
  ctx.strokeStyle = theme.line;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 2;
  const rows = 14;
  for (let i = 0; i < rows; i++) {
    const t = ((i + (env.gridOffset / 80)) % rows) / rows;
    const y = horizon + t * (bottom - horizon);
    // perspective width
    const w = roadTopW + (roadBotW - roadTopW) * t;
    const x = (VIEW.w - w) / 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.stroke();
  }
  // lane divider lines (perspective)
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 3;
  ctx.strokeStyle = theme.line;
  ctx.shadowBlur = 14;
  ctx.shadowColor = theme.line;
  for (let l = 1; l <= 2; l++) {
    const topX = roadTopX + (roadTopW / 3) * l;
    const botX = roadBotX + (roadBotW / 3) * l;
    ctx.beginPath();
    ctx.moveTo(topX, horizon);
    ctx.lineTo(botX, bottom);
    ctx.stroke();
  }
  // side rails
  ctx.strokeStyle = theme.accent;
  ctx.shadowColor = theme.accent;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(roadTopX, horizon); ctx.lineTo(roadBotX, bottom);
  ctx.moveTo(roadTopX + roadTopW, horizon); ctx.lineTo(roadBotX + roadBotW, bottom);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

function drawSpeedLines() {
  if (state.speed < 1.3) return;
  const intensity = Math.min(1, (state.speed - 1.3) * 1.2);
  ctx.strokeStyle = `rgba(0,240,255,${0.15 * intensity})`;
  ctx.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    const x = Math.random() * VIEW.w;
    const y = Math.random() * VIEW.h;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + 40 + intensity * 80);
    ctx.stroke();
  }
}

function drawPlayer(theme) {
  const veh = getSelectedVehicle();
  const img = Assets.get(veh.asset) || Assets.get('player');

  // ghost effect
  if (player.ghost > 0) ctx.globalAlpha = 0.55;

  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.ellipse(player.x + player.w / 2, player.y + player.h - 4, player.w * 0.55, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(player.x + player.w / 2, player.y + player.h / 2);
  ctx.rotate(player.tilt * 0.25);

  // engine glow trail
  const trailColor = player.nitro > 0 ? '#ffd54a' : theme.accent;
  ctx.shadowBlur = 20;
  ctx.shadowColor = trailColor;
  ctx.fillStyle = trailColor;
  ctx.beginPath();
  ctx.moveTo(-14, player.h / 2 + 6);
  ctx.lineTo(0, player.h / 2 + 30 + Math.sin(state.time * 20) * 4);
  ctx.lineTo(14, player.h / 2 + 6);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;

  if (img) {
    ctx.drawImage(img, -player.w / 2, -player.h / 2, player.w, player.h);
  } else {
    drawFallbackVehicle(ctx, veh.color, player.w, player.h);
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  // shield ring
  if (player.shield > 0) {
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 3;
    ctx.shadowBlur = 18;
    ctx.shadowColor = '#00f0ff';
    ctx.beginPath();
    ctx.arc(player.x + player.w / 2, player.y + player.h / 2, player.w * 0.95, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  // magnet ring
  if (player.magnet > 0) {
    ctx.strokeStyle = 'rgba(255,43,214,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(player.x + player.w / 2, player.y + player.h / 2, 90 + Math.sin(state.time * 6) * 6, 0, Math.PI * 2);
    ctx.stroke();
  }
  // nitro lines
  if (player.nitro > 0) {
    ctx.strokeStyle = 'rgba(255,213,74,0.7)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const y = player.y + 10 + i * 20;
      ctx.beginPath();
      ctx.moveTo(player.x - 30 - i * 6, y);
      ctx.lineTo(player.x + player.w + 30 + i * 6, y);
      ctx.stroke();
    }
  }
}

function drawFallbackVehicle(c, w, h) {
  // Simple neon car shape in Canvas
  ctx.fillStyle = '#0a0820';
  ctx.strokeStyle = c;
  ctx.lineWidth = 3;
  ctx.shadowBlur = 16;
  ctx.shadowColor = c;
  ctx.beginPath();
  const x = -w / 2, y = -h / 2;
  roundRect(ctx, x, y, w, h, 10);
  ctx.fill();
  ctx.stroke();

  // cockpit
  ctx.fillStyle = c;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  roundRect(ctx, x + 8, y + 10, w - 16, h * 0.4, 6);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawEnemies() {
  for (const e of enemies) {
    const img = Assets.get('enemy_car');
    ctx.save();
    ctx.translate(e.x + e.w / 2, e.y + e.h / 2);
    if (img) {
      ctx.drawImage(img, -e.w / 2, -e.h / 2, e.w, e.h);
    } else {
      drawFallbackEnemy(ctx, e.color, e.w, e.h);
    }
    ctx.restore();
  }
}

function drawFallbackEnemy(c, w, h) {
  ctx.fillStyle = '#12000a';
  ctx.strokeStyle = c;
  ctx.lineWidth = 2.5;
  ctx.shadowBlur = 14;
  ctx.shadowColor = c;
  ctx.beginPath();
  roundRect(ctx, -w / 2, -h / 2, w, h, 8);
  ctx.fill();
  ctx.stroke();
  // headlights
  ctx.fillStyle = '#fff';
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(-w / 2 + 8, h / 2 - 4, 3, 0, Math.PI * 2);
  ctx.arc(w / 2 - 8, h / 2 - 4, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

function drawObstacles() {
  for (const o of obstacles) {
    let key = 'barrier';
    if (o.kind === 'barrel') key = 'barrel';
    if (o.kind === 'electric') key = 'electric';
    const img = Assets.get(key);
    const color = o.kind === 'electric' ? '#00f0ff' : o.kind === 'barrel' ? '#ffaa33' : '#ff2bd6';

    if (img) {
      ctx.drawImage(img, o.x, o.y, o.w, o.h);
    } else {
      if (o.kind === 'electric') {
        // electric arc
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.shadowBlur = 16;
        ctx.shadowColor = color;
        ctx.beginPath();
        for (let i = 0; i <= o.w; i += 6) {
          const yy = o.y + o.h / 2 + Math.sin((i * 0.4) + o.phase) * 6;
          if (i === 0) ctx.moveTo(o.x + i, yy);
          else ctx.lineTo(o.x + i, yy);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else if (o.kind === 'barrel') {
        // barrel with X
        ctx.fillStyle = '#331a00';
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.shadowBlur = 12;
        ctx.shadowColor = color;
        ctx.beginPath();
        roundRect(ctx, o.x, o.y, o.w, o.h, 6);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#ff4444';
        ctx.beginPath();
        ctx.moveTo(o.x + 8, o.y + 8);
        ctx.lineTo(o.x + o.w - 8, o.y + o.h - 8);
        ctx.moveTo(o.x + o.w - 8, o.y + 8);
        ctx.lineTo(o.x + 8, o.y + o.h - 8);
        ctx.stroke();
      } else {
        // barrier stripes
        ctx.fillStyle = '#1a0010';
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.shadowBlur = 12;
        ctx.shadowColor = color;
        ctx.beginPath();
        roundRect(ctx, o.x, o.y, o.w, o.h, 5);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = color;
        for (let i = 0; i < 4; i++) {
          ctx.fillRect(o.x + 4 + i * 12, o.y + 6, 6, o.h - 12);
        }
      }
    }
  }
}

function drawCoins() {
  for (const c of coins) {
    ctx.save();
    ctx.translate(c.x + c.w / 2, c.y + c.h / 2);
    const scale = Math.abs(Math.cos(c.spin));
    ctx.scale(0.4 + scale * 0.6, 1);
    ctx.fillStyle = '#ffd54a';
    ctx.shadowBlur = 14;
    ctx.shadowColor = '#ffd54a';
    ctx.beginPath();
    ctx.arc(0, 0, c.w / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffae00';
    ctx.beginPath();
    ctx.arc(0, 0, c.w / 2 - 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff6c2';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('₡', 0, 1);
    ctx.restore();
    ctx.shadowBlur = 0;
  }
}

function drawPowerups() {
  for (const p of powerups) {
    const img = Assets.get(p.kind);
    const color = POWERUP_COLORS[p.kind];
    const bob = Math.sin(p.bob) * 5;
    if (img) {
      ctx.drawImage(img, p.x, p.y + bob, p.w, p.h);
    } else {
      ctx.save();
      ctx.translate(p.x + p.w / 2, p.y + p.h / 2 + bob);
      ctx.shadowBlur = 18;
      ctx.shadowColor = color;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = color;
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(POWERUP_ICONS[p.kind], 0, 2);
      ctx.restore();
    }
  }
}

function drawParticles() {
  for (const p of particles) {
    const a = Math.max(0, p.life);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

/* =========================================================
   15. GAME FLOW
   ========================================================= */
function startGame() {
  Audio_.unlock();
  Audio_.play('powerup');

  state.running = true;
  state.paused = false;
  state.over = false;
  state.screen = 'playing';
  state.time = 0;
  state.distance = 0;
  state.score = 0;
  state.coinsRun = 0;
  state.combo = 0;
  state.comboTimer = 0;
  state.difficulty = 0;
  state.themeIndex = 0;
  state.themeTimer = 0;
  state.shake = 0;
  state.flash = 0;

  player.lane = 0;
  player.targetX = player.laneX[1];
  player.x = player.targetX - player.w / 2;
  player.shield = 0;
  player.nitro = 0;
  player.magnet = 0;
  player.ghost = 0;
  player.invuln = 0.8;

  enemies = [];
  obstacles = [];
  powerups = [];
  coins = [];
  particles = [];

  spawnTimer = 0.8;
  coinTimer = 1.0;
  powerTimer = 8;

  initEnvironment();
  updatePowerupBar();

  showScreen(null);
  document.getElementById('hud').classList.remove('hidden');
  document.getElementById('touch-controls').classList.toggle('hidden', !save.settings.showTouch);

  Audio_.setMusic(save.settings.music);
}

function gameOver() {
  state.running = false;
  state.over = true;
  state.screen = 'gameover';

  const finalScore = Math.floor(state.score);
  const distance = Math.floor(state.distance);

  if (finalScore > save.bestScore) save.bestScore = finalScore;
  saveGame();

  document.getElementById('go-score').textContent = finalScore;
  document.getElementById('go-dist').textContent = distance + 'm';
  document.getElementById('go-coins').textContent = state.coinsRun;
  document.getElementById('go-best').textContent = save.bestScore;

  document.getElementById('hud').classList.add('hidden');
  document.getElementById('touch-controls').classList.add('hidden');
  showScreen('screen-gameover');

  // refresh mission rewards if any newly completed
  checkMissionsAfterRun();
}

function togglePause() {
  if (!state.running || state.over) return;
  state.paused = !state.paused;
  if (state.paused) {
    showScreen('screen-pause');
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('touch-controls').classList.add('hidden');
  } else {
    showScreen(null);
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('touch-controls').classList.toggle('hidden', !save.settings.showTouch);
  }
}

/* =========================================================
   16. UI
   ========================================================= */
function showScreen(id) {
  ['screen-start', 'screen-garage', 'screen-missions', 'screen-settings', 'screen-pause', 'screen-gameover']
    .forEach(s => {
      document.getElementById(s).classList.toggle('hidden', s !== id);
    });
}

function updateHUD() {
  if (state.screen !== 'playing') return;
  document.getElementById('hud-score').textContent = Math.floor(state.score);
  document.getElementById('hud-dist').textContent = Math.floor(state.distance) + 'm';
  document.getElementById('hud-coins').textContent = state.coinsRun;
  document.getElementById('hud-combo').textContent = 'x' + (1 + state.combo);
  document.getElementById('hud-speed').textContent = Math.floor(state.speed * 100);
}

function updatePowerupBar() {
  const bar = document.getElementById('powerup-bar');
  bar.innerHTML = '';
  const items = [
    { key: 'shield', time: player.shield, color: POWERUP_COLORS.shield, icon: POWERUP_ICONS.shield },
    { key: 'nitro',  time: player.nitro,  color: POWERUP_COLORS.nitro,  icon: POWERUP_ICONS.nitro },
    { key: 'magnet', time: player.magnet, color: POWERUP_COLORS.magnet, icon: POWERUP_ICONS.magnet },
    { key: 'ghost',  time: player.ghost,  color: POWERUP_COLORS.ghost,  icon: POWERUP_ICONS.ghost },
  ];
  for (const it of items) {
    if (it.time > 0) {
      const el = document.createElement('div');
      el.className = 'powerup-pill';
      el.style.color = it.color;
      el.textContent = `${it.icon} ${it.key.toUpperCase()} ${it.time.toFixed(1)}s`;
      bar.appendChild(el);
    }
  }
}

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1200);
}

/* =========================================================
   GARAGE
   ========================================================= */
function renderGarage() {
  const list = document.getElementById('garage-list');
  list.innerHTML = '';
  document.getElementById('garage-coins').textContent = save.coins;

  for (const v of VEHICLES) {
    const owned = save.unlockedVehicles.includes(v.id);
    const selected = save.selectedVehicle === v.id;

    const card = document.createElement('div');
    card.className = 'garage-card' + (selected ? ' selected' : '');

    const thumb = document.createElement('div');
    thumb.className = 'vehicle-thumb';
    const tcanvas = document.createElement('canvas');
    tcanvas.width = 100; tcanvas.height = 100;
    const tctx = tcanvas.getContext('2d');
    const img = Assets.get(v.asset);
    if (img) {
      tctx.drawImage(img, 0, 0, 100, 100);
    } else {
      tctx.translate(50, 50);
      drawFallbackVehicle(tctx, v.color, 60, 90);
    }
    thumb.appendChild(tcanvas);

    const info = document.createElement('div');
    info.className = 'vehicle-info';
    info.innerHTML = `
      <div class="name">${v.name}</div>
      <div class="stats">SPEED ${Math.round(v.speed * 100)} · HANDLING ${Math.round(v.handling * 100)}</div>
      ${owned ? '' : `<div class="price">💰 ${v.price} COINS</div>`}
    `;

    const action = document.createElement('button');
    action.className = 'vehicle-action';
    if (selected) {
      action.textContent = 'SELECTED';
      action.classList.add('selected');
      action.disabled = true;
    } else if (owned) {
      action.textContent = 'SELECT';
      action.classList.add('select');
      action.onclick = () => {
        save.selectedVehicle = v.id;
        saveGame();
        renderGarage();
        Audio_.play('powerup');
      };
    } else {
      action.textContent = 'BUY';
      action.classList.add('buy');
      action.onclick = () => {
        if (save.coins >= v.price) {
          save.coins -= v.price;
          save.unlockedVehicles.push(v.id);
          save.selectedVehicle = v.id;
          saveGame();
          renderGarage();
          toast('UNLOCKED ' + v.name);
          Audio_.play('powerup');
        } else {
          toast('NOT ENOUGH COINS');
        }
      };
    }

    card.appendChild(thumb);
    card.appendChild(info);
    card.appendChild(action);
    list.appendChild(card);
  }
}

/* =========================================================
   MISSIONS
   ========================================================= */
function renderMissions() {
  const list = document.getElementById('missions-list');
  list.innerHTML = '';
  for (const m of MISSIONS) {
    const progress = save.missions[m.id] || 0;
    const done = progress >= m.target;
    const claimed = save.missionsClaimed[m.id];

    const card = document.createElement('div');
    card.className = 'mission-card' + (done ? ' done' : '');
    const pct = Math.min(100, (progress / m.target) * 100);

    card.innerHTML = `
      <div class="m-title">${m.title}</div>
      <div class="m-desc">${m.desc} — ${Math.floor(progress)} / ${m.target}</div>
      <div class="m-bar"><div class="m-fill" style="width:${pct}%"></div></div>
      <div class="m-reward">REWARD: 💰 ${m.reward} ${claimed ? '· CLAIMED' : ''}</div>
    `;

    if (done && !claimed) {
      const btn = document.createElement('button');
      btn.className = 'vehicle-action buy';
      btn.style.marginTop = '8px';
      btn.textContent = 'CLAIM REWARD';
      btn.onclick = () => {
        save.coins += m.reward;
        save.missionsClaimed[m.id] = true;
        saveGame();
        renderMissions();
        toast('+' + m.reward + ' COINS');
        Audio_.play('coin');
      };
      card.appendChild(btn);
    }
    list.appendChild(card);
  }
}

function checkMissionsAfterRun() {
  // Nothing to auto-claim; just ensures the save is up to date
  saveGame();
}

/* =========================================================
   MENU BUTTONS
   ========================================================= */
document.querySelectorAll('[data-action]').forEach(btn => {
  btn.addEventListener('click', () => {
    Audio_.unlock();
    const a = btn.dataset.action;
    if (a === 'play') startGame();
    else if (a === 'garage') { renderGarage(); showScreen('screen-garage'); }
    else if (a === 'missions') { renderMissions(); showScreen('screen-missions'); }
    else if (a === 'settings') { syncSettingsUI(); showScreen('screen-settings'); }
    else if (a === 'back') showScreen('screen-start');
    else if (a === 'resume') togglePause();
    else if (a === 'restart') startGame();
    else if (a === 'quit') {
      state.running = false;
      state.paused = false;
      state.over = false;
      state.screen = 'start';
      document.getElementById('hud').classList.add('hidden');
      document.getElementById('touch-controls').classList.add('hidden');
      refreshStartStats();
      showScreen('screen-start');
      Audio_.setMusic(save.settings.music);
    }
    else if (a === 'menu') {
      refreshStartStats();
      showScreen('screen-start');
    }
  });
});

/* Settings */
function syncSettingsUI() {
  document.getElementById('set-sound').checked = save.settings.sound;
  document.getElementById('set-music').checked = save.settings.music;
  document.getElementById('set-touch').checked = save.settings.showTouch;
}

document.getElementById('set-sound').addEventListener('change', e => {
  save.settings.sound = e.target.checked;
  saveGame();
});
document.getElementById('set-music').addEventListener('change', e => {
  save.settings.music = e.target.checked;
  saveGame();
  Audio_.setMusic(save.settings.music);
});
document.getElementById('set-touch').addEventListener('change', e => {
  save.settings.showTouch = e.target.checked;
  saveGame();
  if (state.running) {
    document.getElementById('touch-controls').classList.toggle('hidden', !save.settings.showTouch);
  }
});

document.getElementById('btn-reset').addEventListener('click', () => {
  if (confirm('Reset all progress?')) {
    localStorage.removeItem(SAVE_KEY);
    save = loadSave();
    refreshStartStats();
    syncSettingsUI();
    toast('PROGRESS RESET');
  }
});

/* HUD buttons */
document.getElementById('btn-pause').addEventListener('click', togglePause);
document.getElementById('btn-sound').addEventListener('click', (e) => {
  save.settings.sound = !save.settings.sound;
  saveGame();
  e.currentTarget.classList.toggle('off', !save.settings.sound);
  e.currentTarget.textContent = save.settings.sound ? '🔊' : '🔇';
});
document.getElementById('btn-music').addEventListener('click', (e) => {
  save.settings.music = !save.settings.music;
  saveGame();
  Audio_.setMusic(save.settings.music);
  e.currentTarget.classList.toggle('off', !save.settings.music);
});

/* Start screen stats */
function refreshStartStats() {
  document.getElementById('start-best').textContent = save.bestScore;
  document.getElementById('start-coins').textContent = save.coins;
}

/* =========================================================
   17. COLLISION
   ========================================================= */
function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/* =========================================================
   18. GAME LOOP
   ========================================================= */
let lastTime = performance.now();
let hudTimer = 0;

function loop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000); // clamp for tab-switch safety
  lastTime = now;

  update(dt);
  render();

  hudTimer += dt;
  if (hudTimer > 0.08) {
    hudTimer = 0;
    updateHUD();
    updatePowerupBar();
  }

  requestAnimationFrame(loop);
}

/* =========================================================
   BOOT
   ========================================================= */
function boot() {
  resize();
  Audio_.init();

  // Show loading feedback
  showScreen('screen-start');
  refreshStartStats();

  // Preload assets then start loop
  Assets.loadAll(() => {
    // Asset loading finished (or timed out gracefully)
    refreshStartStats();
    requestAnimationFrame(loop);
  });

  // Also start loop immediately so canvas isn't blank if loading is slow
  requestAnimationFrame(loop);
}

window.addEventListener('load', boot);

// Also handle case where script loads after page is already loaded
if (document.readyState === 'complete') boot();
</script>