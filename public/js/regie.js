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
// Équipe qui a la main : déduite du buzz, corrigeable (face-à-face gagné par l'autre équipe, passe…).
document.querySelectorAll('[data-main]').forEach((b) =>
  b.addEventListener('click', () => cmd('setActiveTeam', { index: Number(b.dataset.main) }))
);

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

  // Manche finale à l'écran : Entrée, Espace et 1…9 pilotent l'assistant.
  if (state && state.view === 'final' && state.finalState && finalShortcut(k)) return e.preventDefault();

  // Manche : 1…9 = la réponse n°, Entrée = action principale de l'étape (assistant)
  if (state && state.board && state.view !== 'final') {
    if (/^[1-9]$/.test(k)) return roundAnswerClick(Number(k) - 1), e.preventDefault();
    if (k === 'Enter') return runRoundPrimary() && e.preventDefault();
  }

  switch (k) {
    case 'x': case 'X':
      roundMiss(); e.preventDefault(); break;
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

  // Pendant le jeu, les autres cartes s'estompent : la manche en cours (ou la finale) reste nette.
  const grid = document.querySelector('main.grid');
  grid.classList.toggle('focus-board', !!state.board && (state.view === 'question' || state.view === 'board'));
  grid.classList.toggle('focus-final', !!state.final && state.view === 'final');
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
      st.textContent = `✋ ${t ? t.name : 'Équipe ' + (bz.winner + 1)} a buzzé en premier : elle répond d'abord. La main va à la réponse la mieux classée (corrigez « La main » sur le plateau si besoin).`;
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
  document.querySelectorAll('[data-main]').forEach((b) => {
    const i = Number(b.dataset.main);
    b.textContent = teamName(i);
    b.classList.toggle('active', act === i);
  });

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
        <span class="ab-who"></span>
        <span class="ab-pts">${a.points}</span>
        <span class="ab-state">caché</span>
      </button>`
      )
      .join('');
    ctrl.querySelectorAll('.ans-btn').forEach((b) =>
      b.addEventListener('click', () => roundAnswerClick(Number(b.dataset.i)))
    );
    document.getElementById('rwInput').value = '';
    updateRoundHint();
  }

  const fo = faceoffOf(board);
  board.answers.forEach((a, i) => {
    const b = ctrl.querySelector(`.ans-btn[data-i="${i}"]`);
    if (!b) return;
    b.classList.toggle('revealed', a.revealed);
    b.querySelector('.ab-state').textContent = a.revealed ? '✓ affiché' : 'caché';
    // Qui l'a trouvée au face-à-face
    const who = [0, 1].find((t) => fo.answers[t] === i);
    const whoEl = b.querySelector('.ab-who');
    whoEl.textContent = who !== undefined ? teamName(who) : '';
    whoEl.title = who !== undefined ? `Trouvée au face-à-face par ${teamName(who)}` : '';
  });
  ctrl.dataset.phase = roundPhase(board);
  renderRoundGuide(board);
}

// ------------------------------------------------------------------ //
//  Manche : assistant (face-à-face → jeu → vol → fin de manche)
// ------------------------------------------------------------------ //
// Mêmes étapes que ROUND_PHASES côté serveur.
const ROUND_PHASES = ['faceoff', 'play', 'steal', 'done'];
const teamName = (i) => (state.teams[i] ? state.teams[i].name : `Équipe ${i + 1}`);
const roundPhase = (b) => b.phase || 'faceoff';
const faceoffOf = (b) => b.faceoff || { first: null, answers: [null, null], winner: null };

/** Équipe qui répond en premier au face-à-face : choix de la régie, sinon le buzz. */
function faceoffFirst(b) {
  const fo = faceoffOf(b);
  if (fo.first != null) return fo.first;
  const w = state.buzzer && state.buzzer.winner;
  return w === 0 || w === 1 ? w : null;
}

/** Équipe dont on attend la réponse au face-à-face (null : décidé, ou premier inconnu). */
function faceoffResponder(b) {
  const fo = faceoffOf(b);
  const first = faceoffFirst(b);
  if (first == null || fo.winner != null) return null;
  if (fo.answers[first] == null) return first;
  if (fo.answers[1 - first] == null) return 1 - first;
  return null; // les deux ont raté
}

/** Clic sur une réponse du tableau (ou touche 1…9) : son effet dépend de l'étape. */
function roundAnswerClick(i) {
  const b = state.board;
  const a = b && b.answers[i];
  if (!a) return;
  const phase = roundPhase(b);
  if (phase === 'faceoff') {
    const team = faceoffResponder(b);
    if (team == null) {
      showToast(
        faceoffFirst(b) == null
          ? "Indiquez d'abord l'équipe qui a buzzé."
          : 'Face-à-face terminé : choisissez « joue » ou « passe ».'
      );
      return;
    }
    if (a.revealed) return showToast('Déjà au tableau : le joueur doit donner une autre réponse.');
    cmd('faceoffAnswer', { team, index: i });
    sound('reveal');
    return;
  }
  if (phase === 'steal') {
    if (a.revealed) return showToast('Déjà au tableau : cette réponse ne permet pas de voler.');
    cmd('stealResult', { index: i }); // vol réussi : la famille qui vole rafle la cagnotte
    sound('reveal');
    setTimeout(() => sound('points'), 900);
    return;
  }
  // Jeu (ou fin de manche) : révéler / masquer
  if (a.revealed) cmd('hideAnswer', { index: i });
  else {
    cmd('revealAnswer', { index: i });
    sound('reveal');
  }
}

/** Réponse absente du tableau (bouton, touche X) : son effet dépend de l'étape. */
function roundMiss() {
  const b = state.board;
  if (!b) return;
  const phase = roundPhase(b);
  if (phase === 'faceoff') {
    const team = faceoffResponder(b);
    if (team == null) return showToast("Indiquez d'abord l'équipe qui a buzzé.");
    cmd('faceoffAnswer', { team, index: -1 });
    sound('wrong');
  } else if (phase === 'steal') {
    cmd('stealResult', { index: -1 }); // vol raté : la cagnotte revient à la famille qui jouait
    sound('wrong');
    setTimeout(() => sound('points'), 900);
  } else if (phase === 'play') {
    cmd('addStrike');
    sound('wrong');
  }
}

/** Champ « ce que dit le joueur » : réponse du tableau correspondante. */
function roundMatch(text) {
  return state.board ? matchAnswer(state.board.answers, text) : null;
}

function updateRoundHint() {
  const hint = document.getElementById('rwHint');
  const text = document.getElementById('rwInput').value;
  const b = state.board;
  document.querySelectorAll('#answersCtrl .ans-btn').forEach((el) => el.classList.remove('match'));
  if (!b || !text.trim()) {
    hint.className = 'rw-say__hint';
    hint.textContent = '';
    return;
  }
  const m = roundMatch(text);
  const phase = roundPhase(b);
  const missLabel = phase === 'faceoff' ? 'pas au tableau' : phase === 'steal' ? 'vol raté' : 'faute (X)';
  if (m) {
    const el = document.querySelector(`#answersCtrl .ans-btn[data-i="${m.i}"]`);
    if (el) el.classList.add('match');
  }
  if (m && !b.answers[m.i].revealed) {
    hint.className = 'rw-say__hint ok';
    hint.textContent = `${m.exact ? '✓' : '≈'} n°${m.i + 1} ${m.a.text} (${m.a.points}) — Entrée pour la révéler`;
  } else if (m) {
    hint.className = 'rw-say__hint miss';
    hint.textContent = `Déjà au tableau (n°${m.i + 1}) — Entrée = ${phase === 'faceoff' ? 'redemander' : missLabel}`;
  } else {
    hint.className = 'rw-say__hint miss';
    hint.textContent = `Pas au tableau — Entrée = ${missLabel}`;
  }
}

