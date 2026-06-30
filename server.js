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
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
// Socket.IO : temps réel avec repli automatique en HTTP long-polling quand le
// WebSocket est bloqué (proxys/pare-feux d'entreprise). Même origine → pas de CORS.
const io = new Server(server);
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

// La page animateur peut-elle PILOTER le jeu (gérer réponses, scores, finale…) ?
// false = lecture seule (« vision » : voit questions/réponses sans agir).
// Réglable depuis la régie ; persiste au chargement d'un nouveau JSON / à la remise à zéro.
// Défaut fixable au démarrage : ANIMATOR_CONTROL=1 (utile pour un dispositif piloté
// depuis la tablette de l'animateur, qui survit alors aux redémarrages du serveur).
let animatorControl = /^(1|true|on|oui)$/i.test(process.env.ANIMATOR_CONTROL || '');

// Code d'accès des surfaces de CONTRÔLE (régie + animateur).
// Défini par REGIE_CODE, sinon généré (6 chiffres aléatoires sûrs).
const crypto = require('crypto');
const ACCESS_CODE = (process.env.REGIE_CODE || String(crypto.randomInt(100000, 1000000))).toString();

// Code distinct (optionnel) pour la page animateur. S'il est défini, le rôle
// (régie / animateur) est déduit du CODE saisi, pas du paramètre ?role= envoyé par
// le client : la séparation vision/pilotage devient alors un vrai cloisonnement
// (un porteur du seul code animateur ne peut jamais obtenir les droits régie).
// Sinon, code unique partagé : le rôle reste indicatif (cf. effectiveRole).
const ANIMATEUR_CODE = (process.env.ANIMATEUR_CODE || '').toString();

/** Rôle correspondant à un code (null si aucun ne correspond). */
function roleForCode(code) {
  if (code && code === ACCESS_CODE) return 'regie';
  if (code && ANIMATEUR_CODE && code === ANIMATEUR_CODE) return 'animateur';
  return null;
}

/** Rôle effectif du socket.
 *  - Codes distincts (ANIMATEUR_CODE défini) : l'autorité vient du code validé.
 *  - Code unique partagé : le rôle est indicatif (?role=), avec un défaut FAIL-SAFE
 *    (tout ce qui n'est pas explicitement « regie » est traité comme animateur). */
function effectiveRole(queryRole, codeRole) {
  if (ANIMATEUR_CODE) return codeRole === 'regie' ? 'regie' : 'animateur';
  return queryRole === 'regie' ? 'regie' : 'animateur';
}

// Anti-brute-force : limite les tentatives de code échouées par IP.
const authFails = new Map(); // ip -> { count, lockedUntil }
const AUTH_MAX = 8; // échecs avant verrouillage
const AUTH_LOCK_MS = 60000; // durée du verrouillage

/** Valide un code pour une IP, avec verrouillage progressif. Renvoie {ok, locked, role}. */
function validateCode(ip, code) {
  const rec = authFails.get(ip);
  if (rec && rec.lockedUntil > Date.now()) return { ok: false, locked: true };
  if (!code) return { ok: false }; // pas de code = spectateur, pas une tentative
  const role = roleForCode(code);
  const ok = !!role;
  if (ok) {
    authFails.delete(ip);
  } else {
    const r = rec || { count: 0, lockedUntil: 0 };
    r.count += 1;
    if (r.count >= AUTH_MAX) {
      r.count = 0;
      r.lockedUntil = Date.now() + AUTH_LOCK_MS;
      authFails.set(ip, r);
      return { ok: false, locked: true };
    }
    authFails.set(ip, r);
  }
  return { ok, role };
}

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
app.get('/animateur', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'animateur.html')));

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

/** Le jeu a commencé sur le plateau : on retire le prompt « À vos buzzers »
    (si personne n'a buzzé). Le gagnant éventuel d'un buzz reste inchangé. */
function endFaceOffIfArmed() {
  if (state.buzzer && state.buzzer.armed) state.buzzer.armed = false;
}

