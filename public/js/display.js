/* ------------------------------------------------------------------ *
 *  Écran de jeu — rendu temps réel de l'état reçu du serveur.
 * ------------------------------------------------------------------ */

const stage = document.getElementById('stage');
const connDot = document.getElementById('connDot');
let prev = null;
let cur = null; // dernier état reçu (utilisé par le décompte du chrono)

// ---- Connexion temps réel (Socket.IO : WebSocket + repli long-polling, reconnexion auto) ----
const socket = io();
socket.on('connect', () => connDot.classList.add('ok'));
socket.on('disconnect', () => connDot.classList.remove('ok'));
socket.on('state', (s) => render(s));
socket.on('sound', (msg) => SoundManager.handle(msg));
socket.on('soundsChanged', () => SoundManager.scan());

// ---- Jingle vidéo (plein écran, piloté par la régie) ----

// Préchargement : les vidéos de media/ sont téléchargées en entier en mémoire dès
// l'ouverture de l'écran (une à la fois), pour démarrer instantanément sans
// mise en mémoire tampon. La progression est remontée à la régie.
const mediaCache = {}; // url -> URL blob locale
let preloading = false;
async function preloadMedia() {
  if (preloading) return;
  preloading = true;
  try {
    const list = await fetch('/media/list', { cache: 'no-store' }).then((r) => r.json());
    for (const { url } of Array.isArray(list) ? list : []) {
      if (!mediaCache[url]) await preloadOne(url);
    }
  } catch {}
  preloading = false;
}
async function preloadOne(url) {
  const report = (st) => socket.emit('mediaPreload', { url, ...st });
  try {
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(res.status);
    const total = Number(res.headers.get('Content-Length')) || 0;
    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;
    let lastPct = -1;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      const pct = total ? Math.floor((loaded / total) * 20) : -1; // tous les 5 %
      if (pct !== lastPct) {
        lastPct = pct;
        report({ loaded, total });
      }
    }
    const type = res.headers.get('Content-Type') || 'video/mp4';
    mediaCache[url] = URL.createObjectURL(new Blob(chunks, { type }));
    report({ loaded, total: total || loaded, done: true });
  } catch {
    report({ error: true });
  }
}
socket.on('connect', preloadMedia);

let videoWasMuted = false;
function playVideo(src) {
  const ov = document.getElementById('videoOverlay');
  const v = document.getElementById('jingleVideo');
  if (!ov || !v) return;
  cancelVideoFade();
  // Coupe les autres sons pendant le jingle (évite la superposition avec la musique).
  // On ne mémorise l'état de mute qu'à la 1re entrée : une rediffusion / un enchaînement
  // de jingles ne doit pas écraser l'état sauvegardé (sinon le son resterait coupé).
  if (!ov.classList.contains('show')) videoWasMuted = SoundManager.isMuted();
  SoundManager.setMuted(true);
  v.src = mediaCache[src] || src; // version préchargée si disponible
  ov.classList.add('show');
  // Si l'autoplay est refusé (public n'a pas encore activé le son), on ne reste pas
  // bloqué sur un écran noir : on referme l'overlay et on restaure le son.
  v.play().catch(() => hideVideo());
}
function hideVideo() {
  const ov = document.getElementById('videoOverlay');
  const v = document.getElementById('jingleVideo');
  if (!ov || !v) return;
  cancelVideoFade();
  ov.classList.remove('show');
  v.pause();
  v.removeAttribute('src');
  v.load();
  SoundManager.setMuted(videoWasMuted);
}

