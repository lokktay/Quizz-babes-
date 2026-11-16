import { SETTINGS } from "./config.js?v=4";
import { isConfigured, signIn } from "./firebase.js?v=4";
import * as api from "./game.js?v=14";
import { computeScores } from "./logic.js?v=7";
import * as modes from "./modes.js?v=6";
import * as fun from "./fun.js?v=8";
import * as sound from "./sound.js?v=2";
import * as comfort from "./comfort.js?v=2";
import * as bank from "./bank.js?v=2";

const root = document.getElementById("app");
const LETTERS = ["A", "B", "C", "D"];
const NAME_KEY = "quizz.pseudo";
const AVATAR_KEY = "quizz.avatar";
const GROUP_KEY = "quizz.groupe";
const TV_KEY = "quizz.tv";
const OFFLINE_GRACE_MS = 10000;
const SUSPENSE_MS = 1600;

let me = null;
let gameId = null;
let game = null;
let aiApiKey = "";
let screen = { key: null };
let stopWatching = null;
let stopPresence = null;
let generating = false;
let badgeMap = new Map();
const attempts = new Map();
const shownOnce = new Set();

const esc = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const $ = (selector) => root.querySelector(selector);

function load(key) {
  try { return localStorage.getItem(key) ?? ""; } catch { return ""; }
}
function save(key, value) {
  try { localStorage.setItem(key, value); } catch { /* navigation privée */ }
}

const SETTINGS_KEY = "quizz.reglages";
function loadSettings() {
  try {
    const saved = JSON.parse(load(SETTINGS_KEY) || "null");
    const valid = saved?.modes?.filter?.((m) => modes.MODES[m]);
    if (valid?.length && modes.DURATIONS.includes(saved.minutes)) return { modes: valid, minutes: saved.minutes };
  } catch { /* réglages illisibles */ }
  return { ...modes.DEFAULT_SETTINGS, modes: [...modes.DEFAULT_SETTINGS.modes] };
}

// Programme de la partie, affiché dans la salle d'attente.
function programHtml() {
  const settings = { ...modes.DEFAULT_SETTINGS, ...(game.settings ?? {}) };
  const list = settings.modes.filter((m) => modes.MODES[m]);
  return `<section class="card">
    <h2>Au programme · ${settings.minutes < 60 ? `${settings.minutes} min` : `${Math.floor(settings.minutes / 60)} h${settings.minutes % 60 ? ` ${settings.minutes % 60}` : ""}`}</h2>
    <div class="program">${list.map((m) => `<span class="plan-chip" title="${esc(modes.MODES[m].desc)}">${modes.MODES[m].emoji} ${esc(modes.MODES[m].title)}</span>`).join("")}</div>
  </section>`;
}

const myAvatar = () => {
  const saved = load(AVATAR_KEY);
  return fun.isValidAvatar(saved) ? saved : "";
};
const avatarFor = (player, size = "") => fun.avatarHtml(player, player.uid, size, badgeMap.get(player.uid));
const playerById = (uid) => ({ uid, ...game.players?.[uid] });

let toastTimer;
function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3500);
}

// Reconstruit l'écran seulement s'il change, pour ne pas effacer ce que le joueur tape.
function show(key, build) {
  if (screen.key !== key) {
    screen.leave?.();
    screen = { key, ...build() };
  }
  screen.update?.();
  frenchSpaces(root);
}

// Typographie française : espace insécable avant ? ! : ; pour qu'un signe ne passe jamais seul à la ligne.
function frenchSpaces(node) {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (/ [?!:;»]/.test(text.data)) text.data = text.data.replace(/ ([?!:;»])/g, "\u00a0$1");
  }
}

// Une action (animation, son) jouée une seule fois par appareil pour une clé donnée.
function onceShown(key, action) {
  if (shownOnce.has(key)) return;
  shownOnce.add(key);
  action();
}

async function closeGame() {
  stopWatching?.();
  stopWatching = null;
  fun.setReactionBar(false);
  pauseOverlay?.remove();
  pauseOverlay = null;
  updateToolbar(false);
  comfort.keepAwake(false);
  document.body.classList.remove("tv");
  const stop = stopPresence;
  stopPresence = null;
  await stop?.(Boolean(game?.players?.[me]));
  gameId = null;
  game = null;
}

async function route() {
  const id = location.hash.match(/^#\/partie\/([^/]+)$/)?.[1] ?? null;
  await closeGame();
  screen = { key: null };
  if (id) openGame(id);
  else showHome();
}

const goHome = () => { location.hash = ""; };
const gameLink = (id) => `${location.origin}${location.pathname}#/partie/${id}`;

/* ---------- Barre d'outils : TV, plein écran, son ---------- */

let toolbar = null;
const tvOn = () => {
  const saved = load(TV_KEY);
  return saved ? saved === "on" : window.innerWidth >= 900;
};

function updateToolbar(inGame) {
  if (!toolbar) {
    toolbar = document.createElement("div");
    toolbar.className = "toolbar";
    toolbar.innerHTML = `
      <button type="button" data-tool="tv" title="Mode TV : texte agrandi pour l'écran principal">📺</button>
      <button type="button" data-tool="full" title="Plein écran">⛶</button>
      <button type="button" data-tool="pause" title="Mettre en pause">⏸</button>
      <button type="button" data-tool="sound"></button>`;
    toolbar.addEventListener("click", (event) => {
      const tool = event.target.closest("[data-tool]")?.dataset.tool;
      if (tool === "pause" && game) api.requestPause(gameId, !(game.pause || game.state.paused)).catch(() => toast("Pause impossible, réessaie."));
      if (tool === "tv") save(TV_KEY, tvOn() ? "off" : "on");
      if (tool === "full") comfort.toggleFullscreen()?.catch?.(() => {});
      if (tool === "sound") sound.setOn(!sound.isOn(isHost()));
      updateToolbar(Boolean(game?.players?.[me]));
    });
    document.addEventListener("fullscreenchange", () => updateToolbar(Boolean(game?.players?.[me])));
    document.body.append(toolbar);
  }
  const host = inGame && isHost();
  toolbar.querySelector('[data-tool="tv"]').hidden = !host;
  toolbar.querySelector('[data-tool="tv"]').classList.toggle("on", host && tvOn());
  toolbar.querySelector('[data-tool="full"]').hidden = !comfort.canFullscreen();
  toolbar.querySelector('[data-tool="full"]').classList.toggle("on", comfort.isFullscreen());
  const pauseButton = toolbar.querySelector('[data-tool="pause"]');
  pauseButton.hidden = !(inGame && canPause());
  pauseButton.classList.toggle("on", Boolean(game?.pause || game?.state?.paused));
  const soundButton = toolbar.querySelector('[data-tool="sound"]');
  soundButton.hidden = !inGame;
  if (inGame) {
    const on = sound.isOn(isHost());
    soundButton.textContent = on ? "🔊" : "🔇";
    soundButton.title = on ? "Couper le son" : "Activer le son";
  }
  document.body.classList.toggle("tv", host && tvOn());
}

/* ---------- Accueil ---------- */

function showHome() {
  updateToolbar(false);
  show("home", () => {
    root.innerHTML = `
      <div class="stack">
        <header class="hero">
          <p class="eyebrow">Soirée quiz</p>
          <h1>Quizz entre amis</h1>
          <p class="tagline">Chacun choisit ses thèmes, l'IA écrit les questions, et on chambre le perdant.</p>
        </header>
        <section class="card">
          <label>Ton pseudo
            <input id="pseudo" maxlength="20" autocomplete="nickname" value="${esc(load(NAME_KEY))}" placeholder="Ex. Pierre">
          </label>
        </section>
        <section class="card">
          <h2>Parties en lancement</h2>
          <ul class="list" id="lobbies"><li class="empty">Recherche des parties…</li></ul>
        </section>
        <form class="card" id="create">
          <h2>Créer une partie</h2>
          <label>Nom de la partie
            <input id="gameName" maxlength="40" required placeholder="Soirée de samedi">
          </label>
          <label><span>Groupe d'amis <span class="optional">facultatif</span></span>
            <input id="groupName" maxlength="40" value="${esc(load(GROUP_KEY))}" placeholder="Les Babes">
            <span class="hint">Garde l'historique du groupe (victoires, titres) et évite de reposer les mêmes questions.</span>
          </label>
          <label><span>Clé API Gemini <span class="optional">facultatif</span></span>
            <input id="apiKey" type="password" autocomplete="off">
            <span class="hint">Avec la clé, chacun ajoute un thème libre écrit par l'IA. Sans clé, tout le monde choisit ${SETTINGS.bankPicks + 1} thèmes dans la banque. Le site n'enregistre pas la clé.</span>
          </label>
          <div class="setup">
            <h3>Modes de jeu <span class="optional">joués dans l'ordre où tu les choisis</span></h3>
            <div class="mode-grid" id="mode-grid"></div>
            <h3>Durée de la soirée</h3>
            <div class="duration" id="duration"></div>
            <p class="plan-summary" id="plan-summary"></p>
          </div>
          <button class="primary big">Créer la partie</button>
        </form>
      </div>`;

    // Modes et durée : mémorisés pour la prochaine fois.
    let settings = loadSettings();
    const renderSetup = () => {
      $("#mode-grid").innerHTML = modes.MODE_ORDER.map((id) => {
        const meta = modes.MODES[id];
        const order = settings.modes.indexOf(id);
        return `<button type="button" class="mode-card ${order >= 0 ? "on" : ""}" data-mode="${id}" aria-pressed="${order >= 0}">
          <span class="mode-emoji">${meta.emoji}</span>
          <span class="mode-text"><b>${esc(meta.title)}</b>${meta.interlude ? `<span class="tag">Entre les modes</span>` : meta.fixed ? `<span class="tag">Taille fixe</span>` : ""}<small>${esc(meta.desc)}</small></span>
          ${order >= 0 && !meta.interlude ? `<span class="mode-order">${settings.modes.filter((m) => !modes.MODES[m].interlude).indexOf(id) + 1}</span>` : ""}
        </button>`;
      }).join("");
      $("#duration").innerHTML = modes.DURATIONS.map((m) => `<button type="button" class="duration-chip ${settings.minutes === m ? "on" : ""}" data-minutes="${m}">${m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ""}`}</button>`).join("");
      const program = modes.planProgram({ modes: settings.modes, minutes: settings.minutes, themeCount: 9 });
      const main = program.filter((p) => !modes.MODES[p.mode].interlude);
      $("#plan-summary").innerHTML = main.length
        ? `${main.length} manche${main.length > 1 ? "s" : ""}${program.length > main.length ? ` + ${program.length - main.length} duel${program.length - main.length > 1 ? "s" : ""}` : ""} : ${program.map((p) => `<span class="plan-chip">${modes.MODES[p.mode].emoji} ${p.mode === "duel" ? "Duel" : `${esc(modes.MODES[p.mode].title)} · ${p.count} ${p.mode === "chrono" ? "sprint" : p.mode === "quitteDouble" ? "échelle" : p.mode === "plateau" ? "case" : "question"}${p.count > 1 ? "s" : ""}`}</span>`).join("")}`
        : "Choisis au moins un mode de jeu.";
      const estimate = modes.estimateMinutes(program);
      if (main.length && estimate > settings.minutes + 5) {
        $("#plan-summary").innerHTML += `<br><span class="warn">⚠ Le plateau a une taille fixe : avec autant de modes, compte plutôt ${estimate} min.</span>`;
      }
      save(SETTINGS_KEY, JSON.stringify(settings));
    };
    $("#mode-grid").addEventListener("click", (event) => {
      const id = event.target.closest("[data-mode]")?.dataset.mode;
      if (!id) return;
      settings.modes = settings.modes.includes(id) ? settings.modes.filter((m) => m !== id) : [...settings.modes, id];
      renderSetup();
    });
    $("#duration").addEventListener("click", (event) => {
      const minutes = Number(event.target.closest("[data-minutes]")?.dataset.minutes);
      if (!minutes) return;
      settings.minutes = minutes;
      renderSetup();
    });
    renderSetup();

    const pseudo = () => {
      const value = $("#pseudo").value.trim();
      if (!value) {
        $("#pseudo").focus();
        toast("Choisis d'abord un pseudo.");
        return null;
      }
      save(NAME_KEY, value);
      return value;
    };

    $("#create").addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = pseudo();
      if (!name) return;
      if (!settings.modes.some((m) => !modes.MODES[m].interlude)) return toast("Choisis au moins un mode de jeu (les duels seuls ne suffisent pas).");
      aiApiKey = $("#apiKey").value.trim();
      const group = $("#groupName").value.trim();
      save(GROUP_KEY, group);
      try {
        location.hash = `#/partie/${await api.createGame($("#gameName").value.trim(), name, myAvatar(), group, Boolean(aiApiKey), settings)}`;
      } catch (error) {
        console.error(error);
        toast("Impossible de créer la partie.");
      }
    });

    $("#lobbies").addEventListener("click", async (event) => {
      const id = event.target.closest("[data-join]")?.dataset.join;
      if (!id) return;
      const name = pseudo();
      if (!name) return;
      try {
        await api.joinGame(id, name, myAvatar());
        location.hash = `#/partie/${id}`;
      } catch (error) {
        console.error(error);
        toast(error.message || "Impossible de rejoindre cette partie.");
      }
    });

    stopWatching = api.watchLobbies((games) => {
      $("#lobbies").innerHTML = games.length
        ? games.map((g) => {
            const count = Object.keys(g.players ?? {}).length;
            const full = count >= SETTINGS.maxPlayers;
            return `<li>
              <span class="grow"><b>${esc(g.name)}</b>
                <span class="muted small">${esc(g.players[g.hostId].name)}${g.groupName ? ` · ${esc(g.groupName)}` : ""} · ${count} joueur${count > 1 ? "s" : ""}</span></span>
              <button data-join="${esc(g.id)}" ${full ? "disabled" : ""}>${full ? "Pleine" : "Rejoindre"}</button></li>`;
          }).join("")
        : `<li class="empty">Aucune partie en lancement. Crée la première !</li>`;
    });

    return {};
  });
}

