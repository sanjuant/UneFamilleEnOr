/* ------------------------------------------------------------------ *
 *  Page Animateur — vue compagnon (smartphone / tablette).
 *  Voir la question, lancer une manche, révéler les réponses
 *  (ou les garder masquées pour ne pas se spoiler).
 * ------------------------------------------------------------------ */

let ws;
let state = null;
let authed = false;
let ctrlCode = localStorage.getItem('ctrlCode') || '';
let roundsSig = '';
let hideAnswers = localStorage.getItem('animHideAnswers') === '1';

const $ = (id) => document.getElementById(id);
const connDot = $('conn');

function connect() {
  ws = new WebSocket(`ws://${location.host}/?code=${encodeURIComponent(ctrlCode)}`);
  ws.onopen = () => connDot.classList.add('ok');
  ws.onclose = () => {
    connDot.classList.remove('ok');
    authed = false;
    setTimeout(connect, 1000);
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'auth') {
      handleAuth(msg.ok, msg.locked);
    } else if (msg.type === 'state') {
      state = msg.state;
      render();
    }
  };
}
connect();

function cmd(action, payload = {}) {
  if (!authed) return;
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'command', action, payload }));
}
// Déclenche un son sur l'écran de jeu (cette page ne joue rien localement).
function sound(name) {
  if (!authed) return;
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'sound', name }));
}

// ---- Portail de code d'accès ----
let manualAttempt = false;
function showAuthErr(text) {
  const err = $('authErr');
  if (err) {
    err.textContent = text;
    err.hidden = !text;
  }
}
function handleAuth(ok, locked) {
  authed = ok;
  const gate = $('authGate');
  if (gate) gate.hidden = ok;
  if (!ok) {
    if (locked) showAuthErr('Trop de tentatives. Réessayez dans une minute.');
    else if (manualAttempt) showAuthErr('Code incorrect.');
    else if (ctrlCode) showAuthErr('Le code a peut-être changé (serveur redémarré). Entrez le nouveau code affiché dans le terminal.');
    else showAuthErr('');
    const inp = $('authInput');
    if (inp) inp.focus();
  } else {
    showAuthErr('');
  }
  manualAttempt = false;
}
function submitCode() {
  const v = ($('authInput').value || '').trim();
  if (!v) {
    showAuthErr('Entrez le code.');
    $('authInput').focus();
    return;
  }
  ctrlCode = v;
  localStorage.setItem('ctrlCode', ctrlCode);
  manualAttempt = true;
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'auth', code: ctrlCode }));
  else connect();
}
$('authSubmit').addEventListener('click', submitCode);
$('authInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitCode();
});
$('authInput').focus();

// ---- Anti-spoiler ----
$('spoilerBtn').addEventListener('click', () => {
  hideAnswers = !hideAnswers;
  localStorage.setItem('animHideAnswers', hideAnswers ? '1' : '0');
  render();
});

// ---- Outils plateau ----
$('strikeBtn').addEventListener('click', () => {
  cmd('addStrike');
  if (state && state.board && state.board.strikes < 3) sound('wrong');
});
$('strikeClearBtn').addEventListener('click', () => cmd('clearStrikes'));
$('revealAllBtn').addEventListener('click', () => {
  cmd('revealAll');
  sound('reveal');
});
$('awardA').addEventListener('click', () => {
  cmd('awardPot', { index: 0 });
  sound('applause');
});
$('awardB').addEventListener('click', () => {
  cmd('awardPot', { index: 1 });
  sound('applause');
});
$('launchNextBtn').addEventListener('click', launchNext);

// ---- Manche finale : lancement + pilotage ----
$('launchFinalBtn').addEventListener('click', () => {
  if (state && state.view === 'final' && !confirm('Redémarrer la manche finale ?\nLes réponses saisies seront effacées.')) return;
  cmd('startFinal');
});
$('afP0').addEventListener('click', () => cmd('setFinalPlayer', { player: 0 }));
$('afP1').addEventListener('click', () => cmd('setFinalPlayer', { player: 1 }));
$('afTimerStart').addEventListener('click', () => cmd('startFinalTimer', {}));
$('afTimerPause').addEventListener('click', () => cmd('pauseFinalTimer'));
$('afTimerReset').addEventListener('click', () => cmd('resetFinalTimer'));
$('afReveal').addEventListener('click', () => {
  cmd('revealFinalAll');
  sound('reveal');
});

