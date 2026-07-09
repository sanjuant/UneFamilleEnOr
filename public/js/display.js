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
socket.on('sound', ({ name, stop }) => {
  if (stop) SoundManager.stop(name);
  else SoundManager.play(name, name === 'final' ? { loop: true } : {});
});

// ---- Jingle vidéo (plein écran, piloté par la régie) ----
let videoWasMuted = false;
function playVideo(src) {
  const ov = document.getElementById('videoOverlay');
  const v = document.getElementById('jingleVideo');
  if (!ov || !v) return;
  // Coupe les autres sons pendant le jingle (évite la superposition avec la musique).
  // On ne mémorise l'état de mute qu'à la 1re entrée : une rediffusion / un enchaînement
  // de jingles ne doit pas écraser l'état sauvegardé (sinon le son resterait coupé).
  if (!ov.classList.contains('show')) videoWasMuted = SoundManager.isMuted();
  SoundManager.setMuted(true);
  v.src = src;
  ov.classList.add('show');
  // Si l'autoplay est refusé (public n'a pas encore activé le son), on ne reste pas
  // bloqué sur un écran noir : on referme l'overlay et on restaure le son.
  v.play().catch(() => hideVideo());
}
function hideVideo() {
  const ov = document.getElementById('videoOverlay');
  const v = document.getElementById('jingleVideo');
  if (!ov || !v) return;
  ov.classList.remove('show');
  v.pause();
  v.removeAttribute('src');
  v.load();
  SoundManager.setMuted(videoWasMuted);
}
socket.on('video', (msg) => {
  if (!msg) return;
  if (msg.stop) hideVideo();
  else if (msg.src) playVideo(msg.src);
});
document.getElementById('jingleVideo').addEventListener('ended', hideVideo);

// ---- Activation du son + plein écran ----
const gate = document.getElementById('soundGate');
document.getElementById('soundGateBtn').addEventListener('click', () => {
  SoundManager.unlock();
  gate.classList.add('hidden');
  if (document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
});

// ---- Rendu ----
function render(s) {
  cur = s;
  // Thème choisi en régie (sombre / clair / rétro) appliqué à l'écran de jeu.
  document.documentElement.setAttribute('data-theme', s.theme || 'dark');
  stage.dataset.view = s.view;

  // Titre / logo
  document.getElementById('logoTitle').textContent = s.title;

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
  renderWinner(s);
  renderBuzzer(s);
  renderJoinQR(s);

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
}

function renderQuestion(s) {
  const round = s.rounds[s.currentRoundIndex];
  const badge = document.getElementById('qRoundBadge');
  const mult = round?.multiplier > 1 ? ` ×${round.multiplier}` : '';
  badge.textContent = `MANCHE ${s.currentRoundIndex + 1}${mult}`;
  document.getElementById('qText').textContent = s.board ? s.board.question : '';
}

// Texte d'une réponse. En thème rétro : chaque lettre dans sa propre case
// (effet « split-flap » / panneaux qui tournent). Sinon : texte simple.
// On ne reconstruit le DOM que si le contenu (ou le thème) change, pour ne pas
// relancer l'animation à chaque rafraîchissement.
function setAnswerText(el, text) {
  if (!el) return;
  const retro = !!(cur && cur.theme === 'retro');
  const key = (retro ? 'R|' : 'P|') + text;
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  if (!retro) {
    el.classList.remove('flaps');
    el.textContent = text;
    return;
  }
  el.classList.add('flaps');
  el.textContent = '';
  const chars = [...String(text)];
  el.style.setProperty('--n', chars.length || 1); // sert à dimensionner les cases pour tenir sur 1 ligne
  chars.forEach((ch, i) => {
    const s = document.createElement('span');
    s.className = ch === ' ' ? 'flap flap--space' : 'flap';
    s.style.setProperty('--i', i);
    s.textContent = ch === ' ' ? ' ' : ch;
    el.appendChild(s);
  });
}

function renderBoard(board) {
  const el = document.getElementById('board');
  document.getElementById('boardQuestion').textContent = board ? board.question : '';
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
  txt.textContent = reached
    ? `🎉 OBJECTIF ATTEINT — ${publicTotal} / ${fs.target}`
    : `TOTAL ${publicTotal} / ${fs.target}`;
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
  el.textContent = `⏱ ${String(rem).padStart(2, '0')}`;
  el.classList.toggle('low', t.running && rem <= 5);
}

// Décompte fluide du chrono (l'autorité reste le serveur via endsAt)
setInterval(() => {
  if (cur && cur.view === 'final' && cur.finalState) updateFinalTimerBig(cur.finalState);
}, 250);

function renderWinner(s) {
  if (s.view !== 'winner') return;
  const t = s.teams[s.winnerTeam];
  document.getElementById('winnerName').textContent = t ? t.name : '—';
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

function renderBuzzer(s) {
  const bz = s.buzzer || { armed: false, winner: null };
  const ov = document.getElementById('buzzOverlay');
  if (!ov) return;
  if (bz.winner !== null && bz.winner !== undefined) {
    const t = s.teams[bz.winner];
    ov.className = 'buzz-overlay show winner';
    ov.innerHTML =
      `<div class="bz-card"><div class="bz-icon">✋</div>` +
      `<div class="bz-team gold-text">${t ? t.name : ''}</div>` +
      `<div class="bz-sub">a la main !</div></div>`;
  } else if (bz.armed) {
    ov.className = 'buzz-overlay show armed';
    ov.innerHTML = `<div class="bz-ribbon">🔔 À VOS BUZZERS…</div>`;
  } else {
    ov.className = 'buzz-overlay';
    ov.innerHTML = '';
  }
}

function confetti() {
  const colors = ['#ffe169', '#f5c518', '#ffffff', '#ff3b3b', '#38d66b'];
  for (let i = 0; i < 120; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = 2 + Math.random() * 2 + 's';
    c.style.animationDelay = Math.random() * 0.6 + 's';
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 4500);
  }
}
