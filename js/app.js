import { SETTINGS } from "./config.js";
import { isConfigured, signIn } from "./firebase.js";
import * as api from "./game.js";
import { computeScores } from "./logic.js";

const root = document.getElementById("app");
const LETTERS = ["A", "B", "C", "D"];
const NAME_KEY = "quizz.pseudo";

let me = null;
let gameId = null;
let game = null;
let aiApiKey = "";
let screen = { key: null };
let stopWatching = null;
let stopPresence = null;
let generating = false;
const attempts = new Map();

const esc = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const $ = (selector) => root.querySelector(selector);

function load(key) {
  try { return localStorage.getItem(key) ?? ""; } catch { return ""; }
}
function save(key, value) {
  try { localStorage.setItem(key, value); } catch { /* navigation privée */ }
}

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
  if (screen.key !== key) screen = { key, ...build() };
  screen.update?.();
}

async function closeGame() {
  stopWatching?.();
  stopWatching = null;
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

/* ---------- Accueil ---------- */

function showHome() {
  show("home", () => {
    root.innerHTML = `
      <div class="stack">
        <header>
          <h1>Quizz entre amis</h1>
          <p class="tagline">Chacun choisit ses thèmes, l'IA écrit les questions.</p>
        </header>
        <section class="card">
          <label>Ton pseudo
            <input id="pseudo" maxlength="20" autocomplete="nickname" value="${esc(load(NAME_KEY))}">
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
          <label>Clé API Gemini
            <input id="apiKey" type="password" autocomplete="off" required>
            <span class="hint">À créer dans Google AI Studio. Le site ne l'enregistre pas. L'offre gratuite a des limites et Google peut utiliser les requêtes pour améliorer ses produits.</span>
          </label>
          <button class="primary big">Créer la partie</button>
        </form>
      </div>`;

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
      aiApiKey = $("#apiKey").value.trim();
      try {
        location.hash = `#/partie/${await api.createGame($("#gameName").value.trim(), name)}`;
      } catch (error) {
        console.error(error);
        toast("Impossible de créer la partie.");
      }
    });

    $("#lobbies").addEventListener("click", async (event) => {
      const id = event.target.dataset?.join;
      if (!id) return;
      const name = pseudo();
      if (!name) return;
      try {
        await api.joinGame(id, name);
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
            return `<li><span><b>${esc(g.name)}</b><br>
              <span class="muted small">${esc(g.players[g.hostId].name)} · ${count} joueur${count > 1 ? "s" : ""}</span></span>
              <button data-join="${esc(g.id)}" ${count >= SETTINGS.maxPlayers ? "disabled" : ""}>${count >= SETTINGS.maxPlayers ? "Partie pleine" : "Rejoindre"}</button></li>`;
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
      if (!firstValue) toast("La partie a été fermée.");
      else toast("Cette partie n'existe plus.");
      game = null;
      goHome();
      return;
    }
    firstValue = false;
    game = value;
    if (game.players?.[me] && !stopPresence) stopPresence = api.startPresence(id);
    renderGame();
    drive();
  });
}

const isHost = () => game.hostId === me;
const playersOf = () => Object.entries(game.players ?? {}).map(([uid, p]) => ({ uid, ...p }));
const connectedPlayers = () => playersOf().filter((p) => p.connected);
const answeringPlayers = () => connectedPlayers().filter((p) => p.uid !== game.hostId);

function renderGame() {
  const { phase, index } = game.state;
  if (!game.players?.[me]) return phase === "lobby" ? showJoin() : showClosed();
  if (phase === "lobby") return showLobby();
  if (phase === "themes") {
    if (isHost() || game.themes?.[me]) return showThemesWaiting();
    return showThemesForm();
  }
  if (phase === "generating") return showGenerating();
  if (phase === "question") return isHost() ? showHostQuestion(index) : showQuestion(index);
  if (phase === "reveal") return showReveal(index);
  if (phase === "boardChoose") return showBoard();
  if (phase === "boardQuestion") {
    if (isHost()) return showHostBoardQuestion(game.state.selectedBoardIndex);
    return game.state.selectedBy === me
      ? showBoardAnswer(game.state.selectedBoardIndex)
      : showBoardWaiting();
  }
  if (phase === "boardReveal") return showReveal(game.state.selectedBoardIndex, true);
  return showFinal();
}

function showJoin() {
  show("join", () => {
    root.innerHTML = `
      <form class="card" id="join">
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
      await api.joinGame(gameId, name).catch((error) => toast(error.message || "Impossible de rejoindre cette partie."));
    });
    return {};
  });
}

function showClosed() {
  show("closed", () => {
    root.innerHTML = `
      <div class="card center">
        <h2>Cette partie a déjà commencé</h2>
        <button class="primary" id="home">Retour à l'accueil</button>
      </div>`;
    $("#home").addEventListener("click", goHome);
    return {};
  });
}

function showLobby() {
  show("lobby", () => {
    root.innerHTML = `
      <div class="stack">
        <header>
          <h1>${esc(game.name)}</h1>
          <p class="tagline" id="status"></p>
        </header>
        <section class="card">
          <div class="row">
            <h2>Joueurs</h2>
            <button id="copy">Copier le lien</button>
          </div>
          <ul class="list" id="players"></ul>
        </section>
        <button class="primary big" id="start" hidden>Lancer la partie</button>
        <button class="link" id="leave"></button>
      </div>`;

    $("#copy").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        toast("Lien copié.");
      } catch {
        toast(location.href);
      }
    });
    $("#start").addEventListener("click", () => api.startThemes(gameId));
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
        $("#players").innerHTML = playersOf().map((p) => `
          <li class="${p.connected ? "" : "offline"}">
            <span>${esc(p.name)}${p.uid === me ? " (toi)" : ""}</span>
            ${p.uid === game.hostId ? `<span class="tag host">Créateur</span>` : ""}
          </li>`).join("");
        $("#start").hidden = !isHost();
        const otherPlayers = playersOf().filter((p) => p.uid !== game.hostId).length;
        $("#start").disabled = isHost() && otherPlayers === 0;
        $("#leave").textContent = isHost() ? "Supprimer la partie" : "Quitter la partie";
        $("#status").textContent = isHost()
          ? `${Object.keys(game.players ?? {}).length}/${SETTINGS.maxPlayers} joueurs. ${otherPlayers ? "Tu gardes l'écran des questions." : "Invite au moins une personne avant de lancer."}`
          : `En attente de ${game.players[game.hostId]?.name ?? "l'hôte"}…`;
      },
    };
  });
}

function showThemesForm() {
  show("themes:form", () => {
    const fields = Array.from({ length: SETTINGS.themesPerPlayer }, (_, i) => `
      <label>Thème ${i + 1}
        <input name="theme" maxlength="60" required autocomplete="off">
      </label>`).join("");
    root.innerHTML = `
      <div class="stack">
        <header>
          <h1>Tes thèmes</h1>
          <p class="tagline">Écris ${SETTINGS.themesPerPlayer} sujets. Le créateur ne propose pas de thèmes.</p>
        </header>
        <form class="card" id="themes">
          ${fields}
          <button class="primary big">Valider mes thèmes</button>
        </form>
      </div>`;

    $("#themes").addEventListener("submit", async (event) => {
      event.preventDefault();
      const themes = [...root.querySelectorAll("[name=theme]")].map((i) => i.value.trim());
      if (themes.some((t) => !t)) return toast("Remplis les trois thèmes.");
      await api.submitThemes(gameId, themes).catch(() => toast("Thèmes non enregistrés, réessaie."));
    });
    return {};
  });
}

function showThemesWaiting() {
  show("themes:waiting", () => {
    root.innerHTML = `
      <div class="stack">
        <header>
          <h1>${isHost() ? "En attente des thèmes" : "C'est noté"}</h1>
          <p class="tagline">${isHost() ? "Les joueurs sur téléphone choisissent leurs thèmes. Toi, tu gardes l'écran des questions." : "On attend les thèmes des autres joueurs."}</p>
        </header>
        <section class="card">
          <ul class="list" id="players"></ul>
          <button id="skip" hidden>Continuer sans les thèmes manquants</button>
        </section>
      </div>`;
    $("#skip").addEventListener("click", () => api.startGeneration(gameId));
    return {
      update() {
        const participants = playersOf().filter((p) => p.uid !== game.hostId);
        $("#players").innerHTML = participants.length
          ? participants.map((p) => `
            <li class="${p.connected ? "" : "offline"}">
              <span>${esc(p.name)}</span>
              <span class="tag ${game.themes?.[p.uid] ? "done" : ""}">${game.themes?.[p.uid] ? "Prêt" : "En attente"}</span>
            </li>`).join("")
          : `<li class="empty">Aucun autre joueur n'est encore dans la partie.</li>`;
        $("#skip").hidden = !isHost() || participants.length === 0 || participants.every((p) => game.themes?.[p.uid]);
      },
    };
  });
}

