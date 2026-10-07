/* ------------------------------------------------------------------ *
 *  Régie — pupitre de l'animateur.
 * ------------------------------------------------------------------ */

let state = null;
let authed = false;
let ctrlCode = localStorage.getItem('ctrlCode') || '';
const connEl = document.getElementById('conn');

// Socket.IO : WebSocket avec repli automatique en long-polling (proxys d'entreprise),
// reconnexion auto. Le code/rôle voyagent dans `auth` (re-transmis aux reconnexions).
const socket = io({ auth: { role: 'regie', code: ctrlCode } });
socket.on('connect', () => {
  connEl.textContent = '● en ligne';
  connEl.classList.add('ok');
});
socket.on('disconnect', () => {
  connEl.textContent = '● hors ligne';
  connEl.classList.remove('ok');
  authed = false; // on ne peut plus commander tant qu'on n'est pas reconnecté+ré-authentifié
});
socket.on('auth', ({ ok, locked }) => handleAuth(ok, locked));
socket.on('state', (s) => {
  state = s;
  render();
});
socket.on('sound', (msg) => SoundManager.handle(msg));
socket.on('soundsChanged', () => SoundManager.scan());

function cmd(action, payload = {}) {
  if (!authed) return;
  socket.emit('command', { action, payload });
}
function sound(name, stop = false) {
  if (!authed) return;
  socket.emit('sound', { name, stop });
}

// ---- Portail de code d'accès ----
let manualAttempt = false; // un code vient-il d'être saisi à la main ?
function showAuthErr(text) {
  const err = document.getElementById('authErr');
  if (err) {
    err.textContent = text;
    err.hidden = !text;
  }
}
function handleAuth(ok, locked) {
  authed = ok;
  const gate = document.getElementById('authGate');
  if (gate) gate.hidden = ok;
  if (!ok) {
    if (locked) showAuthErr('Trop de tentatives. Réessayez dans une minute.');
    else if (manualAttempt) showAuthErr('Code incorrect.');
    else if (ctrlCode) showAuthErr('Le code a peut-être changé (serveur redémarré). Entrez le nouveau code affiché dans le terminal.');
    else showAuthErr('');
    const inp = document.getElementById('authInput');
    if (inp) inp.focus();
  } else {
    showAuthErr('');
  }
  manualAttempt = false;
}
function submitCode() {
  const inp = document.getElementById('authInput');
  const v = (inp.value || '').trim();
  if (!v) {
    showAuthErr('Entrez le code.');
    inp.focus();
    return;
  }
  ctrlCode = v;
  localStorage.setItem('ctrlCode', ctrlCode);
  manualAttempt = true;
  socket.auth = { role: 'regie', code: ctrlCode }; // utilisé aux reconnexions
  socket.emit('auth', ctrlCode); // validation immédiate sans reconnecter
}
document.getElementById('authSubmit').addEventListener('click', submitCode);
document.getElementById('authInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitCode();
});
document.getElementById('authInput').focus();

// Politique d'autoplay : le navigateur coupe le son d'une page tant qu'elle n'a
// reçu aucun geste (clic, touche). Si l'animateur pilote et que personne ne touche
// la régie, elle resterait muette : on débloque à la moindre interaction, et le
// bouton « Son » signale l'état bloqué tant que ce n'est pas fait.
let gestureUnlocked = false; // le geste en cours vient-il de débloquer le son ?
['pointerdown', 'keydown'].forEach((ev) =>
  document.addEventListener(
    ev,
    () => {
      gestureUnlocked = !SoundManager.isUnlocked();
      SoundManager.unlock();
      setTimeout(refreshMuteBtn, 100); // laisse l'AudioContext reprendre
    },
    true
  )
);

// ------------------------------------------------------------------ //
//  Barre supérieure
// ------------------------------------------------------------------ //