function submitRoundInput() {
  const inp = document.getElementById('rwInput');
  const text = inp.value;
  if (!text.trim()) return runRoundPrimary();
  const b = state.board;
  if (!b) return;
  const m = roundMatch(text);
  if (m && !b.answers[m.i].revealed) roundAnswerClick(m.i);
  else if (m && roundPhase(b) === 'faceoff') return showToast('Déjà au tableau : le joueur doit donner une autre réponse.');
  else roundMiss(); // absente, ou déjà trouvée : faute
  inp.value = '';
  updateRoundHint();
}

/** Prochaine étape après une manche : manche suivante, finale, ou victoire. */
function roundNextStep(primary) {
  if (!allRoundsPlayed()) return { label: '▶ Manche suivante', cls: 'btn--gold', primary, fn: nextRound };
  if (state.final) {
    return {
      label: '⭐ Démarrer la manche finale',
      cls: 'btn--gold',
      primary,
      fn: () => {
        document.getElementById('startFinalBtn').click();
        // Action explicite : on descend jusqu'à la carte de la finale, en bas de page.
        setTimeout(() => document.getElementById('finalCard').scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
      },
    };
  }
  const lead = state.teams[1].score > state.teams[0].score ? 1 : 0;
  return { label: `🏆 Victoire : ${teamName(lead)}`, cls: 'btn--gold', primary, fn: () => cmd('setWinner', { index: lead }) };
}

/** Consigne du moment : titre, explication et actions possibles. */
function roundGuide(b) {
  const phase = roundPhase(b);
  const fo = faceoffOf(b);
  const act = b.activeTeamIndex;
  const said = (i) => (i >= 0 ? `« ${b.answers[i].text} » (n°${i + 1})` : 'pas au tableau');
  const pot = b.multiplier > 1 ? `${b.pot * b.multiplier} pts (${b.pot} × ${b.multiplier})` : `${b.pot} pts`;

  if (phase === 'faceoff') {
    const first = faceoffFirst(b);
    if (first == null) {
      return {
        title: '① Face-à-face : qui a buzzé ?',
        sub: state.buzzer && state.buzzer.armed
          ? 'Buzzers armés : en attente du premier buzz… Sans buzzers, indiquez l\'équipe la plus rapide.'
          : 'Indiquez l\'équipe la plus rapide, ou armez les buzzers.',
        actions: [
          { label: `✋ ${teamName(0)}`, fn: () => cmd('faceoffFirst', { team: 0 }) },
          { label: `✋ ${teamName(1)}`, fn: () => cmd('faceoffFirst', { team: 1 }) },
          { label: '🟢 Armer les buzzers', fn: () => cmd('armBuzzer') },
        ],
      };
    }
    if (fo.winner != null) {
      const w = fo.winner;
      const l = 1 - w;
      const why =
        fo.answers[l] == null
          ? `Réponse n°1 du tableau : ${said(fo.answers[w])} !`
          : `${teamName(w)} : ${said(fo.answers[w])} · ${teamName(l)} : ${said(fo.answers[l])}.`;
      return {
        title: `① ${teamName(w)} gagne le face-à-face`,
        sub: `${why} Joue ou passe ?`,
        actions: [
          { label: `▶ ${teamName(w)} joue`, cls: 'btn--gold', primary: true, fn: () => cmd('playOrPass', { pass: false }) },
          { label: `↪ Passe la main à ${teamName(l)}`, fn: () => cmd('playOrPass', { pass: true }) },
          { label: '⟲ Recommencer', fn: () => cmd('faceoffReset') },
        ],
      };
    }
    const resp = faceoffResponder(b);
    if (resp == null) {
      return {
        title: '① Aucune réponse au tableau',
        sub: 'Personne ne prend la main : on rejoue le face-à-face avec les deux joueurs suivants.',
        actions: [{ label: '⟲ Rejouer le face-à-face', cls: 'btn--gold', primary: true, fn: () => cmd('faceoffReset') }],
      };
    }
    const prev = fo.answers[first];
    return {
      title: `① Face-à-face : réponse de ${teamName(resp)}`,
      sub:
        resp === first
          ? `${teamName(resp)} a buzzé. Cliquez sa réponse au tableau, tapez-la, ou « Pas au tableau ». La réponse n°1 gagne directement.`
          : `${teamName(first)} : ${said(prev)}. À ${teamName(resp)} : il lui faut ${prev >= 0 ? 'une réponse mieux classée' : 'une réponse au tableau'} pour prendre la main.`,
      actions: [
        { label: '✗ Pas au tableau', cls: 'btn--x', fn: roundMiss },
        { label: '⟲ Recommencer', fn: () => cmd('faceoffReset') },
      ],
    };
  }

  if (phase === 'play') {
    const found = b.answers.filter((a) => a.revealed).length;
    const n = b.answers.length;
    if (found === n) {
      return {
        title: '② Tableau complet !',
        sub: `${teamName(act)} a tout trouvé : elle remporte la manche, sans vol.`,
        actions: [{ label: `🏆 Donner ${pot} à ${teamName(act)}`, cls: 'btn--gold', primary: true, fn: () => award(act ?? 0) }],
      };
    }
    return {
      title: `② ${act != null ? teamName(act) : 'La famille'} joue`,
      sub: `${found} / ${n} réponses trouvées · ${b.strikes} X sur 3 · cagnotte : ${pot}. Chaque joueur répond à son tour.`,
      actions: [{ label: '✗ Faute (X)', cls: 'btn--x', fn: roundMiss }],
    };
  }

  if (phase === 'steal') {
    const thief = act != null ? 1 - act : null;
    return {
      title: `③ Vol : ${thief != null ? teamName(thief) : "l'adversaire"} tente sa chance`,
      sub: `${thief != null ? teamName(thief) : "L'adversaire"} se concerte et donne UNE réponse. Au tableau : elle rafle ${pot}. Sinon, la cagnotte revient à ${teamName(act)}.`,
      actions: [{ label: `✗ Vol raté : cagnotte à ${teamName(act)}`, cls: 'btn--x', fn: roundMiss }],
    };
  }

  // Fin de manche
  const won = b.awarded != null ? b.awarded : act;
  const rest = b.answers.some((a) => !a.revealed);
  const actions = [];
  if (rest) actions.push({ label: '👁 Révéler le reste', primary: true, fn: () => { cmd('revealAll'); sound('reveal'); } });
  actions.push(roundNextStep(!rest));
  return {
    title: `④ ${won != null ? teamName(won) : 'La famille'} remporte la manche`,
    sub: `+${b.awardedValue || 0} pts. ${rest ? 'Révélez les réponses restantes pour le public (elles ne rapportent plus rien), puis passez à la suite.' : 'Passez à la suite.'}`,
    actions,
  };
}

let roundActions = [];
let roundActionsSig = '';

function renderRoundGuide(b) {
  const g = roundGuide(b);
  document.getElementById('rwTitle').textContent = g.title;
  document.getElementById('rwSub').textContent = g.sub;
  roundActions = g.actions;
  const sig = g.actions.map((a) => `${a.label}|${a.cls || ''}|${a.primary ? 1 : 0}`).join('#');
  if (sig !== roundActionsSig) {
    roundActionsSig = sig;
    const box = document.getElementById('rwActions');
    box.innerHTML = g.actions
      .map(
        (a, k) =>
          `<button class="btn ${a.cls || ''}${a.primary ? ' rw-primary' : ''}" data-k="${k}">${escapeHtml(a.label)}${a.primary ? ' <kbd>Entrée</kbd>' : ''}</button>`
      )
      .join('');
    box.querySelectorAll('[data-k]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const a = roundActions[Number(btn.dataset.k)];
        if (a) a.fn();
        btn.blur();
      })
    );
  }
  const idx = ROUND_PHASES.indexOf(roundPhase(b));
  document.querySelectorAll('[data-rphase]').forEach((s, i) => {
    s.classList.toggle('active', i === idx);
    s.classList.toggle('done', i < idx);
  });
  document.getElementById('rwGuide').dataset.phase = roundPhase(b);
}