function showGenerating() {
  show("generating", () => {
    root.innerHTML = `
      <div class="card center">
        <div class="spinner" id="spinner"></div>
        <h2>L'IA prépare les questions</h2>
        <p class="muted" id="wait">Deux séries de questions sont préparées. Cela peut prendre quelques minutes.</p>
        <form id="retry" hidden>
          <div class="stack">
            <p class="error" id="error"></p>
            <label>Clé API Gemini
              <input id="apiKey" type="password" autocomplete="off" required value="${esc(aiApiKey)}">
            </label>
            <button class="primary big">Relancer</button>
          </div>
        </form>
      </div>`;
    $("#retry").addEventListener("submit", (event) => {
      event.preventDefault();
      aiApiKey = $("#apiKey").value.trim();
      api.clearGenerationError(gameId);
    });
    return {
      update() {
        const failed = Boolean(game.state.error);
        const showRetry = failed && isHost();
        $("#retry").hidden = !showRetry;
        $("#spinner").hidden = showRetry;
        $("#wait").hidden = showRetry;
        if (failed && !isHost()) {
          $("#wait").textContent = `Un problème est survenu, ${game.players[game.hostId]?.name ?? "l'hôte"} va relancer.`;
        }
        if (failed) $("#error").textContent = game.state.error;
      },
    };
  });
}

