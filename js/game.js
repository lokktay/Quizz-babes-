import {
  ref, set, update, remove, push, get, onValue, query, orderByChild, equalTo, endAt,
  runTransaction, onDisconnect, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-database.js";
import { db } from "./firebase.js?v=4";
import { SETTINGS } from "./config.js?v=4";
import { collectThemes, createPools, createSupply, normalize, questionKey } from "./logic.js?v=7";
import { DEFAULT_SETTINGS, buildRounds, firstState, needsQuestions, planProgram } from "./modes.js?v=6";
import { generatePools } from "./ai.js?v=6";
import { loadIndex, loadThemeQuestions, loadUndercoverPairs } from "./bank.js?v=2";

let uid = null;
let clockOffset = 0;

const DAY = 24 * 60 * 60 * 1000;
const gameRef = (id, path = "") => ref(db, `games/${id}${path}`);

export function init(userId) {
  uid = userId;
  onValue(ref(db, ".info/serverTimeOffset"), (snap) => { clockOffset = snap.val() ?? 0; });
}

// Heure du serveur, pour que tous les joueurs aient le même chrono.
export const serverNow = () => Date.now() + clockOffset;

export function watchLobbies(callback) {
  const lobbies = query(ref(db, "games"), orderByChild("state/phase"), equalTo("lobby"));
  return onValue(lobbies, (snap) => {
    const games = Object.entries(snap.val() ?? {})
      .map(([id, game]) => ({ id, ...game }))
      .filter((game) => game.players?.[game.hostId]?.connected)
      .sort((a, b) => b.createdAt - a.createdAt);
    callback(games);
  });
}

export const watchGame = (id, callback) => onValue(gameRef(id), (snap) => callback(snap.val()));

export async function cleanOldGames() {
  const old = await get(query(ref(db, "games"), orderByChild("createdAt"), endAt(serverNow() - DAY)));
  await Promise.allSettled(Object.keys(old.val() ?? {}).map((id) => remove(gameRef(id))));
}

const playerRecord = (name, avatar) => (avatar ? { name, connected: true, avatar } : { name, connected: true });

// Nom de groupe → clé Firebase stable (« Les Babes ! » → « les-babes »).
export const groupKey = (name) => normalize(name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

// `ai` : le créateur a une clé Gemini, chaque joueur peut donc proposer un thème libre.
// `settings` : { modes: [...], minutes } — les modes de jeu choisis et la durée visée.
export async function createGame(name, playerName, avatar, groupName = "", ai = true, settings = DEFAULT_SETTINGS) {
  const newGame = push(ref(db, "games"));
  const group = groupKey(groupName);
  await set(newGame, {
    name,
    hostId: uid,
    createdAt: serverTimestamp(),
    ai: Boolean(ai),
    settings: { modes: settings.modes, minutes: settings.minutes },
    state: { phase: "lobby" },
    players: { [uid]: playerRecord(playerName, avatar) },
    ...(group ? { group, groupName: groupName.trim().slice(0, 40) } : {}),
  });
  return newGame.key;
}

// Revanche : nouvelle partie avec le même nom et le même groupe ; l'ancienne pointe vers elle.
export async function createRematch(id, game, ai = game.ai) {
  const host = game.players?.[uid] ?? {};
  const nextId = await createGame(game.name, host.name ?? "Hôte", host.avatar, game.groupName ?? "", ai,
    { ...DEFAULT_SETTINGS, ...(game.settings ?? {}) });
  await set(gameRef(id, "/next"), nextId);
  return nextId;
}

export const setAvatar = (id, avatar) => set(gameRef(id, `/players/${uid}/avatar`), avatar);

export const sendReaction = (id, emoji, to = null) =>
  set(push(gameRef(id, "/reactions")), { uid, e: emoji, at: serverTimestamp(), ...(to ? { to } : {}) });

export const sendVote = (id, target) => set(gameRef(id, `/votes/${uid}`), target);

export const reportQuestion = (id, key) => set(gameRef(id, `/reports/${key}/${uid}`), true);

export async function joinGame(id, playerName, avatar) {
  const game = await get(gameRef(id));
  if (!game.exists() || game.child("state/phase").val() !== "lobby") {
    throw new Error("Cette partie n'accepte plus de joueurs.");
  }
  const players = game.child("players").val() ?? {};
  if (!players[uid] && Object.keys(players).length >= SETTINGS.maxPlayers) {
    throw new Error("Cette partie est complète (10 joueurs maximum, créateur inclus).");
  }
  await set(gameRef(id, `/players/${uid}`), playerRecord(playerName, avatar));
}

export const leaveLobby = (id) => remove(gameRef(id, `/players/${uid}`));
export const deleteGame = (id) => remove(gameRef(id));

// Présence : on note aussi l'heure de déconnexion, pour laisser quelques secondes
// à un téléphone qui se met en veille avant de passer son tour.
export function startPresence(id) {
  const player = gameRef(id, `/players/${uid}`);
  const stopListening = onValue(ref(db, ".info/connected"), (snap) => {
    if (!snap.val()) return;
    onDisconnect(player).update({ connected: false, offlineAt: serverTimestamp() })
      .then(() => update(player, { connected: true, offlineAt: null }))
      .catch(() => {});
  });
  return async (markOffline) => {
    stopListening();
    await onDisconnect(player).cancel().catch(() => {});
    if (markOffline) await update(player, { connected: false, offlineAt: serverTimestamp() }).catch(() => {});
  };
}

// Les changements de phase sont transactionnels pour éviter deux transitions concurrentes.
function moveTo(id, from, next) {
  return runTransaction(gameRef(id, "/state"), (current) => {
    if (current === null) return null;
    if (current.phase !== from.phase) return undefined;
    if (from.index !== undefined && current.index !== from.index) return undefined;
    return next(current);
  });
}

// Sans mode à questions (undercover seul), on saute le choix des thèmes.
export const startThemes = (id, game) => moveTo(id, { phase: "lobby" }, () =>
  (needsQuestions(game?.settings?.modes ?? DEFAULT_SETTINGS.modes) ? { phase: "themes" } : { phase: "generating", since: serverNow() }));
// Choix en cours d'un joueur, enregistré à chaque clic pour que les autres le voient en direct.
export const saveThemes = (id, entry) => set(gameRef(id, `/themes/${uid}`), entry);
export const startGeneration = (id) => moveTo(id, { phase: "themes" }, (current) =>
  ({ phase: "generating", since: serverNow(), ...(current.noAi ? { noAi: true } : {}) }));

// Plan B : on renonce aux thèmes libres (IA trop lente ou en erreur). Chaque joueur
// choisit un thème de plus dans la banque pour remplacer le sien.
export const dropFreeThemes = (id) => moveTo(id, { phase: "generating" }, () => ({ phase: "themes", noAi: true }));

// Questions par thème : 4 pour le plateau + celles de la manche 1.
const BOARD_PER_THEME = 4;
const READY_COUNT = BOARD_PER_THEME + SETTINGS.questionsPerTheme;
// En dessous, un thème est jugé inutilisable (4 au plateau + au moins 2 en manche 1).
const MIN_COUNT = BOARD_PER_THEME + 2;

// Les questions déjà générées sont gardées si le créateur doit relancer.
// `inflight` : thèmes en cours de génération anticipée ; `tried` : thèmes déjà lancés une fois.
const poolsByGame = new Map();
function gameStore(id) {
  if (!poolsByGame.has(id)) poolsByGame.set(id, { pools: createPools(), inflight: new Map(), tried: new Set() });
  return poolsByGame.get(id);
}

// Génération anticipée : dès qu'un joueur valide ses thèmes, l'hôte envoie son thème libre à l'IA
// sans attendre les autres. Un échec ici n'est pas grave : la génération finale reprendra ce thème.
export async function prefetchThemes(id, game, apiKey) {
  if (!apiKey || game.state?.noAi) return;
  const { pools, inflight, tried } = gameStore(id);
  const todo = collectThemes(game, await loadIndex())
    .filter((theme) => theme.source === "ai" && !tried.has(normalize(theme.theme)));
  if (!todo.length) return;
  todo.forEach((theme) => tried.add(normalize(theme.theme)));
  const run = generatePools(apiKey, todo, {
    addToPool: pools.add,
    isReady: (theme) => pools.count(theme) >= READY_COUNT,
  }).catch(console.error).finally(() => todo.forEach((theme) => inflight.delete(normalize(theme.theme))));
  todo.forEach((theme) => inflight.set(normalize(theme.theme), run));
}

export async function generateQuestions(id, game, apiKey) {
  const noAi = Boolean(game.state.noAi);
  const themes = collectThemes(game, await loadIndex());
  const settings = { ...DEFAULT_SETTINGS, ...(game.settings ?? {}) };
  const withQuestions = needsQuestions(settings.modes);
  if (!themes.length && withQuestions) throw new Error("Aucun thème n'a été choisi.");
  const aiThemes = themes.filter((theme) => theme.source === "ai");
  const bankThemes = themes.filter((theme) => theme.source === "bank");
  if (aiThemes.length && !apiKey) throw new Error("Colle la clé API Gemini pour générer les thèmes libres, ou lance sans eux.");
  const { pools: store, inflight } = gameStore(id);

  // Thèmes de la banque : chargés directement, aucune attente.
  for (const theme of bankThemes) {
    for (const raw of await loadThemeQuestions(theme.bankId)) store.add({ ...raw, theme: theme.theme });
  }
  const report = (done) => update(gameRef(id, "/state"), { progress: { done: bankThemes.length + done, total: themes.length } }).catch(() => {});

  if (aiThemes.length) {
    // On attend d'abord les générations anticipées encore en cours, pour ne rien demander deux fois.
    report(aiThemes.filter((theme) => store.count(theme) >= READY_COUNT).length);
    await Promise.allSettled([...new Set(inflight.values())]);

    let lastReported = -1;
    const lastError = await generatePools(apiKey, aiThemes, {
      addToPool: store.add,
      isReady: (theme) => store.count(theme) >= READY_COUNT,
      onProgress: (done) => {
        if (done === lastReported) return;
        lastReported = done;
        report(done);
      },
    });

    const unusable = aiThemes.filter((theme) => store.count(theme) < MIN_COUNT);
    if (unusable.length) {
      const names = unusable.slice(0, 3).map((t) => t.theme).join(", ") + (unusable.length > 3 ? "…" : "");
      const reason = lastError?.message ? ` (${lastError.message})` : "";
      throw new Error(`Thèmes libres incomplets : ${names}${reason}. Relance (seuls les thèmes manquants seront regénérés) ou lance sans les thèmes libres.`);
    }
  }

  // Si le créateur a entre-temps renoncé aux thèmes libres, cette génération est périmée : on n'écrit rien.
  const state = (await get(gameRef(id, "/state"))).val();
  if (state?.phase !== "generating" || Boolean(state.noAi) !== noAi) return;

  // Mémoire du groupe : on évite de reposer une question déjà vue par ce groupe.
  const asked = game.group ? (await get(ref(db, `groups/${game.group}/asked`)).catch(() => null))?.val() ?? {} : {};
  const supply = createSupply(themes, store.pools, (text) => Boolean(asked[questionKey(text)]));
  const program = planProgram({ modes: settings.modes, minutes: settings.minutes, themeCount: supply.themes.length });
  const pairs = settings.modes.includes("undercover") ? await loadUndercoverPairs() : [];
  const rounds = buildRounds(program, supply, { pairs });
  await update(gameRef(id), { rounds, state: firstState(serverNow()) });
  poolsByGame.delete(id);
}

export const setGenerationError = (id, message) => update(gameRef(id, "/state"), { error: message });
export const clearGenerationError = (id) => update(gameRef(id, "/state"), { error: null });

/* ---------- Ce qu'envoient les joueurs ---------- */

export const sendAnswer = (id, round, step, choice) =>
  set(gameRef(id, `/answers/${round}/${step}/${uid}`), { choice, at: serverTimestamp() });
export const sendBet = (id, round, step, value) => set(gameRef(id, `/bets/${round}/${step}/${uid}`), value);
export const sendDecision = (id, round, step, choice) => set(gameRef(id, `/decisions/${round}/${step}/${uid}`), choice);
export const sendPick = (id, round, step, value) => set(gameRef(id, `/picks/${round}/${step}`), value);
// Vote pour désigner l'espion ou éliminer quelqu'un à l'undercover.
export const sendBallot = (id, round, step, target) => set(gameRef(id, `/ballots/${round}/${step}/${uid}`), target);
// Fin d'une partie d'espion ou d'undercover : « again » (partie suivante) ou « next » (mode suivant).
export const sendChoice = (id, round, step, choice) => set(gameRef(id, `/choices/${round}/${step}`), choice);
export const sendSprint = (id, round, sprint, index, choice) =>
  set(gameRef(id, `/sprint/${round}/${sprint}/${uid}/${index}`), { choice, at: serverTimestamp() });

/* ---------- Pause et fin anticipée ---------- */

// N'importe quel joueur (ou l'écran principal) demande une pause ou une reprise ; l'écran principal l'applique.
export const requestPause = (id, on) => set(gameRef(id, "/pause"), on ? { by: uid, at: serverTimestamp() } : null);
export const requestStop = (id) => set(gameRef(id, "/stop"), { by: uid, at: serverTimestamp() });

// Fige le chrono : on garde le temps restant pour repartir exactement au même point.
export const applyPause = (id, by) => runTransaction(gameRef(id, "/state"), (current) => {
  if (!current || current.paused || current.phase === "finished") return undefined;
  const now = serverNow();
  return { ...current, paused: { by: by ?? "", at: now, remaining: Math.max(0, (current.deadline ?? now) - now) } };
});

export const applyResume = (id) => runTransaction(gameRef(id, "/state"), (current) => {
  if (!current?.paused) return undefined;
  const now = serverNow();
  const { paused, ...rest } = current;
  return { ...rest, deadline: now + paused.remaining, start: (current.start ?? now) + (now - paused.at) };
});

export async function applyStop(id) {
  await runTransaction(gameRef(id, "/state"), (current) => {
    if (!current || current.phase === "finished") return undefined;
    const { paused, accept, ...rest } = current;
    return { ...rest, phase: "finished", stoppedEarly: true };
  });
  await set(gameRef(id, "/pause"), null).catch(() => {});
}

/* ---------- Arbitrage (écran principal) ---------- */

// Applique une transition calculée par modes.js : résultats d'abord, puis changement d'étape.
// La transaction vérifie que la partie est toujours à l'étape attendue (pas de double transition).
export async function applyTransition(id, transition) {
  if (!transition) return;
  if (transition.writes && Object.keys(transition.writes).length) {
    const writes = Object.fromEntries(Object.entries(transition.writes).map(([path, value]) => [`games/${id}/${path}`, value]));
    await update(ref(db), writes);
  }
  const { expect } = transition;
  await runTransaction(gameRef(id, "/state"), (current) => {
    if (!current) return undefined;
    if (current.phase !== expect.phase || current.round !== expect.round || (current.step ?? 0) !== (expect.step ?? 0)) return undefined;
    return transition.state;
  });
}

/* ---------- Mémoire du groupe ---------- */

export async function getGroup(group) {
  if (!group) return null;
  return (await get(ref(db, `groups/${group}/players`))).val() ?? {};
}

// Toutes les questions de la partie, retrouvées par leur empreinte (pour les signalements).
export function findQuestion(game, key) {
  for (const round of game.rounds ?? []) {
    const all = [
      ...(round.questions ?? []), ...(round.board ?? []),
      ...(round.pools ?? []).flat(), ...(round.ladders ?? []).flat(), ...(round.lists ?? []).flat(),
    ];
    const found = all.find((q) => q && questionKey(q.question) === key);
    if (found) return found;
  }
  return null;
}

// Enregistre la partie dans l'historique du groupe, une seule fois (drapeau `recorded`).
export async function recordResults(id, game, scores, awards) {
  if (game.recorded) return;
  const claimed = await runTransaction(gameRef(id, "/recorded"), (current) => (current ? undefined : true));
  if (!claimed.committed) return;

  const updates = {};
  if (game.group) {
    const players = await getGroup(game.group).catch(() => ({}));
    const best = scores[0]?.score ?? 0;
    scores.forEach((s, rank) => {
      const key = groupKey(s.name) || s.uid;
      const old = players[key] ?? {};
      const titles = { ...(old.titles ?? {}) };
      awards.filter((a) => a.uids.includes(s.uid)).forEach((a) => { titles[a.key] = (titles[a.key] ?? 0) + 1; });
      updates[`groups/${game.group}/players/${key}`] = {
        name: s.name,
        games: (old.games ?? 0) + 1,
        wins: (old.wins ?? 0) + (s.score === best && best > 0 ? 1 : 0),
        points: (old.points ?? 0) + s.score,
        last: (old.last ?? 0) + (scores.length >= 2 && rank === scores.length - 1 ? 1 : 0),
        titles,
      };
    });
    updates[`groups/${game.group}/name`] = game.groupName ?? game.group;
    for (const key of Object.keys(game.asked ?? {})) updates[`groups/${game.group}/asked/${key}`] = true;
  }
  // Questions signalées : gardées à part pour nettoyer la banque.
  for (const [key, voters] of Object.entries(game.reports ?? {})) {
    const q = findQuestion(game, key);
    if (!q) continue;
    updates[`reports/${id}_${key}`] = {
      theme: q.theme, question: q.question, correct: q.answers[q.correct], count: Object.keys(voters).length, at: serverTimestamp(),
    };
  }
  if (Object.keys(updates).length) await update(ref(db), updates);
}