function allRoundsPlayed() {
  const played = state.playedRounds || [];
  return state.rounds.length > 0 && state.rounds.every((_, i) => played.includes(i));
}
function nextRoundIndex() {
  const played = state.playedRounds || [];
  let n = state.rounds.findIndex((_, i) => !played.includes(i) && i > state.currentRoundIndex);
  if (n === -1) n = state.rounds.findIndex((_, i) => !played.includes(i));
  return n;
}
function launchRound(i) {
  cmd('launchRound', { index: i });
  sound('reveal');
}
// Tap sur une manche : confirme si on relance la manche en cours ou une manche déjà jouée
// (évite d'écraser la progression par un appui accidentel sur l'écran tactile).
function launchRoundTap(i) {
  const played = (state.playedRounds || []).includes(i);
  const current = i === state.currentRoundIndex && state.board;
  if ((played || current) && !confirm('Relancer cette manche ? La progression en cours sera réinitialisée.')) return;
  launchRound(i);
}
function launchNext() {
  const n = nextRoundIndex();
  if (n !== -1) launchRound(n);
}

// ------------------------------------------------------------------ //
//  Rendu
// ------------------------------------------------------------------ //
const VIEW_LABELS = { logo: 'Logo', question: 'Question', board: 'Plateau', final: 'Manche finale', winner: 'Gagnant' };

function render() {
  if (!state) return;

  $('spoilerBtn').textContent = hideAnswers ? '🙈 Réponses masquées' : '👁 Réponses visibles';
  $('spoilerBtn').classList.toggle('on', hideAnswers);
  // Pertinent seulement quand des réponses sont à l'écran (plateau ou finale).
  const hasAnswers = (state.board && state.view !== 'final') || (state.view === 'final' && state.finalState);
  $('spoilerBtn').hidden = !hasAnswers;

  // Scores
  $('animScores').innerHTML = state.teams
    .map((t) => `<span class="sc"><b>${escapeHtml(t.name)}</b> ${t.score}</span>`)
    .join('');

  // Phase
  let phase = VIEW_LABELS[state.view] || state.view;
  if (state.board) phase += ` · Manche ${state.currentRoundIndex + 1}`;
  $('animPhase').textContent = phase;

  // Bouton « Manche finale » : visible dès qu'une finale est définie.
  const lf = $('launchFinalBtn');
  if (lf) {
    lf.hidden = !state.final;
    lf.classList.toggle('active', state.view === 'final');
  }

  renderBoard();
  renderFinal();
  renderRounds();
}

function renderBoard() {
  const board = state.board;
  $('boardPanel').hidden = !board || state.view === 'final';
  if (!board || state.view === 'final') return;

  $('boardTag').textContent = `Manche ${state.currentRoundIndex + 1} (×${board.multiplier})`;
  $('boardQuestion').textContent = board.question;
  $('strikeNum').textContent = `${board.strikes}/3`;
  $('potVal').textContent = board.pot * board.multiplier;

  // Boutons cagnotte = noms d'équipes, surbrillance de l'équipe active
  const act = board.activeTeamIndex;
  [0, 1].forEach((i) => {
    const b = $(i === 0 ? 'awardA' : 'awardB');
    b.textContent = state.teams[i] ? state.teams[i].name : `Équipe ${i + 1}`;
    b.classList.toggle('active', act === i);
  });

  const list = $('ansList');
  list.innerHTML = board.answers
    .map((a, i) => {
      const masked = !a.revealed && hideAnswers;
      const text = a.revealed || !hideAnswers ? escapeHtml(a.text) : '• • •';
      const pts = a.revealed || !hideAnswers ? a.points : '•';
      return `
      <button class="ans ${a.revealed ? 'revealed' : ''} ${masked ? 'masked' : ''}" data-i="${i}">
        <span class="ans-rank">${i + 1}</span>
        <span class="ans-text">${text}</span>
        <span class="ans-pts">${pts}</span>
        <span class="ans-act">${a.revealed ? '✓' : '👁'}</span>
      </button>`;
    })
    .join('');
  list.querySelectorAll('.ans').forEach((b) => {
    const i = Number(b.dataset.i);
    b.addEventListener('click', () => {
      const revealed = state.board.answers[i].revealed;
      if (revealed) {
        cmd('hideAnswer', { index: i });
      } else {
        cmd('revealAnswer', { index: i });
        sound('reveal');
      }
    });
  });
}