function scoreList(scores, withGain) {
  return scores.map((s, i) => `
    <li class="${s.uid === me ? "me" : ""}">
      <span class="rank">${i + 1}</span>
      <span class="name">${esc(s.name)}</span>
      ${withGain && s.gained ? `<span class="gain">+${s.gained}</span>` : ""}
      <span class="pts">${s.score} pt${s.score > 1 ? "s" : ""}</span>
    </li>`).join("");
}

function questionHeader(index, question) {
  return `
    <p class="eyebrow">Manche 1 · Tout le monde répond</p>
    <div class="meta">
      <span>Question ${index + 1} / ${game.questions.length}</span>
      <span id="right"></span>
    </div>
    <div class="timer"><div id="bar"></div></div>
    <p class="theme"><b>${esc(question.theme)}</b> · proposé par ${esc(question.by)}</p>
    <p class="question">${esc(question.question)}</p>`;
}

function startBar(totalSeconds) {
  return () => {
    const left = Math.max(0, game.state.deadline - api.serverNow());
    $("#bar").style.width = `${Math.min(100, (left / (totalSeconds * 1000)) * 100)}%`;
    return Math.ceil(left / 1000);
  };
}

function showQuestion(index) {
  show(`question:${index}`, () => {
    const question = game.questions[index];
    root.innerHTML = `
      <div class="stack">
        <div class="meta">
          <span>Regarde l'écran principal</span>
          <span id="right"></span>
        </div>
        <div class="timer"><div id="bar"></div></div>
        <div class="answers" id="answers">
          ${question.answers.map((answer, i) => `
            <button class="answer" data-choice="${i}">
              <span class="letter">${LETTERS[i]}</span>
              <span class="text">${esc(answer)}</span>
            </button>`).join("")}
        </div>
        <p class="muted center" id="count"></p>
      </div>`;

    let picked = null;
    const bar = startBar(SETTINGS.questionSeconds);

    $("#answers").addEventListener("click", async (event) => {
      const button = event.target.closest("[data-choice]");
      if (!button || picked !== null || game.answers?.[index]?.[me]) return;
      picked = Number(button.dataset.choice);
      screen.update();
      try {
        await api.sendAnswer(gameId, index, picked);
      } catch {
        toast("Réponse arrivée trop tard.");
      }
    });

    return {
      update() {
        const mine = game.answers?.[index]?.[me]?.choice ?? picked;
        root.querySelectorAll(".answer").forEach((button) => {
          button.disabled = mine !== null;
          button.classList.toggle("mine", Number(button.dataset.choice) === mine);
        });
        const answered = answeringPlayers().filter((p) => game.answers?.[index]?.[p.uid]).length;
        $("#count").textContent = `${answered} / ${answeringPlayers().length} réponse${answered > 1 ? "s" : ""}`;
      },
      tick() { $("#right").textContent = `${bar()} s`; },
    };
  });
}

