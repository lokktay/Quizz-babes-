import {
  ref, set, update, remove, push, get, onValue, query, orderByChild, equalTo, endAt,
  runTransaction, onDisconnect, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-database.js";
import { db } from "./firebase.js";
import { SETTINGS } from "./config.js";
import { collectThemes, computeScores, prepareBank, prepareBoard } from "./logic.js";
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
  const rawQuestions = await requestQuestions(apiKey, themes, SETTINGS.questionsPerTheme + 1);
  const questions = prepareBank(rawQuestions, themes, SETTINGS.questionsPerTheme);
  const rawBoard = await requestQuestions(apiKey, themes, 4, "plateau");
  const board = prepareBoard(rawBoard, themes, SETTINGS.difficultyPoints);
  if (!questions.length || !board.length) throw new Error("L'IA n'a pas produit de questions utilisables. Relance la génération.");
  await update(gameRef(id), {
    questions,
    board,
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

export const nextQuestion = (id, index) =>
  moveTo(id, { phase: "reveal", index }, () =>
    ({ phase: "question", index: index + 1, deadline: serverNow() + SETTINGS.questionSeconds * 1000 }));

export async function beginBoard(id, index, game, activeIds) {
  const order = computeScores(game).map((player) => player.uid).filter((playerId) => activeIds.includes(playerId));
  return moveTo(id, { phase: "reveal", index }, () =>
    index + 1 < game.questions.length
      ? undefined
      : order.length
        ? { phase: "boardChoose", turnOrder: order, turnIndex: 0, turnNumber: 0, used: {} }
        : { phase: "finished", index });
}

export const submitBoardPick = (id, turnNumber, boardIndex) =>
  set(gameRef(id, `/boardPicks/${turnNumber}`), boardIndex);

export function activateBoardPick(id, turnNumber, boardIndex, boardLength) {
  return runTransaction(gameRef(id, "/state"), (current) => {
    if (!current || current.phase !== "boardChoose" || current.turnNumber !== turnNumber) return undefined;
    if (!Number.isInteger(boardIndex) || boardIndex < 0 || boardIndex >= boardLength || current.used?.[boardIndex]) return undefined;
    const expectedPlayer = current.turnOrder?.[current.turnIndex];
    if (!expectedPlayer) return undefined;
    return {
      ...current,
      phase: "boardQuestion",
      selectedBoardIndex: boardIndex,
      selectedBy: expectedPlayer,
      deadline: serverNow() + SETTINGS.questionSeconds * 1000,
      used: { ...(current.used ?? {}), [boardIndex]: true },
    };
  });
}

export const sendBoardAnswer = (id, boardIndex, choice) =>
  set(gameRef(id, `/boardAnswers/${boardIndex}/${uid}`), { choice, at: serverTimestamp() });

export function revealBoardQuestion(id, turnNumber) {
  return runTransaction(gameRef(id, "/state"), (current) => {
    if (!current || current.phase !== "boardQuestion" || current.turnNumber !== turnNumber) return undefined;
    return {
      ...current,
      phase: "boardReveal",
      deadline: serverNow() + SETTINGS.revealSeconds * 1000,
    };
  });
}

function nextActiveIndex(turnOrder, currentIndex, activeIds) {
  for (let step = 1; step <= turnOrder.length; step++) {
    const index = (currentIndex + step) % turnOrder.length;
    if (activeIds.includes(turnOrder[index])) return index;
  }
  return -1;
}

export function nextBoardTurn(id, turnNumber, activeIds, boardLength) {
  return runTransaction(gameRef(id, "/state"), (current) => {
    if (!current || current.phase !== "boardReveal" || current.turnNumber !== turnNumber) return undefined;
    if (Object.keys(current.used ?? {}).length >= boardLength) return { ...current, phase: "finished" };
    const nextIndex = nextActiveIndex(current.turnOrder ?? [], current.turnIndex, activeIds);
    if (nextIndex < 0) return { ...current, phase: "finished" };
    const { selectedBoardIndex, selectedBy, deadline, ...rest } = current;
    return {
      ...rest,
      phase: "boardChoose",
      turnIndex: nextIndex,
      turnNumber: turnNumber + 1,
    };
  });
}

export function skipBoardTurn(id, turnNumber, activeIds) {
  return runTransaction(gameRef(id, "/state"), (current) => {
    if (!current || current.phase !== "boardChoose" || current.turnNumber !== turnNumber) return undefined;
    const nextIndex = nextActiveIndex(current.turnOrder ?? [], current.turnIndex, activeIds);
    if (nextIndex < 0) return { ...current, phase: "finished" };
    return {
      ...current,
      phase: "boardChoose",
      turnIndex: nextIndex,
      turnNumber: turnNumber + 1,
    };
  });
}