/* ---------- Partie ---------- */

function openGame(id) {
  gameId = id;
  let firstValue = true;
  stopWatching = api.watchGame(id, (value) => {
    if (id !== gameId) return;
    if (value === null) {
      toast(firstValue ? "Cette partie n'existe plus." : "La partie a été fermée.");
      game = null;
      goHome();
      return;
    }
    firstValue = false;
    game = value;
    if (game.players?.[me] && !stopPresence) stopPresence = api.startPresence(id);
    badgeMap = game.rounds ? fun.badges(game, computeScores(game)) : new Map();
    renderGame();
    drive();
    updateFun();
  });
}

const isHost = () => game?.hostId === me;
const playersOf = () => Object.entries(game.players ?? {}).map(([uid, p]) => ({ uid, ...p }));
const participantsOf = () => playersOf().filter((p) => p.uid !== game.hostId);
const answeringPlayers = () => participantsOf().filter((p) => p.connected);

const PLAYING_PHASES = ["intro", "bet", "pick", "ask", "decide", "reveal", "vote", "role", "word", "clue", "ballot", "verdict", "end", "finished"];

// La pause et la fin anticipée sont possibles pendant toutes les manches.
const canPause = () => Boolean(game?.rounds) && game.state?.phase !== "finished" && PLAYING_PHASES.includes(game.state?.phase);

let pauseOverlay = null;
let confirmStop = false;
function updatePauseOverlay() {
  const active = Boolean(game?.players?.[me]) && canPause() && Boolean(game.pause || game.state.paused || game.stop);
  if (!active) {
    pauseOverlay?.remove();
    pauseOverlay = null;
    confirmStop = false;
    return;
  }
  if (!pauseOverlay) {
    pauseOverlay = document.createElement("div");
    pauseOverlay.className = "pause-overlay";
    pauseOverlay.addEventListener("click", (event) => {
      const action = event.target.closest("[data-pause]")?.dataset.pause;
      if (action === "resume") api.requestPause(gameId, false).catch(() => toast("Reprise impossible, réessaie."));
      if (action === "stop") { confirmStop = true; updatePauseOverlay(); }
      if (action === "cancel") { confirmStop = false; updatePauseOverlay(); }
      if (action === "confirm") api.requestStop(gameId).catch(() => toast("Impossible de terminer, réessaie."));
    });
    document.body.append(pauseOverlay);
  }
  const by = game.players?.[game.pause?.by ?? game.state.paused?.by]?.name;
  pauseOverlay.innerHTML = game.stop ? `
    <div class="pause-box"><div class="pause-icon">⏹</div><h2>Fin de la partie…</h2></div>` : `
    <div class="pause-box">
      <div class="pause-icon">⏸</div>
      <h2>Pause</h2>
      <p class="muted">${by ? `Demandée par ${esc(by)}.` : ""} Le chrono est figé.</p>
      ${confirmStop ? `
        <p><b>Terminer la partie maintenant ?</b><br><span class="muted small">Le classement actuel devient le classement final.</span></p>
        <div class="pause-actions">
          <button class="big danger" data-pause="confirm">⏹ Oui, terminer</button>
          <button class="big" data-pause="cancel">Annuler</button>
        </div>` : `
        <div class="pause-actions">
          <button class="primary big" data-pause="resume">▶ Reprendre</button>
          <button class="big" data-pause="stop">⏹ Terminer la partie</button>
        </div>`}
    </div>`;
}

function updateFun() {
  const inGame = Boolean(game.players?.[me]);
  updatePauseOverlay();
  const played = fun.playReactions(gameId, game, avatarFor);
  if (played.floats) sound.pop();
  if (played.throws) setTimeout(() => sound.splat(), 450);
  updateToolbar(inGame);
  comfort.keepAwake(inGame);
  // Pas de barre de réactions quand le joueur doit choisir (case, cadeau) : elle cacherait les boutons.
  const choosing = game.state.phase === "pick" && game.state.chooser === me;
  const canReact = inGame && !isHost() && !choosing && PLAYING_PHASES.includes(game.state.phase);
  fun.setReactionBar(
    canReact,
    (emoji, to) => api.sendReaction(gameId, emoji, to).catch(() => toast("Réaction non envoyée.")),
    () => participantsOf().filter((p) => p.uid !== me).map((p) => ({ uid: p.uid, name: p.name, html: avatarFor(p, "lg") })),
  );
}

function renderGame() {
  const { phase, index } = game.state;
  if (!game.players?.[me]) return phase === "lobby" ? showJoin() : showClosed();
  if (phase === "lobby") return showLobby();
  if (phase === "themes") {
    if (!bankIndex) return showLoadingThemes();
    if (!bankIndex.length) return showBankMissing();
    if (isHost() || themesDone(me)) return showThemesWaiting();
    if (game.state.noAi && themeEntry(me)?.ready) return showExtraTheme();
    return showThemePicker();
  }
  if (phase === "generating") return showGenerating();
  if (phase === "finished") return showFinal();
  if (!game.rounds) return showClosed();
  if (phase === "intro") return showIntro();
  if (phase === "bet") return showBet();
  if (phase === "pick") return showPick();
  if (phase === "ask") return showAsk();
  if (phase === "decide") return showDecide();
  if (phase === "sprint") return showSprint();
  if (phase === "vote") return showVote();
  if (phase === "role") return showRole();
  if (phase === "word") return showWord();
  if (phase === "clue") return showClue();
  if (phase === "ballot") return showBallot();
  if (phase === "verdict") return showVerdict();
  if (phase === "end") return showGameEnd();
  if (phase === "reveal") {
    if (currentMode() === "chrono") return showSprintReveal();
    if (currentMode() === "echelle") return showLadderReveal();
    return showReveal();
  }
  return showClosed();
}

function showJoin() {
  show("join", () => {
    root.innerHTML = `
      <form class="card narrow" id="join">
        <p class="eyebrow">Invitation</p>
        <h2>Rejoindre « ${esc(game.name)} »</h2>
        <label>Ton pseudo
          <input id="pseudo" maxlength="20" required value="${esc(load(NAME_KEY))}">
        </label>
        <button class="primary big">Rejoindre</button>
        <button type="button" class="link" id="home">Retour à l'accueil</button>
      </form>`;
    $("#home").addEventListener("click", goHome);
    $("#join").addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = $("#pseudo").value.trim();
      if (!name) return;
      save(NAME_KEY, name);
      await api.joinGame(gameId, name, myAvatar()).catch((error) => toast(error.message || "Impossible de rejoindre cette partie."));
    });
    return {};
  });
}

function showClosed() {
  show("closed", () => {
    root.innerHTML = `
      <div class="card narrow center">
        <h2>Cette partie a déjà commencé</h2>
        <p class="muted">Si tu en faisais partie, rouvre le lien depuis le même téléphone et le même navigateur pour retrouver ta place.</p>
        <button class="primary" id="home">Retour à l'accueil</button>
      </div>`;
    $("#home").addEventListener("click", goHome);
    return {};
  });
}

function playerRow(p, extra = "") {
  return `
    <li class="${p.connected === false ? "offline" : ""}">
      <span class="who-line">${avatarFor(p)}<span class="grow">${esc(p.name)}${p.uid === me ? ` <span class="muted">(toi)</span>` : ""}</span></span>
      ${extra}
    </li>`;
}

function palmaresHtml(players) {
  const rows = Object.values(players ?? {}).sort((a, b) => (b.wins ?? 0) - (a.wins ?? 0) || (b.points ?? 0) - (a.points ?? 0));
  if (!rows.length) return `<p class="muted">Première partie du groupe : l'historique commence ce soir.</p>`;
  return `
    <table class="palmares">
      <thead><tr><th>Joueur</th><th title="Victoires">🏆</th><th title="Parties">🎮</th><th title="Dernière place">🥄</th><th>Titres</th></tr></thead>
      <tbody>
        ${rows.map((r) => {
          const titles = Object.entries(r.titles ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3)
            .map(([key, n]) => `<span title="${esc(fun.AWARD_NAMES[key]?.[1] ?? key)}">${fun.AWARD_NAMES[key]?.[0] ?? "🏅"}${n > 1 ? `×${n}` : ""}</span>`).join(" ");
          return `<tr><td>${esc(r.name)}</td><td>${r.wins ?? 0}</td><td>${r.games ?? 0}</td><td>${r.last ?? 0}</td><td>${titles || "—"}</td></tr>`;
        }).join("")}
      </tbody>
    </table>`;
}

function loadPalmares(target) {
  if (!game.group) return;
  api.getGroup(game.group)
    .then((players) => { const el = $(target); if (el) el.innerHTML = palmaresHtml(players); })
    .catch(() => { const el = $(target); if (el) el.innerHTML = `<p class="muted">Historique indisponible.</p>`; });
}

function showLobby() {
  show("lobby", () => {
    const host = isHost();
    root.innerHTML = `
      <div class="stack ${host ? "lobby-host" : ""}">
        <header>
          <p class="eyebrow">${game.groupName ? esc(game.groupName) : "Salle d'attente"}</p>
          <h1>${esc(game.name)}</h1>
          <p class="tagline" id="status"></p>
        </header>
        ${host ? `
        <section class="card join-card">
          <h2>Rejoindre la partie</h2>
          <div class="qr" id="qr"><span class="muted small">QR code en cours…</span></div>
          <p class="muted small center">Scanne avec l'appareil photo de ton téléphone, ou :</p>
          <button id="copy">🔗 Copier le lien</button>
        </section>` : ""}
        <section class="card">
          <h2>Joueurs</h2>
          <ul class="list" id="players"></ul>
        </section>
        ${programHtml()}
        ${host ? "" : `<div id="picker">${fun.avatarPickerHtml(game.players[me]?.avatar)}</div>`}
        ${game.group ? `<section class="card"><h2>Palmarès du groupe</h2><div id="palmares"><p class="muted">Chargement…</p></div></section>` : ""}
        ${host ? `<button class="primary big" id="start">Lancer la partie</button>` : ""}
        <button class="link" id="leave">${host ? "Supprimer la partie" : "Quitter la partie"}</button>
      </div>`;

    if (host) {
      comfort.qrDataUrl(gameLink(gameId))
        .then((url) => { const el = $("#qr"); if (el) el.innerHTML = `<img src="${url}" alt="QR code pour rejoindre la partie">`; })
        .catch(() => { const el = $("#qr"); if (el) el.innerHTML = `<p class="muted small">QR code indisponible : utilise le lien.</p>`; });
      $("#copy").addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(gameLink(gameId));
          toast("Lien copié.");
        } catch {
          toast(gameLink(gameId));
        }
      });
      $("#start").addEventListener("click", () => api.startThemes(gameId, game));
    } else {
      const chooseAvatar = (avatar) => {
        save(AVATAR_KEY, avatar);
        api.setAvatar(gameId, avatar).catch(() => toast("Avatar non enregistré, réessaie."));
      };
      $("#avatar-grid").addEventListener("click", (event) => {
        const button = event.target.closest("[data-avatar]");
        if (button) chooseAvatar(button.dataset.avatar);
      });
      $("#avatar-photo").addEventListener("change", async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        try {
          chooseAvatar(await fun.photoToAvatar(file));
        } catch (error) {
          console.error(error);
          toast("Cette photo n'a pas pu être utilisée.");
        }
      });
    }
    loadPalmares("#palmares");

    $("#leave").addEventListener("click", async () => {
      stopWatching?.();
      stopWatching = null;
      const stop = stopPresence;
      stopPresence = null;
      await stop?.(false);
      const leave = isHost() ? api.deleteGame(gameId) : api.leaveLobby(gameId);
      game = null;
      await leave.catch(console.error);
      goHome();
    });

    return {
      update() {
        if (!isHost()) {
          const current = game.players[me]?.avatar;
          $("#avatar-current").innerHTML = avatarFor(playerById(me), "lg");
          root.querySelectorAll("[data-avatar]").forEach((b) => b.classList.toggle("on", b.dataset.avatar === current));
        }
        $("#players").innerHTML = playersOf().map((p) =>
          playerRow(p, p.uid === game.hostId ? `<span class="tag host">Écran</span>` : "")).join("");
        const others = participantsOf().length;
        if (isHost()) $("#start").disabled = others === 0;
        $("#status").textContent = isHost()
          ? `${others} joueur${others > 1 ? "s" : ""} sur ${SETTINGS.maxPlayers - 1}. ${others ? "Lance quand tout le monde est là." : "Invite au moins une personne."}`
          : `Choisis ton avatar en attendant ${game.players[game.hostId]?.name ?? "l'hôte"}.`;
      },
    };
  });
}