// Fondu de sortie (image vers le noir/le jeu + son) au Stop et en fin de vidéo.
const VIDEO_FADE_MS = 1200;
let videoFade = null;
function cancelVideoFade() {
  const ov = document.getElementById('videoOverlay');
  const v = document.getElementById('jingleVideo');
  if (videoFade) {
    clearInterval(videoFade.tick);
    clearTimeout(videoFade.guard);
    videoFade = null;
  }
  if (ov) ov.style.opacity = '';
  if (v) v.volume = 1;
}
function fadeOutVideo() {
  const ov = document.getElementById('videoOverlay');
  const v = document.getElementById('jingleVideo');
  if (!ov || !v || !ov.classList.contains('show') || videoFade) return;
  const t0 = performance.now();
  const vol0 = v.volume;
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / VIDEO_FADE_MS);
    ov.style.opacity = String(1 - k);
    v.volume = vol0 * (1 - k) * (1 - k); // courbe douce pour l'oreille
    if (k >= 1) hideVideo();
  };
  // Filet de sécurité si l'onglet est en arrière-plan (minuteurs ralentis).
  videoFade = { tick: setInterval(step, 30), guard: setTimeout(hideVideo, VIDEO_FADE_MS + 500) };
}

socket.on('video', (msg) => {
  if (!msg) return;
  if (msg.stop) fadeOutVideo();
  else if (msg.src) {
    stopIntro();
    playVideo(msg.src);
  }
});
document.getElementById('jingleVideo').addEventListener('ended', fadeOutVideo);

// ---- Intro animée « Une Faille en Or » (iframe /intro.html?embed) ----
const introOverlay = document.getElementById('introOverlay');
const introFrame = document.getElementById('introFrame');
let introStopTimer = null;
function introApi() {
  try {
    return introFrame.contentWindow.intro || null;
  } catch {
    return null;
  }
}
function playIntro() {
  const api = introApi();
  if (!api) return;
  hideVideo();
  clearTimeout(introStopTimer);
  api.restart({ crt: !isRetro() }); // le thème rétro a déjà son propre tube cathodique
  introOverlay.classList.add('show');
}
// L'intro tourne en boucle ; c'est la régie qui fait exploser le M.
// Les sons (musique, explosion) arrivent par l'événement 'sound' du serveur, juste avant :
// l'intro suit la lecture du son d'explosion pour partir pile avec lui.
function boomIntro() {
  const api = introApi();
  if (!api || !introOverlay.classList.contains('show')) return;
  api.boom(() => SoundManager.position('explosion'));
}
function stopIntro() {
  if (!introOverlay.classList.contains('show')) return;
  introOverlay.classList.remove('show');
  clearTimeout(introStopTimer);
  introStopTimer = setTimeout(() => introApi()?.stop(), 800); // après le fondu
}
socket.on('intro', (msg) => {
  if (!msg) return;
  if (msg.stop) stopIntro();
  else if (msg.boom) boomIntro();
  else if (msg.play) playIntro();
});

// ---- Thème rétro : effets « télé cathodique » ----
const isRetro = () => !!(cur && cur.theme === 'retro');
const crt = document.getElementById('crt');
const crtTimers = {};
// 'boot' = allumage du tube, 'zap' = neige au changement de plan (cf. retro.css).
function crtFx(name, ms) {
  if (!crt) return;
  crt.classList.remove(name);
  void crt.offsetWidth; // relance l'animation si elle est déjà en cours
  crt.classList.add(name);
  clearTimeout(crtTimers[name]);
  crtTimers[name] = setTimeout(() => crt.classList.remove(name), ms);
}

// Texte + copie dans data-text (le thème rétro s'en sert pour le lettrage en relief).
function setText3d(el, text) {
  el.textContent = text;
  el.dataset.text = text;
}

// Texte précédé d'un emoji isolé dans un <span class="emo"> (masqué en thème rétro).
function setEmojiText(el, emoji, text) {
  const e = document.createElement('span');
  e.className = 'emo';
  e.textContent = emoji;
  el.replaceChildren(e, ' ' + text);
}

