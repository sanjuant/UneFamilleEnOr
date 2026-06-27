/**
 * Une Famille en Or — serveur de jeu.
 *
 * - Sert l'écran de jeu (/) et la régie (/regie).
 * - Détient l'état du jeu (source de vérité) et le diffuse en temps réel
 *   à tous les écrans connectés via WebSocket.
 * - La régie envoie des commandes ; le serveur applique et rediffuse l'état.
 */

const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use('/sounds', express.static(path.join(__dirname, 'sounds')));

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'display.html')));
app.get('/regie', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'regie.html')));
app.get('/regles', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'regles.html')));
app.get('/buzzer', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'buzzer.html')));

// ---------------------------------------------------------------------------
// État du jeu
// ---------------------------------------------------------------------------

function freshState() {
  return {
    title: 'UNE FAMILLE EN OR',
    loaded: false,
    teams: [
      { name: 'ÉQUIPE 1', score: 0 },
      { name: 'ÉQUIPE 2', score: 0 },
    ],
    rounds: [],          // manches normales chargées depuis le JSON
    final: null,         // définition de la manche finale (depuis le JSON)
    currentRoundIndex: -1,
    view: 'logo',        // logo | question | board | final | winner
    board: null,         // plateau de la manche en cours
    finalState: null,    // état vivant de la manche finale
    winnerTeam: null,    // index de l'équipe gagnante (vue winner)
    // Buzzers du face-à-face : armé ? qui a la main ? combien de buzzers connectés par équipe ?
    buzzer: { armed: false, winner: null, connected: [0, 0] },
  };
}

let state = freshState();

/** Recalcule la cagnotte (somme des réponses révélées) avant diffusion. */
function recomputePot() {
  if (state.board) {
    state.board.pot = state.board.answers
      .filter((a) => a.revealed)
      .reduce((sum, a) => sum + (a.points || 0), 0);
  }
  if (state.finalState) {
    state.finalState.total = state.finalState.cells
      .flat()
      .filter((c) => c.revealed)
      .reduce((sum, c) => sum + (Number(c.points) || 0), 0);
  }
}

/** Compte les buzzers connectés par équipe (mis à jour avant chaque diffusion). */
function recomputeBuzzerConnected() {
  const counts = [0, 0];
  wss.clients.forEach((c) => {
    if (c._buzzerTeam === 0 || c._buzzerTeam === 1) counts[c._buzzerTeam]++;
  });
  state.buzzer.connected = counts;
}

function buildBoard(roundIndex) {
  const round = state.rounds[roundIndex];
  if (!round) return null;
  return {
    multiplier: round.multiplier || 1,
    question: round.question || '',
    answers: (round.answers || []).map((a) => ({
      text: a.text,
      points: a.points || 0,
      revealed: false,
    })),
    pot: 0,
    strikes: 0,
    activeTeamIndex: null,
  };
}

function buildFinalState() {
  const f = state.final;
  if (!f) return null;
  const questions = f.questions || [];
  return {
    target: f.target || 200,   // objectif standard de la finale (200 pts)
    timers: f.timers || [20, 25], // temps imparti : finaliste 1 / finaliste 2
    questions: questions.map((q) => ({
      question: q.question || '',
      answers: q.answers || [], // réponses attendues (aide animateur)
    })),
    // 2 colonnes (finaliste 1 / finaliste 2) × N questions.
    cells: questions.map(() => [
      { answer: '', points: 0, revealed: false },
      { answer: '', points: 0, revealed: false },
    ]),
    finalistNames: ['', ''], // noms personnalisés des 2 finalistes (optionnels)
    total: 0,
    activePlayer: 0,      // finaliste en jeu : 0 = finaliste 1, 1 = finaliste 2
    concealFirst: false,  // masquer au public les réponses du finaliste 1
    // Famille qui joue la finale = celle qui a gagné les manches (meilleur score).
    familyIndex: state.teams[1].score > state.teams[0].score ? 1 : 0,
    timer: { running: false, endsAt: 0, remaining: 0, player: 0 },
  };
}


// ---------------------------------------------------------------------------
// Application des commandes de la régie
// ---------------------------------------------------------------------------

