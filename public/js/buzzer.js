/* ------------------------------------------------------------------ *
 *  Buzzer smartphone — face-à-face.
 *  Le premier à appuyer (quand les buzzers sont armés) prend la main.
 * ------------------------------------------------------------------ */

let team = localStorage.getItem('buzzerTeam');
team = team !== null ? Number(team) : null;
let st = null;
let lastArmed = false;

const $ = (id) => document.getElementById(id);
const connDot = $('conn');

// Socket.IO : WebSocket avec repli automatique en long-polling, reconnexion auto.
const socket = io();
socket.on('connect', () => {
  connDot.classList.add('ok');
  helloIfReady();
});
socket.on('disconnect', () => connDot.classList.remove('ok'));
socket.on('state', (s) => {
  st = s;
  render();
});

function helloIfReady() {
  if (team !== null) socket.emit('hello', { team });
}

// --- Choix de l'équipe ---
document.querySelectorAll('[data-team]').forEach((b) =>
  b.addEventListener('click', () => {
    team = Number(b.dataset.team);
    localStorage.setItem('buzzerTeam', String(team));
    helloIfReady();
    render();
  })
);
$('changeTeam').addEventListener('click', () => {
  team = null;
  localStorage.removeItem('buzzerTeam');
  render();
});

// --- Appui sur le buzzer ---
const pad = $('pad');
function tryBuzz() {
  if (!st || team === null) return;
  const bz = st.buzzer || {};
  if (bz.armed && (bz.winner === null || bz.winner === undefined)) {
    socket.emit('buzz');
    if (navigator.vibrate) navigator.vibrate(120);
  }
}
pad.addEventListener('click', tryBuzz);

// --- Rendu ---
function teamName(i) {
  return st && st.teams && st.teams[i] ? st.teams[i].name : `Équipe ${i + 1}`;
}

function render() {
  // Libellés des boutons de choix avec les vrais noms d'équipes
  $('pick0').textContent = teamName(0);
  $('pick1').textContent = teamName(1);

  if (team === null) {
    $('pick').style.display = 'flex';
    $('buzz').classList.remove('show');
    return;
  }
  $('pick').style.display = 'none';
  $('buzz').classList.add('show');
  $('myTeam').textContent = teamName(team);

  const bz = (st && st.buzzer) || { armed: false, winner: null };
  const emoji = $('padEmoji');
  const text = $('padText');
  const sub = $('padSub');

  let cls = 'idle';
  if (bz.winner === team) {
    cls = 'won';
    emoji.textContent = '✋';
    text.textContent = 'VOUS AVEZ LA MAIN !';
    sub.textContent = 'À votre équipe de jouer.';
  } else if (bz.winner !== null && bz.winner !== undefined) {
    cls = 'lost';
    emoji.textContent = '🔒';
    text.textContent = 'Trop tard…';
    sub.textContent = `${teamName(bz.winner)} a buzzé en premier.`;
  } else if (bz.armed) {
    cls = 'armed';
    emoji.textContent = '🔔';
    text.textContent = 'BUZZ !';
    sub.textContent = 'Appuyez vite !';
    // Vibration courte au moment de l'armement
    if (!lastArmed && navigator.vibrate) navigator.vibrate(60);
  } else {
    cls = 'idle';
    emoji.textContent = '⏳';
    text.textContent = 'En attente…';
    sub.textContent = "L'animateur va armer les buzzers.";
  }
  pad.className = 'pad ' + cls;
  lastArmed = !!bz.armed;
}

render();