const DIFFICULTY_NAMES = {
  facile: "Facile",
  moyen: "Moyen",
  difficile: "Difficile",
  tres_difficile: "Très difficile",
};

function boardMarkup(canChoose) {
  const grouped = new Map();
  game.board.forEach((question, index) => {
    if (!grouped.has(question.theme)) grouped.set(question.theme, []);
    grouped.get(question.theme).push({ question, index });
  });
  return [...grouped.entries()].map(([theme, cells]) => `
    <section class="board-category">
      <h2>${esc(theme)}</h2>
      <div class="board-tiles">
        ${cells.map(({ question, index }) => {
          const used = Boolean(game.state.used?.[index]);
          return `<button class="board-tile" data-board-index="${index}" aria-label="${esc(theme)}, ${esc(DIFFICULTY_NAMES[question.difficulty])}, ${question.points} points" ${used || !canChoose ? "disabled" : ""}>
            <span>${esc(DIFFICULTY_NAMES[question.difficulty])}</span>
            <b>${question.points} pts</b>
          </button>`;
        }).join("")}
      </div>
    </section>`).join("");
}

function showBoard() {
  const turnPlayerId = game.state.turnOrder?.[game.state.turnIndex];
  const isMyTurn = !isHost() && turnPlayerId === me;
  show(`board:${game.state.turnNumber}`, () => {
    root.innerHTML = `
      <div class="stack">
        <header>
          <p class="eyebrow">Manche 2 · Le plateau</p>
          <h1>${isHost() || !isMyTurn ? "Plateau des thèmes" : "À toi de choisir"}</h1>
          <p class="tagline" id="board-status"></p>
        </header>
        <div class="board" id="board"></div>
      </div>`;
    $("#board").addEventListener("click", async (event) => {
      const button = event.target.closest("[data-board-index]");
      if (!button || button.disabled) return;
      root.querySelectorAll("[data-board-index]").forEach((tile) => { tile.disabled = true; });
      try {
        await api.submitBoardPick(gameId, game.state.turnNumber, Number(button.dataset.boardIndex));
      } catch (error) {
        console.error(error);
        toast("Cette case n'a pas pu être choisie. Vérifie ta connexion.");
      }
    });
    return {
      update() {
        const current = game.players?.[turnPlayerId]?.name ?? "un joueur";
        $("#board-status").textContent = isHost()
          ? `C'est au tour de ${current}. Les cases choisies disparaissent du plateau.`
          : isMyTurn ? "Choisis une case encore disponible. Tu seras le seul à répondre."
            : `C'est au tour de ${current}. Le plateau reste affiché sur ton téléphone.`;
        $("#board").innerHTML = boardMarkup(isMyTurn);
      },
    };
  });
}

function showBoardWaiting() {
  show(`board:waiting:${game.state.turnNumber}`, () => {
    root.innerHTML = `
      <div class="card center">
        <p class="eyebrow">Manche 2</p>
        <h1>À toi de choisir</h1>
        <p class="tagline" id="board-wait"></p>
      </div>`;
    return {
      update() {
        const current = game.players?.[game.state.selectedBy]?.name ?? "Le joueur";
        $("#board-wait").textContent = `${current} répond seul à la question choisie.`;
      },
    };
  });
}

function boardQuestionHeader(question) {
  return `
    <p class="eyebrow">Manche 2 · ${esc(question.theme)}</p>
    <div class="meta">
      <span>${esc(DIFFICULTY_NAMES[question.difficulty])} · ${question.points} points</span>
      <span id="right"></span>
    </div>
    <div class="timer"><div id="bar"></div></div>
    <p class="question">${esc(question.question)}</p>`;
}