// ---- Activation du son + plein écran ----
const gate = document.getElementById('soundGate');
document.getElementById('soundGateBtn').addEventListener('click', () => {
  SoundManager.unlock();
  gate.classList.add('hidden');
  if (isRetro()) crtFx('boot', 1200);
  if (document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
});

// ---- Rendu ----
function render(s) {
  cur = s;
  SoundManager.setVolume('introloop', (s.introVolume ?? 40) / 100); // curseurs de la régie
  SoundManager.setVolume('explosion', (s.explosionVolume ?? 100) / 100);
  // Thème choisi en régie (sombre / clair / rétro) appliqué à l'écran de jeu.
  const theme = s.theme || 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  if (theme === 'retro' && prev) {
    if ((prev.theme || 'dark') !== 'retro') crtFx('boot', 1200);
    // Changement de plan : un peu de neige. Pas entre la question et son plateau
    // (même manche, la question glisse à sa place).
    else if (prev.view !== s.view && !(prev.view === 'question' && s.view === 'board')) crtFx('zap', 450);
  }
  stage.dataset.view = s.view;

  // Titre / logo
  setText3d(document.getElementById('logoTitle'), s.title);

  // Équipes & scores
  s.teams.forEach((t, i) => {
    document.querySelector(`[data-team-name="${i}"]`).textContent = t.name;
    const el = document.querySelector(`[data-team-score="${i}"]`);
    const old = prev?.teams?.[i]?.score;
    el.textContent = t.score;
    if (old !== undefined && old !== t.score) {
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
    }
  });

  // Cagnotte + multiplicateur
  const board = s.board;
  document.getElementById('potValue').textContent = board ? board.pot : 0;
  document.getElementById('potMult').textContent =
    board && board.multiplier > 1 ? `× ${board.multiplier}` : '';

  // Fautes
  renderStrikes(board ? board.strikes : 0);
  if (board && prev?.board && board.strikes > prev.board.strikes) bigX();

  // Vues
  renderQuestion(s);
  renderBoard(board);
  renderFinal(s.finalState, s);
  renderSpeaker(s);
  renderWinner(s);
  renderBuzzer(s);
  renderJoinQR(s);
  fitLamps();

  prev = s;
}

function renderStrikes(n) {
  const box = document.getElementById('strikes');
  box.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const x = document.createElement('span');
    x.className = 'strikes__x';
    x.textContent = '✕';
    box.appendChild(x);
  }
}

function bigX() {
  const wrap = document.createElement('div');
  wrap.className = 'big-x';
  wrap.innerHTML = '<span>✕</span>';
  document.body.appendChild(wrap);
  setTimeout(() => wrap.remove(), 900);
  // L'image tremble (effet visible en thème rétro seulement, cf. retro.css).
  document.body.classList.remove('shake');
  void document.body.offsetWidth;
  document.body.classList.add('shake');
  setTimeout(() => document.body.classList.remove('shake'), 500);
}

function renderQuestion(s) {
  const round = s.rounds[s.currentRoundIndex];
  const badge = document.getElementById('qRoundBadge');
  badge.textContent = `MANCHE ${s.currentRoundIndex + 1}`;
  if (round?.multiplier > 1) {
    // Multiplicateur à part : pastille « explosion » en thème rétro.
    const m = document.createElement('span');
    m.className = 'round-badge__mult';
    m.textContent = `×${round.multiplier}`;
    badge.appendChild(m);
  }
  document.getElementById('qText').textContent = shownQuestion(s.board);
}

// Question de la manche, ou '' tant que l'animateur ne l'a pas fait afficher.
function shownQuestion(board) {
  return board && board.questionShown !== false ? board.question : '';
}