/** Compte les buzzers connectés par équipe (mis à jour avant chaque diffusion). */
function recomputeBuzzerConnected() {
  const counts = [0, 0];
  io.sockets.sockets.forEach((s) => {
    const t = s.data.buzzerTeam;
    if (t === 0 || t === 1) counts[t]++;
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
    clearFinalTimerExpiry();
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
    clearFinalTimerExpiry();
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
      endFaceOffIfArmed(); // le jeu a commencé : on retire « À vos buzzers »
    }
  },

  hideAnswer(p) {
    if (state.board && state.board.answers[p.index]) {
      state.board.answers[p.index].revealed = false;
    }
  },

  revealAll() {
    if (state.board) state.board.answers.forEach((a) => (a.revealed = true));
    endFaceOffIfArmed();
  },

  setStrikes(p) {
    if (state.board) state.board.strikes = Math.max(0, Math.min(3, Number(p.strikes) || 0));
  },

  addStrike() {
    if (state.board) {
      state.board.strikes = Math.min(3, state.board.strikes + 1);
      endFaceOffIfArmed();
    }
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
    clearFinalTimerExpiry();
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
  // Reprend le temps restant si le chrono est en pause (même finaliste) ;
  // sinon démarre un décompte neuf.
  startFinalTimer(p) {
    const fs = state.finalState;
    if (!fs) return;
    const t = fs.timer;
    const canResume = !t.running && t.remaining > 0 && t.player === fs.activePlayer;
    const seconds = Number(p.seconds) || (canResume ? t.remaining : fs.timers[fs.activePlayer] || 20);
    const endsAt = Date.now() + seconds * 1000;
    fs.timer = { running: true, endsAt, remaining: seconds, player: fs.activePlayer };
    scheduleFinalTimerExpiry(endsAt, seconds * 1000 + 50);
  },

  pauseFinalTimer() {
    const fs = state.finalState;
    if (!fs || !fs.timer.running) return;
    fs.timer.remaining = Math.max(0, Math.round((fs.timer.endsAt - Date.now()) / 1000));
    fs.timer.running = false;
    clearFinalTimerExpiry();
  },

  resetFinalTimer() {
    const fs = state.finalState;
    if (!fs) return;
    fs.timer = { running: false, endsAt: 0, remaining: 0, player: fs.activePlayer };
    clearFinalTimerExpiry();
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

  // ---- Réglages ----
  // Autorise / retire le pilotage à la page animateur (réservé à la régie).
  setAnimatorControl(p) {
    animatorControl = !!p.on;
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

const lastSoundAt = {}; // anti-rebond des événements sonores (par nom)

// Expiration du minuteur de la finale : à 0, on joue un son et on arrête le chrono.
let finalTimerHandle = null;
function clearFinalTimerExpiry() {
  if (finalTimerHandle) {
    clearTimeout(finalTimerHandle);
    finalTimerHandle = null;
  }
}
function scheduleFinalTimerExpiry(endsAt, ms) {
  clearFinalTimerExpiry();
  finalTimerHandle = setTimeout(() => {
    finalTimerHandle = null;
    const fs = state.finalState;
    // On n'expire que si CE minuteur tourne toujours (pas pausé/réinitialisé/relancé).
    if (fs && fs.timer.running && fs.timer.endsAt === endsAt) {
      fs.timer.running = false;
      fs.timer.remaining = 0;
      if (state.view === 'final') emitSound('timesup'); // fin du temps
      broadcastState();
    }
  }, ms);
}

/** Événement sonore transitoire diffusé à tous les écrans. */
function emitSound(name, stop) {
  io.emit('sound', { name, stop: !!stop });
}

/**
 * État "public" pour les clients NON authentifiés (écran de jeu, buzzers, curieux) :
 * les réponses non révélées sont retirées pour ne pas pouvoir lire les bonnes
 * réponses à l'avance. Les clients de contrôle authentifiés reçoivent l'état complet.
 */
function publicState() {
  const s = JSON.parse(JSON.stringify(state));
  // Définitions chargées : on retire toutes les réponses (le client public n'en a pas besoin).
  s.rounds = (s.rounds || []).map((r) => ({ multiplier: r.multiplier, question: r.question, answers: [] }));
  if (s.final) {
    s.final = {
      ...s.final,
      questions: (s.final.questions || []).map((q) => ({ question: q.question, answers: [] })),
    };
  }
  // Plateau en cours : réponses non révélées masquées.
  if (s.board) {
    s.board.answers = s.board.answers.map((a) =>
      a.revealed ? a : { text: '', points: 0, revealed: false }
    );
  }
  // Manche finale : réponses attendues retirées, cellules non révélées masquées.
  if (s.finalState) {
    s.finalState.questions = (s.finalState.questions || []).map((q) => ({ question: q.question, answers: [] }));
    s.finalState.cells = (s.finalState.cells || []).map((pair) =>
      pair.map((c) => (c.revealed ? c : { answer: '', points: 0, revealed: false }))
    );
  }
  return s;
}

/** Envoie l'état adapté au niveau d'accès du socket (complet si authentifié). */
function sendStateTo(socket) {
  state.animatorControl = animatorControl;
  socket.emit('state', socket.data.authed ? state : publicState());
}

function broadcastState() {
  state.animatorControl = animatorControl;
  recomputePot();
  recomputeBuzzerConnected();
  refreshLan();
  let pub = null;
  io.sockets.sockets.forEach((socket) => {
    if (socket.data.authed) {
      socket.emit('state', state);
    } else {
      if (!pub) pub = publicState();
      socket.emit('state', pub);
    }
  });
}

// (Socket.IO gère lui-même le heartbeat ping/pong et la détection des déconnexions.)

/** IP du client en tenant compte d'un reverse proxy (hébergement en ligne).
 *  Render/Railway/Fly mettent l'IP réelle dans X-Forwarded-For ; sans cela, tous les
 *  clients partageraient l'IP du proxy → un seul mauvais code verrouillerait tout le monde
 *  (l'anti-brute-force est par IP). En direct (pas de proxy), on garde l'adresse de la socket.
 *  NB : X-Forwarded-For est falsifiable ; ce keyage évite surtout le verrouillage global.
 *  En exposition publique, la vraie protection reste un REGIE_CODE long. */
function clientIp(handshake) {
  const xff = (handshake.headers && handshake.headers['x-forwarded-for']) || '';
  const first = xff.split(',')[0].trim();
  return first || handshake.address || 'unknown';
}

io.on('connection', (socket) => {
  const hs = socket.handshake;
  socket.data.ip = clientIp(hs);
  // Identifiants à la connexion : via `auth` (recommandé, re-transmis aux reconnexions),
  // avec repli sur la query. Le rôle (regie|animateur) n'est qu'un indice : l'autorité
  // réelle vient du code validé (cf. effectiveRole).
  const cred = hs.auth || {};
  const q = hs.query || {};
  const code = (cred.code || q.code || '').toString();
  const role = (cred.role || q.role || '').toString();
  socket.data.queryRole = role;
  const res = validateCode(socket.data.ip, code);
  socket.data.authed = res.ok;
  socket.data.role = effectiveRole(role, res.role);
  recomputePot();
  recomputeBuzzerConnected();
  refreshLan();
  sendStateTo(socket);
  socket.emit('auth', { ok: res.ok, locked: !!res.locked });

  // Authentification a posteriori (saisie du code dans la régie/animateur).
  socket.on('auth', (code) => {
    const wasAuthed = socket.data.authed;
    const res = validateCode(socket.data.ip, (code || '').toString());
    socket.data.authed = res.ok;
    if (res.ok) socket.data.role = effectiveRole(socket.data.queryRole, res.role);
    socket.emit('auth', { ok: res.ok, locked: !!res.locked });
    // Si on vient d'obtenir l'accès, on pousse l'état complet (réponses incluses).
    if (res.ok && !wasAuthed) sendStateTo(socket);
  });

  socket.on('command', (msg) => {
    msg = msg || {};
    // Seules les surfaces de contrôle authentifiées peuvent commander.
    if (!socket.data.authed) {
      socket.emit('auth', { ok: false });
      return;
    }
    // Fail-safe : tout ce qui n'est pas explicitement la régie est soumis au gating.
    const isAnimator = socket.data.role !== 'regie';
    // Animateur en lecture seule (vision) : aucune commande ne passe.
    if (isAnimator && !animatorControl) return;
    // Le mode de l'animateur ne se change que depuis la régie.
    if (msg.action === 'setAnimatorControl' && isAnimator) return;
    const handler = handlers[msg.action];
    if (handler) {
      try {
        handler(msg.payload || {});
      } catch (err) {
        console.error('Erreur commande', msg.action, err);
      }
      broadcastState();
    }
  });

  socket.on('sound', (msg) => {
    msg = msg || {};
    if (!socket.data.authed) return; // les sons sont déclenchés par le contrôle
    if (socket.data.role !== 'regie' && !animatorControl) return; // animateur en vision
    // Anti-rebond : ignore un même son redéclenché < 150 ms après (double-clic,
    // ou régie + animateur qui agissent en parallèle).
    if (!msg.stop) {
      const now = Date.now();
      if (lastSoundAt[msg.name] && now - lastSoundAt[msg.name] < 150) return;
      lastSoundAt[msg.name] = now;
    }
    emitSound(msg.name, msg.stop);
  });

  // Un smartphone s'annonce comme buzzer d'une équipe.
  socket.on('hello', (msg) => {
    msg = msg || {};
    socket.data.buzzerTeam = msg.team === 1 ? 1 : 0;
    broadcastState();
  });

  socket.on('buzz', () => {
    // Seul un buzzer déclaré peut buzzer, et UNIQUEMENT pour sa propre équipe
    // (l'équipe est celle du socket, jamais celle du payload — anti-triche).
    const team = socket.data.buzzerTeam;
    if ((team === 0 || team === 1) && state.buzzer.armed && state.buzzer.winner === null) {
      state.buzzer.winner = team;
      state.buzzer.armed = false;
      // L'équipe qui a buzzé prend la main sur le plateau en cours.
      if (state.board) state.board.activeTeamIndex = team;
      emitSound('buzzer');
      broadcastState();
    }
  });

  socket.on('disconnect', () => {
    if (socket.data.buzzerTeam === 0 || socket.data.buzzerTeam === 1) {
      broadcastState(); // recompte les buzzers + diffuse (état expurgé pour les non-authentifiés)
    }
  });
});

server.listen(PORT, () => {
  refreshLan();
  console.log('\n  🟡  UNE FAMILLE EN OR  🟡\n');
  console.log(`  Écran de jeu : http://localhost:${PORT}/`);
  console.log(`  Régie        : http://localhost:${PORT}/regie`);
  console.log(`  Animateur    : http://localhost:${PORT}/animateur`);
  console.log(`  Règles       : http://localhost:${PORT}/regles`);
  console.log(`  Buzzer       : http://localhost:${PORT}/buzzer\n`);
  if (ANIMATEUR_CODE) {
    console.log(`  🔒 Code RÉGIE      : ${ACCESS_CODE}`);
    console.log(`  🔒 Code ANIMATEUR  : ${ANIMATEUR_CODE}  (vision/pilotage cloisonné par code)`);
  } else {
    console.log(`  🔒 Code d'accès régie/animateur : ${ACCESS_CODE}`);
    if (!process.env.REGIE_CODE) {
      console.log('     (aléatoire — fixez-le avec REGIE_CODE=moncode pour le garder)');
    }
    console.log('     (code animateur distinct : démarrer avec ANIMATEUR_CODE=autrecode)');
  }
  console.log(`  📱 Animateur par défaut : ${animatorControl ? 'PILOTAGE' : 'vision seule'} (réglable en régie ; ANIMATOR_CONTROL=1 pour piloter par défaut)`);
  console.log('');
  console.log(`  Réseau (téléphones) : ${currentLanUrl()}/buzzer`);
  const cands = lanCandidates();
  if (cands.length > 1) {
    console.log('  Autres adresses possibles (choisissables dans la régie) :');
    cands.forEach((c) => console.log(`    - ${c.url}  (${c.name})`));
    console.log('  Forcer une IP : démarrer avec LAN_HOST=192.168.x.x');
  }
  console.log('\n  (Ctrl+C pour arrêter)\n');
});
