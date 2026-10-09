/* ------------------------------------------------------------------ *
 *  Intro « Une Faille en Or »
 *  Logo doré qui brille en boucle (reflets + scintillements) jusqu'à ce
 *  qu'on déclenche l'explosion du M de FAMILLE → « UNE FA ILLE EN OR ».
 *
 *  Paramètres d'URL :
 *    ?boom=10   explosion automatique à N s (par défaut : jamais, on attend B / boom())
 *    ?loop=20   relance automatique après N secondes
 *    ?mute      pas de son
 *    ?embed     intégrée à l'écran de jeu : attend restart() / boom() ; les sons
 *               (musique, explosion) sont alors diffusés par le serveur (régie + écran de jeu)
 *    ?end=20    instant de fin → appelle intro.onEnd
 *  Clavier : Espace / clic = rejouer, B = explosion (hors embed). Hors embed et hors
 *  ?mute, un premier clic lance l'intro (déblocage du son par le navigateur).
 * ------------------------------------------------------------------ */
(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  const num = (v, d) => (v !== null && v !== '' && isFinite(+v) ? +v : d);
  const BOOM_AT = num(params.get('boom'), Infinity);
  const LOOP = num(params.get('loop'), 0);
  const EMBED = params.has('embed');
  const END = num(params.get('end'), 0);
  let muted = params.has('mute') || EMBED;
  let boomAt = BOOM_AT;

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

  let fire = [], smoke = [], sparks = [], shards = [], embers = [], rings = [], debris = [], flyers = [];
  let boomInfo = null; // { t, x, y, s, hw, onset }
  let shakeAmp = 0;
  const bulbs = $('bulbs');

  function logoScale() {
    return Math.min(W / 1920, H / 1080);
  }

  /* ---------- Son de l'explosion : l'animation suit son volume ---------- *
   * sounds/explosion.* est décodé et analysé : enveloppe (niveau 0–1 par pas de
   * 10 ms) et crépitements (brusques remontées). Sans fichier : enveloppe type. */
  const ENV_STEP = 0.01;
  let boomSound = null; // { url, buffer, env, lead, dur, onsets }

  function analyseBoom(url, buffer) {
    const chans = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    const w = Math.round(buffer.sampleRate * ENV_STEP);
    const frames = Math.ceil(buffer.length / w);
    const db = new Float32Array(frames);
    let peak = 1e-9;
    for (let f = 0; f < frames; f++) {
      let sum = 0;
      const end = Math.min(buffer.length, (f + 1) * w);
      for (let i = f * w; i < end; i++) {
        let v = 0;
        for (const c of chans) v += c[i];
        v /= chans.length;
        sum += v * v;
      }
      db[f] = Math.sqrt(sum / Math.max(1, end - f * w));
      peak = Math.max(peak, db[f]);
    }
    for (let f = 0; f < frames; f++) db[f] = 20 * Math.log10(db[f] / peak + 1e-6);
    // Niveau 0–1 (−48 dB → 0), qui retombe en douceur
    const env = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      const v = Math.min(1, Math.max(0, (db[f] + 48) / 48));
      env[f] = Math.max(v, f ? env[f - 1] * Math.exp(-ENV_STEP / 0.08) : 0);
    }
    // Silence éventuel en tête de fichier : l'explosion part avec le son, pas avant
    let first = env.findIndex((v) => v > 0.4);
    if (first < 0) first = 0;
    let last = frames - 1;
    while (last > first && env[last] < 0.04) last--;
    // Crépitements : le niveau bondit d'un coup au-dessus des 100 ms précédentes
    const onsets = [];
    for (let f = first + 25; f <= last; f++) {
      let m = 0;
      for (let k = f - 10; k < f; k++) m += db[k];
      if (db[f] - m / 10 > 5 && env[f] > 0.12 && (!onsets.length || (f - first) * ENV_STEP - onsets[onsets.length - 1] > 0.08)) {
        onsets.push((f - first) * ENV_STEP);
      }
    }
    return { url, buffer, env, lead: first * ENV_STEP, dur: (last - first) * ENV_STEP, onsets };
  }

  function loadBoomSound() {
    fetch('/sounds/list', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        const f = (Array.isArray(list) ? list : []).find((x) => /^explosion\.[^.]+$/i.test(String(x.file)));
        if (!f) return (boomSound = null);
        if (boomSound && boomSound.url === f.url) return; // déjà analysé (l'URL change avec le fichier)
        return fetch(f.url)
          .then((r) => r.arrayBuffer())
          .then((ab) => new OfflineAudioContext(1, 1, 44100).decodeAudioData(ab))
          .then((buf) => { boomSound = analyseBoom(f.url, buf); });
      })
      .catch(() => { boomSound = null; });
  }

  // Niveau sonore de l'explosion τ secondes après son départ (0–1)
  function boomLevel(tau) {
    if (tau < 0) return 0;
    if (!boomSound) return tau < 0.6 ? 1 : Math.max(0, 1 - (tau - 0.6) / 2.4);
    const i = (tau + boomSound.lead) / ENV_STEP;
    const i0 = Math.floor(i), env = boomSound.env;
    if (i0 >= env.length - 1) return 0;
    return env[i0] + (env[i0 + 1] - env[i0]) * (i - i0);
  }
  const boomDur = () => (boomSound ? boomSound.dur : 3);

  // Morceau polygonal irrégulier (n sommets) autour de l'origine
  function chunkShape(n, sz) {
    return Array.from({ length: n }, (_, k) => {
      const a = (k / n) * Math.PI * 2 + R(-0.35, 0.35);
      const r = sz * R(0.55, 1.1);
      return [Math.cos(a) * r, Math.sin(a) * r];
    });
  }

  function boom(t) {
    const s = logoScale();
    const box = mBox();
    const lx = (box.x0 + box.x1) / 2;
    const ly = 40 - 240 * 0.36; // milieu de la hauteur de capitale
    const x = W / 2 + lx * s;
    const y = H / 2 + ly * s;
    const hw = ((box.x1 - box.x0) / 2) * s;
    boomInfo = { t, x, y, s, hw, onset: 0 };

    M.setAttribute('visibility', 'hidden');

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
    // Colonne de feu qui monte (entretenue ensuite tant que le son gronde, cf. stepFx)
    for (let i = 0; i < 70; i++) {
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
    // Escarbilles noircies
    for (let i = 0; i < 40; i++) {
      const sz = R(3, 9);
      shards.push({ x: x + R(-hw, hw), y: y + R(-60, 60) * s, vx: R(-900, 900), vy: R(-1000, -100),
        rot: R(0, 6.28), vr: R(-18, 18), pts: chunkShape(3 + Math.floor(R(0, 2)), sz), sz, life: R(1.4, 2.6), age: 0,
        light: 0, dark: true });
    }
    // Débris : gros morceaux du M (or) et du bandeau (bleu liseré d'or), qui tournoient
    // en brûlant puis fument et retombent hors champ
    for (let i = 0; i < 18; i++) {
      const banner = i % 3 === 0;
      const sz = banner ? R(26, 46) : R(22, 56);
      const r = Math.random();
      const a = r < 0.75 ? R(-Math.PI + 0.15, -0.15) : r < 0.875 ? R(-0.15, 0.5) : R(Math.PI - 0.5, Math.PI + 0.15);
      const sp = R(500, 1300);
      debris.push({ x: x + R(-hw, hw) * 0.7, y: y + R(-60, 60) * s, vx: Math.cos(a) * sp * 1.25, vy: Math.sin(a) * sp,
        rot: R(0, 6.28), vr: R(-7, 7), tilt: R(0, 6.28), vt: R(-9, 9), pts: chunkShape(4 + Math.floor(R(0, 3)), sz),
        sz, banner, burn: R(0.5, 1.4), age: 0, life: 3.5 });
    }
    // Quelques morceaux projetés droit vers la caméra
    for (let i = 0; i < 4; i++) {
      const a = R(0, Math.PI * 2);
      flyers.push({ x: x + R(-hw, hw) * 0.4, y: y + R(-30, 30) * s, vx: Math.cos(a) * R(250, 600),
        vy: Math.sin(a) * R(200, 450) - 150, rot: R(0, 6.28), vr: R(-5, 5), tilt: R(0, 6.28), vt: R(-6, 6),
        pts: chunkShape(5, 22), sz: 22, banner: i === 0, age: 0, life: R(0.6, 0.9), delay: R(0, 0.08) });
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

    shakeAmp = 26 * s;
    // Éclair puis lueur qui suit le volume (cf. stepFx)
    flash.style.background =
      `radial-gradient(circle at ${x}px ${y}px, rgba(255,252,230,1) 0%, rgba(255,210,130,0.6) 12%, rgba(255,150,40,0.15) 35%, transparent 60%)`;

    playBoom();
  }

  // Crépitement du son : gerbe d'étincelles et petit sursaut de l'image
  function pop() {
    const { x, y, s, hw } = boomInfo;
    const px = x + R(-hw, hw) * 0.8, py = y + R(-40, 40) * s;
    for (let i = 0; i < 14; i++) {
      const a = R(0, Math.PI * 2), sp = R(250, 800);
      sparks.push({ x: px, y: py, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.75 - 200, life: R(0.25, 0.7), age: 0,
        w: R(1.2, 3) });
    }
    for (let i = 0; i < 4; i++) {
      embers.push({ x: px, y: py, vx: R(-150, 150), vy: R(-220, -60), life: R(0.8, 1.8), age: 0, delay: 0,
        r: R(1.2, 2.6), ph: R(0, 6) });
    }
    shakeAmp += 6 * s;
  }

  // Débris : face (or, ou bleu liseré d'or) + tranche plus sombre, aplatie selon la rotation 3D
  function drawChunk(p, scale, alpha) {
    const c = Math.cos(p.tilt);
    const lit = 0.5 + 0.5 * Math.sin(p.tilt * 1.3 + p.rot);
    const path = (dx, dy) => {
      ctx.beginPath();
      p.pts.forEach(([px, py], i) => (i ? ctx.lineTo(px + dx, py + dy) : ctx.moveTo(px + dx, py + dy)));
      ctx.closePath();
    };
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.scale(scale, scale * (c < 0 ? -1 : 1) * Math.max(0.12, Math.abs(c)));
    ctx.globalAlpha = alpha;
    path(3, 5);
    ctx.fillStyle = p.banner ? '#040c3a' : '#4a2f02';
    ctx.fill();
    path(0, 0);
    if (p.banner) {
      ctx.fillStyle = `rgb(${Math.round(16 + 40 * lit)}, ${Math.round(40 + 60 * lit)}, ${Math.round(150 + 80 * lit)})`;
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = `rgb(255, ${Math.round(200 + 45 * lit)}, ${Math.round(40 + 120 * lit)})`;
      ctx.lineWidth = p.sz * 0.45;
      ctx.beginPath();
      ctx.moveTo(...p.pts[0]);
      ctx.lineTo(...p.pts[1]);
      ctx.stroke();
      ctx.restore();
    } else {
      const lg = ctx.createLinearGradient(-p.sz, -p.sz, p.sz, p.sz);
      lg.addColorStop(0, `rgb(255, ${Math.round(225 + 30 * lit)}, ${Math.round(110 + 120 * lit)})`);
      lg.addColorStop(0.5, `rgb(${Math.round(190 + 50 * lit)}, ${Math.round(140 + 50 * lit)}, 20)`);
      lg.addColorStop(1, 'rgb(105, 70, 5)');
      ctx.fillStyle = lg;
      ctx.fill();
    }
    ctx.restore();
  }

  function stepFx(t, dt) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!boomInfo) {
      flash.style.opacity = 0;
      return;
    }
    const s = boomInfo.s;
    const since = t - boomInfo.t;
    const L = boomLevel(since);
    flash.style.opacity = Math.min(1, Math.exp(-since / 0.14) + 0.3 * L * L * L).toFixed(3);

    if (dt > 0) {
      // Boule de feu entretenue tant que le son gronde, puis qui s'éteint avec lui
      let n = 160 * L * L * L * dt;
      for (; n > 0; n--) {
        if (n < 1 && Math.random() > n) break;
        fire.push({ x: boomInfo.x + R(-boomInfo.hw, boomInfo.hw) * 0.6, y: boomInfo.y + R(-30, 60) * s,
          vx: R(-140, 140), vy: R(-380, -80) * (0.4 + 0.6 * L), size: R(40, 90) * (0.5 + 0.5 * L), grow: 2,
          life: R(0.6, 1.3), age: 0, buoy: 170, drag: 1.7 });
      }
      // Crépitements du son
      const onsets = boomSound ? boomSound.onsets : [];
      while (boomInfo.onset < onsets.length && onsets[boomInfo.onset] <= since) {
        boomInfo.onset++;
        pop();
      }
    }

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
      if (p.dark) {
        ctx.fillStyle = 'rgb(38, 24, 12)';
      } else {
        // L'éclat « tourne » : sa luminosité oscille avec la rotation
        const flick = 0.55 + 0.45 * Math.sin(p.rot * 2 + p.light * 3);
        const lg = ctx.createLinearGradient(-p.sz, -p.sz, p.sz, p.sz);
        lg.addColorStop(0, `rgb(255, ${Math.round(235 + 20 * flick)}, ${Math.round(120 + 100 * flick)})`);
        lg.addColorStop(0.5, `rgb(${Math.round(200 + 40 * flick)}, ${Math.round(150 + 40 * flick)}, 20)`);
        lg.addColorStop(1, 'rgb(110, 75, 5)');
        ctx.fillStyle = lg;
      }
      ctx.beginPath();
      p.pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // --- Débris (traînée de feu, puis de fumée) ---
    debris = debris.filter((p) => live(p) && p.y < H + 200 * s && p.x > -200 * s && p.x < W + 200 * s);
    for (const p of debris) {
      if (dt > 0) {
        p.vy += 1400 * dt;
        p.vx *= Math.exp(-0.5 * dt);
        p.x += p.vx * dt * s;
        p.y += p.vy * dt * s;
        p.rot += p.vr * dt;
        p.tilt += p.vt * dt;
        if (p.age < p.burn) {
          fire.push({ x: p.x, y: p.y, vx: R(-30, 30), vy: R(-60, 0), size: R(18, 34) * (1 - p.age / p.burn * 0.6),
            grow: 1.2, life: R(0.25, 0.45), age: 0, buoy: 60, drag: 2 });
        } else if (Math.random() < 30 * dt) {
          smoke.push({ x: p.x, y: p.y, vx: R(-15, 15), vy: R(-40, -10), size: R(14, 26), grow: 2.5, life: R(0.8, 1.4),
            age: 0, a: R(0.25, 0.4) });
        }
      }
      drawChunk(p, s, 1);
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

    // --- Morceaux qui foncent vers la caméra (par-dessus tout) ---
    ctx.globalCompositeOperation = 'source-over';
    flyers = flyers.filter(live);
    for (const p of flyers) {
      if (p.delay > 0) continue;
      const a = p.age / p.life;
      const z = 1 + 9 * a * a; // grossit en approchant
      p.x += p.vx * dt * s * Math.sqrt(z);
      p.y += p.vy * dt * s * Math.sqrt(z);
      p.rot += p.vr * dt;
      p.tilt += p.vt * dt;
      drawChunk(p, s * z, a < 0.7 ? 1 : (1 - a) / 0.3);
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

  /* ---------- Musique de l'intro en boucle (aperçu seul : sur l'écran de jeu, ---------- *
   * c'est le serveur qui la diffuse). Début « intro-boucle-debut » joué une fois s'il existe. */
  const MUSIC_VOL = 0.2;
  let music = null; // promesse { buffer, loopStart } (null : pas de fichier)
  let musicStop = null;
  let musicToken = 0;

  function loadMusic() {
    const dec = new OfflineAudioContext(2, 1, 44100);
    const load = (f) => f && fetch(f.url).then((r) => r.arrayBuffer()).then((ab) => dec.decodeAudioData(ab));
    return fetch('/sounds/list', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        const find = (re) => (Array.isArray(list) ? list : []).find((x) => re.test(String(x.file)));
        const loop = find(/^intro-boucle\.[^.]+$/i);
        if (!loop) return null;
        return Promise.all([load(find(/^intro-boucle-debut\.[^.]+$/i)), load(loop)]);
      })
      .then((bufs) => {
        if (!bufs) return null;
        const [a, b] = bufs;
        if (!a) return { buffer: b, loopStart: 0 };
        const ch = Math.max(a.numberOfChannels, b.numberOfChannels);
        const buffer = new AudioBuffer({ length: a.length + b.length, numberOfChannels: ch, sampleRate: a.sampleRate });
        for (let i = 0; i < ch; i++) {
          buffer.copyToChannel(a.getChannelData(Math.min(i, a.numberOfChannels - 1)), i, 0);
          buffer.copyToChannel(b.getChannelData(Math.min(i, b.numberOfChannels - 1)), i, a.length);
        }
        return { buffer, loopStart: a.length / a.sampleRate };
      })
      .catch(() => null);
  }

  function stopMusic() {
    musicToken++;
    if (musicStop) musicStop();
    musicStop = null;
  }

  // Repart du début (si l'audio est encore bloqué, elle démarre au premier geste)
  function playMusic() {
    stopMusic();
    const ac = EMBED ? null : audio();
    if (!ac) return;
    const token = musicToken;
    (music = music || loadMusic()).then((m) => {
      if (!m || token !== musicToken) return;
      const gain = ac.createGain();
      gain.gain.value = MUSIC_VOL;
      gain.connect(ac.destination);
      const src = ac.createBufferSource();
      src.buffer = m.buffer;
      src.loop = true;
      src.loopStart = m.loopStart;
      src.loopEnd = m.buffer.duration;
      src.connect(gain);
      src.start();
      musicStop = () => {
        try { src.stop(); } catch { /* déjà arrêtée */ }
        gain.disconnect();
      };
    });
  }

  function playBoom() {
    const ac = audio();
    if (!ac) return;
    if (ac.state !== 'running') ac.resume();
    if (boomSound) { // le fichier de sounds/, sans son silence de tête : il part avec l'image
      const src = ac.createBufferSource();
      src.buffer = boomSound.buffer;
      src.connect(ac.destination);
      src.start(0, boomSound.lead);
      return;
    }
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
  let boomClock = null;
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
    if (!mGlintDone && t > boomAt - 0.9) {
      mGlintDone = true;
      const b = mBox();
      spawnGlint(t, (b.x0 + b.x1) / 2, -110, 130, 0.85);
    }
    updateGlints(t);

    if (!boomed && t >= boomAt) {
      // Écran de jeu : le son est joué par la page parente ; on attend qu'il démarre
      // vraiment (position > silence de tête) pour que l'image parte pile avec lui.
      const lead = boomSound ? boomSound.lead : 0;
      const pos = boomClock ? boomClock() : null;
      const ok = typeof pos === 'number' && pos < lead + 1;
      if (!(ok && pos < lead && t - boomAt < 0.6)) {
        boomed = true;
        boom(ok && pos >= lead ? t - (pos - lead) : t);
      }
    }
    stepFx(t, dt);
    bulbs.classList.toggle('panic', !!boomInfo && boomLevel(t - boomInfo.t) > 0.55);

    // Tremblement de l'image : suit le volume du son
    if (boomInfo) {
      const L = boomLevel(t - boomInfo.t);
      shakeAmp = Math.max(shakeAmp, 20 * boomInfo.s * L * L);
    }
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
    boomAt = BOOM_AT;
    t0 = last = performance.now();
    boomed = false;
    mGlintDone = false;
    nextGlint = 0.6;
    boomClock = null;
    boomInfo = null;
    fire = []; smoke = []; sparks = []; shards = []; embers = []; rings = []; debris = []; flyers = [];
    loadBoomSound(); // le fichier a pu changer depuis la dernière fois
    playMusic();
    glints.forEach((g) => g.el.remove());
    glints = [];
    shakeAmp = 0;
    stage.style.transform = '';
    M.removeAttribute('visibility');
    logoWrap.classList.remove('appear');
    void logoWrap.offsetWidth; // relance l'animation CSS
    logoWrap.classList.add('appear');
  }

  // clock (écran de jeu) : position de lecture du son d'explosion, en secondes
  // (0 = pas encore parti, null = pas de son joué ici).
  function boomNow(clock) {
    if (boomed) return;
    boomAt = lastT; // à la prochaine image
    boomClock = typeof clock === 'function' ? clock : null;
    mGlintDone = true;
  }

  // Arrêt (écran de jeu) : on fige et on vide les effets.
  function stop() {
    paused = true;
    fire = []; smoke = []; sparks = []; shards = []; embers = []; rings = []; debris = []; flyers = [];
    boomInfo = null;
    bulbs.classList.remove('panic');
    stepFx(0, 0);
  }

  // Aperçu : un premier clic lance l'intro (sans geste, le navigateur bloque le son).
  let waiting = !EMBED && !muted && !params.has('at');
  function start() {
    waiting = false;
    document.body.classList.remove('waiting');
    restart();
  }

  if (!EMBED) {
    window.addEventListener('pointerdown', () => (waiting ? start() : restart()));
    window.addEventListener('keydown', (e) => {
      if (waiting) { e.preventDefault(); start(); return; }
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); restart(); }
      if (e.code === 'KeyB') boomNow();
    });
  }
  loadBoomSound();

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
    stopMusic(); // image figée : pas de musique
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
  else if (waiting) {
    paused = true;
    document.body.classList.add('waiting');
  } else {
    logoWrap.classList.add('appear');
    playMusic();
  }
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