/** Entrée : l'action principale de l'étape en cours. */
function runRoundPrimary() {
  const a = roundActions.find((x) => x.primary);
  if (a) a.fn();
  return !!a;
}

document.querySelectorAll('[data-rphase]').forEach((s) =>
  s.addEventListener('click', () => cmd('setRoundPhase', { phase: s.dataset.rphase }))
);
document.getElementById('rwInput').addEventListener('input', updateRoundHint);
document.getElementById('rwInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    submitRoundInput();
  }
});

// ------------------------------------------------------------------ //
//  Manche finale : assistant pas à pas
// ------------------------------------------------------------------ //
// Mêmes étapes que FINAL_PHASES côté serveur.
const FINAL_PHASES = [
  { id: 'setup', label: 'Préparation' },
  { id: 'answer1', label: 'Finaliste 1 répond' },
  { id: 'reveal1', label: 'Ses réponses' },
  { id: 'answer2', label: 'Finaliste 2 répond' },
  { id: 'reveal2', label: 'Révélation finale' },
];

// Saisie en direct (état propre à cette régie) : question en cours, questions
// « passées » par chaque finaliste, points corrigés à la main.
let fCursor = 0;
let fCursorKey = '';
const fSkipped = [new Set(), new Set()];
let fPointsTouched = false;