// Texte d'une réponse. En thème rétro : une lettre par <span> pour que
// l'afficheur à ampoules les allume l'une après l'autre. Sinon : texte simple.
// On ne reconstruit le DOM que si le contenu (ou le thème) change, pour ne pas
// relancer l'animation à chaque rafraîchissement.
function setAnswerText(el, text) {
  if (!el) return;
  const retro = isRetro();
  const key = (retro ? 'R|' : 'P|') + text;
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  if (!retro) {
    el.classList.remove('lamps');
    el.textContent = text;
    return;
  }
  el.classList.add('lamps');
  // Une ligne qui porte les lettres : fitLamps() la resserre, ou la coupe en deux,
  // si la réponse est trop longue.
  const line = document.createElement('span');
  line.className = 'lamps__line';
  const chars = [...String(text)];
  // Point de coupure éventuel : l'espace qui équilibre le mieux les deux lignes.
  let brk = -1;
  let best = Infinity;
  chars.forEach((ch, i) => {
    const cost = Math.max(i, chars.length - i - 1);
    if (ch === ' ' && cost < best) {
      best = cost;
      brk = i;
    }
  });
  chars.forEach((ch, i) => {
    const s = document.createElement('span');
    s.className = i === brk ? 'lamp lamp--brk' : 'lamp';
    s.style.setProperty('--i', i);
    s.textContent = ch === ' ' ? ' ' : ch;
    line.appendChild(s);
    if (i === brk) {
      const br = document.createElement('span');
      br.className = 'lamp-br';
      line.appendChild(br);
    }
  });
  el.replaceChildren(line);
}

// Afficheur à ampoules : la grille a un pas fixe sur tout l'écran (comme un vrai
// tableau), elle ne suit pas la taille du texte. Une réponse trop longue est
// resserrée horizontalement ; au-delà d'un resserrement lisible, elle passe sur
// deux lignes (plateau seulement : les cases de la finale sont trop basses).
const LAMP_MIN_SQUEEZE = 0.72;
function fitLamps() {
  document.querySelectorAll('.lamps__line').forEach((line) => {
    line.style.transform = '';
    line.classList.remove('lamps__line--2');
    const avail = line.parentElement.clientWidth * 0.94; // une colonne d'ampoules de marge
    if (!avail || !line.offsetWidth) return; // vue masquée : mesure refaite à son affichage
    let k = avail / line.offsetWidth; // offsetWidth = largeur hors transform
    if (k < LAMP_MIN_SQUEEZE && line.querySelector('.lamp-br') && line.closest('.slot')) {
      line.classList.add('lamps__line--2');
      k = avail / line.offsetWidth;
    }
    if (k < 1) line.style.transform = `scale(${k}, ${Math.min(1, k / LAMP_MIN_SQUEEZE)})`;
  });
}
window.addEventListener('resize', fitLamps);
document.fonts.ready.then(fitLamps);

function renderBoard(board) {
  const el = document.getElementById('board');
  document.getElementById('boardQuestion').textContent = shownQuestion(board);
  if (!board) {
    el.innerHTML = '';
    return;
  }
  const answers = board.answers;
  el.classList.toggle('single', answers.length <= 4);

  // (Re)construire si le nombre de slots change
  if (el.children.length !== answers.length) {
    el.innerHTML = '';
    answers.forEach((a, i) => {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.innerHTML = `
        <div class="slot__num">${i + 1}</div>
        <div class="slot__answer">
          <span class="slot__text"></span>
          <span class="slot__points"></span>
        </div>`;
      el.appendChild(slot);
    });
  }

  // Ordonner en colonnes (gauche remplie d'abord)
  answers.forEach((a, i) => {
    const slot = el.children[i];
    const wasRevealed = slot.classList.contains('revealed');
    setAnswerText(slot.querySelector('.slot__text'), a.text);
    slot.querySelector('.slot__points').textContent = a.points;
    if (a.revealed && !wasRevealed) {
      slot.classList.add('revealed');
    } else if (!a.revealed) {
      slot.classList.remove('revealed');
    }
  });
}

let finalTargetReached = false;