/* ---------- Choix des thèmes ---------- */

let bankIndex = null;
bank.loadIndex().then((list) => {
  bankIndex = list;
  if (game?.state?.phase === "themes") renderGame();
});

function showBankMissing() {
  show("themes:missing", () => {
    root.innerHTML = `<div class="card narrow center"><h2>Banque de thèmes introuvable</h2>
      <p class="muted">Le fichier banque/index.json n'a pas pu être chargé. Vérifie qu'il est bien publié, puis recharge la page.</p></div>`;
    return {};
  });
}

function showLoadingThemes() {
  show("themes:loading", () => {
    root.innerHTML = `<div class="card narrow center"><div class="spinner"></div><p class="muted">Chargement des thèmes…</p></div>`;
    return {};
  });
}
const bankTheme = (id) => bankIndex?.find((t) => t.id === id);
const needsFree = () => Boolean(game.ai) && !game.state.noAi;
const themeEntry = (uid) => {
  const entry = game.themes?.[uid];
  return entry && !Array.isArray(entry) ? entry : null;
};

// Le joueur a-t-il fini de choisir ? (En mode « sans thèmes libres », il lui faut un thème de remplacement.)
function themesDone(uid) {
  const entry = themeEntry(uid);
  if (!entry?.ready) return false;
  if (game.state.noAi && game.ai && entry.free) return Boolean(entry.extra);
  return true;
}

// Thèmes de la banque déjà pris par les autres joueurs : id → [joueurs].
function takenByOthers() {
  const taken = new Map();
  for (const p of participantsOf()) {
    if (p.uid === me) continue;
    const entry = themeEntry(p.uid);
    for (const id of [...(entry?.bank ?? []), ...(entry?.extra ? [entry.extra] : [])]) {
      if (!taken.has(id)) taken.set(id, []);
      taken.get(id).push(p);
    }
  }
  return taken;
}

function themeCardsHtml(selected, { mine = [] } = {}) {
  const taken = takenByOthers();
  return bankIndex.map((t) => {
    const order = selected.indexOf(t.id);
    const by = taken.get(t.id);
    const own = mine.includes(t.id);
    const disabled = (by && order < 0) || own;
    return `
      <button type="button" class="theme-card ${order >= 0 ? "on" : ""} ${disabled ? "taken" : ""}" data-theme="${esc(t.id)}" ${disabled ? "disabled" : ""}>
        <span class="theme-emoji">${t.emoji}</span>
        <span class="theme-label">${esc(t.label)}</span>
        ${order >= 0 ? `<span class="theme-order">${order + 1}</span>` : ""}
        ${by && order < 0 ? `<span class="theme-taken">${by.map((p) => avatarFor(p, "xs")).join("")}<small>${esc(by.map((p) => p.name).join(", "))}</small></span>` : ""}
        ${own ? `<span class="theme-taken"><small>Déjà à toi</small></span>` : ""}
      </button>`;
  }).join("");
}

function showThemePicker() {
  const free = needsFree();
  const picks = free ? SETTINGS.bankPicks : SETTINGS.bankPicks + 1;
  show(`themes:picker:${free}`, () => {
    let selected = [...(themeEntry(me)?.bank ?? [])].slice(0, picks);
    root.innerHTML = `
      <div class="stack">
        <header>
          <p class="eyebrow">Étape 1 · Tes thèmes</p>
          <h1>Choisis ${picks} thèmes</h1>
          <p class="tagline">${free
            ? `Pioche ${picks} thèmes dans la banque, puis invente un thème libre : l'IA écrira ses questions.`
            : `Pioche ${picks} thèmes dans la banque. Un thème déjà pris par quelqu'un n'est plus disponible.`}</p>
        </header>
        <div class="picker-bar">
          <span class="pick-count" id="pick-count"></span>
          <button type="button" id="random">🎲 Au hasard</button>
        </div>
        <div class="theme-grid" id="theme-grid"></div>
        ${free ? `
        <section class="card free-card">
          <label>✨ Ton thème libre
            <input id="free" maxlength="60" autocomplete="off" placeholder="Ex. Les répliques de Kaamelott" value="${esc(themeEntry(me)?.free ?? "")}">
            <span class="hint">Un sujet de niche ou complètement loufoque. L'IA prépare ses questions pendant que les autres choisissent.</span>
          </label>
        </section>` : ""}
        <button class="primary big sticky-cta" id="validate"></button>
      </div>`;

    const freeText = () => (free ? $("#free").value.trim() : "");
    const draft = () => api.saveThemes(gameId, { bank: selected, ...(free ? { free: freeText() } : {}), ready: false }).catch(() => {});
    const refresh = () => {
      $("#theme-grid").innerHTML = themeCardsHtml(selected);
      $("#pick-count").textContent = `${selected.length} / ${picks} thèmes`;
      const complete = selected.length === picks && (!free || freeText());
      $("#validate").disabled = !complete;
      $("#validate").textContent = complete ? "Valider mes thèmes"
        : selected.length < picks ? `Encore ${picks - selected.length} thème${picks - selected.length > 1 ? "s" : ""} à choisir` : "Écris ton thème libre";
    };

    $("#theme-grid").addEventListener("click", (event) => {
      const id = event.target.closest("[data-theme]:not(:disabled)")?.dataset.theme;
      if (!id) return;
      if (selected.includes(id)) selected = selected.filter((s) => s !== id);
      else if (selected.length < picks) selected.push(id);
      else return toast(`Tu as déjà ${picks} thèmes : retire-en un d'abord.`);
      navigator.vibrate?.(15);
      refresh();
      draft();
    });
    $("#random").addEventListener("click", () => {
      const taken = takenByOthers();
      const pool = bankIndex.map((t) => t.id).filter((id) => !selected.includes(id) && !taken.has(id));
      while (selected.length < picks && pool.length) selected.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      refresh();
      draft();
    });
    $("#free")?.addEventListener("input", refresh);
    $("#free")?.addEventListener("change", draft);
    $("#validate").addEventListener("click", async () => {
      // Un thème pris entre-temps par quelqu'un d'autre est retiré.
      const taken = takenByOthers();
      const lost = selected.filter((id) => taken.has(id));
      if (lost.length) {
        selected = selected.filter((id) => !taken.has(id));
        refresh();
        return toast(`${lost.map((id) => bankTheme(id)?.label).join(", ")} vient d'être pris. Choisis-en un autre.`);
      }
      await api.saveThemes(gameId, { bank: selected, ...(free ? { free: freeText() } : {}), ready: true })
        .catch(() => toast("Thèmes non enregistrés, réessaie."));
    });

    refresh();
    return {
      update() {
        // Les choix des autres arrivent en direct : on retire ce qui vient d'être pris.
        const taken = takenByOthers();
        const before = selected.length;
        selected = selected.filter((id) => !taken.has(id) || themeEntry(me)?.bank?.includes(id));
        if (selected.length !== before) draft();
        refresh();
      },
    };
  });
}

// Plan B : les thèmes libres sont annulés, le joueur en choisit un de plus dans la banque.
function showExtraTheme() {
  show("themes:extra", () => {
    const entry = themeEntry(me);
    let choice = null;
    root.innerHTML = `
      <div class="stack">
        <header>
          <p class="eyebrow">Changement de programme</p>
          <h1>Un thème de plus</h1>
          <p class="tagline">L'IA met trop de temps : les thèmes libres sont annulés. Choisis un thème de la banque pour remplacer « ${esc(entry.free)} ».</p>
        </header>
        <div class="theme-grid" id="theme-grid"></div>
        <button class="primary big sticky-cta" id="validate" disabled>Choisis un thème</button>
      </div>`;
    const refresh = () => {
      $("#theme-grid").innerHTML = themeCardsHtml(choice ? [choice] : [], { mine: entry.bank ?? [] });
      $("#validate").disabled = !choice;
      $("#validate").textContent = choice ? `Valider « ${bankTheme(choice)?.label} »` : "Choisis un thème";
    };
    $("#theme-grid").addEventListener("click", (event) => {
      const id = event.target.closest("[data-theme]:not(:disabled)")?.dataset.theme;
      if (!id) return;
      choice = choice === id ? null : id;
      navigator.vibrate?.(15);
      refresh();
    });
    $("#validate").addEventListener("click", async () => {
      if (!choice) return;
      if (takenByOthers().has(choice)) {
        choice = null;
        refresh();
        return toast("Ce thème vient d'être pris. Choisis-en un autre.");
      }
      await api.saveThemes(gameId, { ...themeEntry(me), extra: choice }).catch(() => toast("Choix non enregistré, réessaie."));
    });
    refresh();
    return {
      update() {
        if (choice && takenByOthers().has(choice)) choice = null;
        refresh();
      },
    };
  });
}

function themeChips(uid) {
  const entry = themeEntry(uid);
  if (!entry) return "";
  const ids = [...(entry.bank ?? []), ...(entry.extra ? [entry.extra] : [])];
  const chips = ids.map((id) => bankTheme(id)).filter(Boolean).map((t) => `<span class="mini-chip">${t.emoji} ${esc(t.label)}</span>`);
  if (entry.free && !game.state.noAi && entry.ready) chips.push(`<span class="mini-chip free">✨ ${esc(entry.free)}</span>`);
  if (entry.free && game.state.noAi) chips.push(`<span class="mini-chip off">✨ ${esc(entry.free)}</span>`);
  return chips.length ? `<span class="chips-line">${chips.join("")}</span>` : "";
}

function showThemesWaiting() {
  const noAi = Boolean(game.state.noAi);
  show(`themes:waiting:${noAi}`, () => {
    root.innerHTML = `
      <div class="stack">
        <header>
          <p class="eyebrow">Étape 1 · Les thèmes</p>
          <h1>${isHost() ? (noAi ? "Plan B" : "Les thèmes arrivent") : "C'est noté !"}</h1>
          <p class="tagline">${isHost()
            ? noAi ? "Les thèmes libres sont annulés : chaque joueur choisit un thème de plus dans la banque."
              : "Les joueurs choisissent leurs thèmes sur leur téléphone. Les thèmes libres se préparent au fur et à mesure."
            : "On attend les autres joueurs."}</p>
        </header>
        <section class="card">
          <ul class="list" id="players"></ul>
          <button id="skip" hidden>Continuer sans les joueurs en retard</button>
        </section>
      </div>`;
    $("#skip").addEventListener("click", () => api.startGeneration(gameId));
    return {
      update() {
        const participants = participantsOf();
        $("#players").innerHTML = participants.length
          ? participants.map((p) => {
              const done = themesDone(p.uid);
              const count = (themeEntry(p.uid)?.bank ?? []).length;
              return `
                <li class="${p.connected === false ? "offline" : ""} theme-row">
                  <span class="who-line">${avatarFor(p)}<span class="grow"><b>${esc(p.name)}</b>${themeChips(p.uid)}</span></span>
                  <span class="tag ${done ? "done" : ""}">${done ? "Prêt" : count ? `${count} choisi${count > 1 ? "s" : ""}` : "Choisit…"}</span>
                </li>`;
            }).join("")
          : `<li class="empty">Aucun autre joueur n'est encore dans la partie.</li>`;
        $("#skip").hidden = !isHost() || !participants.some((p) => themesDone(p.uid)) || participants.every((p) => themesDone(p.uid));
      },
    };
  });
}