const finalPhase = (fs) => fs.phase || 'setup';
const finalCol = (fs) => (['answer2', 'reveal2'].includes(finalPhase(fs)) ? 1 : 0);
const finalistName = (fs, i) => (fs.finalistNames && fs.finalistNames[i]) || `Finaliste ${i + 1}`;
const hasAnswer = (c) => !!(c && c.answer && c.answer.trim());
const ptsLabel = (n) => `${n} pt${n > 1 ? 's' : ''}`;

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
      '<p class="final-hint">Cliquez sur « Démarrer la manche finale » : un assistant vous guide ensuite étape par étape (préparation, réponses du finaliste 1, révélation, réponses du finaliste 2, révélation finale).</p>';
    finalLen = -1;
    startBtn.textContent = '▶ Démarrer la manche finale';
    startBtn.classList.add('btn--gold');
    return;
  }
  startBtn.textContent = '↻ Recommencer la finale';
  startBtn.classList.remove('btn--gold');

  if (fs.cells.length !== finalLen) {
    finalLen = fs.cells.length;
    fCursorKey = '';
    ctrl.innerHTML = buildFinalScaffold(fs);
    wireFinalScaffold(ctrl);
    wireFinalCells(ctrl);
    wireFinalChips(ctrl);
  }
  updateFinalWizard(fs, ctrl);
  updateFinalLive(fs, ctrl);
}