function renderFinal(fs, s) {
  if (!fs) return;

  // Famille qui joue la finale (gagnante des manches)
  const fam = s.teams[fs.familyIndex];
  document.getElementById('finalFamilyName').textContent = fam ? `FAMILLE ${fam.name}` : '';

  // Noms des finalistes (repli sur « FINALISTE 1/2 »)
  const names = fs.finalistNames || ['', ''];
  const name0 = (names[0] || 'Finaliste 1').toUpperCase();
  const name1 = (names[1] || 'Finaliste 2').toUpperCase();

  // Bandeau du finaliste en jeu
  document.getElementById('finalBanner').textContent = fs.activePlayer === 0 ? name0 : name1;

  // En-têtes de colonnes avec sous-totaux (réponses révélées).
  // Tant que le finaliste 1 est masqué, son sous-total ne doit pas fuiter au public.
  const sub0 = fs.cells.reduce((t, p) => t + (p[0].revealed ? p[0].points : 0), 0);
  const sub1 = fs.cells.reduce((t, p) => t + (p[1].revealed ? p[1].points : 0), 0);
  document.getElementById('fc-head-0').textContent = fs.concealFirst ? name0 : `${name0} — ${sub0}`;
  document.getElementById('fc-head-1').textContent = `${name1} — ${sub1}`;

  const grid = document.getElementById('finalGrid');
  if (grid.children.length !== fs.cells.length) {
    grid.innerHTML = '';
    fs.cells.forEach(() => {
      const row = document.createElement('div');
      row.className = 'final-row';
      row.innerHTML = `
        <div class="fcell" data-col="0"><span class="ftext"></span><span class="fpts"></span></div>
        <div class="fcell" data-col="1"><span class="ftext"></span><span class="fpts"></span></div>`;
      grid.appendChild(row);
    });
  }

  const allRevealed = fs.cells.every((p) => p[0].revealed && p[1].revealed);

  fs.cells.forEach((pair, q) => {
    const row = grid.children[q];
    pair.forEach((cell, col) => {
      const fc = row.children[col];

      // Masquage des réponses du finaliste 1 au public (règle du doublon).
      const masked = fs.concealFirst && col === 0;
      // On n'écrit le contenu réel dans le DOM public QUE s'il n'est pas masqué
      // (évite toute fuite par inspection de la page sur le réseau).
      setAnswerText(fc.querySelector('.ftext'), masked ? '' : cell.answer);
      fc.querySelector('.fpts').textContent = masked ? '' : cell.points;

      fc.classList.toggle('revealed', !!cell.revealed && !masked);
      fc.classList.toggle('masked', masked && !!cell.revealed);

      // Colonne du finaliste inactif en retrait pendant le jeu
      fc.classList.toggle('is-dim', !allRevealed && col !== fs.activePlayer);
    });
  });

  // Barre de progression vers l'objectif. Le total public exclut le finaliste 1
  // tant que ses réponses sont masquées (pas de spoiler avant la révélation finale).
  const publicTotal = (fs.concealFirst ? 0 : sub0) + sub1;
  const pct = Math.min(100, fs.target ? (publicTotal / fs.target) * 100 : 0);
  document.getElementById('fppFill').style.width = pct + '%';
  const reached = publicTotal >= fs.target;
  document.getElementById('fppFill').classList.toggle('done', reached);
  const txt = document.getElementById('fppText');
  if (reached) setEmojiText(txt, '🎉', `OBJECTIF ATTEINT — ${publicTotal} / ${fs.target}`);
  else txt.textContent = `TOTAL ${publicTotal} / ${fs.target}`;
  txt.classList.toggle('done', reached);

  // Applaudissements une seule fois quand l'objectif est franchi (et en vue finale)
  if (reached && !finalTargetReached && s.view === 'final') SoundManager.play('applause');
  finalTargetReached = reached;

  updateFinalTimerBig(fs);
}

function updateFinalTimerBig(fs) {
  const el = document.getElementById('finalTimerBig');
  if (!el) return;
  const t = fs && fs.timer;
  // À l'expiration, le serveur arrête le chrono (running=false, remaining=0) et
  // diffuse le son de fin : le chrono disparaît alors ici.
  if (!t || (!t.running && !t.remaining)) {
    el.style.display = 'none';
    return;
  }
  const rem = t.running ? Math.max(0, Math.round((t.endsAt - Date.now()) / 1000)) : t.remaining;
  el.style.display = '';
  setEmojiText(el, '⏱', String(rem).padStart(2, '0'));
  el.classList.toggle('low', t.running && rem <= 5);
}