const handlers = {
  // ---- Chargement / configuration ----
  load(p) {
    const data = p.data || {};
    state = freshState();
    state.title = (data.title || 'UNE FAMILLE EN OR').toString();
    if (Array.isArray(data.teams) && data.teams.length >= 2) {
      state.teams = data.teams.slice(0, 2).map((t) => ({
        name: (typeof t === 'string' ? t : t.name || 'ÉQUIPE').toString().toUpperCase(),
        score: 0,
      }));
    }
    state.rounds = Array.isArray(data.rounds) ? data.rounds : [];
    state.final = data.final || null;
    state.loaded = state.rounds.length > 0 || !!state.final;
    state.view = 'logo';
  },

  reset() {
    const rounds = state.rounds;
    const final = state.final;
    const title = state.title;
    const teams = state.teams.map((t) => ({ name: t.name, score: 0 }));
    state = freshState();
    state.rounds = rounds;
    state.final = final;
    state.title = title;
    state.teams = teams;
    state.loaded = rounds.length > 0 || !!final;
  },

  setTeamName(p) {
    if (state.teams[p.index]) state.teams[p.index].name = (p.name || '').toString().toUpperCase();
  },

  setScore(p) {
    if (state.teams[p.index]) state.teams[p.index].score = Math.max(0, Number(p.score) || 0);
  },

  addScore(p) {
    if (state.teams[p.index]) {
      state.teams[p.index].score = Math.max(0, state.teams[p.index].score + (Number(p.delta) || 0));
    }
  },

  // ---- Navigation des vues ----
  setView(p) {
    state.view = p.view;
  },

  selectRound(p) {
    const i = Number(p.index);
    if (i >= 0 && i < state.rounds.length) {
      state.currentRoundIndex = i;
      state.board = buildBoard(i);
      state.view = 'question';
    }
  },

  // ---- Plateau (manche) ----
  revealAnswer(p) {
    if (state.board && state.board.answers[p.index]) {
      state.board.answers[p.index].revealed = true;
      state.view = 'board';
    }
  },

  hideAnswer(p) {
    if (state.board && state.board.answers[p.index]) {
      state.board.answers[p.index].revealed = false;
    }
  },

  revealAll() {
    if (state.board) state.board.answers.forEach((a) => (a.revealed = true));
  },

  setStrikes(p) {
    if (state.board) state.board.strikes = Math.max(0, Math.min(3, Number(p.strikes) || 0));
  },

  addStrike() {
    if (state.board) state.board.strikes = Math.min(3, state.board.strikes + 1);
  },

  clearStrikes() {
    if (state.board) state.board.strikes = 0;
  },

  setActiveTeam(p) {
    if (state.board) state.board.activeTeamIndex = p.index === null ? null : Number(p.index);
  },

  awardPot(p) {
    if (!state.board) return;
    recomputePot();
    const team = state.teams[p.index];
    if (team) team.score += state.board.pot * state.board.multiplier;
  },

  // ---- Manche finale ----
  startFinal() {
    state.finalState = buildFinalState();
    state.view = 'final';
  },

  setFinalCell(p) {
    const fs = state.finalState;
    if (!fs) return;
    const cell = fs.cells?.[p.q]?.[p.col];
    if (cell) {
      if (p.answer !== undefined) cell.answer = (p.answer || '').toString();
      if (p.points !== undefined) cell.points = Math.max(0, Number(p.points) || 0);
    }
  },

  // Famille qui joue la finale (celle qui a gagné les manches).
  setFinalFamily(p) {
    if (state.finalState) state.finalState.familyIndex = Number(p.index) ? 1 : 0;
  },

  // Nom personnalisé d'un finaliste (affiché à la place de « Finaliste 1/2 »).
  setFinalistName(p) {
    const fs = state.finalState;
    if (fs && (p.index === 0 || p.index === 1)) {
      fs.finalistNames[p.index] = (p.name || '').toString();
    }
  },

  revealFinalCell(p) {
    const fs = state.finalState;
    if (!fs) return;
    const cell = fs.cells?.[p.q]?.[p.col];
    if (cell) cell.revealed = !!p.revealed;
  },

  // Choix du finaliste en jeu (0 ou 1). En passant au finaliste 2, on masque
  // automatiquement les réponses du finaliste 1 au public.
  setFinalPlayer(p) {
    const fs = state.finalState;
    if (!fs) return;
    fs.activePlayer = Number(p.player) ? 1 : 0;
    // Le masquage du finaliste 1 suit le finaliste en jeu (effet visible et bidirectionnel) :
    // masqué pendant le tour du finaliste 2, affiché quand on revient au finaliste 1.
    fs.concealFirst = fs.activePlayer === 1;
  },

  // Révélation finale : on dévoile toutes les cellules et on lève le masquage.
  revealFinalAll() {
    const fs = state.finalState;
    if (!fs) return;
    fs.cells.forEach((pair) => pair.forEach((c) => (c.revealed = true)));
    fs.concealFirst = false;
  },

  // Minuteur de la finale (piloté par endsAt côté serveur).
  startFinalTimer(p) {
    const fs = state.finalState;
    if (!fs) return;
    const seconds = Number(p.seconds) || fs.timers[fs.activePlayer] || 20;
    fs.timer = {
      running: true,
      endsAt: Date.now() + seconds * 1000,
      remaining: seconds,
      player: fs.activePlayer,
    };
  },

  pauseFinalTimer() {
    const fs = state.finalState;
    if (!fs || !fs.timer.running) return;
    fs.timer.remaining = Math.max(0, Math.round((fs.timer.endsAt - Date.now()) / 1000));
    fs.timer.running = false;
  },

  resetFinalTimer() {
    const fs = state.finalState;
    if (!fs) return;
    fs.timer = { running: false, endsAt: 0, remaining: 0, player: fs.activePlayer };
  },

  // ---- Buzzers (face-à-face) ----
  armBuzzer() {
    state.buzzer.armed = true;
    state.buzzer.winner = null;
  },

  resetBuzzer() {
    state.buzzer.armed = false;
    state.buzzer.winner = null;
  },

  // ---- Gagnant ----
  setWinner(p) {
    state.winnerTeam = p.index === null ? null : Number(p.index);
    state.view = 'winner';
  },
};

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(msg);
  });
}