function showGenerating() {
  show("generating", () => {
    root.innerHTML = `
      <div class="card narrow center">
        <div class="spinner" id="spinner"></div>
        <h2>Préparation des questions</h2>
        <p class="muted" id="wait">Encore quelques secondes…</p>
        <div class="progress" id="progress-wrap" hidden><div id="progress-bar"></div></div>
        <p class="muted small" id="progress"></p>
        <form id="retry" hidden>
          <div class="stack">
            <p class="error" id="error"></p>
            <label>Clé API Gemini
              <input id="apiKey" type="password" autocomplete="off" value="${esc(aiApiKey)}">
            </label>
            <button class="primary big">Relancer</button>
          </div>
        </form>
        <div class="stack plan-b" id="plan-b" hidden>
          <p class="muted small">Les thèmes libres prennent du temps. Tu peux lancer sans eux : chacun choisira un thème de plus dans la banque.</p>
          <button class="big" id="drop-free">⏭ Lancer sans les thèmes libres</button>
        </div>
      </div>`;
    $("#retry").addEventListener("submit", (event) => {
      event.preventDefault();
      aiApiKey = $("#apiKey").value.trim();
      api.clearGenerationError(gameId);
    });
    $("#drop-free").addEventListener("click", (event) => {
      event.currentTarget.disabled = true;
      api.dropFreeThemes(gameId).catch(() => { event.currentTarget.disabled = false; toast("Impossible de changer de plan, réessaie."); });
    });
    return {
      update() {
        const failed = Boolean(game.state.error);
        const showRetry = failed && isHost();
        $("#retry").hidden = !showRetry;
        $("#spinner").hidden = showRetry;
        $("#wait").hidden = showRetry;
        const progress = game.state.progress;
        $("#progress-wrap").hidden = !progress?.total || showRetry;
        if (progress?.total) $("#progress-bar").style.width = `${(progress.done / progress.total) * 100}%`;
        $("#progress").textContent = progress?.total && !showRetry ? `${progress.done} / ${progress.total} thèmes prêts` : "";
        if (failed && !isHost()) {
          $("#wait").hidden = false;
          $("#wait").textContent = `Un problème est survenu, ${game.players[game.hostId]?.name ?? "l'hôte"} va relancer.`;
        }
        if (failed) $("#error").textContent = game.state.error;
        screen.tick();
      },
      tick() {
        // Plan B proposé au créateur après un délai, ou tout de suite en cas d'erreur.
        const hasFree = !game.state.noAi && participantsOf().some((p) => themeEntry(p.uid)?.ready && themeEntry(p.uid)?.free);
        const slow = api.serverNow() - (game.state.since ?? api.serverNow()) > SETTINGS.freeThemeWaitSeconds * 1000;
        $("#plan-b").hidden = !(isHost() && hasFree && (slow || game.state.error));
      },
    };
  });
}

/* ---------- Manches : éléments communs ---------- */

const currentRound = () => modes.roundOf(game);
const currentMode = () => currentRound()?.mode;
const modeMeta = (mode = currentMode()) => modes.MODES[mode] ?? { emoji: "❓", title: "Manche" };
const activeIds = () => answeringPlayers().map((p) => p.uid);
const LEVEL_NAMES = modes.LEVEL_NAMES;

function scoreList(scores, withGain) {
  return scores.map((s, i) => `
    <li class="${s.uid === me ? "me" : ""}">
      <span class="rank">${i + 1}</span>
      ${avatarFor(playerById(s.uid))}
      <span class="name">${esc(s.name)}</span>
      ${withGain && s.gained ? `<span class="gain ${s.gained < 0 ? "neg" : ""}">${s.gained > 0 ? "+" : ""}${s.gained}</span>` : ""}
      <span class="pts">${s.score}<small> pt${Math.abs(s.score) > 1 ? "s" : ""}</small></span>
    </li>`).join("");
}

function rankingCard(withGain = true) {
  return `<section class="card ranking"><h2>Classement</h2><ul class="list score">${scoreList(computeScores(game), withGain)}</ul></section>`;
}

function roundLabel() {
  const meta = modeMeta();
  const r = game.state.round ?? 0;
  return `${meta.emoji} ${esc(meta.title)} · manche ${r + 1} / ${game.rounds?.length ?? 1}`;
}

function stepLabel() {
  const round = currentRound();
  const s = game.state.step ?? 0;
  switch (round?.mode) {
    case "quitteDouble": return `Échelle ${game.state.ladder.i + 1} / ${round.ladders.length} · marche ${game.state.ladder.k + 1} / 5`;
    case "plateau": return `${Object.keys(game.state.used ?? {}).length} / ${round.board.length} cases jouées`;
    case "cadeau": return `Cadeau ${s + 1} / ${round.count}`;
    case "chrono": return `Sprint ${s + 1} / ${round.count}`;
    case "duel": return "Duel";
    case "espion": return `Partie ${(game.state.g ?? 0) + 1} · question ${(game.state.k ?? 0) + 1} / 5`;
    case "undercover": return `Partie ${(game.state.uc?.g ?? 0) + 1}`;
    case "echelle": return `Question ${s + 1} / ${round.count}`;
    default: return `Question ${s + 1} / ${round?.questions?.length ?? 0}`;
  }
}

function timerHtml() {
  return `<div class="timer-row">
      <span id="left-label" class="left-label"></span>
      <div class="timer"><div id="bar"></div></div>
      <span id="right" class="clock"></span>
    </div>`;
}

// Barre de temps générique (début et fin lus dans l'état). Tic-tac sur les 5 dernières secondes de réponse.
function startBar() {
  let lastSecond = null;
  return () => {
    const { start, deadline, accept, paused } = game.state;
    const total = Math.max(1, (deadline ?? 0) - (start ?? 0));
    // En pause, le chrono reste figé sur le temps restant.
    const left = paused ? paused.remaining : Math.max(0, (deadline ?? 0) - api.serverNow());
    const bar = $("#bar");
    const urgent = !paused && !game.pause && accept === "answers" && left <= 5000;
    if (bar) {
      bar.style.width = `${Math.min(100, (left / total) * 100)}%`;
      bar.classList.toggle("urgent", urgent);
    }
    const seconds = Math.ceil(left / 1000);
    if (urgent && seconds !== lastSecond && seconds > 0) sound.tick(seconds <= 2);
    lastSecond = seconds;
    const clock = $("#right");
    if (clock) clock.textContent = `${seconds} s`;
    return seconds;
  };
}

function answersHtml(question, { buttons = false, chips = null } = {}) {
  return question.answers.map((answer, i) => {
    const tag = buttons ? "button" : "div";
    return `
      <${tag} class="answer answer-${i}" ${buttons ? `data-choice="${i}"` : `aria-label="Réponse ${LETTERS[i]}"`}>
        <span class="letter">${LETTERS[i]}</span>
        <span class="text">${esc(answer)}${chips?.[i] ? `<span class="who">${chips[i]}</span>` : ""}</span>
      </${tag}>`;
  }).join("");
}

function questionBlock(question, { small = false } = {}) {
  if (!question) return "";
  return `
    <p class="theme"><b>${esc(question.theme)}</b> · ${esc(LEVEL_NAMES[question.lvl] ?? "")}${question.points ? ` · ${question.points} pts` : ""}</p>
    <p class="question ${small ? "small-q" : ""}">${esc(question.question)}</p>`;
}

function waitCard(title, text, people = []) {
  return `
    <div class="card narrow center wait-card">
      ${people.length ? `<div class="wait-people">${people.map((p) => avatarFor(p, "xl")).join("")}</div>` : ""}
      <h2>${title}</h2>
      ${text ? `<p class="muted">${text}</p>` : ""}
    </div>`;
}

const names = (uids) => uids.map((uid) => game.players?.[uid]?.name ?? "?").join(" et ");

/* ---------- Présentation d'une manche ---------- */

function showIntro() {
  const r = game.state.round;
  show(`intro:${r}`, () => {
    const meta = modeMeta();
    const scores = computeScores(game);
    root.innerHTML = `
      <div class="stack intro">
        <div class="center intro-head">
          <p class="eyebrow">Manche ${r + 1} / ${game.rounds?.length ?? 1}</p>
          <div class="intro-emoji">${meta.emoji}</div>
          <h1>${esc(meta.title)}</h1>
          <p class="intro-desc">${esc(meta.desc)}</p>
        </div>
        ${timerHtml()}
        ${r > 0 && scores.some((s) => s.score) ? rankingCard(false) : ""}
      </div>`;
    sound.reveal();
    // Annonce du looser élu juste après le vote.
    if (game.state.shame?.length) {
      onceShown(`${gameId}:shame`, () => {
        const hype = fun.shameHype(game);
        setTimeout(() => { fun.showHype(hype, avatarFor); sound.playHype(hype); }, 300);
      });
    }
    const bar = startBar();
    return { tick: bar };
  });
}

/* ---------- Question ---------- */

function modeInfoHtml() {
  const st = game.state;
  const mode = currentMode();
  const chip = (uid, extra = "") => `<span class="chip">${avatarFor(playerById(uid), "xs")}${esc(game.players?.[uid]?.name ?? "?")}${extra}</span>`;
  switch (mode) {
    case "mortSubite":
      return `<p class="mode-info">💀 Encore en vie : ${(st.alive ?? []).map((uid) => chip(uid)).join("")}</p>`;
    case "quitteDouble":
      return `<p class="mode-info">🎲 Cagnotte en jeu : <b>${2 ** st.ladder.k} pt${st.ladder.k ? "s" : ""}</b> · ${(st.ladder.in ?? []).map((uid) => chip(uid)).join("")}</p>`;
    case "paris": {
      const bets = game.bets?.[st.round]?.[st.step] ?? {};
      return `<p class="mode-info">🎰 Mises : ${participantsOf().map((p) => chip(p.uid, ` · ${bets[p.uid] ?? 1}`)).join("")}</p>`;
    }
    case "cadeau":
      return `<p class="mode-info">🎁 Cadeau de ${chip(st.chooser)} pour ${chip(st.gift?.target)} · ${LEVEL_NAMES[st.gift?.level]} (${modes.LEVEL_POINTS[st.gift?.level]} pts)</p>`;
    case "plateau":
      return `<p class="mode-info">🧩 Au tour de ${chip(st.chooser)}</p>`;
    case "duel":
      return `<p class="mode-info duel-line">${chip(st.duelists?.[0])} <b>⚔️</b> ${chip(st.duelists?.[1])}</p>`;
    case "rapide":
      return `<p class="mode-info">⚡ Plus vite tu réponds, plus tu marques (5 → 1 pt)</p>`;
    case "majorite":
      return `<p class="mode-info">🐑 Choisis la réponse que la majorité va choisir</p>`;
    case "espion":
      return `<p class="mode-info">🕵️ Réponse de l'équipe = la plus choisie · ${teamLogHtml()}</p>`;
    default:
      return "";
  }
}

// Pourquoi ce joueur ne répond pas à cette question.
function notEligibleCard() {
  const st = game.state;
  switch (currentMode()) {
    case "mortSubite": return waitCard("💀 Éliminé·e", "Tu es sorti·e de cette série. Regarde les survivants et chambre-les.");
    case "quitteDouble": {
      const banked = game.results?.[st.round] && Object.values(game.results[st.round]).some((step) => step?.[me]?.bank);
      return waitCard(banked ? "💰 Cagnotte encaissée" : "🎲 Hors de l'échelle", "La prochaine échelle repart avec tout le monde.");
    }
    case "cadeau": return waitCard(`🎁 ${esc(game.players?.[st.gift?.target]?.name ?? "?")} ouvre son cadeau`,
      st.chooser === me ? "S'il ou elle se trompe, les points sont pour toi." : "", [playerById(st.gift?.target)]);
    case "plateau": return waitCard(`${esc(game.players?.[st.chooser]?.name ?? "?")} répond`, "Regarde l'écran principal.", [playerById(st.chooser)]);
    case "duel": {
      const bet = game.bets?.[st.round]?.[0]?.[me];
      return waitCard("⚔️ Duel en cours", bet ? `Ton pari : ${esc(game.players?.[bet]?.name ?? "?")}` : "Tu n'as pas parié.", (st.duelists ?? []).map(playerById));
    }
    default: return waitCard("Patiente…", "");
  }
}