function showHostBoardQuestion(index) {
  show(`board-question:host:${index}`, () => {
    const question = game.board[index];
    root.innerHTML = `
      <div class="stack">
        ${boardQuestionHeader(question)}
        <div class="answers">
          ${question.answers.map((answer, i) => `
            <div class="answer" aria-label="Réponse ${LETTERS[i]}">
              <span class="letter">${LETTERS[i]}</span>
              <span class="text">${esc(answer)}</span>
            </div>`).join("")}
        </div>
        <p class="muted center" id="board-count"></p>
      </div>`;
    const bar = startBar(SETTINGS.questionSeconds);
    return {
      update() {
        const playerId = game.state.selectedBy;
        const answered = Boolean(game.boardAnswers?.[index]?.[playerId]);
        $("#board-count").textContent = `${game.players?.[playerId]?.name ?? "Le joueur"} ${answered ? "a répondu." : "est en train de répondre."}`;
      },
      tick() { $("#right").textContent = `${bar()} s`; },
    };
  });
}

function showBoardAnswer(index) {
  show(`board-question:player:${index}`, () => {
    const question = game.board[index];
    root.innerHTML = `
      <div class="stack">
        ${boardQuestionHeader(question)}
        <div class="answers" id="answers">
          ${question.answers.map((answer, i) => `
            <button class="answer" data-choice="${i}">
              <span class="letter">${LETTERS[i]}</span>
              <span class="text">${esc(answer)}</span>
            </button>`).join("")}
        </div>
        <p class="muted center">Seul ton choix compte pour cette question.</p>
      </div>`;
    const bar = startBar(SETTINGS.questionSeconds);
    let picked = null;
    $("#answers").addEventListener("click", async (event) => {
      const button = event.target.closest("[data-choice]");
      if (!button || picked !== null || game.boardAnswers?.[index]?.[me]) return;
      picked = Number(button.dataset.choice);
      screen.update();
      try {
        await api.sendBoardAnswer(gameId, index, picked);
      } catch {
        toast("Réponse arrivée trop tard.");
      }
    });
    return {
      update() {
        const mine = game.boardAnswers?.[index]?.[me]?.choice ?? picked;
        root.querySelectorAll(".answer").forEach((button) => {
          button.disabled = mine !== null;
          button.classList.toggle("mine", Number(button.dataset.choice) === mine);
        });
      },
      tick() { $("#right").textContent = `${bar()} s`; },
    };
  });
}

function showHostQuestion(index) {
  show(`host-question:${index}`, () => {
    const question = game.questions[index];
    root.innerHTML = `
      <div class="stack">
        ${questionHeader(index, question)}
        <div class="answers">
          ${question.answers.map((answer, i) => `
            <div class="answer" aria-label="Réponse ${LETTERS[i]}">
              <span class="letter">${LETTERS[i]}</span>
              <span class="text">${esc(answer)}</span>
            </div>`).join("")}
        </div>
        <p class="muted center" id="count"></p>
      </div>`;

    const bar = startBar(SETTINGS.questionSeconds);
    return {
      update() {
        const answered = answeringPlayers().filter((p) => game.answers?.[index]?.[p.uid]).length;
        $("#count").textContent = `${answered} / ${answeringPlayers().length} réponses reçues`;
      },
      tick() { $("#right").textContent = `${bar()} s`; },
    };
  });
}

function showReveal(index, boardMode = false) {
  show(`${boardMode ? "board-reveal" : "reveal"}:${index}`, () => {
    const question = boardMode ? game.board[index] : game.questions[index];
    const answers = boardMode ? game.boardAnswers?.[index] ?? {} : game.answers?.[index] ?? {};
    const mine = answers[me]?.choice;
    const scores = computeScores(game);
    const namesFor = (choice) =>
      playersOf().filter((p) => p.uid !== game.hostId && answers[p.uid]?.choice === choice).map((p) => p.name).join(", ");

    root.innerHTML = `
      <div class="stack">
        ${boardMode ? boardQuestionHeader(question) : questionHeader(index, question)}
        <div class="answers">
          ${question.answers.map((answer, i) => {
            const state = i === question.correct ? "right" : i === mine ? "wrong" : "dim";
            const names = namesFor(i);
            return `
              <button class="answer ${state}" disabled>
                <span class="letter">${LETTERS[i]}</span>
                <span class="text">${esc(answer)}${names ? `<span class="who">${esc(names)}</span>` : ""}</span>
              </button>`;
          }).join("")}
        </div>
        <section class="card">
          <h2>Classement</h2>
          <ul class="list score">${scoreList(scores, true)}</ul>
        </section>
      </div>`;

    const bar = startBar(SETTINGS.revealSeconds);
    return { tick() { bar(); $("#right").textContent = "Correction"; } };
  });
}

