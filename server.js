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
const os = require('os');
const QRCode = require('qrcode');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3000;

// Adaptateurs virtuels / VPN à déprioriser pour le choix de l'IP locale.
const VIRTUAL_RE = /(vmware|virtualbox|vbox|hyper-?v|vethernet|wsl|docker|loopback|vpn|tunnel|tap\b|tailscale|zerotier|bluetooth|radmin)/i;

/** Liste les IPv4 locales joignables, les plus probables d'abord (vraie carte LAN). */
function lanCandidates() {
  const list = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) list.push({ name, address: ni.address });
    }
  }
  const score = (c) => {
    let s = 0;
    if (VIRTUAL_RE.test(c.name)) s += 100;
    if (/^192\.168\.56\./.test(c.address)) s += 50; // VirtualBox host-only
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(c.address)) s += 20; // souvent Docker/Hyper-V/WSL
    if (/(wi-?fi|wlan|ethernet|^en\d|^eth)/i.test(c.name)) s -= 10; // vraie carte
    return s;
  };
  return list
    .sort((a, b) => score(a) - score(b))
    .map((c) => ({ name: c.name, url: `http://${c.address}:${PORT}` }));
}

// Surcharge manuelle via variable d'environnement (ex. LAN_HOST=192.168.1.20).
const ENV_LAN = process.env.LAN_HOST
  ? process.env.LAN_HOST.startsWith('http')
    ? process.env.LAN_HOST
    : `http://${process.env.LAN_HOST}:${PORT}`
  : null;

let chosenLanUrl = null; // IP choisie par l'opérateur dans la régie

/** URL réseau effective (choix opérateur > env > meilleure candidate). */
function currentLanUrl() {
  if (chosenLanUrl) return chosenLanUrl;
  if (ENV_LAN) return ENV_LAN;
  const c = lanCandidates();
  return c.length ? c[0].url : `http://localhost:${PORT}`;
}

/** Rafraîchit l'adresse réseau et les candidates dans l'état diffusé. */
function refreshLan() {
  state.lanUrl = currentLanUrl();
  state.lanCandidates = lanCandidates();
}

app.use(express.static(path.join(__dirname, 'public')));
app.use('/sounds', express.static(path.join(__dirname, 'sounds')));

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'display.html')));
app.get('/regie', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'regie.html')));
app.get('/regles', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'regles.html')));
app.get('/buzzer', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'buzzer.html')));

// QR code (SVG) pointant vers la page buzzer sur le réseau local.
app.get('/qr/buzzer', async (_req, res) => {
  try {
    const svg = await QRCode.toString(`${currentLanUrl()}/buzzer`, {
      type: 'svg',
      margin: 1,
      color: { dark: '#0a1740', light: '#ffffff' },
    });
    res.set('Cache-Control', 'no-store');
    res.type('svg').send(svg);
  } catch {
    res.status(500).send('QR error');
  }
});

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
    playedRounds: [],    // index des manches déjà attribuées (progression)
    // Buzzers du face-à-face : armé ? qui a la main ? combien de buzzers connectés par équipe ?
    buzzer: { armed: false, winner: null, connected: [0, 0] },
    showJoinQR: false,   // afficher le QR code de connexion sur l'écran de jeu ?
    lanUrl: '',          // adresse réseau effective (rempli par refreshLan)
    lanCandidates: [],   // IP locales possibles (pour le choix en régie)
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
    awarded: null,       // équipe ayant reçu la cagnotte (anti double-crédit)
    awardedValue: 0,     // montant crédité (pour pouvoir corriger l'attribution)
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

  // Lance une manche d'un seul geste : question affichée + buzzers armés (face-à-face).
  launchRound(p) {
    const i = Number(p.index);
    if (i >= 0 && i < state.rounds.length) {
      state.currentRoundIndex = i;
      state.board = buildBoard(i);
      state.view = 'question';
      state.buzzer.armed = true;
      state.buzzer.winner = null;
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
    const idx = Number(p.index);
    const value = state.board.pot * state.board.multiplier;
    // Idempotent : déjà attribué à cette équipe → on ne recrédite pas.
    if (state.board.awarded === idx) return;
    // Correction : annule l'attribution précédente avant de re-créditer l'autre équipe.
    if (state.board.awarded != null && state.teams[state.board.awarded]) {
      const prev = state.teams[state.board.awarded];
      prev.score = Math.max(0, prev.score - (state.board.awardedValue || 0));
    }
    const team = state.teams[idx];
    if (team) team.score += value;
    state.board.awarded = idx;
    state.board.awardedValue = value;
    // Marque la manche en cours comme jouée (progression / « Manche suivante »).
    if (state.currentRoundIndex >= 0 && !state.playedRounds.includes(state.currentRoundIndex)) {
      state.playedRounds.push(state.currentRoundIndex);
    }
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
    // Plus personne n'a la main tant qu'un nouveau buzz n'a pas eu lieu.
    if (state.board) state.board.activeTeamIndex = null;
  },

  // Afficher / masquer le QR code de connexion des buzzers sur l'écran de jeu.
  toggleJoinQR(p) {
    state.showJoinQR = p && p.show !== undefined ? !!p.show : !state.showJoinQR;
  },

  // Choix manuel de l'adresse réseau (IP) utilisée pour le QR des buzzers.
  setLanUrl(p) {
    const url = (p && p.url ? p.url : '').toString();
    chosenLanUrl = /^https?:\/\//.test(url) ? url : null;
    refreshLan();
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
  refreshLan();
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
  refreshLan();
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
        // L'équipe qui a buzzé prend la main sur le plateau en cours.
        if (state.board) state.board.activeTeamIndex = team;
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
  refreshLan();
  console.log('\n  🟡  UNE FAMILLE EN OR  🟡\n');
  console.log(`  Écran de jeu : http://localhost:${PORT}/`);
  console.log(`  Régie        : http://localhost:${PORT}/regie`);
  console.log(`  Règles       : http://localhost:${PORT}/regles`);
  console.log(`  Buzzer       : http://localhost:${PORT}/buzzer\n`);
  console.log(`  Réseau (téléphones) : ${currentLanUrl()}/buzzer`);
  const cands = lanCandidates();
  if (cands.length > 1) {
    console.log('  Autres adresses possibles (choisissables dans la régie) :');
    cands.forEach((c) => console.log(`    - ${c.url}  (${c.name})`));
    console.log('  Forcer une IP : démarrer avec LAN_HOST=192.168.x.x');
  }
  console.log('\n  (Ctrl+C pour arrêter)\n');
});