function showAsk() {
  const { round: r, step: s } = game.state;
  const host = isHost();
  const mode = currentMode();
  const isEligible = modes.eligible(game, activeIds()).includes(me);
  show(`ask:${r}:${s}:${host ? "h" : isEligible ? "p" : "w"}`, () => {
    const myQuestion = host ? null : modes.questionFor(game, me);
    const shared = modes.sharedQuestion(game);
    if (host) {
      root.innerHTML = mode === "echelle" ? `
        <div class="stack">
          <p class="eyebrow">${roundLabel()} · ${stepLabel()}</p>
          ${timerHtml()}
          <p class="tagline center">Chacun répond sur son téléphone à une question de son niveau.</p>
          <div class="ladder" id="ladder"></div>
        </div>` : `
        <div class="stack">
          <p class="eyebrow">${roundLabel()} · ${stepLabel()}</p>
          ${timerHtml()}
          ${modeInfoHtml()}
          ${questionBlock(shared)}
          <div class="answers">${answersHtml(shared)}</div>
          <div class="answered" id="answered"></div>
        </div>`;
    } else if (!isEligible) {
      root.innerHTML = `<div class="stack"><p class="eyebrow">${roundLabel()}</p>${timerHtml()}${notEligibleCard()}</div>`;
    } else {
      const extra = mode === "paris" ? `<p class="mode-info">🎰 Ta mise : <b>${game.bets?.[r]?.[s]?.[me] ?? 1} pt(s)</b></p>`
        : mode === "quitteDouble" ? `<p class="mode-info">🎲 En jeu : <b>${2 ** game.state.ladder.k}</b> · une erreur fait tout perdre</p>`
          : mode === "cadeau" ? `<p class="mode-info">🎁 Cadeau de ${esc(game.players?.[game.state.chooser]?.name ?? "?")} : ${modes.LEVEL_POINTS[game.state.gift.level]} pts en jeu</p>`
            : mode === "echelle" ? `<p class="mode-info">🪜 Niveau ${LEVEL_NAMES[game.state.levels?.[me] ?? 0]} · ${(game.state.levels?.[me] ?? 0) + 1} pt(s)</p>` : "";
      root.innerHTML = `
        <div class="stack">
          <p class="eyebrow">${roundLabel()} · ${stepLabel()}</p>
          ${timerHtml()}
          ${extra}
          ${questionBlock(myQuestion, { small: mode !== "echelle" && mode !== "cadeau" && mode !== "plateau" })}
          <div class="answers" id="answers">${answersHtml(myQuestion, { buttons: true })}</div>
          <p class="muted center" id="count"></p>
        </div>`;
      let picked = null;
      $("#answers").addEventListener("click", async (event) => {
        const button = event.target.closest("[data-choice]");
        if (!button || picked !== null || game.answers?.[r]?.[s]?.[me]) return;
        picked = Number(button.dataset.choice);
        navigator.vibrate?.(30);
        screen.update();
        try {
          await api.sendAnswer(gameId, r, s, picked);
        } catch {
          toast("Réponse arrivée trop tard.");
        }
      });
      const bar = startBar();
      return {
        update() {
          const mine = game.answers?.[r]?.[s]?.[me]?.choice ?? picked;
          root.querySelectorAll(".answer").forEach((b) => {
            b.disabled = mine !== null && mine !== undefined;
            b.classList.toggle("mine", Number(b.dataset.choice) === mine);
          });
          const who = modes.eligible(game, activeIds());
          const done = who.filter((uid) => game.answers?.[r]?.[s]?.[uid]).length;
          $("#count").textContent = who.length > 1 ? `${done} / ${who.length} réponses` : "";
        },
        tick: bar,
      };
    }
    const bar = startBar();
    return {
      update() {
        if (!host) return;
        const who = modes.eligible(game, activeIds());
        if (mode === "echelle") {
          $("#ladder").innerHTML = ladderHtml(game.state.levels ?? {}, (uid) => (game.answers?.[r]?.[s]?.[uid] ? "is-done" : "is-waiting"));
          return;
        }
        const done = who.filter((uid) => game.answers?.[r]?.[s]?.[uid]);
        $("#answered").innerHTML = `
          <span class="muted">${done.length} / ${who.length} ${who.length > 1 ? "ont répondu" : "a répondu"}</span>
          <span class="answered-list">${who.map((uid) => `<span class="${game.answers?.[r]?.[s]?.[uid] ? "is-done" : "is-waiting"}">${avatarFor(playerById(uid), "sm")}</span>`).join("")}</span>`;
      },
      tick: bar,
    };
  });
}

/* ---------- L'échelle ---------- */

function ladderHtml(levels, classFor = () => "", extraFor = () => "") {
  return [3, 2, 1, 0].map((lvl) => {
    const here = Object.entries(levels).filter(([, l]) => l === lvl).map(([uid]) => uid);
    return `
      <div class="rung rung-${lvl}">
        <span class="rung-label">${LEVEL_NAMES[lvl]}<small>${lvl + 1} pt${lvl ? "s" : ""}</small></span>
        <span class="rung-people">${here.map((uid) => `<span class="${classFor(uid)}">${avatarFor(playerById(uid), "lg")}${extraFor(uid)}</span>`).join("") || `<span class="muted small">—</span>`}</span>
      </div>`;
  }).join("");
}

/* ---------- Correction ---------- */

function revealNote() {
  const st = game.state;
  const res = game.results?.[st.round]?.[st.step] ?? {};
  const list = (test) => Object.entries(res).filter(([, e]) => test(e)).map(([uid]) => uid);
  switch (currentMode()) {
    case "mortSubite": {
      const out = list((e) => e.out);
      const winner = list((e) => e.bonus === 8);
      return [
        out.length ? `💀 Éliminé·e${out.length > 1 ? "s" : ""} : ${esc(names(out))}` : "",
        winner.length ? `🧟 ${esc(names(winner))} gagne la série : +8 !` : "",
        st.newSeries ? "🔄 Nouvelle série : tout le monde revient en jeu !" : "",
      ].filter(Boolean).join("<br>");
    }
    case "majorite":
      return st.majority?.length ? `🐑 La majorité a choisi ${st.majority.map((i) => LETTERS[i]).join(" et ")}` : "🐑 Pas de majorité cette fois : personne ne marque.";
    case "quitteDouble": {
      const lost = list((e) => e.lost);
      const stay = st.ladder?.in ?? [];
      return [
        lost.length ? `💸 Cagnotte perdue : ${esc(names(lost))}` : "",
        stay.length && st.ladder.k < 4 ? `🎲 ${esc(names(stay))} : encaisser ou doubler ?` : "",
        list((e) => e.bank).length ? `💰 Encaissé : ${esc(names(list((e) => e.bank)))}` : "",
      ].filter(Boolean).join("<br>");
    }
    case "cadeau": {
      const target = st.gift?.target;
      const ok = res[target]?.ok === 1;
      return ok ? `🎁 ${esc(game.players?.[target]?.name)} a trouvé : les points sont pour lui ou elle !`
        : `☠️ Raté ! Les points vont à ${esc(game.players?.[st.chooser]?.name)}.`;
    }
    case "espion": {
      const ok = st.teamChoice === modes.sharedQuestion(game)?.correct;
      return `${st.teamChoice >= 0 ? `🕵️ L'équipe a répondu ${LETTERS[st.teamChoice]} : ${ok ? "bonne réponse ✓" : "raté ✗"}` : "🕵️ Égalité dans l'équipe : la question est perdue ✗"} ${teamLogHtml()}`;
    }
    case "duel":
      return st.winner ? `⚔️ ${esc(game.players?.[st.winner]?.name)} remporte le duel (+5). Les bons parieurs gagnent 2 points.` : "⚔️ Personne n'a trouvé : pas de vainqueur.";
    case "paris": {
      const big = Object.entries(res).filter(([, e]) => Math.abs(e.pts ?? 0) >= 3);
      return big.length ? big.map(([uid, e]) => `${esc(game.players?.[uid]?.name)} ${e.pts > 0 ? "+" : ""}${e.pts}`).join(" · ") : "";
    }
    default:
      return "";
  }
}

function playReveal(r, s) {
  const hype = fun.hypeFor(game, { before: computeScores(game, { exclude: { r, s } }), after: computeScores(game) });
  return setTimeout(() => { fun.showHype(hype, avatarFor); sound.playHype(hype); }, SUSPENSE_MS + 700);
}

function reportButton(question) {
  if (isHost() || !question) return "";
  return `<button class="link report" id="report" data-key="${modes.questionKeyOf(question)}">🚩 Cette réponse est fausse ?</button>`;
}

function bindReport() {
  $("#report")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Merci, c'est signalé.";
    await api.reportQuestion(gameId, button.dataset.key).catch(() => {});
  });
}

function showReveal() {
  const { round: r, step: s } = game.state;
  show(`reveal:${r}:${s}`, () => {
    const mode = currentMode();
    const question = modes.sharedQuestion(game);
    const answers = game.answers?.[r]?.[s] ?? {};
    const mine = answers[me]?.choice;
    const chips = question.answers.map((_, i) => participantsOf()
      .filter((p) => answers[p.uid]?.choice === i)
      .map((p) => `<span class="chip">${avatarFor(p, "xs")}${esc(p.name)}</span>`).join(""));
    const note = revealNote();
    root.innerHTML = `
      <div class="reveal-layout">
        <div class="stack">
          <p class="eyebrow">${roundLabel()} · ${stepLabel()}</p>
          ${timerHtml()}
          ${questionBlock(question)}
          <div class="answers suspense" id="answers">${answersHtml(question, { chips })}</div>
          ${note ? `<p class="mode-info reveal-note">${note}</p>` : ""}
          ${reportButton(question)}
        </div>
        ${rankingCard()}
      </div>`;
    root.querySelectorAll(".answer").forEach((el, i) => {
      el.classList.add(i === question.correct ? "right" : i === mine ? "wrong" : "dim");
      if (mode === "majorite" && game.state.majority?.includes(i)) el.classList.add("majority");
    });
    $("#left-label").textContent = "Qui a répondu quoi ?";
    const revealTimer = setTimeout(() => {
      $("#answers")?.classList.remove("suspense");
      const label = $("#left-label");
      const myResult = game.results?.[r]?.[s]?.[me];
      if (label) label.textContent = isHost() || !myResult ? "Correction" : myResult.pts > 0 ? `+${myResult.pts} !` : myResult.pts < 0 ? `${myResult.pts}…` : "Raté…";
      sound.reveal();
    }, SUSPENSE_MS);
    bindReport();
    const hypeTimer = playReveal(r, s);
    const bar = startBar();
    return {
      tick() { bar(); $("#right").textContent = ""; },
      leave() { clearTimeout(hypeTimer); clearTimeout(revealTimer); },
    };
  });
}

function showLadderReveal() {
  const { round: r, step: s } = game.state;
  show(`reveal:${r}:${s}`, () => {
    const res = game.results?.[r]?.[s] ?? {};
    const myQuestion = modes.questionFor(game, me);
    const mine = game.answers?.[r]?.[s]?.[me]?.choice;
    root.innerHTML = `
      <div class="reveal-layout">
        <div class="stack">
          <p class="eyebrow">${roundLabel()} · ${stepLabel()}</p>
          ${timerHtml()}
          ${isHost() || !myQuestion ? `<div class="ladder">${ladderHtml(game.state.levels ?? {}, () => "",
            (uid) => (res[uid] ? `<b class="ladder-res ${res[uid].ok === 1 ? "up" : "down"}">${res[uid].ok === 1 ? `▲ +${res[uid].pts}` : "▼"}</b>` : ""))}</div>` : `
            ${questionBlock(myQuestion)}
            <div class="answers" id="answers">${answersHtml(myQuestion)}</div>
            <p class="mode-info reveal-note">${res[me]?.ok === 1 ? `▲ Tu montes : +${res[me].pts}` : "▼ Tu redescends d'un niveau"}</p>
            ${reportButton(myQuestion)}`}
        </div>
        ${rankingCard()}
      </div>`;
    root.querySelectorAll("#answers .answer").forEach((el, i) => {
      el.classList.add(i === myQuestion.correct ? "right" : i === mine ? "wrong" : "dim");
    });
    bindReport();
    sound.reveal();
    const hypeTimer = playReveal(r, s);
    const bar = startBar();
    return { tick() { bar(); $("#right").textContent = ""; }, leave() { clearTimeout(hypeTimer); } };
  });
}

/* ---------- Paris et duels : les mises ---------- */