function buildFinalScaffold(fs) {
  const steps = FINAL_PHASES.map(
    (p, i) =>
      `<button class="fw-step" data-goto="${p.id}"><span class="fw-step__n">${i + 1}</span><span class="fw-step__l" data-step-label="${p.id}">${p.label}</span></button>`
  ).join('');

  const revealRows = (withFirst) =>
    fs.questions
      .map(
        (q, qi) => `
        <li class="fw-rrow" data-q="${qi}">
          <span class="fw-rrow__n">Q${qi + 1}</span>
          <span class="fw-rrow__q">${escapeHtml(q.question)}</span>
          ${withFirst ? '<span class="fw-rrow__first" data-first></span>' : ''}
          <span class="fw-rrow__a" data-ans></span>
          <input type="number" class="fw-rrow__pts" min="0" data-pts title="Points (modifiables)" />
          <button class="btn fw-rrow__btn" data-rev></button>
        </li>`
      )
      .join('');

  const qlist = fs.questions
    .map(
      (q, qi) =>
        `<li data-q="${qi}"><span class="fw-ql__n">Q${qi + 1}</span><span class="fw-ql__q">${escapeHtml(q.question)}</span><span class="fw-ql__a" data-ql-ans></span></li>`
    )
    .join('');

  // Tableau complet (ancienne vue) : repli pour corriger n'importe quelle case.
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
    <nav class="fw-steps">${steps}</nav>

    <div class="final-progress">
      <div class="fp-bar"><div class="fp-fill" id="fpFill"></div></div>
      <div class="fp-text" id="fpText"></div>
    </div>

    <section class="fw-panel" data-panel="setup">
      <div class="final-family">
        <span class="ff-label">🏆 Famille en finale :</span>
        <button class="btn pill" data-ffam="0"></button>
        <button class="btn pill" data-ffam="1"></button>
        <span class="ff-hint">(présélection : la famille qui mène)</span>
      </div>
      <div class="final-names">
        <span class="ff-label">Noms des finalistes :</span>
        <input type="text" class="fname-input" data-fn="0" placeholder="Finaliste 1" maxlength="24" />
        <input type="text" class="fname-input" data-fn="1" placeholder="Finaliste 2" maxlength="24" />
        <span class="ff-hint">(affichés sur l'écran de jeu)</span>
      </div>
      <ul class="fw-facts">
        <li><b>${fs.cells.length} questions</b>, les mêmes pour les deux finalistes</li>
        <li>Objectif : <b>${fs.target} points</b> à eux deux</li>
        <li>Chrono : <b>${fs.timers[0]} s</b> pour le 1er, <b>${fs.timers[1]} s</b> pour le 2e</li>
      </ul>
      <p class="fw-callout">🎧 Isolez le 2e finaliste (coulisses, casque) : il ne doit entendre ni les questions ni les réponses du 1er.</p>
      <div class="fw-foot">
        <span class="fw-foot__hint">Raccourci : <kbd>Entrée</kbd></span>
        <button class="btn btn--gold fw-big" id="fwStart">▶ C'est parti : <span data-fname="0"></span> répond</button>
      </div>
    </section>

    <section class="fw-panel" data-panel="answer">
      <div class="fw-head">
        <div class="fw-who"><span class="fw-who__k">Au micro</span><span class="fw-who__v" id="fwWho"></span></div>
        <div class="final-timer fw-timer" id="finalTimer">
          <span class="ft-time" id="ftTime">--</span>
          <button class="btn btn--gold" id="ftStart" title="Lancer le chrono (Espace)">▶ Lancer le chrono</button>
          <button class="btn" id="ftPause" title="Pause (Espace)">⏸</button>
          <button class="btn" id="ftReset" title="Remettre le chrono à zéro">↺</button>
        </div>
      </div>
      <div class="fw-timeup" id="fwTimeUp" hidden>⌛ Temps écoulé : passez à la révélation des réponses.</div>
      <div class="fw-entry">
        <div class="fw-q"><span class="fw-q__n" id="fwQNum"></span><span class="fw-q__t" id="fwQText"></span></div>
        <div class="fw-first" id="fwFirst" hidden></div>
        <div class="fw-chips" id="fwChips"></div>
        <div class="fw-input">
          <input type="text" id="fwAnswer" autocomplete="off" spellcheck="false" placeholder="Réponse du finaliste, puis Entrée" />
          <input type="number" id="fwPoints" min="0" placeholder="pts" title="Points : remplis automatiquement si la réponse est au tableau" />
          <button class="btn btn--gold" id="fwValidate">✓ Valider</button>
          <button class="btn" id="fwSkip" title="Le finaliste passe : on y revient s'il reste du temps">⏭ Passer</button>
          <button class="btn btn--x" id="fwDup" title="Réponse déjà donnée par le 1er finaliste : buzz, on redemande">⛔ Doublon</button>
        </div>
        <div class="fw-match" id="fwMatch"></div>
      </div>
      <ol class="fw-qlist" id="fwQList">${qlist}</ol>
      <div class="fw-foot">
        <span class="fw-foot__hint" id="fwAnswerHint"></span>
        <button class="btn btn--gold fw-big" id="fwToReveal"></button>
      </div>
    </section>

    <section class="fw-panel" data-panel="reveal1">
      <p class="fw-lead">L'animateur reprend chaque réponse : révélez-la quand il demande le score.</p>
      <ol class="fw-rlist">${revealRows(false)}</ol>
      <div class="fw-foot">
        <span class="fw-foot__hint" id="fwR1Hint"></span>
        <button class="btn btn--gold fw-big" id="fwR1Next"></button>
      </div>
    </section>

    <section class="fw-panel" data-panel="reveal2">
      <p class="fw-lead" id="fwR2Lead"></p>
      <ol class="fw-rlist">${revealRows(true)}</ol>
      <div class="fw-verdict" id="fwVerdict"></div>
      <div class="fw-foot">
        <button class="btn" id="revealFinalAllBtn">👁️ Tout révéler d'un coup</button>
        <button class="btn btn--gold fw-big" id="fwR2Next"></button>
      </div>
    </section>

    <details class="fw-manual">
      <summary>✏️ Tableau complet : corriger une réponse ou des points</summary>
      <p class="final-note">💡 Cliquez une réponse, ou tapez-la : en sortant du champ, le <b>score se remplit automatiquement</b> si la réponse est dans la liste. Les propositions vont au finaliste en jeu.</p>
      <div class="fq-colheads">
        <span id="fhead0">Finaliste 1</span>
        <span id="fhead1">Finaliste 2</span>
      </div>
      <div class="final-questions">${questions}</div>
    </details>`;
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
 * Réponse attendue correspondant à un texte saisi : égalité (accents et casse
 * ignorés), sinon inclusion dans un seul sens ou l'autre (« pentest » ≈
 * « Test d'intrusion (pentest) »), à condition qu'une seule proposition colle.
 */
function matchAnswer(props, text) {
  const t = normAns(text);
  if (!t) return null;
  const exact = props.findIndex((a) => normAns(a.text) === t);
  if (exact >= 0) return { i: exact, a: props[exact], exact: true };
  if (t.length < 3) return null;
  const close = props
    .map((a, i) => ({ a, i, n: normAns(a.text) }))
    .filter(({ n }) => n.includes(t) || t.includes(n));
  return close.length === 1 ? { i: close[0].i, a: close[0].a, exact: false } : null;
}

function finalMatch(q, text) {
  return matchAnswer((state.finalState.questions[q] && state.finalState.questions[q].answers) || [], text);
}

/** Doublon : même texte que le finaliste 1, ou même réponse du tableau. */
function isFinalDuplicate(q, text) {
  const first = state.finalState.cells[q][0].answer;
  if (!normAns(first) || !normAns(text)) return false;
  if (normAns(first) === normAns(text)) return true;
  const a = finalMatch(q, text);
  const b = finalMatch(q, first);
  return !!(a && b && a.i === b.i);
}

/**
 * Tableau complet, à la sortie du champ : score automatique si la réponse est
 * une proposition, et nettoyage si c'est un doublon du finaliste 1.
 */
function commitFinalAnswer(q, col, answerText) {
  const fs = state.finalState;
  if (!fs) return;
  if (!normAns(answerText)) return;
  if (col === 1 && isFinalDuplicate(q, answerText)) {
    clearFinalCell(q, col);
    return;
  }
  // Score auto seulement si aucun point n'a déjà été saisi (n'écrase pas un choix manuel).
  const match = finalMatch(q, answerText);
  const current = Number(fs.cells[q][col].points) || 0;
  if (match && current === 0) cmd('setFinalCell', { q, col, points: match.a.points || 0 });
}

function clearFinalCell(q, col) {
  cmd('setFinalCell', { q, col, answer: '', points: 0 });
  cmd('revealFinalCell', { q, col, revealed: false });
  sound('buzzer');
  showToast('⛔ Doublon ! Réponse effacée : demandez-en une autre.');
}

let finalToastTimer;
function showToast(msg) {
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

// ---- Assistant : saisie des réponses ----

/** Prochaine question à saisir après `from` : d'abord les vides, puis les « passées ». */
function nextFinalQuestion(fs, col, from, justFilled = -1) {
  const n = fs.cells.length;
  const empty = (q) => q !== justFilled && !hasAnswer(fs.cells[q][col]);
  for (const withSkipped of [false, true]) {
    for (let k = 1; k <= n; k++) {
      const q = (((from + k) % n) + n) % n;
      if (empty(q) && (withSkipped || !fSkipped[col].has(q))) return q;
    }
  }
  return from < 0 ? 0 : from; // tout est saisi : on reste où l'on est
}

/** Affiche la question en cours : énoncé, propositions, réponse déjà saisie. */
function loadFinalCursor(fs, col) {
  const q = fCursor;
  const qd = fs.questions[q] || { question: '', answers: [] };
  document.getElementById('fwQNum').textContent = `Q${q + 1} / ${fs.cells.length}`;
  document.getElementById('fwQText').textContent = qd.question;
  const chips = document.getElementById('fwChips');
  chips.innerHTML = (qd.answers || [])
    .map((a, i) => `<button class="fchip" data-i="${i}">${escapeHtml(a.text)} <b>${a.points}</b></button>`)
    .join('');
  chips.querySelectorAll('.fchip').forEach((b) =>
    b.addEventListener('click', () => {
      const a = qd.answers[Number(b.dataset.i)];
      validateFinalAnswer(a.text, a.points || 0);
    })
  );
  const c = fs.cells[q][col];
  document.getElementById('fwAnswer').value = c.answer || '';
  document.getElementById('fwPoints').value = hasAnswer(c) ? c.points || 0 : '';
  fPointsTouched = false;
  updateFinalMatch();
}

/** Aide en direct sous le champ : réponse reconnue, doublon, ou absente du tableau. */
function updateFinalMatch() {
  const fs = state.finalState;
  if (!fs) return;
  const col = finalCol(fs);
  const text = document.getElementById('fwAnswer').value;
  const typed = !!text.trim();
  const m = typed ? finalMatch(fCursor, text) : null;
  const dup = typed && col === 1 && isFinalDuplicate(fCursor, text);
  if (!fPointsTouched) document.getElementById('fwPoints').value = typed ? (m ? m.a.points : 0) : '';
  document.querySelectorAll('#fwChips .fchip').forEach((b) =>
    b.classList.toggle('match', !!m && Number(b.dataset.i) === m.i)
  );
  const hint = document.getElementById('fwMatch');
  hint.className = 'fw-match' + (dup ? ' dup' : m ? ' ok' : typed ? ' miss' : '');
  hint.textContent = !typed
    ? 'Cliquez une proposition, ou tapez la réponse puis Entrée.'
    : dup
      ? `⛔ Doublon : ${finalistName(fs, 0)} a déjà donné cette réponse.`
      : m
        ? `${m.exact ? '✓' : '≈'} ${m.a.text} : ${ptsLabel(m.a.points)}`
        : 'Pas au tableau : 0 point (ou saisissez les points à la main).';
}

function focusFinalAnswer() {
  const inp = document.getElementById('fwAnswer');
  if (inp) inp.focus();
}

/** Enregistre la réponse de la question en cours et passe à la suivante. */
function validateFinalAnswer(text, points) {
  const fs = state.finalState;
  if (!fs) return;
  const col = finalCol(fs);
  const q = fCursor;
  const answer = (text || '').trim();
  if (!answer) return;
  if (col === 1 && isFinalDuplicate(q, answer)) return flagFinalDuplicate();
  let pts = points;
  if (pts === undefined) {
    const raw = document.getElementById('fwPoints').value;
    const m = finalMatch(q, answer);
    pts = fPointsTouched && raw !== '' ? Number(raw) : m ? m.a.points : 0;
  }
  cmd('setFinalCell', { q, col, answer, points: Math.max(0, Number(pts) || 0) });
  fSkipped[col].delete(q);
  fCursor = nextFinalQuestion(fs, col, q, q);
  loadFinalCursor(fs, col);
  focusFinalAnswer();
}

/** Doublon : buzz, on vide la réponse et on reste sur la question. */
function flagFinalDuplicate() {
  const fs = state.finalState;
  const c = fs.cells[fCursor][1];
  if (hasAnswer(c)) clearFinalCell(fCursor, 1);
  else {
    sound('buzzer');
    showToast('⛔ Doublon ! Demandez une autre réponse.');
  }
  document.getElementById('fwAnswer').value = '';
  fPointsTouched = false;
  updateFinalMatch();
  focusFinalAnswer();
}

function skipFinalQuestion() {
  const fs = state.finalState;
  const col = finalCol(fs);
  if (!hasAnswer(fs.cells[fCursor][col])) fSkipped[col].add(fCursor);
  fCursor = nextFinalQuestion(fs, col, fCursor);
  loadFinalCursor(fs, col);
  updateFinalWizard(fs, document.getElementById('finalCtrl'));
  focusFinalAnswer();
}

function toggleFinalTimer() {
  const t = state.finalState && state.finalState.timer;
  if (t && t.running) cmd('pauseFinalTimer');
  else cmd('startFinalTimer', {});
}

// ---- Assistant : révélations ----

function revealFinalCellWithSound(q, col, revealed) {
  const c = state.finalState.cells[q][col];
  cmd('revealFinalCell', { q, col, revealed });
  if (revealed) sound((Number(c.points) || 0) > 0 ? 'reveal' : 'wrong');
}

/** Révèle la prochaine case cachée du finaliste `col` ; false s'il n'y en a plus. */
function revealFinalNext(col) {
  const q = state.finalState.cells.findIndex((p) => !p[col].revealed);
  if (q < 0) return false;
  revealFinalCellWithSound(q, col, true);
  return true;
}

function goFinalPhase(phase) {
  cmd('setFinalPhase', { phase });
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
}

function wireFinalScaffold(ctrl) {
  ctrl.querySelectorAll('.fw-step').forEach((b) =>
    b.addEventListener('click', () => goFinalPhase(b.dataset.goto))
  );
  document.getElementById('fwStart').addEventListener('click', () => {
    cmd('setView', { view: 'final' });
    goFinalPhase('answer1');
  });

  // Saisie
  document.getElementById('ftStart').addEventListener('click', () => {
    cmd('startFinalTimer', {});
    focusFinalAnswer(); // on enchaîne directement sur la saisie
  });
  document.getElementById('ftPause').addEventListener('click', () => cmd('pauseFinalTimer'));
  document.getElementById('ftReset').addEventListener('click', () => cmd('resetFinalTimer'));
  const ans = document.getElementById('fwAnswer');
  ans.addEventListener('input', updateFinalMatch);
  ans.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      validateFinalAnswer(ans.value);
    }
  });
  const pts = document.getElementById('fwPoints');
  pts.addEventListener('input', () => (fPointsTouched = pts.value !== ''));
  pts.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      validateFinalAnswer(ans.value);
    }
  });
  document.getElementById('fwValidate').addEventListener('click', () => validateFinalAnswer(ans.value));
  document.getElementById('fwSkip').addEventListener('click', skipFinalQuestion);
  document.getElementById('fwDup').addEventListener('click', flagFinalDuplicate);
  ctrl.querySelectorAll('#fwQList li').forEach((li) =>
    li.addEventListener('click', () => {
      const fs = state.finalState;
      fCursor = Number(li.dataset.q);
      loadFinalCursor(fs, finalCol(fs));
      updateFinalWizard(fs, ctrl);
      focusFinalAnswer();
    })
  );
  document.getElementById('fwToReveal').addEventListener('click', () =>
    goFinalPhase(finalCol(state.finalState) ? 'reveal2' : 'reveal1')
  );

  // Révélations (case par case, ou bouton « suivante »)
  ['reveal1', 'reveal2'].forEach((panelId, col) => {
    const panel = ctrl.querySelector(`.fw-panel[data-panel="${panelId}"]`);
    panel.querySelectorAll('.fw-rrow').forEach((row) => {
      const q = Number(row.dataset.q);
      row.querySelector('[data-rev]').addEventListener('click', () =>
        revealFinalCellWithSound(q, col, !state.finalState.cells[q][col].revealed)
      );
      row.querySelector('[data-pts]').addEventListener('input', (e) =>
        cmd('setFinalCell', { q, col, points: Math.max(0, Number(e.target.value) || 0) })
      );
    });
  });
  document.getElementById('fwR1Next').addEventListener('click', () => {
    if (!revealFinalNext(0)) goFinalPhase('answer2');
  });
  document.getElementById('fwR2Next').addEventListener('click', () => {
    const fs = state.finalState;
    if (fs.concealFirst) {
      // On rappelle d'abord le score du finaliste 1, puis on dévoile le 2e.
      cmd('setConcealFirst', { on: false });
      sound('points');
    } else if (!revealFinalNext(1)) {
      cmd('setWinner', { index: fs.familyIndex });
    }
  });
  document.getElementById('revealFinalAllBtn').addEventListener('click', () => {
    cmd('revealFinalAll');
    sound('reveal');
  });

  // Préparation
  document.querySelectorAll('[data-ffam]').forEach((b) =>
    b.addEventListener('click', () => cmd('setFinalFamily', { index: Number(b.dataset.ffam) }))
  );
  document.querySelectorAll('.fname-input').forEach((inp) =>
    inp.addEventListener('input', (e) =>
      cmd('setFinalistName', { index: Number(inp.dataset.fn), name: e.target.value })
    )
  );
}

/** Raccourcis de la finale (hors saisie) : Entrée = étape suivante, Espace = chrono, 1…9 = révéler. */
function finalShortcut(k) {
  const fs = state.finalState;
  const phase = finalPhase(fs);
  if (k === 'Enter') {
    if (phase.startsWith('answer')) focusFinalAnswer();
    else document.getElementById(phase === 'setup' ? 'fwStart' : phase === 'reveal1' ? 'fwR1Next' : 'fwR2Next').click();
    return true;
  }
  if (k === ' ' && phase.startsWith('answer')) {
    toggleFinalTimer();
    return true;
  }
  if (/^[1-9]$/.test(k) && phase.startsWith('reveal')) {
    const q = Number(k) - 1;
    const col = finalCol(fs);
    if (fs.cells[q]) revealFinalCellWithSound(q, col, !fs.cells[q][col].revealed);
    return true;
  }
  return false;
}

function updateFinalWizard(fs, ctrl) {
  const phase = finalPhase(fs);
  const col = finalCol(fs);
  const idx = FINAL_PHASES.findIndex((p) => p.id === phase);
  const name0 = finalistName(fs, 0);
  const name1 = finalistName(fs, 1);

  ctrl.querySelectorAll('.fw-step').forEach((b, i) => {
    b.classList.toggle('active', i === idx);
    b.classList.toggle('done', i < idx);
  });
  const labels = { answer1: `${name0} répond`, reveal1: `Réponses de ${name0}`, answer2: `${name1} répond` };
  Object.entries(labels).forEach(([id, txt]) => {
    const el = ctrl.querySelector(`[data-step-label="${id}"]`);
    if (el) el.textContent = txt;
  });
  ctrl.querySelectorAll('[data-fname]').forEach((el) => (el.textContent = finalistName(fs, Number(el.dataset.fname))));

  const panel = phase.startsWith('answer') ? 'answer' : phase;
  ctrl.querySelectorAll('.fw-panel').forEach((p) => (p.hidden = p.dataset.panel !== panel));

  if (phase === 'setup') {
    // Finale (re)démarrée : on repart d'une saisie vierge.
    fSkipped[0].clear();
    fSkipped[1].clear();
    fCursorKey = '';
  } else if (panel === 'answer') updateFinalAnswerPanel(fs, col);
  else updateFinalRevealPanel(fs, col);
}

function updateFinalAnswerPanel(fs, col) {
  const n = fs.cells.length;
  const key = `${col}|${n}`;
  if (fCursorKey !== key) {
    // Changement de finaliste : on démarre à la première question à saisir.
    fCursorKey = key;
    fCursor = nextFinalQuestion(fs, col, -1);
    loadFinalCursor(fs, col);
  }
  document.getElementById('fwWho').textContent = finalistName(fs, col);
  document.getElementById('fwDup').hidden = col !== 1;

  // Repère des doublons : la réponse du finaliste 1 à la même question.
  const first = document.getElementById('fwFirst');
  const f = col === 1 ? fs.cells[fCursor][0] : null;
  first.hidden = !hasAnswer(f);
  if (hasAnswer(f)) first.textContent = `⚠ ${finalistName(fs, 0)} a répondu « ${f.answer} » : réponse interdite.`;
  const taken = col === 1 && hasAnswer(f) ? finalMatch(fCursor, f.answer) : null;
  document.querySelectorAll('#fwChips .fchip').forEach((b) =>
    b.classList.toggle('taken', !!taken && Number(b.dataset.i) === taken.i)
  );

  document.querySelectorAll('#fwQList li').forEach((li) => {
    const q = Number(li.dataset.q);
    const c = fs.cells[q][col];
    const skipped = !hasAnswer(c) && fSkipped[col].has(q);
    li.classList.toggle('current', q === fCursor);
    li.classList.toggle('filled', hasAnswer(c));
    li.classList.toggle('zero', hasAnswer(c) && !(Number(c.points) > 0));
    li.classList.toggle('skipped', skipped);
    li.querySelector('[data-ql-ans]').textContent = hasAnswer(c)
      ? `${c.answer} · ${ptsLabel(Number(c.points) || 0)}`
      : skipped
        ? 'passée'
        : '';
  });

  const t = fs.timer || {};
  const timeUp = t.player === col && !t.running && !t.remaining && !!t.endsAt;
  document.getElementById('fwTimeUp').hidden = !timeUp;
  const filled = fs.cells.filter((p) => hasAnswer(p[col])).length;
  document.getElementById('fwAnswerHint').textContent =
    filled === n ? '✓ Toutes les réponses sont saisies.' : `${filled} / ${n} réponses saisies`;
  const next = document.getElementById('fwToReveal');
  next.textContent = `Révéler les réponses de ${finalistName(fs, col)} ▶`;
  next.classList.toggle('pulse', filled === n || timeUp);
}

function updateFinalRevealPanel(fs, col) {
  const panel = document.querySelector(`.fw-panel[data-panel="reveal${col + 1}"]`);
  const nextQ = fs.cells.findIndex((p) => !p[col].revealed);
  panel.querySelectorAll('.fw-rrow').forEach((row) => {
    const q = Number(row.dataset.q);
    const c = fs.cells[q][col];
    row.classList.toggle('revealed', !!c.revealed);
    row.classList.toggle('next', q === nextQ);
    const a = row.querySelector('[data-ans]');
    a.textContent = hasAnswer(c) ? c.answer : 'pas de réponse';
    a.classList.toggle('empty', !hasAnswer(c));
    const pts = row.querySelector('[data-pts]');
    if (document.activeElement !== pts) pts.value = Number(c.points) || 0;
    row.querySelector('[data-rev]').textContent = c.revealed ? '✓ Affichée' : 'Révéler';
    const first = row.querySelector('[data-first]');
    if (first) {
      const f = fs.cells[q][0];
      first.textContent = `${hasAnswer(f) ? f.answer : '—'} · ${Number(f.points) || 0}`;
    }
  });

  const name0 = finalistName(fs, 0);
  const name1 = finalistName(fs, 1);
  const sub0 = fs.cells.reduce((s, p) => s + (p[0].revealed ? Number(p[0].points) || 0 : 0), 0);
  const nextLabel = (q) => `▶ Révéler Q${q + 1} : « ${hasAnswer(fs.cells[q][col]) ? fs.cells[q][col].answer : '—'} »`;

  if (col === 0) {
    document.getElementById('fwR1Hint').textContent =
      nextQ >= 0
        ? `${name0} : ${sub0} pts pour l'instant`
        : `${name0} marque ${sub0} pts : il en faudra ${Math.max(0, fs.target - sub0)} à ${name1}.`;
    document.getElementById('fwR1Next').textContent =
      nextQ >= 0 ? nextLabel(nextQ) : `Masquer et faire venir ${name1} ▶`;
    return;
  }

  document.getElementById('fwR2Lead').textContent = fs.concealFirst
    ? `On rappelle d'abord le score de ${name0} (${sub0} pts), puis on dévoile les réponses de ${name1} une à une.`
    : `${name0} a marqué ${sub0} pts. Dévoilez les réponses de ${name1} une à une.`;
  const verdict = document.getElementById('fwVerdict');
  const reached = fs.total >= fs.target;
  verdict.className = 'fw-verdict' + (reached ? ' ok' : nextQ < 0 && !fs.concealFirst ? ' ko' : '');
  verdict.textContent = reached
    ? `🎉 Objectif atteint : ${fs.total} / ${fs.target} pts !`
    : nextQ >= 0 || fs.concealFirst
      ? `Total ${fs.total} / ${fs.target} : il manque ${fs.target - fs.total} pts`
      : `Objectif manqué : ${fs.total} / ${fs.target} pts`;
  const fam = state.teams[fs.familyIndex];
  document.getElementById('fwR2Next').textContent = fs.concealFirst
    ? `▶ Réafficher les réponses de ${name0}`
    : nextQ >= 0
      ? nextLabel(nextQ)
      : `🏆 Écran du vainqueur : ${fam ? fam.name : 'la famille'}`;
}