document.getElementById('fileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      loadGame(data, file.name);
    } catch (err) {
      alert('Fichier JSON invalide :\n' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// Questions du serveur (dossier questions/) : liste rafraîchie à chaque ouverture.
const qSelect = document.getElementById('questionsSelect');
function refreshQuestionsList() {
  if (!authed) return;
  socket.emit('questionsList', (res) => {
    if (!res || !res.ok) return;
    const keep = qSelect.value;
    qSelect.length = 1; // garde l'option d'invite
    res.files.forEach((f) => {
      const o = document.createElement('option');
      o.value = f.file;
      if (f.error) {
        o.textContent = `${f.file} — ⚠ ${f.error}`;
        o.disabled = true;
      } else {
        const parts = [];
        if (f.rounds) parts.push(`${f.rounds} manche${f.rounds > 1 ? 's' : ''}`);
        if (f.final) parts.push('finale');
        o.textContent = `${f.title || f.file} (${parts.join(' + ')})`;
        o.title = f.file;
      }
      qSelect.appendChild(o);
    });
    if ([...qSelect.options].some((o) => o.value === keep)) qSelect.value = keep;
    syncQuestionsSelect(true);
  });
}
// La liste montre le fichier serveur actuellement chargé. On ne la recale que quand
// la source change (sinon un choix en cours, pas encore « Chargé », serait écrasé).
let lastSourceKey = null;
function syncQuestionsSelect(force) {
  const src = state && state.source;
  const key = src ? src.type + '|' + src.file : '';
  if (!force && key === lastSourceKey) return;
  lastSourceKey = key;
  const want = src && src.type === 'server' ? src.file : '';
  if ([...qSelect.options].some((o) => o.value === want)) qSelect.value = want;
}
socket.on('auth', ({ ok }) => ok && refreshQuestionsList());
qSelect.addEventListener('focus', refreshQuestionsList);
document.getElementById('questionsLoadBtn').addEventListener('click', () => {
  if (!authed) return;
  if (!qSelect.value) {
    alert('Choisis un fichier de questions dans la liste.');
    qSelect.focus();
    return;
  }
  if (!confirmReplaceGame()) return;
  socket.emit('questionsLoad', qSelect.value, (res) => {
    if (!res || !res.ok) alert('Chargement impossible :\n' + ((res && res.error) || 'erreur inconnue'));
  });
});

// Une partie a commencé (points marqués / manches jouées) : on confirme avant de l'écraser.
function confirmReplaceGame() {
  const started = state && (state.teams.some((t) => t.score) || (state.playedRounds || []).length);
  return !started || confirm('Une partie est en cours : charger ces questions la remplacera (scores remis à zéro). Continuer ?');
}

function loadGame(data, fileName) {
  if (!data || (!Array.isArray(data.rounds) && !data.final)) {
    alert('Format inattendu : il faut au moins un tableau "rounds" ou une clé "final".');
    return;
  }
  if (!confirmReplaceGame()) return;
  cmd('load', { data, source: { type: 'pc', file: fileName || '' } });
}

document.getElementById('resetBtn').addEventListener('click', () => {
  if (confirm('Tout réinitialiser ? Les questions seront déchargées et les scores remis à zéro.')) {
    cmd('reset');
    sound('*', true);
  }
});

const muteBtn = document.getElementById('muteBtn');
function refreshMuteBtn() {
  const locked = !SoundManager.isUnlocked();
  const muted = SoundManager.isMuted();
  muteBtn.classList.toggle('locked', locked);
  muteBtn.classList.toggle('off', !locked && muted);
  muteBtn.textContent = locked ? '🔈 Activer le son' : muted ? '🔇 Muet' : '🔊 Son';
  muteBtn.title = locked ? 'Le navigateur bloque le son tant que la page n’a pas été cliquée' : '';
}
muteBtn.addEventListener('click', () => {
  // Clic qui vient de débloquer le son : il sert juste à l'activer (pas à couper).
  if (gestureUnlocked) {
    gestureUnlocked = false;
    refreshMuteBtn();
    return;
  }
  SoundManager.setMuted(!SoundManager.isMuted());
  refreshMuteBtn();
});
refreshMuteBtn();

// Vues + victoire
document.querySelectorAll('[data-view]').forEach((b) =>
  b.addEventListener('click', () => cmd('setView', { view: b.dataset.view }))
);
document.getElementById('winA').addEventListener('click', () => cmd('setWinner', { index: 0 }));
document.getElementById('winB').addEventListener('click', () => cmd('setWinner', { index: 1 }));

// Sons : un bouton par son du catalogue, avec l'état « fichier perso / synthèse ».
(() => {
  const grid = document.getElementById('soundGrid');
  grid.innerHTML = SoundManager.catalog
    .map(
      (s) => `<button class="btn snd-btn ${s.cls || ''}" data-sound="${s.key}" title="${escapeHtml(s.hint)}">
        <span class="snd-btn__emoji">${s.emoji}</span>
        <span class="snd-btn__txt"><b>${escapeHtml(s.label)}</b><small data-snd-file></small></span>
        <span class="snd-btn__badge" data-snd-badge></span>
      </button>`
    )
    .join('');
  grid.querySelectorAll('[data-sound]').forEach((b) => b.addEventListener('click', () => sound(b.dataset.sound)));
  document.getElementById('soundStopAll').addEventListener('click', () => sound('*', true));
  document.getElementById('soundRescan').addEventListener('click', () => {
    SoundManager.scan();
    socket.emit('soundsRescan');
  });
  const renderSounds = () => {
    let custom = 0;
    SoundManager.catalog.forEach((s) => {
      const b = grid.querySelector(`[data-sound="${s.key}"]`);
      const f = SoundManager.fileFor(s.key);
      if (f) custom++;
      b.classList.toggle('is-custom', !!f);
      b.querySelector('[data-snd-file]').textContent = f ? f.file : `${s.file}.mp3`;
      b.querySelector('[data-snd-badge]').textContent = f ? 'perso' : 'synthé';
    });
    document.getElementById('soundCount').textContent =
      `${custom} / ${SoundManager.catalog.length} sons perso trouvés dans sounds/`;
  };
  SoundManager.onChange(renderSounds);
  renderSounds();
})();

// Plateau : outils
document.getElementById('strikeAdd').addEventListener('click', () => {
  cmd('addStrike');
  sound('wrong');
});
document.getElementById('strikeClear').addEventListener('click', () => cmd('clearStrikes'));
document.getElementById('revealAllBtn').addEventListener('click', () => {
  cmd('revealAll');
  sound('reveal');
});
document.getElementById('awardA').addEventListener('click', () => award(0));
document.getElementById('awardB').addEventListener('click', () => award(1));

// Cagnotte vers le score d'une équipe : son des points + applaudissements.
function award(index) {
  cmd('awardPot', { index });
  sound('points');
  sound('applause');
}

// Buzzers (face-à-face)
document.getElementById('armBuzzerBtn').addEventListener('click', () => cmd('armBuzzer'));
document.getElementById('resetBuzzerBtn').addEventListener('click', () => cmd('resetBuzzer'));
document.getElementById('qrScreenBtn').addEventListener('click', () => cmd('toggleJoinQR'));
document.getElementById('lanSelect').addEventListener('change', (e) => cmd('setLanUrl', { url: e.target.value }));

// Manche suivante (1 clic)
document.getElementById('nextRoundBtn').addEventListener('click', nextRound);

// Droits de la page animateur (vision seule / pilotage)
document.getElementById('animModeView').addEventListener('click', () => cmd('setAnimatorControl', { on: false }));
document.getElementById('animModeCtrl').addEventListener('click', () => cmd('setAnimatorControl', { on: true }));

// Jingle vidéo : liste des fichiers du serveur + diffusion/arrêt sur l'écran de jeu
(() => {
  const sel = document.getElementById('videoSelect');
  const urlInput = document.getElementById('videoUrl');
  if (!sel) return;
  // État du préchargement sur l'écran de jeu, affiché à côté de chaque vidéo.
  const preload = {};
  const label = (o) => {
    const st = preload[o.value];
    let tag = '';
    if (st && st.done) tag = ' — ✓ préchargée';
    else if (st && st.error) tag = ' — ⚠ préchargement échoué';
    else if (st && st.total) tag = ` — ⏳ ${Math.floor((st.loaded / st.total) * 100)} %`;
    o.textContent = o.dataset.file + tag;
  };
  socket.on('mediaPreload', (st) => {
    if (!st || !st.url) return;
    preload[st.url] = st;
    const o = [...sel.options].find((x) => x.value === st.url);
    if (o) label(o);
  });
  socket.on('auth', ({ ok }) => ok && socket.emit('mediaPreloadGet'));
  fetch('/media/list')
    .then((r) => r.json())
    .then((vids) => {
      (vids || []).forEach((v) => {
        const o = document.createElement('option');
        o.value = v.url;
        o.dataset.file = v.file;
        label(o);
        sel.appendChild(o);
      });
    })
    .catch(() => {});
  document.getElementById('videoPlay').addEventListener('click', () => {
    if (!authed) return;
    const src = (urlInput.value || '').trim() || sel.value;
    if (!src) { alert('Choisis une vidéo dans la liste ou colle une URL.'); return; }
    socket.emit('video', { src });
  });
  document.getElementById('videoStop').addEventListener('click', () => {
    if (authed) socket.emit('video', { stop: true });
  });
})();

// Thème de l'écran de jeu (sombre / clair / rétro)
document.querySelectorAll('[data-theme-btn]').forEach((b) =>
  b.addEventListener('click', () => cmd('setTheme', { theme: b.dataset.themeBtn }))
);

// Aide des raccourcis clavier
const shortcutsOverlay = document.getElementById('shortcutsOverlay');
const toggleShortcuts = (show) => {
  shortcutsOverlay.hidden = show === undefined ? !shortcutsOverlay.hidden : !show;
};
document.getElementById('shortcutsBtn').addEventListener('click', () => toggleShortcuts());
document.getElementById('shortcutsClose').addEventListener('click', () => toggleShortcuts(false));
shortcutsOverlay.addEventListener('click', (e) => {
  if (e.target === shortcutsOverlay) toggleShortcuts(false);
});

// ------------------------------------------------------------------ //
//  Raccourcis clavier (pilotage en direct)
// ------------------------------------------------------------------ //
document.addEventListener('keydown', (e) => {
  if (!authed) return; // raccourcis inactifs tant que non authentifié
  if (e.repeat) return; // ignore l'auto-répétition d'une touche maintenue
  // Ignorer pendant la saisie dans un champ
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const k = e.key;

  if (k === '?' || k === 'h' || k === 'H') return toggleShortcuts(), e.preventDefault();
  if (k === 'Escape') return toggleShortcuts(false);

  // Révéler/masquer une réponse du plateau
  if (/^[1-9]$/.test(k) && state && state.board) {
    const i = Number(k) - 1;
    const a = state.board.answers[i];
    if (a) {
      if (a.revealed) cmd('hideAnswer', { index: i });
      else { cmd('revealAnswer', { index: i }); sound('reveal'); }
    }
    return e.preventDefault();
  }

  switch (k) {
    case 'x': case 'X':
      cmd('addStrike'); sound('wrong'); e.preventDefault(); break;
    case 'c': case 'C':
      cmd('clearStrikes'); e.preventDefault(); break;
    case 'r': case 'R':
      cmd('revealAll'); sound('reveal'); e.preventDefault(); break;
    case 'ArrowLeft':
      award(0); e.preventDefault(); break;
    case 'ArrowRight':
      award(1); e.preventDefault(); break;
    case 't': case 'T':
      sound('fivesec'); e.preventDefault(); break;
    case 'b': case 'B':
      cmd('armBuzzer'); e.preventDefault(); break;
    case 'n': case 'N':
      nextRound(); e.preventDefault(); break;
    case 'l': case 'L':
      cmd('setView', { view: 'logo' }); e.preventDefault(); break;
  }
});

// Manche finale
document.getElementById('startFinalBtn').addEventListener('click', () => {
  // Redémarrage destructif (efface les réponses saisies) → on confirme
  if (state && state.finalState && !confirm('Redémarrer la manche finale ?\nToutes les réponses et points déjà saisis seront effacés.')) return;
  cmd('startFinal');
});

// ------------------------------------------------------------------ //
//  Rendu
// ------------------------------------------------------------------ //

let teamsBuilt = false;
let roundsSig = '';
let boardSig = '';
let finalLen = -1;

function render() {
  if (!state) return;

  document.getElementById('loadInfo').textContent = state.loaded
    ? `✓ « ${state.title} » — ${state.rounds.length} manche(s)${state.final ? ' + manche finale' : ''}`
    : 'Aucun jeu chargé — choisissez des questions dans la liste, ou importez un fichier.';
  syncQuestionsSelect(false);
  document.getElementById('loadBar').classList.toggle('ok', state.loaded);

  // Boutons de vue actifs
  document.querySelectorAll('[data-view]').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === state.view)
  );

  renderStatusbar();
  renderAnimMode();
  renderThemePicker();
  renderTeams();
  renderRounds();
  renderBoard();
  renderFinal();
  renderBuzzer();
}