function showBet() {
  const { round: r, step: s } = game.state;
  const duel = currentMode() === "duel";
  const host = isHost();
  const duelist = duel && (game.state.duelists ?? []).includes(me);
  show(`bet:${r}:${s}:${host ? "h" : duelist ? "d" : "p"}`, () => {
    const next = duel ? null : currentRound().questions[s];
    const [a, b] = game.state.duelists ?? [];
    root.innerHTML = `
      <div class="stack">
        <p class="eyebrow">${roundLabel()} · ${stepLabel()}</p>
        ${timerHtml()}
        ${duel ? `
          <div class="duel-vs">
            <div>${avatarFor(playerById(a), "xl")}<b>${esc(game.players?.[a]?.name ?? "?")}</b></div>
            <span class="vs">VS</span>
            <div>${avatarFor(playerById(b), "xl")}<b>${esc(game.players?.[b]?.name ?? "?")}</b></div>
          </div>
          <h2 class="center">${host ? "Pariez sur le gagnant !" : duelist ? "C'est ton duel ! Prépare-toi…" : "Qui va gagner ?"}</h2>` : `
          <div class="center">
            <h1>Faites vos jeux</h1>
            <p class="tagline">Prochaine question : <b>${esc(next?.theme ?? "")}</b> · ${esc(LEVEL_NAMES[next?.lvl] ?? "")}</p>
          </div>`}
        ${host || duelist ? `<div class="answered" id="betters"></div>` : `<div class="bet-grid" id="bets">${duel
          ? [a, b].map((uid) => `<button class="vote-card" data-bet="${esc(uid)}">${avatarFor(playerById(uid), "xl")}<b>${esc(game.players?.[uid]?.name ?? "?")}</b></button>`).join("")
          : [1, 2, 3, 5].map((v) => `<button class="bet-chip" data-bet="${v}"><b>${v}</b><span>pt${v > 1 ? "s" : ""}</span></button>`).join("")}</div>
          <p class="muted center">${duel ? "Bon pronostic : +2 points." : "Juste : tu gagnes ta mise. Faux : tu la perds. Sans choix, tu mises 1."}</p>`}
      </div>`;
    $("#bets")?.addEventListener("click", (event) => {
      const value = event.target.closest("[data-bet]")?.dataset.bet;
      if (!value) return;
      navigator.vibrate?.(20);
      api.sendBet(gameId, r, s, duel ? value : Number(value)).catch(() => toast("Mise non enregistrée."));
    });
    const bar = startBar();
    return {
      update() {
        const bets = game.bets?.[r]?.[s] ?? {};
        root.querySelectorAll("[data-bet]").forEach((el) => el.classList.toggle("on", String(bets[me]) === el.dataset.bet));
        const bettors = participantsOf().filter((p) => !(duel && (game.state.duelists ?? []).includes(p.uid)));
        const el = $("#betters");
        if (el) el.innerHTML = `<span class="muted">${bettors.filter((p) => bets[p.uid] !== undefined).length} / ${bettors.length} ont parié</span>
          <span class="answered-list">${bettors.map((p) => `<span class="${bets[p.uid] !== undefined ? "is-done" : "is-waiting"}">${avatarFor(p, "sm")}</span>`).join("")}</span>`;
      },
      tick: bar,
    };
  });
}

/* ---------- Quitte ou double : encaisser ou doubler ---------- */

function showDecide() {
  const { round: r, step: s } = game.state;
  const deciding = (game.state.ladder?.in ?? []).includes(me) && !isHost();
  show(`decide:${r}:${s}:${deciding ? "p" : "w"}`, () => {
    const pot = game.state.ladder?.pots?.[me] ?? 0;
    root.innerHTML = `
      <div class="stack">
        <p class="eyebrow">${roundLabel()} · ${stepLabel()}</p>
        ${timerHtml()}
        ${deciding ? `
          <h1 class="center">Quitte ou double ?</h1>
          <p class="tagline center">Ta cagnotte : <b>${pot} pt${pot > 1 ? "s" : ""}</b>. La prochaine question est plus dure.</p>
          <div class="decide-grid" id="decide">
            <button class="decide bank" data-decide="bank">💰<b>Encaisser</b><span>+${pot} pt${pot > 1 ? "s" : ""} assuré${pot > 1 ? "s" : ""}</span></button>
            <button class="decide double" data-decide="double">🎲<b>Doubler</b><span>${pot * 2} pts ou rien</span></button>
          </div>` : `
          <h2 class="center">Encaisser ou doubler ?</h2>
          <div class="answered" id="deciders"></div>`}
      </div>`;
    $("#decide")?.addEventListener("click", (event) => {
      const choice = event.target.closest("[data-decide]")?.dataset.decide;
      if (!choice) return;
      navigator.vibrate?.(30);
      api.sendDecision(gameId, r, s, choice).catch(() => toast("Choix non enregistré."));
    });
    const bar = startBar();
    return {
      update() {
        const choices = game.decisions?.[r]?.[s] ?? {};
        root.querySelectorAll("[data-decide]").forEach((el) => el.classList.toggle("on", choices[me] === el.dataset.decide));
        const el = $("#deciders");
        if (el) {
          const who = game.state.ladder?.in ?? [];
          el.innerHTML = `<span class="answered-list">${who.map((uid) => `<span class="${choices[uid] ? "is-done" : "is-waiting"}">${avatarFor(playerById(uid), "lg")}<small>${game.state.ladder.pots?.[uid] ?? 0} pt${(game.state.ladder.pots?.[uid] ?? 0) > 1 ? "s" : ""}</small></span>`).join("")}</span>`;
        }
      },
      tick: bar,
    };
  });
}

/* ---------- Plateau et cadeau : choisir ---------- */

function boardMarkup(canChoose) {
  const round = currentRound();
  const grouped = new Map();
  round.board.forEach((question, index) => {
    if (!grouped.has(question.theme)) grouped.set(question.theme, []);
    grouped.get(question.theme).push({ question, index });
  });
  return [...grouped.entries()].map(([theme, cells]) => `
    <section class="board-category">
      <h3>${esc(theme)}</h3>
      <div class="board-tiles">
        ${cells.map(({ question, index }) => {
          const used = Boolean(game.state.used?.[index]);
          return `<button class="board-tile level-${question.difficulty} ${used ? "used" : ""}" data-board-index="${index}" aria-label="${esc(theme)}, ${esc(LEVEL_NAMES[question.lvl])}, ${question.points} points" ${used || !canChoose ? "disabled" : ""}>
            <b>${used ? "✓" : question.points}</b>
            <span>${used ? "Jouée" : esc(LEVEL_NAMES[question.lvl])}</span>
          </button>`;
        }).join("")}
      </div>
    </section>`).join("");
}

function showPick() {
  const { round: r, step: s, chooser } = game.state;
  const mine = chooser === me && !isHost();
  const mode = currentMode();
  show(`pick:${r}:${s}:${mine ? "c" : "w"}`, () => {
    const current = playerById(chooser);
    if (mode === "plateau") {
      root.innerHTML = `
        <div class="stack">
          <p class="eyebrow">${roundLabel()} · ${stepLabel()}</p>
          ${timerHtml()}
          <p class="tagline turn">${avatarFor(current, "sm")}<span>${mine ? "À toi de choisir une case : tu seras seul·e à répondre." : `Au tour de ${esc(current.name ?? "?")} de choisir une case.`}</span></p>
          <div class="board" id="board"></div>
        </div>`;
      $("#board").addEventListener("click", async (event) => {
        const button = event.target.closest("[data-board-index]");
        if (!button || button.disabled) return;
        root.querySelectorAll("[data-board-index]").forEach((tile) => { tile.disabled = true; });
        await api.sendPick(gameId, r, s, Number(button.dataset.boardIndex)).catch(() => toast("Cette case n'a pas pu être choisie."));
      });
      const bar = startBar();
      return { update() { $("#board").innerHTML = boardMarkup(mine); }, tick: bar };
    }
    // Cadeau empoisonné
    if (!mine) {
      root.innerHTML = `<div class="stack"><p class="eyebrow">${roundLabel()} · ${stepLabel()}</p>${timerHtml()}
        ${waitCard(`🎁 ${esc(current.name ?? "?")} prépare un cadeau…`, "Qui va devoir répondre ? Et à quelle difficulté ?", [current])}</div>`;
      return { tick: startBar() };
    }
    let target = null;
    let level = null;
    const others = answeringPlayers().filter((p) => p.uid !== me);
    root.innerHTML = `
      <div class="stack">
        <p class="eyebrow">${roundLabel()} · ${stepLabel()}</p>
        ${timerHtml()}
        <h1>Ton cadeau</h1>
        <p class="tagline">S'il ou elle trouve, il ou elle gagne les points. Sinon, c'est pour toi.</p>
        <h2>Pour qui ?</h2>
        <div class="vote-grid" id="targets">${others.map((p) => `<button class="vote-card" data-target="${esc(p.uid)}">${avatarFor(p, "lg")}<b>${esc(p.name)}</b></button>`).join("")}</div>
        <h2>Quelle difficulté ?</h2>
        <div class="bet-grid" id="levels">${LEVEL_NAMES.map((name, i) => `<button class="bet-chip level-${modes.LEVELS[i]}" data-level="${i}"><b>${modes.LEVEL_POINTS[i]}</b><span>${name}</span></button>`).join("")}</div>
        <button class="primary big sticky-cta" id="send-gift" disabled>Choisis une personne et une difficulté</button>
      </div>`;
    const refresh = () => {
      root.querySelectorAll("[data-target]").forEach((el) => el.classList.toggle("on", el.dataset.target === target));
      root.querySelectorAll("[data-level]").forEach((el) => el.classList.toggle("on", Number(el.dataset.level) === level));
      $("#send-gift").disabled = !(target && level !== null);
      $("#send-gift").textContent = target && level !== null ? `🎁 Offrir à ${game.players?.[target]?.name}` : "Choisis une personne et une difficulté";
    };
    $("#targets").addEventListener("click", (e) => { target = e.target.closest("[data-target]")?.dataset.target ?? target; refresh(); });
    $("#levels").addEventListener("click", (e) => { const l = e.target.closest("[data-level]")?.dataset.level; if (l !== undefined) level = Number(l); refresh(); });
    $("#send-gift").addEventListener("click", async () => {
      $("#send-gift").disabled = true;
      await api.sendPick(gameId, r, s, { target, level }).catch(() => toast("Cadeau non envoyé."));
    });
    return { tick: startBar() };
  });
}

/* ---------- Contre-la-montre ---------- */

function sprintCounts(r, s) {
  const list = currentRound().lists?.[s] ?? [];
  return participantsOf().map((p) => {
    const answers = Object.entries(game.sprint?.[r]?.[s]?.[p.uid] ?? {});
    return { ...p, right: answers.filter(([i, a]) => a?.choice === list[i]?.correct).length, done: answers.length };
  }).sort((a, b) => b.right - a.right);
}

function showSprint() {
  const { round: r, step: s } = game.state;
  const host = isHost();
  show(`sprint:${r}:${s}:${host ? "h" : "p"}`, () => {
    if (host) {
      root.innerHTML = `
        <div class="stack">
          <p class="eyebrow">${roundLabel()} · ${stepLabel()}</p>
          ${timerHtml()}
          <h1 class="center">À vos téléphones !</h1>
          <ul class="sprint-board" id="sprint-board"></ul>
        </div>`;
      const bar = startBar();
      return {
        update() {
          const counts = sprintCounts(r, s);
          const best = Math.max(1, ...counts.map((c) => c.right));
          $("#sprint-board").innerHTML = counts.map((c) => `
            <li>${avatarFor(c, "lg")}<span class="sprint-name">${esc(c.name)}</span>
              <span class="sprint-bar"><span style="width:${(c.right / best) * 100}%"></span></span>
              <b>${c.right}</b></li>`).join("");
        },
        tick: bar,
      };
    }
    const list = currentRound().lists?.[s] ?? [];
    let index = Object.keys(game.sprint?.[r]?.[s]?.[me] ?? {}).length;
    let lockedUntil = 0;
    let right = 0;
    root.innerHTML = `
      <div class="stack sprint">
        <p class="eyebrow">${roundLabel()} · ${stepLabel()}</p>
        ${timerHtml()}
        <div class="sprint-score"><span id="sprint-right">0</span> bonne(s) réponse(s)</div>
        <div id="sprint-q"></div>
        <div class="sprint-lock" id="lock" hidden>✘ Raté ! Attends…</div>
      </div>`;
    const render = () => {
      const q = list[index];
      $("#sprint-right").textContent = right;
      $("#sprint-q").innerHTML = q ? `${questionBlock(q)}<div class="answers" id="answers">${answersHtml(q, { buttons: true })}</div>`
        : `<p class="tagline center">Plus de questions dans ce sprint, bravo !</p>`;
    };
    $("#sprint-q").addEventListener("click", async (event) => {
      const button = event.target.closest("[data-choice]");
      const q = list[index];
      if (!button || !q || Date.now() < lockedUntil) return;
      const choice = Number(button.dataset.choice);
      const ok = choice === q.correct;
      button.classList.add(ok ? "right" : "wrong");
      navigator.vibrate?.(ok ? 20 : [40, 40, 40]);
      api.sendSprint(gameId, r, s, index, choice).catch(() => {});
      index++;
      if (ok) { right++; sound.pop(); setTimeout(render, 150); return; }
      lockedUntil = Date.now() + modes.SPRINT_LOCK_MS;
      $("#lock").hidden = false;
      setTimeout(() => { $("#lock").hidden = true; render(); }, modes.SPRINT_LOCK_MS);
    });
    render();
    return { tick: startBar() };
  });
}