// Chips du tableau complet : remplit la cellule du finaliste EN JEU.
function wireFinalChips(ctrl) {
  ctrl.querySelectorAll('.fw-manual .fchip').forEach((chip) => {
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
      revealFinalCellWithSound(q, col, !cs.revealed);
    });
    const dupBtn = cell.querySelector('.fc-dup');
    if (dupBtn) dupBtn.addEventListener('click', () => clearFinalCell(q, col));
  });
}

function updateFinalLive(fs, ctrl) {
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

  // Sous-totaux par finaliste (tableau complet)
  const sub0 = fs.cells.reduce((s, p) => s + (p[0].revealed ? Number(p[0].points) || 0 : 0), 0);
  const sub1 = fs.cells.reduce((s, p) => s + (p[1].revealed ? Number(p[1].points) || 0 : 0), 0);
  const h0 = document.getElementById('fhead0');
  const h1 = document.getElementById('fhead1');
  if (h0) h0.textContent = `${finalistName(fs, 0)} — ${sub0} pts`;
  if (h1) h1.textContent = `${finalistName(fs, 1)} — ${sub1} pts`;

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

  // Cellules du tableau complet (sans casser la saisie en cours)
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
      if (dupBtn) dupBtn.disabled = !hasAnswer(c);
    });
  });

  // Marque les chips déjà attribuées (et par quel finaliste).
  ctrl.querySelectorAll('.fw-manual .fchip').forEach((chip) => {
    const q = Number(chip.dataset.q);
    const a = normAns(chip.dataset.ans);
    const pair = fs.cells[q];
    chip.classList.toggle('used-0', a !== '' && normAns(pair[0].answer) === a);
    chip.classList.toggle('used-1', a !== '' && normAns(pair[1].answer) === a);
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
    startBtn.textContent = paused ? '▶ Reprendre' : '▶ Lancer le chrono';
    startBtn.disabled = t.running;
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
