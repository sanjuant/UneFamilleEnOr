/* ------------------------------------------------------------------ *
 *  Page Animateur — vue compagnon (smartphone / tablette).
 *  Voir la question, lancer une manche, révéler les réponses
 *  (ou les garder masquées pour ne pas se spoiler).
 * ------------------------------------------------------------------ */

let ws;
let state = null;
let roundsSig = '';
let hideAnswers = localStorage.getItem('animHideAnswers') === '1';

const $ = (id) => document.getElementById(id);
const connDot = $('conn');

function connect() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.onopen = () => connDot.classList.add('ok');
  ws.onclose = () => {
    connDot.classList.remove('ok');
    setTimeout(connect, 1000);
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'state') {
      state = msg.state;
      render();
    }
  };
}
connect();

function cmd(action, payload = {}) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'command', action, payload }));
}
// Déclenche un son sur l'écran de jeu (cette page ne joue rien localement).
function sound(name) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'sound', name }));
}

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

function renderFinal() {
  const fs = state.finalState;
  const show = state.view === 'final' && fs;
  $('finalPanel').hidden = !show;
  if (!show) return;
  const names = fs.finalistNames || ['', ''];
  const who = fs.activePlayer === 0 ? names[0] || 'Finaliste 1' : names[1] || 'Finaliste 2';
  const reached = fs.total >= fs.target;

  // Questions de la finale + réponses attendues (masquées en mode anti-spoiler).
  const questions = (fs.questions || [])
    .map((q, i) => {
      const ans = (q.answers || [])
        .map((a) => `<li>${hideAnswers ? '• • •' : escapeHtml(a.text)} <b>${hideAnswers ? '•' : a.points}</b></li>`)
        .join('');
      return `
      <div class="fq-read">
        <div class="fq-read__q">Q${i + 1}. ${escapeHtml(q.question)}</div>
        <ul class="fq-read__a">${ans}</ul>
      </div>`;
    })
    .join('');

  $('finalRead').innerHTML = `
    <div class="fr-row"><span>Au tour de</span><b>${escapeHtml(who)}</b></div>
    <div class="fr-row"><span>Total</span><b class="${reached ? 'ok' : ''}">${fs.total} / ${fs.target}</b></div>
    <p class="fr-note">La manche finale se pilote depuis la régie — vue d'aide ci-dessous.</p>
    ${questions}`;
}

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