function showSprintReveal() {
  const { round: r, step: s } = game.state;
  show(`reveal:${r}:${s}`, () => {
    const res = game.results?.[r]?.[s] ?? {};
    const rows = participantsOf().map((p) => ({ ...p, pts: res[p.uid]?.pts ?? 0, done: res[p.uid]?.done ?? 0 })).sort((a, b) => b.pts - a.pts);
    root.innerHTML = `
      <div class="reveal-layout">
        <div class="stack">
          <p class="eyebrow">${roundLabel()} · ${stepLabel()}</p>
          ${timerHtml()}
          <h1>Fin du sprint</h1>
          <ul class="list score">${rows.map((p, i) => `<li class="${p.uid === me ? "me" : ""}"><span class="rank">${i + 1}</span>${avatarFor(p)}<span class="name">${esc(p.name)}</span><span class="muted small">${p.pts} / ${p.done}</span><span class="gain">+${p.pts}</span></li>`).join("")}</ul>
        </div>
        ${rankingCard()}
      </div>`;
    sound.reveal();
    const hypeTimer = playReveal(r, s);
    const bar = startBar();
    return { tick() { bar(); $("#right").textContent = ""; }, leave() { clearTimeout(hypeTimer); } };
  });
}

/* ---------- Vote du looser ---------- */

function showVote() {
  show("vote", () => {
    const host = isHost();
    root.innerHTML = `
      <div class="stack">
        <header class="center">
          <p class="eyebrow">Fin de la première manche</p>
          <h1>Élisez le looser</h1>
          <p class="tagline">${host ? "Votez sur vos téléphones. La personne choisie portera le chapeau 💩 jusqu'à la fin." : "Qui mérite le chapeau 💩 pour la suite ? Vote secret."}</p>
        </header>
        ${timerHtml()}
        <div class="vote-grid" id="vote-grid"></div>
        <p class="muted center" id="vote-count"></p>
      </div>`;
    if (!host) {
      $("#vote-grid").addEventListener("click", async (event) => {
        const target = event.target.closest("[data-vote]")?.dataset.vote;
        if (!target) return;
        navigator.vibrate?.(30);
        await api.sendVote(gameId, target).catch(() => toast("Vote non enregistré."));
      });
    }
    const bar = startBar();
    return {
      update() {
        const mine = game.votes?.[me];
        const candidates = participantsOf().filter((p) => p.uid !== me);
        $("#vote-grid").innerHTML = candidates.map((p) => {
          const voted = Boolean(game.votes?.[p.uid]);
          return host
            ? `<div class="vote-card ${voted ? "voted" : ""}">${avatarFor(p, "xl")}<b>${esc(p.name)}</b><span class="muted small">${voted ? "a voté ✓" : "réfléchit…"}</span></div>`
            : `<button class="vote-card ${mine === p.uid ? "on" : ""}" data-vote="${esc(p.uid)}">${avatarFor(p, "xl")}<b>${esc(p.name)}</b></button>`;
        }).join("");
        const voters = answeringPlayers();
        const count = voters.filter((p) => game.votes?.[p.uid]).length;
        $("#vote-count").textContent = host
          ? `${count} / ${voters.length} votes`
          : mine ? `Tu as voté pour ${game.players?.[mine]?.name ?? "?"}. Tu peux encore changer d'avis.` : "Touche un joueur pour voter.";
      },
      tick: bar,
    };
  });
}

/* ---------- Jeux à part entière : l'espion et l'undercover ---------- */

let hostSkipKey = null;
const skipButton = (label) => (isHost() ? `<button class="big" id="host-skip">${label}</button>` : "");
function bindSkip() {
  $("#host-skip")?.addEventListener("click", (event) => {
    event.currentTarget.disabled = true;
    hostSkipKey = `${game.state.phase}:${game.state.round}:${game.state.step}`;
  });
}

function teamLogHtml() {
  const log = game.state.teamLog ?? [];
  return `<div class="team-log">${Array.from({ length: 5 }, (_, i) => `<span class="${log[i] === 1 ? "ok" : log[i] === 0 ? "ko" : ""}">${log[i] === 1 ? "✓" : log[i] === 0 ? "✗" : i + 1}</span>`).join("")}</div>`;
}

// L'espion : chacun découvre son rôle en secret.
function showRole() {
  const { round: r, g } = game.state;
  show(`role:${r}:${g}`, () => {
    const spy = game.state.spy === me;
    root.innerHTML = isHost() ? `
      <div class="stack center">
        <p class="eyebrow">${roundLabel()} · partie ${g + 1}</p>
        <div class="intro-emoji">🕵️</div>
        <h1>Un espion se cache parmi vous</h1>
        <p class="intro-desc">Regardez votre rôle sur votre téléphone, sans le montrer. L'équipe répond ensemble à 5 questions : la réponse la plus choisie l'emporte. L'espion doit faire perdre l'équipe sans se faire repérer.</p>
        ${timerHtml()}
        ${skipButton("Tout le monde est prêt ⏭")}
      </div>` : `
      <div class="stack">
        <p class="eyebrow">${roundLabel()} · partie ${g + 1}</p>
        ${timerHtml()}
        <div class="secret-card ${spy ? "spy" : "team"}" id="secret">
          <p class="secret-hint">Appuie pour révéler ton rôle (cache l'écran)</p>
          <div class="secret-content">
            <div class="intro-emoji">${spy ? "🕵️" : "🤝"}</div>
            <h1>${spy ? "Tu es l'espion" : "Tu es dans l'équipe"}</h1>
            <p>${spy ? "Fais perdre l'équipe : pousse-la vers les mauvaises réponses, sans te faire démasquer au vote final." : "Un espion se cache parmi vous. Répondez juste… et repérez qui vous fait perdre."}</p>
          </div>
        </div>
      </div>`;
    $("#secret")?.addEventListener("click", (event) => event.currentTarget.classList.toggle("open"));
    bindSkip();
    return { tick: startBar() };
  });
}

// Undercover : chacun découvre son mot.
function showWord() {
  const { round: r } = game.state;
  const uc = game.state.uc;
  show(`word:${r}:${uc.g}`, () => {
    const word = uc.words?.[me];
    root.innerHTML = isHost() || !word ? `
      <div class="stack center">
        <p class="eyebrow">${roundLabel()} · partie ${uc.g + 1}</p>
        <div class="intro-emoji">🎭</div>
        <h1>Regardez votre mot</h1>
        <p class="intro-desc">Les civils ont tous le même mot. ${Object.values(uc.roles).filter((x) => x === "undercover").length > 1 ? "Deux undercovers ont" : "Un undercover a"} un mot voisin… sans le savoir. Thème : <b>${esc(uc.theme)}</b>.</p>
        ${timerHtml()}
        ${skipButton("Tout le monde a vu son mot ⏭")}
      </div>` : `
      <div class="stack">
        <p class="eyebrow">${roundLabel()} · partie ${uc.g + 1} · thème ${esc(uc.theme)}</p>
        ${timerHtml()}
        <div class="secret-card word" id="secret">
          <p class="secret-hint">Appuie pour révéler ton mot (cache l'écran)</p>
          <div class="secret-content">
            <p class="muted">Ton mot secret</p>
            <p class="secret-word">${esc(word)}</p>
            <p class="muted small">Personne ne sait s'il est civil ou undercover. Tes indices doivent rester assez vagues !</p>
          </div>
        </div>
      </div>`;
    $("#secret")?.addEventListener("click", (event) => event.currentTarget.classList.toggle("open"));
    bindSkip();
    return { tick: startBar() };
  });
}

function showClue() {
  const { round: r, step: s, chooser } = game.state;
  const uc = game.state.uc;
  show(`clue:${r}:${s}`, () => {
    const speaker = playerById(chooser);
    const mine = chooser === me;
    const order = uc.order.filter((uid) => uc.alive.includes(uid));
    root.innerHTML = `
      <div class="stack">
        <p class="eyebrow">${roundLabel()} · tour d'indices ${uc.cycle}</p>
        ${timerHtml()}
        <div class="center speaker">
          ${avatarFor(speaker, "xl")}
          <h1>${mine ? "À toi !" : `${esc(speaker.name ?? "?")} parle`}</h1>
          <p class="intro-desc">${mine ? "Donne un indice à voix haute (un seul mot ou une courte phrase), puis valide." : "Écoute son indice."}</p>
        </div>
        ${mine ? `<button class="primary big" id="clue-done">✔ J'ai donné mon indice</button>` : ""}
        ${!isHost() && uc.words?.[me] ? `<p class="center muted small">Ton mot : <b>${esc(uc.words[me])}</b></p>` : ""}
        <div class="clue-order">${order.map((uid, i) => `<span class="${i < uc.turn ? "done" : i === uc.turn ? "now" : ""}">${avatarFor(playerById(uid), "sm")}</span>`).join("")}</div>
        ${skipButton("Indice suivant ⏭")}
      </div>`;
    $("#clue-done")?.addEventListener("click", async (event) => {
      event.currentTarget.disabled = true;
      await api.sendPick(gameId, r, s, true).catch(() => toast("Non envoyé, réessaie."));
    });
    bindSkip();
    return { tick: startBar() };
  });
}

function showBallot() {
  const { round: r, step: s } = game.state;
  const mode = currentMode();
  const uc = game.state.uc;
  const voters = mode === "undercover" ? uc.alive : participantsOf().map((p) => p.uid);
  const canVote = !isHost() && voters.includes(me);
  show(`ballot:${r}:${s}:${canVote ? "v" : "w"}`, () => {
    const candidates = (mode === "undercover" ? uc.alive : (game.state.team ?? participantsOf().map((p) => p.uid))).filter((uid) => uid !== me);
    root.innerHTML = `
      <div class="stack">
        <header class="center">
          <p class="eyebrow">${roundLabel()}</p>
          <h1>${mode === "espion" ? "Qui est l'espion ?" : "Qui éliminer ?"}</h1>
          <p class="tagline">${mode === "espion" ? `L'équipe a eu ${(game.state.teamLog ?? []).filter((x) => x === 1).length} bonne(s) réponse(s) sur 5. Discutez, puis votez.` : "Discutez, puis votez pour la personne qui vous semble être l'undercover."}</p>
          ${mode === "espion" ? teamLogHtml() : ""}
        </header>
        ${timerHtml()}
        <div class="vote-grid" id="ballot-grid"></div>
        <p class="muted center" id="ballot-count"></p>
        ${skipButton("Clore le vote ⏭")}
      </div>`;
    if (canVote) {
      $("#ballot-grid").addEventListener("click", async (event) => {
        const target = event.target.closest("[data-ballot]")?.dataset.ballot;
        if (!target) return;
        navigator.vibrate?.(30);
        await api.sendBallot(gameId, r, s, target).catch(() => toast("Vote non enregistré."));
      });
    }
    bindSkip();
    return {
      update() {
        const ballots = game.ballots?.[r]?.[s] ?? {};
        $("#ballot-grid").innerHTML = (isHost() ? voters : candidates).map((uid) => {
          const p = playerById(uid);
          return canVote
            ? `<button class="vote-card ${ballots[me] === uid ? "on" : ""}" data-ballot="${esc(uid)}">${avatarFor(p, "xl")}<b>${esc(p.name ?? "?")}</b></button>`
            : `<div class="vote-card ${ballots[uid] ? "voted" : ""}">${avatarFor(p, "xl")}<b>${esc(p.name ?? "?")}</b><span class="muted small">${ballots[uid] ? "a voté ✓" : "réfléchit…"}</span></div>`;
        }).join("");
        const done = voters.filter((uid) => ballots[uid]).length;
        $("#ballot-count").textContent = canVote && ballots[me]
          ? `Tu as voté pour ${game.players?.[ballots[me]]?.name ?? "?"}. Tu peux changer d'avis.` : `${done} / ${voters.length} votes`;
      },
      tick: startBar(),
    };
  });
}