function showFinal() {
  show("finished", () => {
    const scores = computeScores(game);
    const best = scores[0]?.score ?? 0;
    const winners = scores.filter((s) => s.score === best).map((s) => s.name).join(" et ");
    root.innerHTML = `
      <div class="stack">
        <header class="center">
          <p class="eyebrow">Fin des deux manches</p>
          <p class="muted">${winners.includes(" et ") ? "Égalité entre" : "Victoire de"}</p>
          <p class="winner">${esc(winners)}</p>
        </header>
        <section class="card">
          <h2>Classement final · 2 manches</h2>
          <ul class="list score">${scoreList(scores, false)}</ul>
        </section>
        <button class="primary big" id="home">Retour à l'accueil</button>
      </div>`;
    $("#home").addEventListener("click", goHome);
    return {};
  });
}

/* ---------- Avancement automatique ---------- */

// Évite de relancer la même transition à chaque tic, tout en réessayant si elle a échoué.
function once(key, action) {
  const last = attempts.get(key) ?? 0;
  if (Date.now() - last < 3000) return;
  attempts.set(key, Date.now());
  Promise.resolve(action()).catch(console.error);
}

async function runGeneration() {
  if (generating) return;
  generating = true;
  const id = gameId;
  try {
    await api.generateQuestions(id, game, aiApiKey);
  } catch (error) {
    console.error(error);
    await api.setGenerationError(id, error.message || "La génération a échoué.").catch(console.error);
  } finally {
    generating = false;
  }
}

function drive() {
  if (!game?.players?.[me]) return;
  const { phase, index, deadline, error } = game.state;
  const now = api.serverNow();
  const key = `${gameId}:${phase}:${index ?? ""}:${game.state.turnNumber ?? ""}:${game.state.selectedBoardIndex ?? ""}`;

  if (phase === "themes" && isHost()) {
    const everyone = playersOf().filter((p) => p.uid !== game.hostId);
    if (everyone.length && everyone.every((p) => game.themes?.[p.uid])) {
      once(key, () => api.startGeneration(gameId));
    }
  } else if (phase === "generating" && isHost() && !error) {
    runGeneration();
  } else if (phase === "question" && isHost()) {
    const answers = game.answers?.[index] ?? {};
    const everyone = answeringPlayers();
    if (now >= deadline || (everyone.length && everyone.every((p) => answers[p.uid]))) {
      once(key, () => api.reveal(gameId, index));
    }
  } else if (phase === "reveal" && isHost() && now >= deadline) {
    if (index + 1 >= game.questions.length) {
      once(key, () => api.beginBoard(gameId, index, game, answeringPlayers().map((p) => p.uid)));
    } else {
      once(key, () => api.nextQuestion(gameId, index));
    }
  } else if (phase === "boardChoose" && isHost()) {
    const turnNumber = game.state.turnNumber;
    const currentPlayer = game.state.turnOrder?.[game.state.turnIndex];
    const activeIds = answeringPlayers().map((p) => p.uid);
    if (!activeIds.includes(currentPlayer)) {
      once(key, () => api.skipBoardTurn(gameId, turnNumber, activeIds));
    } else if (Number.isInteger(game.boardPicks?.[turnNumber])) {
      once(key, () => api.activateBoardPick(gameId, turnNumber, game.boardPicks[turnNumber], game.board.length));
    }
  } else if (phase === "boardQuestion" && isHost()) {
    const { turnNumber, selectedBoardIndex, selectedBy } = game.state;
    const hasAnswer = Boolean(game.boardAnswers?.[selectedBoardIndex]?.[selectedBy]);
    if (hasAnswer || now >= deadline) {
      once(key, () => api.revealBoardQuestion(gameId, turnNumber));
    }
  } else if (phase === "boardReveal" && isHost() && now >= deadline) {
    once(key, () => api.nextBoardTurn(
      gameId,
      game.state.turnNumber,
      answeringPlayers().map((p) => p.uid),
      game.board.length,
    ));
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