// Sélecteur de thème : reflète le thème courant de l'écran de jeu.
function renderThemePicker() {
  const t = state.theme || 'dark';
  document.querySelectorAll('[data-theme-btn]').forEach((b) =>
    b.classList.toggle('active', b.dataset.themeBtn === t)
  );
}

// Réglage des droits de l'animateur : reflète le mode courant.
function renderAnimMode() {
  const on = !!state.animatorControl;
  const view = document.getElementById('animModeView');
  const ctrl = document.getElementById('animModeCtrl');
  if (view) view.classList.toggle('active', !on);
  if (ctrl) ctrl.classList.toggle('active', on);
  const lbl = document.getElementById('animCtrlState');
  if (lbl) {
    lbl.textContent = on
      ? '🎮 L’animateur peut piloter le jeu.'
      : '👁 L’animateur est en vision seule (lecture).';
    lbl.classList.toggle('on', on);
  }
}

const VIEW_LABELS = { logo: 'Logo', question: 'Question', board: 'Plateau', final: 'Manche finale', winner: 'Gagnant' };

function renderStatusbar() {
  const b = state.board;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('sbView', VIEW_LABELS[state.view] || state.view);
  set('sbRound', state.currentRoundIndex >= 0 ? `${state.currentRoundIndex + 1} (×${b ? b.multiplier : '?'})` : '—');
  set('sbQuestion', b && b.question ? b.question : '—');

  const active = b && b.activeTeamIndex != null ? b.activeTeamIndex : null;
  set('sbActive', active != null && state.teams[active] ? state.teams[active].name : '—');
  set('sbPot', b ? (b.multiplier > 1 ? `${b.pot} ×${b.multiplier} = ${b.pot * b.multiplier}` : `${b.pot} pts`) : '—');
  set('sbStrikes', b ? `${b.strikes} / 3` : '—');

  const bz = state.buzzer || {};
  let bzTxt = 'repos';
  if (bz.winner != null) bzTxt = `✋ ${state.teams[bz.winner] ? state.teams[bz.winner].name : 'Éq.' + (bz.winner + 1)}`;
  else if (bz.armed) bzTxt = '🟢 armés';
  set('sbBuzz', bzTxt);
}