function showVerdict() {
  const { round: r, step: s } = game.state;
  show(`verdict:${r}:${s}`, () => {
    const mode = currentMode();
    const accused = game.state.accused;
    const p = accused ? playerById(accused) : null;
    let title = "";
    let line = "";
    if (mode === "espion") {
      const spy = playerById(game.state.spy);
      title = game.state.found ? "Espion démasqué !" : "L'espion s'en sort !";
      line = accused
        ? `${esc(p.name)} ${game.state.found ? "était bien l'espion" : "était innocent·e"}. ${game.state.found ? "+1 pour chaque membre de l'équipe." : `L'espion était ${esc(spy.name)} : +2 pour lui ou elle.`}`
        : `Pas de majorité : l'espion (${esc(spy.name)}) passe entre les mailles. +2 pour lui ou elle.`;
    } else {
      const uc = game.state.uc;
      const role = accused ? uc.roles[accused] : null;
      title = !accused ? "Personne ne sort" : role === "undercover" ? "Bien vu : undercover !" : "Raté : c'était un·e civil·e…";
      line = accused ? `${esc(p.name)} était ${role === "undercover" ? "undercover" : "civil·e"} (mot : « ${esc(uc.words[accused])} »).` : "Égalité au vote : on refait un tour d'indices.";
      if (uc.winner) line += uc.winner === "civils" ? " Les civils gagnent : +2 chacun !" : " L'undercover gagne : +4 !";
    }
    root.innerHTML = `
      <div class="stack center verdict">
        <p class="eyebrow">${roundLabel()}</p>
        ${p ? avatarFor(p, "xl") : `<div class="intro-emoji">🤷</div>`}
        <h1>${title}</h1>
        <p class="intro-desc">${line}</p>
        ${timerHtml()}
      </div>`;
    const hype = fun.verdictHype(game);
    const timer = setTimeout(() => { fun.showHype(hype, avatarFor); sound.playHype(hype); }, 900);
    return { tick: startBar(), leave() { clearTimeout(timer); } };
  });
}

// Fin d'une partie d'espion ou d'undercover : partie suivante ou mode suivant.
function showGameEnd() {
  const { round: r, step: s } = game.state;
  show(`end:${r}:${s}`, () => {
    const mode = currentMode();
    const round = currentRound();
    const g = mode === "espion" ? game.state.g : game.state.uc.g;
    const more = mode === "espion" ? g + 1 < (round.games?.length ?? 0) : g + 1 < (round.pairs?.length ?? 0);
    let recap = "";
    if (mode === "espion") {
      recap = `L'espion était <b>${esc(game.players?.[game.state.spy]?.name ?? "?")}</b>. ${teamLogHtml()}`;
    } else {
      const uc = game.state.uc;
      const civilWord = Object.entries(uc.words).find(([uid]) => uc.roles[uid] === "civil")?.[1];
      const ucWord = Object.entries(uc.words).find(([uid]) => uc.roles[uid] === "undercover")?.[1];
      const undercovers = Object.keys(uc.roles).filter((uid) => uc.roles[uid] === "undercover");
      recap = `${uc.winner === "civils" ? "🎉 Les civils gagnent" : "🎭 L'undercover gagne"}.<br>Civils : « ${esc(civilWord)} » · Undercover (${esc(names(undercovers))}) : « ${esc(ucWord)} »`;
    }
    root.innerHTML = `
      <div class="reveal-layout">
        <div class="stack center">
          <p class="eyebrow">${roundLabel()} · partie ${g + 1} terminée</p>
          <div class="intro-emoji">${modeMeta().emoji}</div>
          <p class="intro-desc">${recap}</p>
          <div class="actions" id="end-actions">
            ${more ? `<button class="primary big" data-choice-end="again">🔁 Partie suivante</button>` : ""}
            <button class="big" data-choice-end="next">⏭ Passer à la suite</button>
          </div>
        </div>
        ${rankingCard(false)}
      </div>`;
    $("#end-actions").addEventListener("click", async (event) => {
      const choice = event.target.closest("[data-choice-end]")?.dataset.choiceEnd;
      if (!choice) return;
      root.querySelectorAll("[data-choice-end]").forEach((b) => { b.disabled = true; });
      await api.sendChoice(gameId, r, s, choice).catch(() => toast("Choix non enregistré."));
    });
    return {};
  });
}

/* ---------- Fin de partie ---------- */

function showFinal() {
  show("finished", () => {
    const scores = computeScores(game);
    const best = scores[0]?.score ?? 0;
    const winners = scores.filter((s) => s.score === best).map((s) => s.name).join(" et ");
    const awardList = fun.awards(game, scores);
    const host = isHost();
    root.innerHTML = `
      <div class="stack">
        <header class="center">
          <p class="eyebrow">${game.state.stoppedEarly ? "Partie terminée plus tôt" : "Fin de la partie"}</p>
          <p class="muted">${winners.includes(" et ") ? "Égalité entre" : "Victoire de"}</p>
          <p class="winner">${esc(winners)}</p>
        </header>
        <div class="podium">
          ${[1, 0, 2].map((rank) => scores[rank] ? `
            <div class="step step-${rank + 1}">
              ${avatarFor(playerById(scores[rank].uid), "xl")}
              <b>${esc(scores[rank].name)}</b>
              <span>${scores[rank].score} pts</span>
              <div class="block">${rank + 1}</div>
            </div>` : "").join("")}
        </div>
        <div class="actions">
          ${host ? `<button class="primary big" id="rematch">🔁 Revanche !</button>` : `<button class="primary big pulse" id="join-next" hidden>🔁 Rejoindre la revanche</button>`}
          <button class="big" id="share">📸 Partager le récap</button>
        </div>
        ${awardList.length ? `
        <section class="card">
          <h2>Les titres de la soirée</h2>
          <ul class="awards">
            ${awardList.map((award, i) => `
              <li style="--delay:${(i * 0.25).toFixed(2)}s">
                <span class="award-emoji">${award.emoji}</span>
                <span class="award-people">${award.uids.map((uid) => avatarFor(playerById(uid), "lg")).join("")}</span>
                <span class="award-text"><b>${esc(award.title)}</b><span>${esc(award.names)}</span><small>${esc(award.detail)}</small></span>
              </li>`).join("")}
          </ul>
        </section>` : ""}
        <section class="card">
          <h2>Classement final</h2>
          <ul class="list score">${scoreList(scores, false)}</ul>
        </section>
        ${game.group ? `<section class="card"><h2>Palmarès · ${esc(game.groupName ?? "")}</h2><div id="palmares"><p class="muted">Mise à jour de l'historique…</p></div></section>` : ""}
        ${host && game.reports ? `
        <section class="card">
          <h2>Questions signalées</h2>
          <ul class="list reports">
            ${Object.entries(game.reports).map(([key, voters]) => {
              const q = api.findQuestion(game, key);
              return q ? `<li><span class="grow"><b>${esc(q.question)}</b><span class="muted small">Réponse donnée : ${esc(q.answers[q.correct])} · ${esc(q.theme)}</span></span><span class="tag">🚩 ${Object.keys(voters).length}</span></li>` : "";
            }).join("")}
          </ul>
          <p class="hint">Elles sont aussi enregistrées dans Firebase (dossier « reports ») pour nettoyer la banque de questions.</p>
        </section>` : ""}
        <button class="link" id="home">Retour à l'accueil</button>
      </div>`;

    $("#home").addEventListener("click", goHome);
    $("#rematch")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        location.hash = `#/partie/${await api.createRematch(gameId, game)}`;
      } catch (error) {
        console.error(error);
        button.disabled = false;
        toast("Impossible de créer la revanche.");
      }
    });
    $("#join-next")?.addEventListener("click", async () => {
      try {
        await api.joinGame(game.next, game.players[me]?.name ?? load(NAME_KEY), game.players[me]?.avatar ?? myAvatar());
        location.hash = `#/partie/${game.next}`;
      } catch (error) {
        toast(error.message || "Impossible de rejoindre la revanche.");
      }
    });
    $("#share").addEventListener("click", async () => {
      try {
        const blob = await fun.recapImage(game, scores, awardList);
        const file = new File([blob], "quizz-recap.png", { type: "image/png" });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: game.name });
        } else {
          const link = document.createElement("a");
          link.href = URL.createObjectURL(blob);
          link.download = "quizz-recap.png";
          link.click();
          setTimeout(() => URL.revokeObjectURL(link.href), 2000);
        }
      } catch (error) {
        if (error?.name !== "AbortError") toast("Le récap n'a pas pu être créé.");
      }
    });

    fun.celebrate();
    sound.finale();
    let palmaresLoaded = false;
    return {
      update() {
        const joinNext = $("#join-next");
        if (joinNext && game.next && joinNext.hidden) {
          joinNext.hidden = false;
          toast("Une revanche est lancée !");
        }
        if (game.recorded && !palmaresLoaded) {
          palmaresLoaded = true;
          setTimeout(() => loadPalmares("#palmares"), 1500);
        }
      },
    };
  });
}

/* ---------- Avancement automatique (écran principal) ---------- */

// Évite de relancer la même transition à chaque tic, tout en réessayant si elle a échoué.
function once(key, action) {
  const last = attempts.get(key) ?? 0;
  if (Date.now() - last < 3000) return;
  attempts.set(key, Date.now());
  Promise.resolve(action()).catch(console.error);
}

// Une génération par « version » des thèmes : si le créateur passe au plan B (sans thèmes libres),
// une nouvelle génération démarre aussitôt, et l'ancienne, devenue inutile, ne touche plus à rien.
async function runGeneration() {
  const id = gameId;
  const runKey = `${id}:${Boolean(game.state.noAi)}`;
  if (generating === runKey) return;
  generating = runKey;
  try {
    await api.generateQuestions(id, game, aiApiKey);
  } catch (error) {
    console.error(error);
    const stillCurrent = gameId === id && game?.state.phase === "generating" && `${id}:${Boolean(game.state.noAi)}` === runKey;
    if (stillCurrent) await api.setGenerationError(id, error.message || "La génération a échoué.").catch(console.error);
  } finally {
    if (generating === runKey) generating = false;
  }
}

// Un joueur dont le téléphone s'est mis en veille garde son tour quelques secondes.
function goneFor(uid, now) {
  const player = game.players?.[uid];
  if (!player) return Infinity;
  if (player.connected) return 0;
  return player.offlineAt ? now - player.offlineAt : Infinity;
}

function drive() {
  if (!game?.players?.[me] || !isHost()) return;
  const { phase, error } = game.state;
  const now = api.serverNow();
  const key = `${gameId}:${phase}:${game.state.round ?? ""}:${game.state.step ?? ""}`;

  if (phase === "themes") {
    api.prefetchThemes(gameId, game, aiApiKey).catch(console.error);
    const everyone = participantsOf();
    if (bankIndex && everyone.length && everyone.every((p) => themesDone(p.uid))) once(`${key}:${Boolean(game.state.noAi)}`, () => api.startGeneration(gameId));
  } else if (phase === "generating" && !error) {
    runGeneration();
  } else if (phase === "finished") {
    if (!game.recorded) {
      once(key, () => {
        const scores = computeScores(game);
        return api.recordResults(gameId, game, scores, fun.awards(game, scores));
      });
    }
  } else if (game.rounds) {
    // Fin anticipée, pause et reprise : demandées par n'importe qui, appliquées ici.
    if (game.stop) return once(`${key}:stop`, () => api.applyStop(gameId));
    if (game.pause && !game.state.paused) return once(`${key}:pause`, () => api.applyPause(gameId, game.pause.by));
    if (!game.pause && game.state.paused) return once(`${key}:resume`, () => api.applyResume(gameId));
    if (game.state.paused) return;
    // Toutes les manches passent par le même arbitre (modes.js).
    // Bouton « suivant » de l'écran principal (espion, undercover).
    const skip = hostSkipKey === `${phase}:${game.state.round}:${game.state.step}`;
    const transition = modes.nextTransition(game, now, {
      skip,
      active: activeIds(),
      goneFor: (uid) => goneFor(uid, now),
      scores: computeScores(game),
    });
    if (transition) once(key, () => api.applyTransition(gameId, transition));
  }
}

setInterval(() => {
  screen.tick?.();
  drive();
}, 200);

/* ---------- Démarrage ---------- */

async function start() {
  if (!isConfigured) {
    root.innerHTML = `<div class="card"><h2>Firebase n'est pas configuré</h2>
      <p>Renseigne ton projet dans <code>js/config.js</code>, voir le README.</p></div>`;
    return;
  }
  try {
    me = await signIn();
  } catch (error) {
    console.error(error);
    root.innerHTML = `<div class="card"><h2>Connexion impossible</h2>
      <p>Vérifie que la connexion anonyme est activée dans Firebase Authentication et que le domaine du site est autorisé.</p>
      <p class="muted small">${esc(error.message || "Firebase n'a pas répondu.")}</p></div>`;
    return;
  }
  api.init(me);
  api.cleanOldGames().catch(console.error);
  window.addEventListener("hashchange", route);
  route();
}

start();
