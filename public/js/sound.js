/* ------------------------------------------------------------------ *
 *  Gestionnaire de sons.
 *  - Joue /sounds/<fichier> s'il existe (tes propres MP3).
 *  - Sinon, repli automatique sur un son de synthèse (Web Audio).
 * ------------------------------------------------------------------ */

const SoundManager = (() => {
  // Nom logique -> fichier attendu dans /sounds
  const FILES = {
    intro: 'intro.mp3',      // générique de début
    reveal: 'reveal.mp3',    // bonne réponse révélée (ding)
    wrong: 'wrong.mp3',      // mauvaise réponse (buzzer / le X)
    buzzer: 'buzzer.mp3',    // buzz du face-à-face
    timesup: 'timesup.mp3',  // fin du temps (manche finale)
    applause: 'applause.mp3',// applaudissements
    final: 'final.mp3',      // musique de la manche finale
    win: 'win.mp3',          // jingle de victoire
  };

  const probed = {};         // fichier -> bool (disponible ?)
  const playing = {};        // nom -> HTMLAudioElement en cours (pour stop)
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
    if (muted) Object.keys(playing).forEach(stop);
  }
  function isMuted() {
    return muted;
  }

  async function isAvailable(file) {
    if (file in probed) return probed[file];
    try {
      const res = await fetch('/sounds/' + file, { method: 'HEAD' });
      probed[file] = res.ok;
    } catch {
      probed[file] = false;
    }
    return probed[file];
  }

  async function play(name, opts = {}) {
    if (muted || !unlocked) return;
    const file = FILES[name];
    stop(name); // évite les superpositions du même son

    if (file && (await isAvailable(file))) {
      const el = new Audio('/sounds/' + file);
      el.loop = !!opts.loop;
      el.volume = opts.volume ?? 1;
      playing[name] = el;
      el.play().catch(() => synth(name, opts));
    } else {
      synth(name, opts);
    }
  }

  function stop(name) {
    const el = playing[name];
    if (el) {
      el.pause();
      el.currentTime = 0;
      delete playing[name];
    }
    if (synthStops[name]) {
      synthStops[name]();
      delete synthStops[name];
    }
  }

  function stopAll() {
    Object.keys(playing).forEach(stop);
    Object.keys(synthStops).forEach((n) => synthStops[n] && synthStops[n]());
  }

  // ---- Synthèse (repli sans fichiers) ----
  const synthStops = {};

  function tone(freq, start, dur, { type = 'sine', gain = 0.25, slideTo = null } = {}) {
    const c = audioCtx();
    const t = c.currentTime + start;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(c.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function noiseBurst(start, dur, gain = 0.3) {
    const c = audioCtx();
    const t = c.currentTime + start;
    const buffer = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = c.createBufferSource();
    src.buffer = buffer;
    const g = c.createGain();
    g.gain.value = gain;
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1200;
    src.connect(filter).connect(g).connect(c.destination);
    src.start(t);
  }

  function synth(name, opts = {}) {
    switch (name) {
      case 'reveal': // ding montant agréable
        tone(660, 0, 0.18, { type: 'triangle', gain: 0.3 });
        tone(990, 0.08, 0.25, { type: 'triangle', gain: 0.3 });
        break;
      case 'wrong': // le fameux "X" : buzz grave et dur
        tone(180, 0, 0.55, { type: 'sawtooth', gain: 0.35, slideTo: 90 });
        tone(120, 0, 0.55, { type: 'square', gain: 0.25 });
        break;
      case 'buzzer': // buzz court du face-à-face
        tone(440, 0, 0.25, { type: 'square', gain: 0.3 });
        break;
      case 'timesup': // fin du temps : trois notes descendantes
        tone(392, 0, 0.2, { type: 'triangle', gain: 0.32 });
        tone(311, 0.18, 0.2, { type: 'triangle', gain: 0.32 });
        tone(220, 0.36, 0.55, { type: 'sawtooth', gain: 0.3 });
        break;
      case 'applause':
        for (let i = 0; i < 12; i++) noiseBurst(i * 0.06, 0.12, 0.18);
        break;
      case 'win': // accord triomphant
        [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.05, 0.9, { type: 'triangle', gain: 0.25 }));
        for (let i = 0; i < 10; i++) noiseBurst(0.4 + i * 0.06, 0.12, 0.12);
        break;
      case 'intro': // petite fanfare
        [392, 523, 659, 784].forEach((f, i) => tone(f, i * 0.14, 0.3, { type: 'sawtooth', gain: 0.22 }));
        tone(1047, 0.56, 0.6, { type: 'triangle', gain: 0.25 });
        break;
      case 'final': { // boucle d'ambiance "compte à rebours" légère
        if (!opts.loop) {
          [523, 587, 659].forEach((f, i) => tone(f, i * 0.12, 0.3, { gain: 0.2 }));
          break;
        }
        let stop = false;
        let step = 0;
        const tick = () => {
          if (stop || muted) return;
          tone(step % 2 ? 880 : 660, 0, 0.1, { type: 'triangle', gain: 0.15 });
          step++;
          synthTimers[name] = setTimeout(tick, 500);
        };
        tick();
        synthStops[name] = () => {
          stop = true;
          clearTimeout(synthTimers[name]);
        };
        break;
      }
      default:
        break;
    }
  }
  const synthTimers = {};

  return { play, stop, stopAll, unlock, setMuted, isMuted };
})();
