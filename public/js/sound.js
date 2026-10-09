/* ------------------------------------------------------------------ *
 *  Gestionnaire de sons.
 *  - Joue le fichier déposé dans /sounds (mp3, wav, ogg, m4a…) s'il existe.
 *  - Sinon, repli automatique sur un son de synthèse (Web Audio).
 * ------------------------------------------------------------------ */

const SoundManager = (() => {
  // Catalogue : clé logique, nom du fichier attendu dans /sounds (extension libre),
  // libellé de la régie. `music` : une seule musique à la fois ; `loop` : jouée en boucle.
  const CATALOG = [
    { key: 'intro', file: 'intro', emoji: '🎬', label: 'Générique', hint: "Générique de l'émission", music: true },
    { key: 'round', file: 'round', emoji: '🎵', label: 'Musique de manche', hint: 'Auto au lancement de chaque manche', music: true },
    { key: 'buzzer', file: 'buzzer', emoji: '🔔', label: 'Buzzer', hint: 'Auto au buzz du face-à-face' },
    { key: 'reveal', file: 'reveal', emoji: '✅', label: 'Bonne réponse', hint: "Auto à la révélation d'une réponse" },
    { key: 'wrong', file: 'wrong', emoji: '❌', label: 'Mauvaise réponse', hint: 'Auto à chaque faute (le X)', cls: 'btn--x' },
    { key: 'points', file: 'points', emoji: '🔢', label: 'Points', hint: 'Auto quand la cagnotte rejoint le score' },
    { key: 'fivesec', file: '5sec', emoji: '⏱️', label: '5 secondes', hint: 'Touche T · auto à 5 s de la fin du chrono final' },
    { key: 'timesup', file: 'timesup', emoji: '⌛', label: 'Temps écoulé', hint: 'Auto à la fin du chrono final' },
    { key: 'final', file: 'final', emoji: '💰', label: 'Musique de finale', hint: 'Auto pendant le chrono final · en boucle', music: true, loop: true },
    { key: 'applause', file: 'applause', emoji: '👏', label: 'Applaudis­sements', hint: 'Auto avec les points' },
    { key: 'win', file: 'win', emoji: '🏆', label: 'Victoire', hint: 'Auto sur l’écran du gagnant', music: true, cls: 'btn--gold' },
    { key: 'introloop', file: 'intro-boucle', emoji: '🌟', label: "Musique de l'intro", hint: 'Auto pendant l’intro animée · en boucle', music: true, loop: true },
    { key: 'explosion', file: 'explosion', emoji: '💥', label: 'Explosion', hint: 'Auto quand le M de l’intro explose' },
  ];
  const BY_KEY = Object.fromEntries(CATALOG.map((s) => [s.key, s]));

  let files = {};        // clé -> { file, url } du fichier perso trouvé
  let scanned = false;
  let scanning = null;   // promesse du scan en cours
  const listeners = [];
  const elements = {};   // clé -> HTMLAudioElement préchargé
  const playing = {};    // clé -> élément en cours de lecture
  let ctx = null;
  let unlocked = false;
  let muted = false;

  function audioCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }

  /** À appeler sur un geste utilisateur pour débloquer l'audio. */
  function unlock() {
    unlocked = true;
    const c = audioCtx();
    if (c.state === 'suspended') c.resume();
  }

  function setMuted(v) {
    muted = v;
    if (muted) stopAll();
  }
  function isMuted() {
    return muted;
  }
  /** L'audio a-t-il été débloqué par un geste sur cette page ? */
  function isUnlocked() {
    return unlocked && (!ctx || ctx.state === 'running');
  }

  /** Relit la liste des fichiers de /sounds et précharge ceux du catalogue. */
  function scan() {
    if (scanning) return scanning;
    scanning = fetch('/sounds/list', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [])
      .then((list) => {
        const byBase = {};
        (Array.isArray(list) ? list : []).forEach((f) => {
          const base = String(f.file).replace(/\.[^.]+$/, '').toLowerCase();
          if (!byBase[base]) byBase[base] = f;
        });
        files = {};
        CATALOG.forEach((s) => {
          const f = byBase[s.file.toLowerCase()];
          if (f) files[s.key] = f;
        });
        // Précharge (latence minimale au déclenchement) ; oublie les fichiers retirés/remplacés.
        CATALOG.forEach(({ key }) => {
          const f = files[key];
          const el = elements[key];
          if (el && (!f || el.dataset.url !== f.url)) {
            if (playing[key] === el) {
              el.pause();
              delete playing[key];
            }
            if (el.dataset.blob) URL.revokeObjectURL(el.dataset.blob);
            delete elements[key];
          }
          if (f && !elements[key]) {
            const a = new Audio();
            a.preload = 'auto';
            a.dataset.url = f.url;
            a.src = f.url;
            elements[key] = a;
            // Préchargement complet en mémoire (preload="auto" n'est qu'un indice que
            // le navigateur peut ignorer) : le son part sans délai au 1er déclenchement.
            fetch(f.url)
              .then((r) => (r.ok ? r.blob() : null))
              .then((b) => {
                if (!b || elements[key] !== a || playing[key] === a) return; // remplacé ou en cours
                a.dataset.blob = URL.createObjectURL(b);
                a.src = a.dataset.blob;
              })
              .catch(() => {});
          }
        });
        scanned = true;
        scanning = null;
        listeners.forEach((fn) => {
          try {
            fn();
          } catch {}
        });
      });
    return scanning;
  }

  /** Fichier perso utilisé pour un son ({ file, url }) ou null (synthèse). */
  function fileFor(key) {
    return files[key] || null;
  }
  function onChange(fn) {
    listeners.push(fn);
  }

  async function play(name, opts = {}) {
    if (muted || !unlocked) return;
    if (!scanned) await scan();
    if (muted) return;
    const def = BY_KEY[name];
    if (def && def.music) CATALOG.forEach((s) => s.music && s.key !== name && stop(s.key));
    stop(name); // évite les superpositions du même son
    const loop = opts.loop ?? !!(def && def.loop);
    const el = elements[name];
    if (el) {
      el.loop = loop;
      el.volume = opts.volume ?? 1;
      try {
        el.currentTime = 0;
      } catch {}
      playing[name] = el;
      el.play().catch((err) => {
        // Interrompu par un stop() : normal. Sinon (fichier illisible…) → synthèse.
        if (playing[name] !== el) return;
        delete playing[name];
        if (!err || err.name !== 'AbortError') synth(name, { loop });
      });
    } else {
      synth(name, { loop });
    }
  }

  function stop(name) {
    const el = playing[name];
    if (el) {
      el.pause();
      try {
        el.currentTime = 0;
      } catch {}
      delete playing[name];
    }
    if (synthStops[name]) {
      synthStops[name]();
      delete synthStops[name];
    }
  }

  function stopAll() {
    Object.keys(playing).forEach(stop);
    Object.keys(synthStops).forEach(stop);
  }

  /** Événement 'sound' reçu du serveur : { name, stop }. name '*' = tout couper. */
  function handle(msg) {
    const { name, stop: s } = msg || {};
    if (name === '*') return stopAll();
    if (s) stop(name);
    else play(name);
  }

  // ------------------------------------------------------------------ //
  //  Synthèse (repli sans fichiers) — habillage « plateau télé 90s »
  // ------------------------------------------------------------------ //
  const synthStops = {};

  /** Bus de sortie d'un son : le couper silencie tout ce qui y est programmé. */
  function bus(name) {
    const c = audioCtx();
    const out = c.createGain();
    out.connect(c.destination);
    const b = { c, out, t0: c.currentTime + 0.02, timers: [] };
    const stopFn = () => {
      b.timers.forEach(clearTimeout);
      try {
        out.gain.setTargetAtTime(0, c.currentTime, 0.02);
      } catch {}
      setTimeout(() => out.disconnect(), 150);
    };
    synthStops[name] = stopFn;
    // Nettoyage automatique en fin de son (sauf boucles).
    b.done = (seconds) => {
      b.timers.push(
        setTimeout(() => {
          if (synthStops[name] === stopFn) {
            delete synthStops[name];
            out.disconnect();
          }
        }, (seconds + 0.5) * 1000)
      );
    };
    return b;
  }

  /** Enveloppe attaque / maintien / relâchement. */
  function env(param, t, dur, peak, attack = 0.01, release = 0.1) {
    dur = Math.max(dur, attack + 0.02);
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(peak, t + attack);
    param.setValueAtTime(peak, t + Math.max(attack, dur - release));
    param.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  /** Oscillateur simple. */
  function tone(b, freq, start, dur, { type = 'square', gain = 0.15, slideTo = null, lp = 0 } = {}) {
    const { c } = b;
    const t = b.t0 + start;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = c.createGain();
    env(g.gain, t, dur, gain, 0.005, 0.04);
    let node = o;
    if (lp) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lp;
      node = o.connect(f);
    }
    node.connect(g).connect(b.out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Note de « cuivres » : dents de scie désaccordées + filtre qui s'ouvre. */
  function brass(b, freq, start, dur, gain = 0.12) {
    const { c } = b;
    const t = b.t0 + start;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 3;
    f.frequency.setValueAtTime(freq * 1.2, t);
    f.frequency.linearRampToValueAtTime(Math.min(12000, freq * 7), t + 0.05);
    f.frequency.exponentialRampToValueAtTime(Math.min(12000, freq * 3), t + Math.max(0.1, dur));
    const g = c.createGain();
    env(g.gain, t, dur, gain, 0.02, Math.min(0.15, dur / 2));
    [-8, 0, 8].forEach((det) => {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.05);
    });
    f.connect(g).connect(b.out);
  }
  function chord(b, freqs, start, dur, gain = 0.09) {
    freqs.forEach((f) => brass(b, f, start, dur, gain));
  }

  /** Cloche (partiels inharmoniques qui décroissent) : le « ding » du plateau. */
  function bell(b, freq, start, dur = 1.2, gain = 0.2) {
    const { c } = b;
    const t = b.t0 + start;
    [[1, 1], [2, 0.4], [3.01, 0.2], [4.23, 0.1]].forEach(([m, a]) => {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * m;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain * a, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur / Math.sqrt(m));
      o.connect(g).connect(b.out);
      o.start(t);
      o.stop(t + dur + 0.05);
    });
  }

  let noiseBuf = null;
  function noiseBuffer(c) {
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }
  /** Bruit filtré (claps, cymbales, caisse claire). */
  function noise(b, start, dur, { type = 'bandpass', freq = 1500, q = 1, gain = 0.2, attack = 0.002 } = {}) {
    const { c } = b;
    const t = b.t0 + start;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(b.out);
    src.start(t, Math.random() * 1.5, dur + 0.05);
  }
  function kick(b, start, gain = 0.5) {
    const { c } = b;
    const t = b.t0 + start;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.25);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(b.out);
    o.start(t);
    o.stop(t + 0.4);
  }
  function snare(b, start, gain = 0.25) {
    noise(b, start, 0.18, { freq: 1800, q: 0.7, gain });
    tone(b, 190, start, 0.08, { type: 'triangle', gain: gain * 0.6 });
  }
  function cymbal(b, start, dur = 1.4, gain = 0.12) {
    noise(b, start, dur, { type: 'highpass', freq: 6500, q: 0.5, gain });
  }
  /** Public qui applaudit : claps aléatoires + rumeur de fond. */
  function applause(b, start, dur, gain = 0.35) {
    const n = Math.round(dur * 30);
    for (let i = 0; i < n; i++) {
      const at = Math.random() * dur;
      const level = Math.min(1, at / 0.25) * Math.min(1, (dur - at) / (dur * 0.45));
      noise(b, start + at, 0.06 + Math.random() * 0.05, {
        freq: 900 + Math.random() * 1800,
        q: 1.4,
        gain: Math.max(0.001, gain * level * (0.4 + Math.random() * 0.6)),
      });
    }
    noise(b, start, dur, { type: 'lowpass', freq: 2500, q: 0.3, gain: gain * 0.15, attack: 0.3 });
  }

  // Notes utiles (Hz)
  const N = {
    G3: 196, A3: 220, C4: 262, D4: 294, E4: 330, F4: 349, G4: 392, A4: 440, B4: 494,
    C5: 523, D5: 587, E5: 659, F5: 698, Fs5: 740, G5: 784, A5: 880, B5: 988,
    C6: 1047, D6: 1175, E6: 1319, G6: 1568, A6: 1760, C7: 2093,
  };

  function synth(name, opts = {}) {
    if (!BY_KEY[name]) return;
    const b = bus(name);
    switch (name) {
      case 'intro': { // fanfare de générique
        [0, 0.15, 0.3].forEach((t) => brass(b, N.G4, t, 0.11, 0.13));
        chord(b, [N.C5, N.E5, N.G5], 0.45, 0.45);
        kick(b, 0.45);
        snare(b, 0.45);
        brass(b, N.E5, 0.98, 0.14);
        brass(b, N.F5, 1.15, 0.14);
        chord(b, [N.C5, N.E5, N.G5], 1.32, 0.5);
        snare(b, 1.32);
        chord(b, [N.C5, N.E5, N.G5, N.C6], 1.95, 1.5, 0.1);
        kick(b, 1.95, 0.6);
        cymbal(b, 1.95, 1.8);
        [N.C6, N.E6, N.G6, N.C7].forEach((f, i) => bell(b, f, 1.95 + i * 0.07, 1.2, 0.08));
        b.done(3.6);
        break;
      }
      case 'round': { // « ta-da ! » de début de manche
        brass(b, N.A4, 0, 0.1);
        brass(b, N.D5, 0.11, 0.1);
        chord(b, [N.Fs5, N.A5, N.D6], 0.24, 0.8, 0.1);
        kick(b, 0.24);
        cymbal(b, 0.24, 1.1, 0.1);
        [N.D6, N.Fs5 * 2, N.A6].forEach((f, i) => bell(b, f, 0.3 + i * 0.06, 0.9, 0.07));
        b.done(1.3);
        break;
      }
      case 'buzzer': // buzz électronique du face-à-face
        tone(b, N.E5, 0, 0.11, { gain: 0.16, lp: 4000 });
        tone(b, N.B5, 0.1, 0.32, { gain: 0.16, lp: 4000 });
        tone(b, N.B5 * 1.005, 0.1, 0.32, { gain: 0.1, lp: 4000 });
        b.done(0.5);
        break;
      case 'reveal': // le « ding » + bascule de la case
        noise(b, 0, 0.05, { freq: 3000, q: 2, gain: 0.15 });
        bell(b, N.E6, 0.01, 1.1, 0.22);
        bell(b, N.B5, 0.01, 0.9, 0.1);
        b.done(1.2);
        break;
      case 'wrong': // le X : gros buzz grave qui « gratte »
        tone(b, 150, 0, 0.85, { gain: 0.16, lp: 2200 });
        tone(b, 154, 0, 0.85, { gain: 0.16, lp: 2200 });
        tone(b, 75, 0, 0.85, { type: 'sawtooth', gain: 0.18, lp: 1200 });
        b.done(0.9);
        break;
      case 'points': { // compteur qui défile, puis ding
        for (let i = 0; i < 12; i++) tone(b, 1100 + i * 110, i * 0.045, 0.03, { gain: 0.08, lp: 6000 });
        bell(b, N.C7, 0.56, 0.9, 0.12);
        bell(b, N.G6, 0.56, 0.7, 0.08);
        b.done(1.4);
        break;
      }
      case 'fivesec': // bip-bip-biiip
        tone(b, N.B5, 0, 0.12, { gain: 0.14, lp: 5000 });
        tone(b, N.B5, 0.22, 0.12, { gain: 0.14, lp: 5000 });
        tone(b, N.E6, 0.44, 0.35, { gain: 0.14, lp: 5000 });
        b.done(0.8);
        break;
      case 'timesup': // sirène de fin du temps
        tone(b, N.A5, 0, 1.0, { gain: 0.11, lp: 3500 });
        tone(b, 1109, 0, 1.0, { gain: 0.09, lp: 3500 });
        tone(b, N.A3, 0, 1.0, { type: 'sawtooth', gain: 0.1, lp: 1500 });
        b.done(1.1);
        break;
      case 'applause':
        applause(b, 0, 3.2);
        b.done(3.3);
        break;
      case 'win': { // fanfare triomphale + public
        [N.C5, N.E5, N.G5].forEach((f, i) => brass(b, f, i * 0.12, 0.11, 0.13));
        chord(b, [N.C5, N.E5, N.G5, N.C6], 0.36, 0.35);
        kick(b, 0.36);
        snare(b, 0.36);
        [0.75, 0.87, 0.99].forEach((t) => brass(b, N.G5, t, 0.1, 0.12));
        chord(b, [N.E5, N.G5, N.C6, N.E6], 1.12, 1.6, 0.09);
        kick(b, 1.12, 0.6);
        cymbal(b, 1.12, 2);
        [N.C6, N.E6, N.G6, N.C7].forEach((f, i) => bell(b, f, 1.12 + i * 0.07, 1.4, 0.07));
        applause(b, 1.2, 3.5, 0.3);
        b.done(4.8);
        break;
      }
      case 'final': { // groove de suspense (boucle d'une mesure à 120 bpm)
        const bar = (t) => {
          const bass = [N.A3, N.A3, N.A4, N.A3, N.A3, N.A4, N.G3, N.B4 / 2];
          bass.forEach((f, i) => brass(b, f / 2, t + i * 0.25, 0.2, 0.1));
          for (let i = 0; i < 8; i++) noise(b, t + i * 0.25, 0.05, { type: 'highpass', freq: 7000, gain: i % 2 ? 0.08 : 0.04 });
          kick(b, t, 0.35);
          kick(b, t + 1, 0.35);
          snare(b, t + 0.5, 0.12);
          snare(b, t + 1.5, 0.12);
          tone(b, N.E5, t + 1.75, 0.12, { gain: 0.05, lp: 3000 });
        };
        if (!opts.loop) {
          bar(0);
          b.done(2.2);
          break;
        }
        // Chaque mesure (2 s) est programmée ~0,5 s à l'avance, calée sur t0 (pas de dérive).
        let n = 0;
        const loop = () => {
          bar(n * 2);
          n++;
          b.timers.push(setTimeout(loop, Math.max(0, 1000 * (b.t0 + n * 2 - 0.5 - b.c.currentTime))));
        };
        loop();
        break;
      }
      case 'introloop': { // groove « plateau télé » pailleté : C – Am – F – G, 120 bpm
        const prog = [
          [N.C4, [N.C5, N.E5, N.G5], [N.C6, N.E6, N.G6, N.E6]],
          [N.A3, [N.C5, N.E5, N.A5], [N.A5 * 2, N.E6, N.C6, N.E6]],
          [N.F4 / 2, [N.C5, N.F5, N.A5], [N.F5 * 2, N.A6, N.C7, N.A6]],
          [N.G3, [N.D5, N.G5, N.B5], [N.G6, N.D6, N.B5 * 2, N.D6]],
        ];
        const bar = (t, i) => {
          const [root, ch, arp] = prog[i % 4];
          // basse en croches (octave / fondamentale)
          for (let k = 0; k < 8; k++) brass(b, (k % 2 ? root * 2 : root) / 2, t + k * 0.25, 0.18, 0.08);
          // accords « stabs » sur les contretemps
          [0.25, 0.75, 1.25, 1.75].forEach((o) => chord(b, ch, t + o, 0.14, 0.045));
          // paillettes : arpège de cloches
          arp.forEach((f, k) => bell(b, f, t + k * 0.5 + 0.125, 0.6, 0.035));
          // batterie
          kick(b, t, 0.4);
          kick(b, t + 1, 0.4);
          snare(b, t + 0.5, 0.11);
          snare(b, t + 1.5, 0.11);
          for (let k = 0; k < 8; k++) noise(b, t + k * 0.25, 0.04, { type: 'highpass', freq: 8000, gain: k % 2 ? 0.05 : 0.025 });
          if (i % 4 === 3) cymbal(b, t + 1.75, 0.9, 0.06);
        };
        if (!opts.loop) {
          for (let i = 0; i < 4; i++) bar(i * 2, i);
          b.done(8.2);
          break;
        }
        let n = 0;
        const loop = () => {
          bar(n * 2, n);
          n++;
          b.timers.push(setTimeout(loop, Math.max(0, 1000 * (b.t0 + n * 2 - 0.5 - b.c.currentTime))));
        };
        loop();
        break;
      }
      case 'explosion': { // souffle filtré qui s'assombrit + grave « boum » + crépitements
        const { c } = b;
        const t = b.t0;
        const src = c.createBufferSource();
        src.buffer = noiseBuffer(c);
        src.loop = true;
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(7000, t);
        lp.frequency.exponentialRampToValueAtTime(220, t + 2.4);
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.9, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.25, t + 0.5);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 3);
        src.connect(lp).connect(g).connect(b.out);
        src.start(t);
        src.stop(t + 3.05);
        const o = c.createOscillator();
        o.frequency.setValueAtTime(110, t);
        o.frequency.exponentialRampToValueAtTime(32, t + 0.7);
        const og = c.createGain();
        og.gain.setValueAtTime(0.0001, t);
        og.gain.exponentialRampToValueAtTime(1, t + 0.01);
        og.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
        o.connect(og).connect(b.out);
        o.start(t);
        o.stop(t + 1.5);
        for (let i = 0; i < 26; i++) {
          noise(b, 0.05 + Math.random() * 1.6, 0.03, { freq: 1500 + Math.random() * 3000, q: 2, gain: 0.05 + Math.random() * 0.12 });
        }
        b.done(3.2);
        break;
      }
      default:
        break;
    }
  }

  scan();

  return { catalog: CATALOG, play, stop, stopAll, handle, unlock, setMuted, isMuted, isUnlocked, scan, fileFor, onChange };
})();