function renderBuzzer() {
  const bz = state.buzzer || { armed: false, winner: null, connected: [0, 0] };
  const conn = document.getElementById('buzzConn');
  if (conn) {
    const n0 = bz.connected?.[0] || 0;
    const n1 = bz.connected?.[1] || 0;
    conn.textContent = `Connectés — ${state.teams[0].name} : ${n0} · ${state.teams[1].name} : ${n1}`;
  }
  // Adresse que les téléphones doivent ouvrir (domaine en ligne, IP en local).
  const lanUrl = state.lanUrl || location.origin; // pour la synchro du menu déroulant
  const bBase = buzzerBase(state); // helper partagé (public/js/net-util.js)
  const url = document.getElementById('buzzUrl');
  if (url) url.textContent = `${bBase}/buzzer`;

  // Liste des IP candidates (reconstruite seulement si elle change)
  const sel = document.getElementById('lanSelect');
  if (sel) {
    const cands = state.lanCandidates || [];
    const sig = cands.map((c) => c.url).join('|');
    if (sel.dataset.sig !== sig) {
      sel.dataset.sig = sig;
      sel.innerHTML = cands
        .map((c) => `<option value="${escapeAttr(c.url)}">${escapeHtml(c.url)} — ${escapeHtml(c.name)}</option>`)
        .join('');
    }
    if (document.activeElement !== sel) sel.value = lanUrl;
  }

  // Rafraîchit l'image du QR seulement quand l'adresse change.
  const qr = document.getElementById('buzzQr');
  if (qr && qr.dataset.base !== bBase) {
    qr.dataset.base = bBase;
    qr.src = '/qr/buzzer?url=' + encodeURIComponent(bBase);
  }
  const qrScreenBtn = document.getElementById('qrScreenBtn');
  if (qrScreenBtn) {
    qrScreenBtn.classList.toggle('active', !!state.showJoinQR);
    qrScreenBtn.textContent = state.showJoinQR ? '📺 Masquer le QR de l\'écran' : '📺 Afficher le QR sur l\'écran';
  }
  const armBtn = document.getElementById('armBuzzerBtn');
  if (armBtn) armBtn.classList.toggle('active', bz.armed);

  const st = document.getElementById('buzzState');
  if (st) {
    if (bz.winner !== null && bz.winner !== undefined) {
      const t = state.teams[bz.winner];
      st.textContent = `✋ ${t ? t.name : 'Équipe ' + (bz.winner + 1)} a buzzé en premier — à elle de jouer !`;
      st.className = 'buzz-state winner';
    } else if (bz.armed) {
      st.textContent = '🟢 Buzzers armés — en attente du premier buzz…';
      st.className = 'buzz-state armed';
    } else {
      st.textContent = 'Buzzers au repos. Cliquez « Armer » au moment du face-à-face.';
      st.className = 'buzz-state';
    }
  }
}