const normFinal = (s) =>
  (s || '').toString().trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function renderFinal() {
  const fs = state.finalState;
  const show = state.view === 'final' && fs;
  $('finalPanel').hidden = !show;
  if (!show) {
    updateAnimTimer();
    return;
  }
  const names = fs.finalistNames || ['', ''];
  const n0 = names[0] || 'Finaliste 1';
  const n1 = names[1] || 'Finaliste 2';
  const who = fs.activePlayer === 0 ? n0 : n1;
  const reached = fs.total >= fs.target;

  // Par question : la réponse SAISIE de chaque finaliste. Le finaliste 1 reste
  // visible pour que l'animateur repère les doublons du finaliste 2.
  const rows = (fs.questions || [])
    .map((q, i) => {
      const pair = fs.cells[i] || [];
      const c0 = pair[0] || { answer: '', points: 0 };
      const c1 = pair[1] || { answer: '', points: 0 };
      const dn0 = normFinal(c0.answer);
      const dn1 = normFinal(c1.answer);
      const dup = !!dn0 && !!dn1 && dn0 === dn1; // doublon réel : les deux non vides et identiques
      const hint = hideAnswers
        ? ''
        : (q.answers || []).map((a) => `${escapeHtml(a.text)} (${a.points})`).join(' · ');
      const cell = (c, name, active) => `
        <div class="fcellr ${active ? 'active' : ''} ${dup && c === c1 ? 'dup' : ''}">
          <span class="fcellr-tag">${escapeHtml(name)}</span>
          <span class="fcellr-ans">${c.answer ? escapeHtml(c.answer) : '—'}${dup && c === c1 ? ' ⚠' : ''}</span>
          <span class="fcellr-pts">${c.points || ''}</span>
        </div>`;
      return `
      <div class="fq-read">
        <div class="fq-read__q">Q${i + 1}. ${escapeHtml(q.question)}</div>
        ${hint ? `<div class="fq-hint">💡 ${hint}</div>` : ''}
        <div class="fcell-row">
          ${cell(c0, n0, fs.activePlayer === 0)}
          ${cell(c1, n1, fs.activePlayer === 1)}
        </div>
      </div>`;
    })
    .join('');

  $('finalRead').innerHTML = `
    <div class="fr-row"><span>Au tour de</span><b>${escapeHtml(who)}</b></div>
    <div class="fr-row"><span>Total</span><b class="${reached ? 'ok' : ''}">${fs.total} / ${fs.target}</b></div>
    <p class="fr-note">Réponses saisies des finalistes. ⚠ = doublon (identique au finaliste 1).</p>
    ${rows}`;

  // Contrôles : finaliste actif + libellé du chrono
  $('afP0').classList.toggle('active', fs.activePlayer === 0);
  $('afP1').classList.toggle('active', fs.activePlayer === 1);
  const t = fs.timer;
  const paused = t && !t.running && t.remaining > 0 && t.player === fs.activePlayer;
  $('afTimerStart').textContent = paused ? '▶ Reprendre' : '▶ Chrono';

  updateAnimTimer();
}

// Chrono de la finale : décompte fluide, disparaît quand le serveur l'arrête (fin du temps).
function updateAnimTimer() {
  const el = $('animFinalTimer');
  if (!el) return;
  const fs = state && state.finalState;
  const t = fs && fs.timer;
  if (!t || !state || state.view !== 'final' || (!t.running && !t.remaining)) {
    el.style.display = 'none';
    return;
  }
  const rem = t.running ? Math.max(0, Math.round((t.endsAt - Date.now()) / 1000)) : t.remaining;
  el.style.display = '';
  el.textContent = `⏱ ${String(rem).padStart(2, '0')}`;
  el.classList.toggle('low', t.running && rem <= 5);
}
setInterval(() => {
  if (state) updateAnimTimer();
}, 250);

function renderRounds() {
  const wrap = $('roundsList');
  const sig = state.rounds.map((r) => `${r.multiplier}:${r.question}`).join('|');
  if (sig !== roundsSig) {
    roundsSig = sig;
    if (!state.rounds.length) {
      wrap.innerHTML = '<p class="muted">Aucune manche chargée.</p>';
    } else {
      wrap.innerHTML = state.rounds
        .map(
          (r, i) => `
        <button class="round" data-i="${i}">
          <div class="round-head"><span class="round-num">Manche ${i + 1}</span><span class="round-mult">×${r.multiplier || 1}</span></div>
          <div class="round-q">${escapeHtml(r.question || '')}</div>
        </button>`
        )
        .join('');
      wrap.querySelectorAll('.round').forEach((b) =>
        b.addEventListener('click', () => launchRoundTap(Number(b.dataset.i)))
      );
    }
  }
  const played = state.playedRounds || [];
  const next = nextRoundIndex();
  wrap.querySelectorAll('.round').forEach((b) => {
    const i = Number(b.dataset.i);
    b.classList.toggle('active', i === state.currentRoundIndex);
    b.classList.toggle('played', played.includes(i));
    b.classList.toggle('next', i === next);
  });

  const btn = $('launchNextBtn');
  const done = allRoundsPlayed();
  btn.disabled = !state.rounds.length || done;
  btn.textContent = done ? '✓ Toutes jouées' : '▶ Prochaine manche';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