// Décompte fluide du chrono (l'autorité reste le serveur via endsAt)
setInterval(() => {
  if (cur && cur.view === 'final' && cur.finalState) updateFinalTimerBig(cur.finalState);
}, 250);

// La parole à l'intervenant : son nom + la question de la manche qui vient d'être jouée.
function renderSpeaker(s) {
  if (s.view !== 'speaker') return;
  const sp = s.speaker || {};
  setText3d(document.getElementById('speakerName'), sp.name || '');
  document.getElementById('speakerRole').textContent = sp.role || '';
  const q = s.board && s.board.question;
  document.getElementById('speakerTopic').hidden = !q;
  document.getElementById('speakerTopicLabel').textContent = `MANCHE ${s.currentRoundIndex + 1}`;
  document.getElementById('speakerQuestion').textContent = q ? `« ${q} »` : '';
}

function renderWinner(s) {
  if (s.view !== 'winner') return;
  const t = s.teams[s.winnerTeam];
  setText3d(document.getElementById('winnerName'), t ? t.name : '—');
  document.getElementById('winnerScore').textContent = t ? `${t.score} points` : '';
  if (!prev || prev.view !== 'winner') {
    SoundManager.play('win');
    confetti();
  }
}

function renderJoinQR(s) {
  const ov = document.getElementById('joinQr');
  if (!ov) return;
  ov.classList.toggle('show', !!s.showJoinQR);
  // Adresse à ouvrir sur les téléphones (helper partagé : public/js/net-util.js).
  const base = buzzerBase(s);
  const url = document.getElementById('joinQrUrl');
  if (url) url.textContent = `${base}/buzzer`;
  // Rafraîchit l'image du QR seulement quand l'adresse change.
  const img = document.querySelector('.join-qr__img');
  if (img && img.dataset.base !== base) {
    img.dataset.base = base;
    img.src = '/qr/buzzer?url=' + encodeURIComponent(base);
  }
}

// L'annonce « X a la main ! » est éphémère : elle disparaît au bout de
// BUZZ_SHOW_MS, ou dès que la régie révèle une réponse / marque une faute.
// (Le serveur garde le gagnant du buzz : la régie continue de voir qui a la main.)
const BUZZ_SHOW_MS = 4000;
let buzzDismissed = false;
let buzzTimer = null;

function boardProgress(b) {
  if (!b) return 0;
  return b.answers.filter((a) => a.revealed).length + b.strikes;
}

function renderBuzzer(s) {
  const bz = s.buzzer || { armed: false, winner: null };
  const ov = document.getElementById('buzzOverlay');
  if (!ov) return;
  const hasWinner = bz.winner !== null && bz.winner !== undefined;
  const prevWinner = prev && prev.buzzer ? prev.buzzer.winner : null;
  if (hasWinner && (prevWinner === null || prevWinner === undefined)) {
    // Nouveau buzz : on affiche l'annonce puis on la retire après le délai.
    buzzDismissed = false;
    clearTimeout(buzzTimer);
    buzzTimer = setTimeout(() => {
      buzzDismissed = true;
      if (cur) renderBuzzer(cur);
    }, BUZZ_SHOW_MS);
  } else if (hasWinner && prev && boardProgress(s.board) > boardProgress(prev.board)) {
    // Première réponse révélée (ou faute) : le jeu reprend, on retire l'annonce.
    buzzDismissed = true;
  }
  if (!hasWinner) clearTimeout(buzzTimer);
  const wasWinner = ov.classList.contains('winner');
  const showWinner = hasWinner && !buzzDismissed;
  const showArmed = !showWinner && !!bz.armed;
  // Pendant « À vos buzzers », la question est affichée nette dans l'overlay :
  // on masque celle de la vue (sinon elle apparaîtrait floutée derrière le voile).
  stage.classList.toggle('bz-armed', showArmed);
  // On ne reconstruit le contenu que s'il change (sinon les animations repartent
  // à chaque mise à jour d'état).
  let key = '';
  if (showWinner) {
    const t = s.teams[bz.winner];
    key = 'W|' + (t ? t.name : '');
    ov.className = 'buzz-overlay show winner';
    if (ov.dataset.key !== key) {
      ov.innerHTML =
        `<div class="bz-card"><div class="bz-icon">✋</div>` +
        `<div class="bz-team gold-text"></div>` +
        `<div class="bz-sub">a la main !</div></div>`;
      setText3d(ov.querySelector('.bz-team'), t ? t.name : '');
    }
  } else if (showArmed) {
    key = 'A';
    ov.className = 'buzz-overlay show armed';
    if (ov.dataset.key !== key) {
      ov.innerHTML =
        `<div class="bz-armed"><div class="bz-ribbon"><span class="emo">🔔</span> À VOS BUZZERS…</div>` +
        `<p class="question-text bz-question"></p></div>`;
    }
    // La question arrive sous le bandeau quand l'animateur l'a lue (sans
    // reconstruire le bandeau, pour ne pas relancer son animation).
    const qEl = ov.querySelector('.bz-question');
    const q = shownQuestion(s.board);
    if (qEl.textContent !== q) {
      qEl.textContent = q;
      qEl.classList.remove('bz-question--in');
      if (q) {
        void qEl.offsetWidth;
        qEl.classList.add('bz-question--in');
      }
    }
  } else {
    ov.className = 'buzz-overlay';
    ov.innerHTML = '';
  }
  ov.dataset.key = key;
  // L'annonce du buzz vient de disparaître : la question glisse du centre de
  // l'écran jusqu'à sa place au-dessus du plateau.
  if (wasWinner && !showWinner && !showArmed) flyQuestion();
}