function renderTeams() {
  const wrap = document.getElementById('teams');
  if (!teamsBuilt) {
    wrap.innerHTML = state.teams
      .map(
        (t, i) => `
      <div class="team-edit" data-i="${i}">
        <input type="text" class="tname" value="${escapeAttr(t.name)}" />
        <div class="score-box">
          <button data-d="-10">−10</button>
          <button data-d="-1">−1</button>
          <span class="val">0</span>
          <button data-d="1">+1</button>
          <button data-d="10">+10</button>
          <input type="number" class="setval" placeholder="déf." />
          <button class="setbtn">=</button>
        </div>
      </div>`
      )
      .join('');

    wrap.querySelectorAll('.team-edit').forEach((row) => {
      const i = Number(row.dataset.i);
      row.querySelector('.tname').addEventListener('change', (e) =>
        cmd('setTeamName', { index: i, name: e.target.value })
      );
      row.querySelectorAll('[data-d]').forEach((b) =>
        b.addEventListener('click', () => cmd('addScore', { index: i, delta: Number(b.dataset.d) }))
      );
      row.querySelector('.setbtn').addEventListener('click', () => {
        const v = row.querySelector('.setval');
        if (v.value !== '') {
          cmd('setScore', { index: i, score: Number(v.value) });
          v.value = '';
        }
      });
    });
    teamsBuilt = true;
  }

  state.teams.forEach((t, i) => {
    const row = wrap.querySelector(`.team-edit[data-i="${i}"]`);
    row.querySelector('.val').textContent = t.score;
    const nameInput = row.querySelector('.tname');
    if (document.activeElement !== nameInput) nameInput.value = t.name;
  });
}

function renderRounds() {
  const wrap = document.getElementById('roundsList');
  const sig = state.rounds.map((r) => `${r.multiplier}:${r.question}`).join('|');
  if (sig !== roundsSig) {
    roundsSig = sig;
    if (state.rounds.length === 0) {
      wrap.innerHTML = '<p style="color:var(--muted)">Aucune manche chargée.</p>';
    } else {
      wrap.innerHTML = state.rounds
        .map(
          (r, i) => `
        <button class="round-item" data-i="${i}">
          <div class="ri-head">
            <span class="ri-num">Manche ${i + 1}</span>
            <span class="ri-mult">×${r.multiplier || 1}</span>
          </div>
          <div class="ri-q">${escapeHtml(r.question || '')}</div>
        </button>`
        )
        .join('');
      wrap.querySelectorAll('.round-item').forEach((b) =>
        b.addEventListener('click', () => launchRound(Number(b.dataset.i)))
      );
    }
  }
  const played = state.playedRounds || [];
  wrap.querySelectorAll('.round-item').forEach((b) => {
    const i = Number(b.dataset.i);
    b.classList.toggle('active', i === state.currentRoundIndex);
    b.classList.toggle('played', played.includes(i));
  });

  // Désactive « Manche suivante » quand toutes les manches sont jouées.
  const nb = document.getElementById('nextRoundBtn');
  if (nb) {
    const done = allRoundsPlayed();
    nb.disabled = state.rounds.length === 0 || done;
    nb.textContent = done ? '✓ Toutes les manches jouées' : '▶ Lancer la manche suivante';
  }
}

// Lance une manche : question + buzzers armés (face-à-face) + musique de manche.
function launchRound(index) {
  cmd('launchRound', { index });
  sound('round');
}

// Lance la prochaine manche non encore jouée. Ne fait rien si tout est joué.
function nextRound() {
  if (!state || !state.rounds.length) return;
  const played = state.playedRounds || [];
  let next = state.rounds.findIndex((_, i) => !played.includes(i) && i > state.currentRoundIndex);
  if (next === -1) next = state.rounds.findIndex((_, i) => !played.includes(i));
  if (next === -1) return; // toutes les manches sont jouées
  launchRound(next);
}

function allRoundsPlayed() {
  const played = state.playedRounds || [];
  return state.rounds.length > 0 && state.rounds.every((_, i) => played.includes(i));
}