function broadcastState() {
  recomputePot();
  recomputeBuzzerConnected();
  broadcast({ type: 'state', state });
}

// Heartbeat : détecte et ferme les connexions mortes (téléphones déconnectés).
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      /* ignore */
    }
  });
}, 30000);
wss.on('close', () => clearInterval(heartbeat));

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });
  recomputePot();
  recomputeBuzzerConnected();
  ws.send(JSON.stringify({ type: 'state', state }));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'command') {
      const handler = handlers[msg.action];
      if (handler) {
        try {
          handler(msg.payload || {});
        } catch (err) {
          console.error('Erreur commande', msg.action, err);
        }
        broadcastState();
      }
    } else if (msg.type === 'sound') {
      // Événement sonore transitoire : on relaie à tous les écrans.
      broadcast({ type: 'sound', name: msg.name, stop: !!msg.stop });
    } else if (msg.type === 'hello' && msg.role === 'buzzer') {
      // Un smartphone s'annonce comme buzzer d'une équipe.
      ws._buzzerTeam = msg.team === 1 ? 1 : 0;
      broadcastState();
    } else if (msg.type === 'buzz') {
      // Seul un buzzer déclaré peut buzzer, et UNIQUEMENT pour sa propre équipe
      // (l'équipe est celle du socket, jamais celle du payload — anti-triche).
      const team = ws._buzzerTeam;
      if ((team === 0 || team === 1) && state.buzzer.armed && state.buzzer.winner === null) {
        state.buzzer.winner = team;
        state.buzzer.armed = false;
        broadcast({ type: 'sound', name: 'buzzer' });
        broadcastState();
      }
    }
  });

  ws.on('close', () => {
    if (ws._buzzerTeam === 0 || ws._buzzerTeam === 1) {
      recomputeBuzzerConnected();
      broadcast({ type: 'state', state });
    }
  });
});

server.listen(PORT, () => {
  console.log('\n  🟡  UNE FAMILLE EN OR  🟡\n');
  console.log(`  Écran de jeu : http://localhost:${PORT}/`);
  console.log(`  Régie        : http://localhost:${PORT}/regie`);
  console.log(`  Règles       : http://localhost:${PORT}/regles`);
  console.log(`  Buzzer       : http://localhost:${PORT}/buzzer\n`);
  console.log('  Sur le réseau, remplacez "localhost" par l\'adresse IP de ce PC.');
  console.log('  (Ctrl+C pour arrêter)\n');
});
