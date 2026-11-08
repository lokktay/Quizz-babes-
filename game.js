import {
  ref, set, update, remove, push, get, onValue, query, orderByChild, equalTo, endAt,
  runTransaction, onDisconnect, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-database.js";
import { db } from "./firebase.js";
import { SETTINGS } from "./config.js";
import { collectThemes, prepareBank } from "./logic.js";
import { requestQuestions } from "./ai.js";

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

export async function createGame(name, playerName) {
  const newGame = push(ref(db, "games"));
  await set(newGame, {
    name,
    hostId: uid,
    createdAt: serverTimestamp(),
    state: { phase: "lobby" },
    players: { [uid]: { name: playerName, connected: true } },
  });
  return newGame.key;
}

export async function joinGame(id, playerName) {
  const game = await get(gameRef(id));
  if (!game.exists() || game.child("state/phase").val() !== "lobby") {
    throw new Error("Cette partie n'accepte plus de joueurs.");
  }
  const players = game.child("players").val() ?? {};
  if (!players[uid] && Object.keys(players).length >= SETTINGS.maxPlayers) {
    throw new Error("Cette partie est complète (10 joueurs maximum, créateur inclus).");
  }
  await set(gameRef(id, `/players/${uid}`), { name: playerName, connected: true });
}

export const leaveLobby = (id) => remove(gameRef(id, `/players/${uid}`));
export const deleteGame = (id) => remove(gameRef(id));

export function startPresence(id) {
  const connected = gameRef(id, `/players/${uid}/connected`);
  const stopListening = onValue(ref(db, ".info/connected"), (snap) => {
    if (!snap.val()) return;
    onDisconnect(connected).set(false).then(() => set(connected, true)).catch(() => {});
  });
  return async (markOffline) => {
    stopListening();
    await onDisconnect(connected).cancel().catch(() => {});
    if (markOffline) await set(connected, false).catch(() => {});
  };
}

// Les changements de phase sont transactionnels pour éviter deux transitions concurrentes.
function moveTo(id, from, next) {
  return runTransaction(gameRef(id, "/state"), (current) => {
    if (current === null) return null;
    if (current.phase !== from.phase) return undefined;
    if (from.index !== undefined && current.index !== from.index) return undefined;
    return next();
  });
}

export const startThemes = (id) => moveTo(id, { phase: "lobby" }, () => ({ phase: "themes" }));
export const submitThemes = (id, themes) => set(gameRef(id, `/themes/${uid}`), themes);
export const startGeneration = (id) => moveTo(id, { phase: "themes" }, () => ({ phase: "generating" }));

export async function generateQuestions(id, game, apiKey) {
  if (!apiKey) throw new Error("Colle la clé API pour générer les questions.");
  const themes = collectThemes(game);
  // Une question de marge par thème, pour remplacer celles que le filtre écarte.
  const raw = await requestQuestions(apiKey, themes, SETTINGS.questionsPerTheme + 1);
  const questions = prepareBank(raw, themes, SETTINGS.questionsPerTheme);
  if (!questions.length) throw new Error("L'IA n'a produit aucune question utilisable. Relance la génération.");
  await update(gameRef(id), {
    questions,
    state: { phase: "question", index: 0, deadline: serverNow() + SETTINGS.questionSeconds * 1000 },
  });
}

export const setGenerationError = (id, message) => update(gameRef(id, "/state"), { error: message });
export const clearGenerationError = (id) => update(gameRef(id, "/state"), { error: null });

export const sendAnswer = (id, index, choice) =>
  set(gameRef(id, `/answers/${index}/${uid}`), { choice, at: serverTimestamp() });

export const reveal = (id, index) =>
  moveTo(id, { phase: "question", index }, () => ({
    phase: "reveal",
    index,
    deadline: serverNow() + SETTINGS.revealSeconds * 1000,
  }));

export const nextQuestion = (id, index, total) =>
  moveTo(id, { phase: "reveal", index }, () =>
    index + 1 >= total
      ? { phase: "finished", index }
      : { phase: "question", index: index + 1, deadline: serverNow() + SETTINGS.questionSeconds * 1000 });