function renderBoard() {
  const card = document.getElementById('boardCard');
  const board = state.board;
  card.hidden = !board;
  if (!board) {
    boardSig = '';
    return;
  }

  document.getElementById('boardCardSub').textContent =
    `Manche ${state.currentRoundIndex + 1} (×${board.multiplier})`;
  document.getElementById('curQuestion').textContent = board.question;
  document.getElementById('strikeCount').textContent = `${board.strikes} / 3`;
  document.getElementById('potInfo').textContent = board.pot * board.multiplier;

  // Met en avant l'équipe qui a la main (issue du face-à-face) sur les boutons de cagnotte.
  const act = board.activeTeamIndex;
  const aA = document.getElementById('awardA');
  const aB = document.getElementById('awardB');
  if (aA) aA.classList.toggle('active', act === 0);
  if (aB) aB.classList.toggle('active', act === 1);

  const ctrl = document.getElementById('answersCtrl');
  const sig = board.question + '#' + board.answers.length;
  if (sig !== boardSig) {
    boardSig = sig;
    ctrl.innerHTML = board.answers
      .map(
        (a, i) => `
      <button class="ans-btn" data-i="${i}">
        <span class="ab-rank">${i + 1}</span>
        <span class="ab-text">${escapeHtml(a.text)}</span>
        <span class="ab-pts">${a.points}</span>
        <span class="ab-state">caché</span>
      </button>`
      )
      .join('');
    ctrl.querySelectorAll('.ans-btn').forEach((b) => {
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

  board.answers.forEach((a, i) => {
    const b = ctrl.querySelector(`.ans-btn[data-i="${i}"]`);
    if (!b) return;
    b.classList.toggle('revealed', a.revealed);
    b.querySelector('.ab-state').textContent = a.revealed ? '✓ affiché' : 'caché';
  });
}

const FINAL_STEPS = [
  'Finaliste 1 répond à toutes les questions (lancez le chrono)',
  'Saisissez ses réponses + points dans la colonne « Finaliste 1 »',
  'Révélez ses réponses, puis masquez-les avant le finaliste 2',
  'Finaliste 2 répond aux mêmes questions (sans répéter — sinon « Doublon »)',
  'Révélation finale → comparez le total à l’objectif',
];

/** Étape du guide déduite de l'état (1..5), sans dépendre du serveur. */
function computeFinalStep(fs) {
  const allRevealed = fs.cells.every((p) => p[0].revealed && p[1].revealed);
  if (allRevealed) return 5;
  if (fs.activePlayer === 1) return 4;
  if (fs.cells.some((p) => p[0].revealed)) return 3;
  if (fs.cells.some((p) => p[0].answer)) return 2;
  return 1;
}

function finalTimerRemaining(t) {
  if (!t) return 0;
  if (t.running) return Math.max(0, Math.round((t.endsAt - Date.now()) / 1000));
  return t.remaining || 0;
}

function renderFinal() {
  const card = document.getElementById('finalCard');
  card.hidden = !state.final;
  if (!state.final) return;

  const ctrl = document.getElementById('finalCtrl');
  const fs = state.finalState;
  const startBtn = document.getElementById('startFinalBtn');

  if (!fs) {
    ctrl.innerHTML =
      '<p class="final-hint">Cliquez sur « Démarrer la manche finale ». Les 2 finalistes répondent aux <b>mêmes questions</b>, l’un après l’autre ; l’objectif est d’atteindre la cible de points (200 par défaut).</p>';
    finalLen = -1;
    startBtn.textContent = '▶ Démarrer la manche finale';
    return;
  }
  startBtn.textContent = '↻ Redémarrer la manche finale';

  if (fs.cells.length !== finalLen) {
    finalLen = fs.cells.length;
    ctrl.innerHTML = buildFinalScaffold(fs);
    wireFinalScaffold();
    wireFinalCells(ctrl);
    wireFinalChips(ctrl);
  }
  updateFinalLive(fs, ctrl);
}

function buildFinalScaffold(fs) {
  const steps = FINAL_STEPS.map(
    (s, i) => `<li data-step="${i + 1}"><span class="fs-num">${i + 1}</span>${s}</li>`
  ).join('');

  const questions = fs.questions
    .map((q, qi) => {
      const chips = (q.answers || [])
        .map(
          (a) =>
            `<button class="fchip" data-q="${qi}" data-ans="${escapeAttr(a.text)}" data-pts="${a.points}">${escapeHtml(a.text)} <b>${a.points}</b></button>`
        )
        .join('');
      return `
      <div class="fq" data-q="${qi}">
        <div class="fq__q">Q${qi + 1}. ${escapeHtml(q.question)}</div>
        ${chips ? `<div class="fq__chips" title="Cliquez une réponse pour la donner au finaliste en jeu">${chips}</div>` : ''}
        <div class="fq__cells">
          ${finalCellHtml(qi, 0)}
          ${finalCellHtml(qi, 1)}
        </div>
      </div>`;
    })
    .join('');

  return `
    <div class="final-family">
      <span class="ff-label">🏆 Famille en finale :</span>
      <button class="btn pill" data-ffam="0"></button>
      <button class="btn pill" data-ffam="1"></button>
      <span class="ff-hint">(celle qui a gagné les manches)</span>
    </div>

    <div class="final-status">
      <span class="fstat-label">Au tour de :</span>
      <div class="final-player-switch">
        <button class="btn pill" data-fplayer="0">① Finaliste 1</button>
        <button class="btn pill" data-fplayer="1">② Finaliste 2</button>
      </div>
      <span class="fstat-badge" id="fstatBadge"></span>
    </div>

    <div class="final-names">
      <span class="ff-label">Noms des finalistes :</span>
      <input type="text" class="fname-input" data-fn="0" placeholder="Finaliste 1" maxlength="24" />
      <input type="text" class="fname-input" data-fn="1" placeholder="Finaliste 2" maxlength="24" />
      <span class="ff-hint">(affichés sur l'écran de jeu)</span>
    </div>

    <ol class="final-steps" id="finalSteps">${steps}</ol>

    <div class="final-toolbar">
      <div class="final-timer" id="finalTimer">
        <span class="ft-time" id="ftTime">--</span>
        <button class="btn" id="ftStart" title="Lancer le chrono du finaliste en jeu">▶ Chrono</button>
        <button class="btn" id="ftPause" title="Mettre en pause">⏸</button>
        <button class="btn" id="ftReset" title="Réinitialiser le chrono">↺</button>
      </div>
      <button class="btn btn--gold" id="revealFinalAllBtn">👁️ Révélation finale</button>
    </div>

    <div class="final-progress">
      <div class="fp-bar"><div class="fp-fill" id="fpFill"></div></div>
      <div class="fp-text" id="fpText"></div>
    </div>

    <p class="final-note">💡 Cliquez une réponse, ou tapez-la : en sortant du champ, le <b>score se remplit automatiquement</b> si la réponse est dans la liste (sinon, saisissez les points à la main). Si le finaliste 2 redonne une réponse du finaliste 1, elle est <b>effacée (doublon)</b> avec un buzz — redemandez-en une autre.</p>

    <div class="fq-colheads">
      <span id="fhead0">Finaliste 1</span>
      <span id="fhead1">Finaliste 2</span>
    </div>

    <div class="final-questions">${questions}</div>`;
}

function finalCellHtml(q, col) {
  const dup =
    col === 1
      ? `<button class="btn fc-dup btn--x" title="Marquer comme doublon : efface la réponse + buzz">Doublon</button>`
      : '';
  return `
    <div class="fcell-ctrl" data-q="${q}" data-col="${col}">
      <input type="text" class="fc-answer" placeholder="Réponse finaliste ${col + 1}" />
      <input type="number" class="fc-points" placeholder="pts" min="0" />
      <button class="btn fc-reveal">Afficher</button>
      ${dup}
    </div>`;
}

const normAns = (s) =>
  (s || '').toString().trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * À la sortie du champ : score automatique si la réponse est une proposition,
 * et nettoyage si c'est un doublon du finaliste 1.
 */
function commitFinalAnswer(q, col, answerText) {
  const fs = state.finalState;
  if (!fs) return;
  const ans = normAns(answerText);
  if (!ans) return;
  if (col === 1 && ans === normAns(fs.cells[q][0].answer)) {
    clearFinalCell(q, col);
    return;
  }
  // Score auto seulement si aucun point n'a déjà été saisi (n'écrase pas un choix manuel).
  const props = (fs.questions[q] && fs.questions[q].answers) || [];
  const match = props.find((a) => normAns(a.text) === ans);
  const current = Number(fs.cells[q][col].points) || 0;
  if (match && current === 0) cmd('setFinalCell', { q, col, points: match.points || 0 });
}

function clearFinalCell(q, col) {
  cmd('setFinalCell', { q, col, answer: '', points: 0 });
  cmd('revealFinalCell', { q, col, revealed: false });
  sound('buzzer');
  showFinalToast('⛔ Doublon ! Réponse effacée — demandez-en une autre.');
}

let finalToastTimer;
function showFinalToast(msg) {
  let el = document.getElementById('finalToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'finalToast';
    el.className = 'final-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(finalToastTimer);
  finalToastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

function wireFinalScaffold() {
  document.querySelectorAll('[data-fplayer]').forEach((b) =>
    b.addEventListener('click', () => cmd('setFinalPlayer', { player: Number(b.dataset.fplayer) }))
  );
  document.getElementById('ftStart').addEventListener('click', () => cmd('startFinalTimer', {}));
  document.getElementById('ftPause').addEventListener('click', () => cmd('pauseFinalTimer'));
  document.getElementById('ftReset').addEventListener('click', () => cmd('resetFinalTimer'));
  document.getElementById('revealFinalAllBtn').addEventListener('click', () => {
    cmd('revealFinalAll');
    sound('reveal');
  });
  document.querySelectorAll('[data-ffam]').forEach((b) =>
    b.addEventListener('click', () => cmd('setFinalFamily', { index: Number(b.dataset.ffam) }))
  );
  document.querySelectorAll('.fname-input').forEach((inp) =>
    inp.addEventListener('input', (e) =>
      cmd('setFinalistName', { index: Number(inp.dataset.fn), name: e.target.value })
    )
  );
}

// Chips de réponses prédéfinies : remplit la cellule du finaliste EN JEU.
function wireFinalChips(ctrl) {
  ctrl.querySelectorAll('.fchip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const fs = state.finalState;
      if (!fs) return;
      const q = Number(chip.dataset.q);
      const col = fs.activePlayer; // la réponse va au finaliste en jeu
      cmd('setFinalCell', { q, col, answer: chip.dataset.ans, points: Number(chip.dataset.pts) });
      // Vérifie le doublon (efface si le finaliste 2 reprend une réponse du finaliste 1)
      commitFinalAnswer(q, col, chip.dataset.ans);
    });
  });
}

function wireFinalCells(ctrl) {
  ctrl.querySelectorAll('.fcell-ctrl').forEach((cell) => {
    const q = Number(cell.dataset.q);
    const col = Number(cell.dataset.col);
    const ansInput = cell.querySelector('.fc-answer');
    ansInput.addEventListener('input', (e) => cmd('setFinalCell', { q, col, answer: e.target.value }));
    // À la sortie du champ : score auto si réponse connue, ou nettoyage si doublon.
    ansInput.addEventListener('change', (e) => commitFinalAnswer(q, col, e.target.value));
    cell.querySelector('.fc-points').addEventListener('input', (e) =>
      cmd('setFinalCell', { q, col, points: Number(e.target.value) })
    );
    cell.querySelector('.fc-reveal').addEventListener('click', () => {
      const cs = state.finalState.cells[q][col];
      const revealed = !cs.revealed;
      cmd('revealFinalCell', { q, col, revealed });
      // Son uniquement à la révélation. Points attendus déduits de la proposition
      // (évite un mauvais son si le score auto n'est pas encore synchronisé).
      if (revealed) {
        const props = (state.finalState.questions[q] && state.finalState.questions[q].answers) || [];
        const m = props.find((a) => normAns(a.text) === normAns(cs.answer));
        const pts = m ? m.points || 0 : Number(cs.points) || 0;
        sound(pts > 0 ? 'reveal' : 'wrong');
      }
    });
    const dupBtn = cell.querySelector('.fc-dup');
    if (dupBtn) dupBtn.addEventListener('click', () => clearFinalCell(q, col));
  });
}

function updateFinalLive(fs, ctrl) {
  // Finaliste en jeu
  document.querySelectorAll('[data-fplayer]').forEach((b) =>
    b.classList.toggle('active', Number(b.dataset.fplayer) === fs.activePlayer)
  );
  const badge = document.getElementById('fstatBadge');
  if (badge) badge.textContent = `Finaliste ${fs.activePlayer + 1} en jeu`;

  // Famille en finale (gagnante des manches) — score affiché pour repérer la gagnante.
  document.querySelectorAll('[data-ffam]').forEach((b) => {
    const i = Number(b.dataset.ffam);
    const t = state.teams[i];
    b.textContent = t ? `${t.name} (${t.score})` : `Équipe ${i + 1}`;
    b.classList.toggle('active', i === fs.familyIndex);
  });

  // Noms personnalisés des finalistes (sans casser la saisie en cours)
  const names = fs.finalistNames || ['', ''];
  document.querySelectorAll('.fname-input').forEach((inp) => {
    const i = Number(inp.dataset.fn);
    if (document.activeElement !== inp) inp.value = names[i] || '';
  });
  const label0 = names[0] ? names[0] : 'Finaliste 1';
  const label1 = names[1] ? names[1] : 'Finaliste 2';

  // Guide pas-à-pas
  const step = computeFinalStep(fs);
  document.querySelectorAll('#finalSteps li').forEach((li) =>
    li.classList.toggle('active', Number(li.dataset.step) === step)
  );

  // Sous-totaux par finaliste + en-têtes (doublons exclus)
  const sub0 = fs.cells.reduce((s, p) => s + (p[0].revealed ? p[0].points : 0), 0);
  const sub1 = fs.cells.reduce((s, p) => s + (p[1].revealed ? p[1].points : 0), 0);
  const h0 = document.getElementById('fhead0');
  const h1 = document.getElementById('fhead1');
  if (h0) h0.textContent = `${label0} — ${sub0} pts`;
  if (h1) h1.textContent = `${label1} — ${sub1} pts`;

  // Barre de progression
  const pct = Math.min(100, fs.target ? (fs.total / fs.target) * 100 : 0);
  const fill = document.getElementById('fpFill');
  const text = document.getElementById('fpText');
  if (fill) {
    fill.style.width = pct + '%';
    fill.classList.toggle('done', fs.total >= fs.target);
  }
  if (text) {
    text.textContent =
      fs.total >= fs.target
        ? `🎉 OBJECTIF ATTEINT ! ${fs.total} / ${fs.target} pts`
        : `TOTAL ${fs.total} / ${fs.target} — il manque ${fs.target - fs.total} pts`;
    text.classList.toggle('done', fs.total >= fs.target);
  }

  updateFinalTimerDisplay(fs);

  // Cellules (sans casser la saisie en cours)
  fs.cells.forEach((pair, q) => {
    pair.forEach((c, col) => {
      const cell = ctrl.querySelector(`.fcell-ctrl[data-q="${q}"][data-col="${col}"]`);
      if (!cell) return;
      const ans = cell.querySelector('.fc-answer');
      const pts = cell.querySelector('.fc-points');
      if (document.activeElement !== ans) ans.value = c.answer;
      if (document.activeElement !== pts) pts.value = c.points || '';
      cell.querySelector('.fc-reveal').classList.toggle('on', c.revealed);
      cell.classList.toggle('is-active', col === fs.activePlayer);
      const dupBtn = cell.querySelector('.fc-dup');
      // Bouton « Doublon » (efface) activable dès qu'une réponse du finaliste 2 existe.
      if (dupBtn) dupBtn.disabled = !(c.answer && c.answer.trim());
    });
  });

  // Marque les chips déjà attribuées (et par quel finaliste).
  const norm = normAns;
  ctrl.querySelectorAll('.fchip').forEach((chip) => {
    const q = Number(chip.dataset.q);
    const a = norm(chip.dataset.ans);
    const pair = fs.cells[q];
    chip.classList.toggle('used-0', a !== '' && norm(pair[0].answer) === a);
    chip.classList.toggle('used-1', a !== '' && norm(pair[1].answer) === a);
  });
}

function updateFinalTimerDisplay(fs) {
  const el = document.getElementById('ftTime');
  if (!el || !fs || !fs.timer) return;
  const t = fs.timer;
  const idle = !t.running && !t.remaining;
  // Au repos, on pré-affiche le temps imparti du finaliste en jeu (20 ou 25 s).
  const val = idle ? (fs.timers?.[fs.activePlayer] ?? 0) : finalTimerRemaining(t);
  el.textContent = String(val).padStart(2, '0');
  el.classList.toggle('running', t.running);
  el.classList.toggle('idle', idle);
  el.classList.toggle('low', t.running && val <= 5);

  // « Reprendre » si le chrono est en pause avec du temps restant (même finaliste).
  const startBtn = document.getElementById('ftStart');
  if (startBtn) {
    const paused = !t.running && t.remaining > 0 && t.player === fs.activePlayer;
    startBtn.textContent = paused ? '▶ Reprendre' : '▶ Chrono';
  }
}

// Décompte fluide du chrono côté régie (l'autorité reste le serveur via endsAt).
setInterval(() => {
  if (state && state.finalState) updateFinalTimerDisplay(state.finalState);
}, 250);

// ------------------------------------------------------------------ //
//  Utilitaires
// ------------------------------------------------------------------ //
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}