const FLY_MS = 900;
function flyQuestion() {
  const target = document.getElementById('boardQuestion');
  const source = document.getElementById('qText');
  if (!cur || cur.view !== 'board' || !target || !target.textContent) return;
  const end = target.getBoundingClientRect();
  if (!end.width) return;
  const srcStyle = getComputedStyle(source);
  const endStyle = getComputedStyle(target);

  // Départ : même rendu que la question pendant « À vos buzzers » (grande, centrée).
  const fly = document.createElement('p');
  fly.className = 'q-fly';
  fly.textContent = target.textContent;
  const startW = window.innerWidth * 0.9;
  Object.assign(fly.style, {
    left: (window.innerWidth - startW) / 2 + 'px',
    width: startW + 'px',
    fontSize: srcStyle.fontSize,
    lineHeight: srcStyle.lineHeight,
    color: srcStyle.color,
    textShadow: srcStyle.textShadow,
  });
  document.body.appendChild(fly);
  fly.style.top = (window.innerHeight - fly.offsetHeight) / 2 + 'px';
  target.style.visibility = 'hidden';

  // Arrivée : position, taille et couleur exactes de la question du plateau.
  void fly.offsetWidth;
  fly.classList.add('moving');
  Object.assign(fly.style, {
    left: end.left + 'px',
    top: end.top + 'px',
    width: end.width + 'px',
    fontSize: endStyle.fontSize,
    lineHeight: endStyle.lineHeight,
    color: endStyle.color,
    textShadow: endStyle.textShadow,
  });
  setTimeout(() => {
    target.style.visibility = '';
    fly.remove();
  }, FLY_MS + 50);
}

function confetti() {
  const retro = isRetro();
  // Rétro : couleurs « flashy » et formes géométriques façon années 90.
  const colors = retro
    ? ['#ffd400', '#ff2bd6', '#00e5ff', '#7cff3a', '#ffffff', '#ff3b3b']
    : ['#ffe169', '#f5c518', '#ffffff', '#ff3b3b', '#38d66b'];
  const shapes = ['', 'confetti--tri', 'confetti--dot', 'confetti--zig'];
  for (let i = 0; i < 120; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    if (retro && shapes[i % shapes.length]) c.classList.add(shapes[i % shapes.length]);
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = 2 + Math.random() * 2 + 's';
    c.style.animationDelay = Math.random() * 0.6 + 's';
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 4500);
  }
}
