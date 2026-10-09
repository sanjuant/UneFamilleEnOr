/* ------------------------------------------------------------------ *
 *  Intro « Une Faille en Or »
 *  Logo doré qui brille (reflets + scintillements), puis le M de
 *  FAMILLE explose → « UNE FA ILLE EN OR ».
 *
 *  Paramètres d'URL :
 *    ?boom=10   instant de l'explosion (s)
 *    ?loop=20   relance automatique après N secondes
 *    ?mute      pas de son
 *    ?embed     intégrée à l'écran de jeu : attend restart(), signale la fin via onEnd
 *    ?end=20    instant de fin (défaut 20 s en mode embed) → appelle intro.onEnd
 *  Clavier : Espace / clic = rejouer, B = explosion immédiate (hors embed).
 * ------------------------------------------------------------------ */
(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  const num = (v, d) => (v !== null && v !== '' && isFinite(+v) ? +v : d);
  const BOOM_AT = num(params.get('boom'), 10);
  const LOOP = num(params.get('loop'), 0);
  const EMBED = params.has('embed');
  const END = num(params.get('end'), EMBED ? 20 : 0);
  let muted = params.has('mute');

  const NS = 'http://www.w3.org/2000/svg';
  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const logoWrap = $('logoWrap');
  const goldGrad = $('gold');
  const sheen1 = $('sheen1');
  const sheen2 = $('sheen2');
  const glintLayer = $('glints');
  const M = $('M');
  const fx = $('fx');
  const ctx = fx.getContext('2d');
  const flash = $('flash');

  let paused = EMBED; // image figée (seek / ?at=) ; en embed, en attente de restart()
  let lastT = 0;
  let ready = false; // tout est initialisé (le redessin au redimensionnement peut opérer)

  const R = (a, b) => a + Math.random() * (b - a);
  const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
  const easeOut = (x) => 1 - Math.pow(1 - x, 3);

  /* ================================================================ *
   *  Textures générées
   * ================================================================ */

  function lerpColor(stops, v) {
    for (let i = 1; i < stops.length; i++) {
      if (v <= stops[i][0]) {
        const [p0, c0] = stops[i - 1], [p1, c1] = stops[i];
        const k = (v - p0) / (p1 - p0 || 1);
        return [0, 1, 2].map((j) => c0[j] + (c1[j] - c0[j]) * k);
      }
    }
    return stops[stops.length - 1][1];
  }

  // Couronne d'ampoules autour du logo (le bandeau passe devant).
  function makeBulbs() {
    const N = 48, r = 456;
    let html = '';
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 - Math.PI / 2;
      const x = (Math.cos(a) * r).toFixed(1), y = (Math.sin(a) * r).toFixed(1);
      html += `<g transform="translate(${x} ${y})">` +
        `<circle r="10" fill="url(#bulbOff)"/>` +
        `<g class="on ${i % 2 ? 'b' : 'a'}"><circle r="24" fill="url(#bulbHalo)"/><circle r="10" fill="url(#bulbOn)"/></g>` +
        `</g>`;
    }
    $('bulbs').innerHTML = html;
  }

  // Bleu roi légèrement granuleux (motif répétable).
  function makeBlue() {
    const s = 256;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    const img = g.createImageData(s, s);
    const T = (2 * Math.PI) / s;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        // Ondulations périodiques (raccord parfait) + grain
        const low =
          Math.sin(x * T * 2 + Math.sin(y * T * 3) * 1.5) * 0.5 +
          Math.sin(y * T * 4 + Math.cos(x * T) * 2) * 0.35 +
          Math.sin((x + y) * T * 5) * 0.15;
        const n = low * 9 + (Math.random() - 0.5) * 18;
        const i = (y * s + x) * 4;
        img.data[i] = 14 + n * 0.4;
        img.data[i + 1] = 30 + n * 0.7;
        img.data[i + 2] = 178 + n;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    $('blueImg').setAttribute('href', c.toDataURL());
  }

  // Rayures / usure de l'or (fines stries sombres et claires).
  function makeGrain() {
    const s = 512;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    g.lineCap = 'round';
    for (let i = 0; i < 520; i++) {
      const dark = Math.random() < 0.72;
      g.strokeStyle = dark
        ? `rgba(90, 55, 0, ${R(0.18, 0.5)})`
        : `rgba(255, 252, 215, ${R(0.25, 0.6)})`;
      g.lineWidth = R(0.6, dark ? 2.2 : 1.4);
      const x = R(0, s), y = R(0, s), len = R(12, 110), a = R(-0.5, 0.5) + (Math.random() < 0.3 ? Math.PI / 2 : 0);
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + R(-8, 8), y + Math.sin(a) * len * 0.5 + R(-8, 8),
        x + Math.cos(a) * len, y + Math.sin(a) * len);
      g.stroke();
    }
    // Quelques taches sombres diffuses
    for (let i = 0; i < 40; i++) {
      const x = R(0, s), y = R(0, s), r = R(10, 45);
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, 'rgba(80, 45, 0, 0.28)');
      rg.addColorStop(1, 'rgba(80, 45, 0, 0)');
      g.fillStyle = rg;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    $('grainImg').setAttribute('href', c.toDataURL());
  }

  makeBlue();
  makeBulbs();
  makeGrain();

  /* ================================================================ *
   *  Scintillements (étoiles qui brillent sur l'or)
   * ================================================================ */

  const STAR = 'M0,-1 L0.085,-0.085 L1,0 L0.085,0.085 L0,1 L-0.085,0.085 L-1,0 L-0.085,-0.085Z';
  let glints = [];

  function spawnGlint(t, x, y, size, life) {
    const g = document.createElementNS(NS, 'g');
    g.innerHTML = `<circle r="0.5" fill="url(#glintGlow)"/><path d="${STAR}" fill="#fff"/>`;
    glintLayer.appendChild(g);
    glints.push({ el: g, x, y, size, life, born: t, spin: R(-50, 50) });
  }

  function mBox() {
    try {
      const e = $('tFamille').getExtentOfChar(2);
      return { x0: e.x, x1: e.x + e.width };
    } catch {
      return { x0: -230, x1: -50 };
    }
  }

  // Un point au hasard sur une partie dorée : anneaux ou bord d'une lettre.
  const TEXTS = [
    { id: 'tUne', y: -178, fs: 128 },
    { id: 'tFamille', y: 40, fs: 240 },
    { id: 'tEn', y: 160, fs: 104 },
    { id: 'tOr', y: 352, fs: 232 },
  ];
  function randomGoldPoint(exclude) {
    for (let tries = 0; tries < 20; tries++) {
      let x, y;
      if (Math.random() < 0.5) {
        const a = R(0, Math.PI * 2);
        const r = [400, 374, 346, 316][Math.floor(Math.random() * 4)];
        x = Math.cos(a) * r;
        y = Math.sin(a) * r;
        if (y > -180 && y < 70) continue; // caché par le bandeau
        if (Math.abs(x) < 180 && y > 180) continue; // derrière « OR »
      } else {
        const T = TEXTS[Math.floor(Math.random() * TEXTS.length)];
        const el = $(T.id);
        const n = el.getNumberOfChars();
        const i = Math.floor(Math.random() * n);
        let e;
        try { e = el.getExtentOfChar(i); } catch { continue; }
        x = R(e.x + e.width * 0.1, e.x + e.width * 0.9);
        y = Math.random() < 0.7 ? T.y - T.fs * 0.7 : T.y;
      }
      if (exclude && x > exclude.x0 - 10 && x < exclude.x1 + 10 && y > -180 && y < 70) continue;
      return [x, y];
    }
    return [0, -400];
  }

  function updateGlints(t) {
    glints = glints.filter((g) => {
      const p = (t - g.born) / g.life;
      if (p >= 1) {
        g.el.remove();
        return false;
      }
      const k = Math.sin(Math.PI * p);
      g.el.setAttribute('transform',
        `translate(${g.x} ${g.y}) rotate(${g.spin * p}) scale(${(g.size * k).toFixed(2)})`);
      g.el.setAttribute('opacity', Math.min(1, k * 1.4).toFixed(2));
      return true;
    });
  }

  /* ================================================================ *
   *  Explosion : particules sur canvas
   * ================================================================ */

  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    fx.width = Math.round(W * DPR);
    fx.height = Math.round(H * DPR);
    if (paused && ready) stepFx(lastT, 0); // image figée : on redessine
  }
  window.addEventListener('resize', resize);
  resize();

  // Sprites pré-calculés : dégradé feu (blanc → jaune → orange → rouge sombre) et fumée.
  const FIRE_PAL = [
    [0, [255, 250, 225]],
    [0.08, [255, 220, 130]],
    [0.22, [255, 160, 50]],
    [0.45, [230, 95, 20]],
    [0.7, [130, 40, 10]],
    [1, [45, 18, 6]],
  ];
  function makeSprite(rgb, inner = 0.35) {
    const s = 128;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    const [r, gg, b] = rgb.map(Math.round);
    rg.addColorStop(0, `rgba(${r},${gg},${b},1)`);
    rg.addColorStop(inner, `rgba(${r},${gg},${b},0.6)`);
    rg.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = rg;
    g.fillRect(0, 0, s, s);
    return c;
  }
  const FIRE_N = 32;
  const fireSprites = Array.from({ length: FIRE_N }, (_, i) => makeSprite(lerpColor(FIRE_PAL, i / (FIRE_N - 1))));
  const smokeSprite = makeSprite([42, 36, 36], 0.45);

  let fire = [], smoke = [], sparks = [], shards = [], embers = [], rings = [];
  let boomInfo = null; // { t, x, y, s }
  let shakeAmp = 0;

  function logoScale() {
    return Math.min(W / 1920, H / 1080);
  }

  function boom(t) {
    const s = logoScale();
    const box = mBox();
    const lx = (box.x0 + box.x1) / 2;
    const ly = 40 - 240 * 0.36; // milieu de la hauteur de capitale
    const x = W / 2 + lx * s;
    const y = H / 2 + ly * s;
    const hw = ((box.x1 - box.x0) / 2) * s;
    boomInfo = { t, x, y, s, hw };

    M.setAttribute('visibility', 'hidden');
    const bulbs = $('bulbs');
    bulbs.classList.add('panic');
    setTimeout(() => bulbs.classList.remove('panic'), 1400);

    // Cœur aveuglant
    for (let i = 0; i < 14; i++) {
      fire.push({ x: x + R(-hw, hw) * 0.6, y: y + R(-50, 50) * s, vx: R(-90, 90), vy: R(-90, 30),
        size: R(120, 200), grow: 1.4, life: R(0.3, 0.6), age: 0, buoy: 40, drag: 4 });
    }
    // Gerbe horizontale (« éclaboussure » plate)
    for (let i = 0; i < 55; i++) {
      const dir = Math.random() < 0.5 ? -1 : 1;
      const sp = R(350, 1150);
      fire.push({ x: x + R(-hw, hw) * 0.6, y: y + R(20, 80) * s, vx: dir * sp, vy: -sp * R(0.02, 0.22),
        size: R(32, 72), grow: 1.8, life: R(0.4, 0.9), age: 0, buoy: 120, drag: 3.2 });
    }
    // Colonne de feu qui monte
    for (let i = 0; i < 95; i++) {
      fire.push({ x: x + R(-hw, hw) * 0.7, y: y + R(-40, 70) * s, vx: R(-150, 150), vy: R(-420, -60),
        size: R(55, 115), grow: 2.2, life: R(0.9, 1.9), age: 0, buoy: 170, drag: 1.7, delay: R(0, 0.4) });
    }
    // Étincelles
    for (let i = 0; i < 80; i++) {
      const a = R(0, Math.PI * 2), sp = R(400, 1500);
      sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.75 - 320, life: R(0.4, 1.2), age: 0,
        w: R(1.5, 4) });
    }
    // Éclats d'or du M
    for (let i = 0; i < 30; i++) {
      const sz = R(9, 26);
      const pts = Array.from({ length: 3 + (Math.random() < 0.4 ? 1 : 0) }, (_, k, arr) => {
        const a = (k / 3.5) * Math.PI * 2 + R(-0.4, 0.4);
        return [Math.cos(a) * sz * R(0.6, 1.2), Math.sin(a) * sz * R(0.6, 1.2)];
      });
      shards.push({ x: x + R(-hw, hw), y: y + R(-80, 80) * s, vx: R(-750, 750), vy: R(-1100, -150),
        rot: R(0, 6.28), vr: R(-14, 14), pts, sz, life: R(1.1, 2), age: 0, light: R(0.6, 1.2) });
    }
    // Fumée (arrive un peu après)
    for (let i = 0; i < 48; i++) {
      smoke.push({ x: x + R(-hw, hw) * 0.9, y: y + R(-60, 40) * s, vx: R(-100, 100), vy: R(-140, -30),
        size: R(70, 130), grow: 3, life: R(2.4, 4.8), age: 0, delay: R(0.2, 1.0), a: R(0.45, 0.7) });
    }
    // Braises
    for (let i = 0; i < 45; i++) {
      embers.push({ x: x + R(-hw, hw), y: y + R(-30, 60) * s, vx: R(-120, 120), vy: R(-260, -60),
        life: R(1.2, 3), age: 0, delay: R(0, 0.4), r: R(1.2, 3), ph: R(0, 6) });
    }
    rings.push({ age: 0, life: 0.5 });

    shakeAmp = 22 * s;
    flash.style.background =
      `radial-gradient(circle at ${x}px ${y}px, rgba(255,252,230,1) 0%, rgba(255,210,130,0.6) 12%, rgba(255,150,40,0.15) 35%, transparent 60%)`;
    flash.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 650, easing: 'cubic-bezier(.2,.7,.3,1)' });

    playBoom();
  }

  function stepFx(t, dt) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!boomInfo) return;
    const s = boomInfo.s;
    const since = t - boomInfo.t;

    // Volutes de fumée résiduelles qui s'échappent de la brèche
    if (since < 6) {
      const rate = 16 * (1 - since / 6);
      if (Math.random() < rate * dt) {
        smoke.push({ x: boomInfo.x + R(-boomInfo.hw, boomInfo.hw) * 0.6, y: boomInfo.y + R(-30, 50) * s,
          vx: R(-30, 30), vy: R(-130, -60), size: R(30, 60), grow: 3.2, life: R(2, 3.2), age: 0, a: R(0.18, 0.32) });
      }
    }

    const live = (p) => {
      if (p.delay > 0) { p.delay -= dt; return true; }
      p.age += dt;
      return p.age < p.life;
    };

    // --- Fumée (dessous) ---
    ctx.globalCompositeOperation = 'source-over';
    smoke = smoke.filter(live);
    for (const p of smoke) {
      if (p.delay > 0) continue;
      p.vx *= Math.exp(-1.2 * dt);
      p.vy = p.vy * Math.exp(-0.8 * dt) - 25 * dt;
      p.x += p.vx * dt * s;
      p.y += p.vy * dt * s;
      const a = p.age / p.life;
      const sz = p.size * (1 + p.grow * easeOut(a)) * s;
      ctx.globalAlpha = p.a * Math.min(1, p.age / 0.35) * Math.pow(1 - a, 1.4);
      ctx.drawImage(smokeSprite, p.x - sz / 2, p.y - sz / 2, sz, sz);
    }

    // --- Feu (additif) ---
    ctx.globalCompositeOperation = 'lighter';
    fire = fire.filter(live);
    for (const p of fire) {
      if (p.delay > 0) continue;
      p.vx *= Math.exp(-p.drag * dt);
      p.vy = p.vy * Math.exp(-p.drag * 0.8 * dt) - p.buoy * dt;
      p.x += p.vx * dt * s;
      p.y += p.vy * dt * s;
      const a = p.age / p.life;
      const sz = p.size * (1 + p.grow * easeOut(a)) * s;
      ctx.globalAlpha = 0.7 * Math.pow(1 - a, 1.3);
      ctx.drawImage(fireSprites[Math.min(FIRE_N - 1, Math.floor(a * FIRE_N))], p.x - sz / 2, p.y - sz / 2, sz, sz);
    }

    // Onde de choc
    rings = rings.filter((r) => (r.age += dt) < r.life);
    for (const r of rings) {
      const p = r.age / r.life;
      ctx.globalAlpha = (1 - p) * 0.55;
      ctx.strokeStyle = 'rgb(255, 225, 160)';
      ctx.lineWidth = 22 * (1 - p) * s + 1;
      ctx.beginPath();
      ctx.ellipse(boomInfo.x, boomInfo.y, easeOut(p) * 420 * s, easeOut(p) * 260 * s, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // --- Éclats d'or ---
    ctx.globalCompositeOperation = 'source-over';
    shards = shards.filter(live);
    for (const p of shards) {
      p.vy += 1500 * dt;
      p.vx *= Math.exp(-0.6 * dt);
      p.x += p.vx * dt * s;
      p.y += p.vy * dt * s;
      p.rot += p.vr * dt;
      const a = p.age / p.life;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(s, s);
      ctx.globalAlpha = Math.min(1, (1 - a) * 2.5);
      // L'éclat « tourne » : sa luminosité oscille avec la rotation
      const flick = 0.55 + 0.45 * Math.sin(p.rot * 2 + p.light * 3);
      const lg = ctx.createLinearGradient(-p.sz, -p.sz, p.sz, p.sz);
      lg.addColorStop(0, `rgb(255, ${Math.round(235 + 20 * flick)}, ${Math.round(120 + 100 * flick)})`);
      lg.addColorStop(0.5, `rgb(${Math.round(200 + 40 * flick)}, ${Math.round(150 + 40 * flick)}, 20)`);
      lg.addColorStop(1, 'rgb(110, 75, 5)');
      ctx.fillStyle = lg;
      ctx.beginPath();
      p.pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // --- Étincelles et braises (additif) ---
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    sparks = sparks.filter(live);
    for (const p of sparks) {
      p.vy += 900 * dt;
      p.vx *= Math.exp(-1.6 * dt);
      p.vy *= Math.exp(-1.0 * dt);
      const ox = p.x, oy = p.y;
      p.x += p.vx * dt * s;
      p.y += p.vy * dt * s;
      const a = p.age / p.life;
      ctx.globalAlpha = 1 - a;
      ctx.strokeStyle = a < 0.4 ? 'rgb(255, 248, 210)' : 'rgb(255, 180, 70)';
      ctx.lineWidth = p.w * s * (1 - a * 0.6);
      ctx.beginPath();
      ctx.moveTo(ox - (p.x - ox) * 1.5, oy - (p.y - oy) * 1.5);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    embers = embers.filter(live);
    for (const p of embers) {
      if (p.delay > 0) continue;
      p.vx = p.vx * Math.exp(-1.5 * dt) + Math.sin(t * 3 + p.ph) * 40 * dt;
      p.vy = p.vy * Math.exp(-1.2 * dt) - 30 * dt;
      p.x += p.vx * dt * s;
      p.y += p.vy * dt * s;
      const a = p.age / p.life;
      const flick = 0.6 + 0.4 * Math.sin(t * 25 + p.ph * 7);
      ctx.globalAlpha = (1 - a) * flick;
      ctx.fillStyle = a < 0.5 ? 'rgb(255, 210, 110)' : 'rgb(255, 120, 40)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * s * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ================================================================ *
   *  Son de l'explosion (synthétisé, aucun fichier)
   * ================================================================ */

  let actx = null;
  function audio() {
    if (muted) return null;
    if (!actx) {
      // En iframe, on emprunte le contexte audio de la page parente : c'est elle qui a
      // reçu le clic d'activation du son (politique d'autoplay des navigateurs).
      let AC = window.AudioContext || window.webkitAudioContext;
      try {
        if (EMBED && window.parent !== window && window.parent.AudioContext) AC = window.parent.AudioContext;
      } catch { /* parent inaccessible */ }
      try { actx = new AC(); } catch { actx = null; }
    }
    return actx;
  }
  const unlock = () => { const ac = audio(); if (ac && ac.state !== 'running') ac.resume(); };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  function playBoom() {
    const ac = audio();
    if (!ac) return;
    if (ac.state !== 'running') ac.resume();
    const now = ac.currentTime + 0.01;

    const out = ac.createDynamicsCompressor();
    out.threshold.value = -12;
    out.ratio.value = 6;
    const master = ac.createGain();
    master.gain.value = 0.9;
    out.connect(master).connect(ac.destination);

    // Souffle + crépitement : bruit filtré qui s'assombrit
    const dur = 3;
    const buf = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      const crackle = Math.random() < 0.004 ? R(2, 4) : 1;
      d[i] = (Math.random() * 2 - 1) * crackle * 0.6;
    }
    const noise = ac.createBufferSource();
    noise.buffer = buf;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(7000, now);
    lp.frequency.exponentialRampToValueAtTime(250, now + 2.2);
    const ng = ac.createGain();
    ng.gain.setValueAtTime(0.0001, now);
    ng.gain.exponentialRampToValueAtTime(1, now + 0.008);
    ng.gain.exponentialRampToValueAtTime(0.25, now + 0.5);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    noise.connect(lp).connect(ng).connect(out);
    noise.start(now);

    // Grave « boum »
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(32, now + 0.7);
    const og = ac.createGain();
    og.gain.setValueAtTime(0.0001, now);
    og.gain.exponentialRampToValueAtTime(1.2, now + 0.01);
    og.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);
    osc.connect(og).connect(out);
    osc.start(now);
    osc.stop(now + 1.5);
  }

  /* ================================================================ *
   *  Boucle principale
   * ================================================================ */

  let t0 = performance.now();
  let last = t0;
  let boomed = false;
  let mGlintDone = false;
  let nextGlint = 0.6;

  function sweep(el, t, period, phase, dur, angle) {
    const p = (((t + phase) % period) + period) % period / dur;
    const x = p <= 1 ? -950 + easeInOut(p) * 1900 : 2000;
    el.setAttribute('transform', `rotate(${angle}) translate(${x.toFixed(1)} 0)`);
  }


  function frame(now) {
    if (!paused) tick(now);
    requestAnimationFrame(frame);
  }

  function tick(now) {
    const t = (now - t0) / 1000;
    lastT = t;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    // Reflets de l'or : les bandes du dégradé glissent en continu
    const k = t * 120 + Math.sin(t * 0.6) * 90;
    goldGrad.setAttribute('gradientTransform', `translate(${(k * 0.76).toFixed(1)} ${(k * 0.65).toFixed(1)})`);
    sweep(sheen1, t, 4.6, -0.8, 1.6, 24);
    sweep(sheen2, t, 6.1, -3.2, 1.15, -32);

    // Scintillements
    if (t > nextGlint) {
      const [x, y] = randomGoldPoint(boomed ? mBox() : null);
      spawnGlint(t, x, y, R(45, 85), R(0.55, 0.9));
      nextGlint = t + R(0.18, 0.6);
    }
    // Un éclat insistant sur le M juste avant qu'il saute
    if (!mGlintDone && t > BOOM_AT - 0.9) {
      mGlintDone = true;
      const b = mBox();
      spawnGlint(t, (b.x0 + b.x1) / 2, -110, 130, 0.85);
    }
    updateGlints(t);

    if (!boomed && t >= BOOM_AT) {
      boomed = true;
      boom(t);
    }
    stepFx(t, dt);

    // Tremblement de l'image
    if (shakeAmp > 0.3) {
      shakeAmp *= Math.exp(-5 * dt);
      stage.style.transform = `translate(${R(-1, 1) * shakeAmp}px, ${R(-1, 1) * shakeAmp}px)`;
    } else if (shakeAmp) {
      shakeAmp = 0;
      stage.style.transform = '';
    }

    if (END && !ended && t >= END) {
      ended = true;
      if (typeof api.onEnd === 'function') api.onEnd();
    }
    if (LOOP && t >= LOOP) restart();
  }

  let ended = false;

  // opts (écran de jeu) : { mute: bool, crt: bool }
  function restart(opts = {}) {
    if ('mute' in opts) muted = !!opts.mute;
    if ('crt' in opts) document.body.classList.toggle('no-crt', !opts.crt);
    ended = false;
    paused = false;
    t0 = last = performance.now();
    boomed = false;
    mGlintDone = false;
    nextGlint = 0.6;
    boomInfo = null;
    fire = []; smoke = []; sparks = []; shards = []; embers = []; rings = [];
    glints.forEach((g) => g.el.remove());
    glints = [];
    shakeAmp = 0;
    stage.style.transform = '';
    M.removeAttribute('visibility');
    logoWrap.classList.remove('appear');
    void logoWrap.offsetWidth; // relance l'animation CSS
    logoWrap.classList.add('appear');
  }

  function boomNow() {
    if (boomed) return;
    t0 = performance.now() - BOOM_AT * 1000;
    mGlintDone = true;
  }

  // Arrêt (écran de jeu) : on fige et on vide les effets.
  function stop() {
    paused = true;
    fire = []; smoke = []; sparks = []; shards = []; embers = []; rings = [];
    boomInfo = null;
    stepFx(0, 0);
  }

  if (!EMBED) {
    window.addEventListener('pointerdown', () => restart());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); restart(); }
      if (e.code === 'KeyB') boomNow();
    });
  }

  let cursorTimer;
  window.addEventListener('mousemove', () => {
    document.body.classList.add('show-cursor');
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => document.body.classList.remove('show-cursor'), 2000);
  });

  // Débogage : se placer à l'instant T (simulation image par image) et figer.
  function seek(T) {
    restart();
    const start = t0;
    for (let ms = 0; ms <= T * 1000; ms += 1000 / 60) tick(start + ms);
    paused = true;
  }

  // « OR » chevauche les anneaux : on bouche en bleu le trou du O et l'espace entre O et R.
  function fitOHole() {
    try {
      const o = $('tOr').getExtentOfChar(0);
      const r = $('tOr').getExtentOfChar(1);
      const cx = o.x + o.width / 2;
      const h = $('oHole');
      h.setAttribute('cx', cx);
      h.setAttribute('cy', 352 - 232 * 0.36);
      h.setAttribute('rx', o.width * 0.3);
      h.setAttribute('ry', 232 * 0.3);
      const b = $('orGap');
      b.setAttribute('x', cx);
      b.setAttribute('y', 352 - 232 * 0.7);
      b.setAttribute('width', r.x + r.width * 0.55 - cx);
      b.setAttribute('height', 232 * 0.7);
    } catch { /* police pas encore prête */ }
  }
  fitOHole();
  if (document.fonts) document.fonts.ready.then(fitOHole);

  const api = { restart, stop, boom: boomNow, seek, resume: () => { paused = false; }, onEnd: null };
  window.intro = api;

  ready = true;
  if (EMBED) document.body.classList.add('embed');
  else logoWrap.classList.add('appear');
  requestAnimationFrame(frame);

  // ?at=T : image figée à l'instant T (pour les captures)
  if (params.has('at')) {
    const T = num(params.get('at'), 0);
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => {
      fitOHole();
      seek(T);
      logoWrap.classList.remove('appear');
    });
  }
})();
