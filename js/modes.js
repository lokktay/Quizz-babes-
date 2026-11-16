// Modes de jeu : description, programme de la soirée, questions de chaque manche,
// et arbitrage (qui répond, combien de points, quelle est la suite).
// Aucune dépendance à Firebase : l'écran principal appelle nextTransition() et applique le résultat.

import { LEVELS, questionKey, shuffle } from "./logic.js?v=7";

export const LEVEL_POINTS = [1, 3, 5, 7];
export const LEVEL_NAMES = ["Facile", "Moyen", "Difficile", "Très difficile"];

// Durées (ms) de chaque étape.
export const TIMING = {
  intro: 12000, ask: 40000, fast: 35000, reveal: 11000, bet: 12000, decide: 10000,
  pick: 20000, sprint: 90000, vote: 20000,
  role: 15000, word: 15000, clue: 45000, ballot: 60000, verdict: 10000,
};
// Points des jeux à part entière.
export const SPY_POINTS = { found: 1, escaped: 2 };
export const UNDERCOVER_POINTS = { civil: 2, undercover: 4 };
const SPRINT_LOCK_MS = 2000;
export { SPRINT_LOCK_MS };

export const MODES = {
  classique: {
    emoji: "🎯", title: "Classique", stepSec: 38,
    desc: "Tout le monde répond à la même question. 2 points par bonne réponse.",
  },
  plateau: {
    emoji: "🧩", title: "Le plateau", fixed: true, stepSec: 46,
    desc: "Un tableau de cases par thème et par difficulté (1, 3, 5 ou 7 points). Chacun son tour choisit une case et répond seul. Taille fixe : 4 cases par thème, 6 thèmes au plus.",
  },
  rapide: {
    emoji: "⚡", title: "Le plus rapide", stepSec: 32,
    desc: "Plus tu réponds vite, plus tu marques : de 5 points à 1 point. Une erreur ne coûte rien.",
  },
  mortSubite: {
    emoji: "💀", title: "Mort subite", stepSec: 38,
    desc: "Une erreur et tu es éliminé de la manche. Chaque question survécue rapporte 1 point, et la dernière personne en vie en gagne 8 de plus.",
  },
  chrono: {
    emoji: "⏱️", title: "Contre-la-montre", stepSec: 103,
    desc: "90 secondes pour enchaîner un maximum de bonnes réponses, chacun à son rythme sur son téléphone. 1 point par bonne réponse, une erreur bloque 2 secondes.",
  },
  paris: {
    emoji: "🎰", title: "Paris", stepSec: 49,
    desc: "Avant chaque question, tu vois le thème et la difficulté et tu mises 1, 2, 3 ou 5 points. Juste : tu gagnes ta mise. Faux : tu la perds.",
  },
  quitteDouble: {
    emoji: "🎲", title: "Quitte ou double", stepSec: 140,
    desc: "Chaque bonne réponse double ta cagnotte (1, 2, 4, 8, 16) sur des questions de plus en plus dures. Encaisse à temps : une erreur fait tout perdre.",
  },
  echelle: {
    emoji: "🪜", title: "L'échelle", stepSec: 38,
    desc: "Chacun grimpe à son rythme : une bonne réponse fait monter d'un niveau, une erreur fait redescendre. Plus tu es haut, plus ça rapporte (1 à 4 points).",
  },
  cadeau: {
    emoji: "🎁", title: "Cadeau empoisonné", stepSec: 53,
    desc: "À ton tour, tu choisis qui répond et à quelle difficulté. Si la personne trouve, elle gagne les points ; sinon, c'est toi qui les prends.",
  },
  majorite: {
    emoji: "🐑", title: "Majorité", stepSec: 38,
    desc: "Peu importe la bonne réponse : 2 points si tu choisis la même réponse que la majorité du groupe.",
  },
  espion: {
    emoji: "🕵️", title: "L'espion", standalone: true, stepSec: 600,
    desc: "Jeu à part entière. Tout le monde joue en équipe, sauf un espion secret qui doit la faire perdre. 5 questions, la réponse de l'équipe est la plus choisie. Puis on vote : espion trouvé, +1 pour chaque membre de l'équipe ; sinon, +2 pour l'espion.",
  },
  undercover: {
    emoji: "🎭", title: "Undercover", standalone: true, noQuestions: true, stepSec: 600,
    desc: "Jeu à part entière. Chacun reçoit un mot secret ; l'undercover a un mot voisin. Chacun donne un indice à voix haute, puis on vote pour éliminer. Civils gagnants : +2 chacun ; undercover gagnant : +4.",
  },
  duel: {
    emoji: "⚔️", title: "Duels", interlude: true, stepSec: 64,
    desc: "De temps en temps entre deux modes (4 duels au plus), deux joueurs tirés au sort s'affrontent sur une question. Les autres parient sur le gagnant.",
  },
};
export const MODE_ORDER = ["classique", "plateau", "rapide", "mortSubite", "chrono", "paris", "quitteDouble", "echelle", "cadeau", "majorite", "espion", "undercover", "duel"];
// Faut-il des thèmes et des questions ? (Non si le programme ne contient que l'undercover.)
export const needsQuestions = (modes) => (modes ?? []).some((m) => MODES[m] && !MODES[m].noQuestions);
export const DURATIONS = [20, 30, 45, 60, 90, 120];
export const DEFAULT_SETTINGS = { modes: ["classique", "plateau"], minutes: 45 };
const BOARD_THEMES = 6;
const MAX_DUELS = 4;
const SHARED = ["classique", "rapide", "mortSubite", "paris", "majorite", "duel"];

/* ---------- Programme de la soirée ---------- */

// Répartit la durée entre les modes choisis. Le plateau a une taille fixe ; les duels s'intercalent.
export function planProgram({ modes, minutes, themeCount }) {
  const valid = (modes ?? []).filter((m) => MODES[m]);
  let main = valid.filter((m) => !MODES[m].interlude);
  if (!main.length) main = ["classique"];
  // Duels : environ un tous les 2 modes, 4 au plus, répartis régulièrement entre les modes
  // (jamais deux de suite, jamais plus de duels que de vrais modes).
  const gaps = Math.max(1, main.length - 1);
  const duels = valid.includes("duel") ? Math.min(MAX_DUELS, Math.max(1, Math.ceil(gaps / 2))) : 0;
  const duelAfter = new Set(Array.from({ length: duels }, (_, k) => Math.round(((k + 1) * (gaps + 1)) / (duels + 1)) - 1));
  const boardCases = Math.min(Math.max(themeCount, 1), BOARD_THEMES) * 4;
  // Le plateau a une taille fixe ; les jeux à part entière durent le temps qu'on veut (comptés ~10 min).
  const fixedSec = (main.includes("plateau") ? boardCases * MODES.plateau.stepSec : 0)
    + main.filter((m) => MODES[m].standalone).length * 600;
  const overhead = (main.length + duels) * 10 + 30 + duels * MODES.duel.stepSec;
  const variable = main.filter((m) => !MODES[m].fixed && !MODES[m].standalone);
  const share = variable.length ? Math.max(120, (minutes * 60 - overhead - fixedSec) / variable.length) : 0;

  const count = (mode) => {
    if (mode === "plateau") return boardCases;
    if (mode === "duel" || MODES[mode].standalone) return 1;
    return Math.max(mode === "chrono" || mode === "quitteDouble" ? 1 : 3, Math.round(share / MODES[mode].stepSec));
  };
  const program = [];
  main.forEach((mode, i) => {
    program.push({ mode, count: count(mode) });
    if (duelAfter.has(i)) program.push({ mode: "duel", count: 1 });
  });
  return program;
}

export function estimateMinutes(program) {
  const sec = program.reduce((sum, p) => sum + p.count * MODES[p.mode].stepSec + 10, 30);
  return Math.round(sec / 60);
}

/* ---------- Questions de chaque manche ---------- */

const takeMany = (supply, n, level = () => null) =>
  Array.from({ length: n }, (_, i) => supply.take(level(i))).filter(Boolean);

export function buildRounds(program, supply, extras = {}) {
  return program.map(({ mode, count }) => {
    const round = { mode, count };
    switch (mode) {
      case "espion":
        // Jusqu'à 8 parties : 2 faciles, 2 moyennes, 1 difficile ou très difficile.
        round.games = Array.from({ length: 8 }, () => [0, 0, 1, 1, 2 + Math.floor(Math.random() * 2)].map((lvl) => supply.take(lvl)).filter(Boolean))
          .filter((list) => list.length === 5);
        break;
      case "undercover":
        round.pairs = shuffle(extras.pairs ?? []).slice(0, 40);
        break;
      case "classique":
      case "paris":
      case "majorite":
        round.questions = takeMany(supply, count);
        break;
      case "rapide":
        round.questions = takeMany(supply, count, () => (Math.random() < 0.6 ? 0 : 1));
        break;
      case "mortSubite":
        // Difficulté croissante au fil de la manche.
        round.questions = takeMany(supply, count, (i) => Math.min(3, Math.floor((i / count) * 4)));
        break;
      case "duel":
        round.questions = takeMany(supply, 2, () => 1 + Math.floor(Math.random() * 2));
        break;
      case "echelle":
      case "cadeau":
        round.pools = LEVELS.map((_, lvl) => takeMany(supply, count, () => lvl));
        break;
      case "quitteDouble":
        round.ladders = Array.from({ length: count }, () => takeMany(supply, 5, (k) => [0, 1, 2, 3, 3][k]));
        break;
      case "chrono":
        round.lists = Array.from({ length: count }, () => takeMany(supply, 24, () => (Math.random() < 0.7 ? 0 : 1)));
        break;
      case "plateau": {
        const themes = shuffle(supply.themes).slice(0, BOARD_THEMES);
        round.board = themes.flatMap((theme) => LEVELS.map((_, lvl) => {
          const q = supply.take(lvl, theme.theme);
          return q && { ...q, difficulty: LEVELS[lvl], lvl, points: LEVEL_POINTS[lvl] };
        })).filter(Boolean);
        round.count = round.board.length;
        break;
      }
      default:
        round.questions = takeMany(supply, count);
    }
    return round;
  });
}

/* ---------- Qui répond, à quelle question ---------- */

export const roundOf = (game, r = game.state?.round) => game.rounds?.[r];
const nonHost = (game) => Object.keys(game.players ?? {}).filter((uid) => uid !== game.hostId);

// Question posée à `uid` à l'étape en cours (ou null si ce joueur ne répond pas).
export function questionFor(game, uid, state = game.state) {
  const round = roundOf(game, state.round);
  if (!round) return null;
  const s = state.step ?? 0;
  switch (round.mode) {
    case "echelle": {
      const levels = state.phase === "reveal" ? state.asked ?? {} : state.levels ?? {};
      if (levels[uid] === undefined) return null;
      return round.pools?.[levels[uid]]?.[s] ?? null;
    }
    case "cadeau":
      return state.gift ? round.pools?.[state.gift.level]?.[s] ?? null : null;
    case "quitteDouble":
      return round.ladders?.[state.ladder?.i]?.[state.ladder?.k] ?? null;
    case "plateau":
      return round.board?.[state.selected] ?? null;
    case "duel":
      return round.questions?.[0] ?? null;
    case "espion":
      return round.games?.[state.g]?.[state.k] ?? null;
    case "undercover":
      return null;
    default:
      return round.questions?.[s] ?? null;
  }
}

// Question commune affichée sur l'écran principal (null si chacun a la sienne, comme à l'échelle).
export function sharedQuestion(game, state = game.state) {
  const round = roundOf(game, state.round);
  if (!round || round.mode === "echelle" || round.mode === "chrono") return null;
  return questionFor(game, null, state) ?? questionFor(game, state.gift?.target, state);
}

// Joueurs attendus pour répondre à l'étape en cours.
export function eligible(game, active, state = game.state) {
  const mode = roundOf(game, state.round)?.mode;
  const isActive = (uid) => active.includes(uid);
  switch (mode) {
    case "mortSubite": return (state.alive ?? []).filter(isActive);
    case "quitteDouble": return (state.ladder?.in ?? []).filter(isActive);
    case "cadeau": return state.gift ? [state.gift.target] : [];
    case "plateau": return state.chooser ? [state.chooser] : [];
    case "duel": return (state.duelists ?? []).filter(isActive);
    case "echelle": return Object.keys(state.levels ?? {}).filter(isActive);
    default: return active;
  }
}

/* ---------- Arbitrage ---------- */

const askDuration = (mode) => (mode === "rapide" ? TIMING.fast : TIMING.ask);

function askState(game, base, now, extra = {}) {
  const mode = roundOf(game, base.round).mode;
  return { ...base, ...extra, phase: "ask", accept: "answers", start: now, deadline: now + askDuration(mode) };
}

function introState(base, r, now) {
  return { ...keep(base), phase: "intro", round: r, step: 0, start: now, deadline: now + TIMING.intro };
}

// Ce qui traverse toute la partie : looser élu, vote déjà fait, joueurs déjà passés en duel.
const keep = (state) => ({
  ...(state.shame ? { shame: state.shame } : {}),
  ...(state.voted ? { voted: true } : {}),
  ...(state.dueled ? { dueled: state.dueled } : {}),
});

function beginRound(game, state, now, active, scores) {
  const r = state.round;
  const round = roundOf(game, r);
  const base = { ...keep(state), round: r, step: 0 };
  switch (round.mode) {
    case "paris":
      return { ...base, phase: "bet", accept: "bets", start: now, deadline: now + TIMING.bet };
    case "mortSubite":
      return askState(game, base, now, { alive: active });
    case "echelle":
      return askState(game, base, now, { levels: Object.fromEntries(active.map((uid) => [uid, 0])) });
    case "quitteDouble":
      return askState(game, base, now, { ladder: { i: 0, k: 0, in: active, pots: {} } });
    case "cadeau": {
      // Les derniers du classement offrent en premier : l'occasion de se venger.
      const order = [...scores].reverse().map((s) => s.uid).filter((uid) => active.includes(uid));
      return { ...base, phase: "pick", accept: "pick", order, turn: 0, chooser: order[0], start: now, deadline: now + TIMING.pick };
    }
    case "plateau": {
      const order = scores.map((s) => s.uid).filter((uid) => active.includes(uid));
      return { ...base, phase: "pick", accept: "pick", order, turn: 0, chooser: order[0], used: {}, start: now, deadline: now + TIMING.pick };
    }
    case "chrono":
      return { ...base, phase: "sprint", accept: "sprint", start: now, deadline: now + TIMING.sprint };
    case "espion":
      return spyGame(game, base, now, active, 0);
    case "undercover":
      return undercoverGame(game, base, now, active, 0);
    case "duel": {
      const dueled = state.dueled ?? [];
      const fresh = shuffle(active.filter((uid) => !dueled.includes(uid)));
      const pool = fresh.length >= 2 ? fresh : shuffle(active);
      const duelists = pool.slice(0, 2);
      return { ...base, phase: "bet", accept: "bets", duelists, dueled: [...dueled, ...duelists].slice(-20), start: now, deadline: now + TIMING.bet };
    }
    default:
      return askState(game, base, now);
  }
}

function endRound(game, state, now, active) {
  const next = state.round + 1;
  if (state.round === 0 && !state.voted && active.length >= 3 && next < (game.rounds?.length ?? 0)) {
    return { ...keep(state), phase: "vote", round: state.round, step: 0, accept: "vote", start: now, deadline: now + TIMING.vote };
  }
  if (next < (game.rounds?.length ?? 0)) return introState(state, next, now);
  return { ...keep(state), phase: "finished", round: state.round };
}

const answerOf = (game, state, uid) => game.answers?.[state.round]?.[state.step]?.[uid];
const resultFor = (q, answer) => (!answer ? -1 : answer.choice === q?.correct ? 1 : 0);

// Résout une question : points de chacun et état suivant (avant l'écran de correction).
function resolveAsk(game, state, now, active) {
  const round = roundOf(game, state.round);
  const mode = round.mode;
  const who = eligible(game, active, state);
  const results = {};
  const set = (uid, ok, pts, lvl, extra = {}) => { results[uid] = { ...(ok === null ? {} : { ok }), pts, ...(lvl === null ? {} : { lvl }), ...extra }; };
  const shared = questionFor(game, null, state);
  const next = { ...state, phase: "reveal", accept: null, start: now, deadline: now + TIMING.reveal };

  switch (mode) {
    case "classique":
      for (const uid of who) { const ok = resultFor(shared, answerOf(game, state, uid)); set(uid, ok, ok === 1 ? 2 : 0, shared.lvl); }
      break;
    case "rapide":
      for (const uid of who) {
        const answer = answerOf(game, state, uid);
        const ok = resultFor(shared, answer);
        const elapsed = Math.max(0, (answer?.at ?? state.deadline) - state.start);
        const pts = ok === 1 ? Math.max(1, Math.ceil(5 * (1 - elapsed / TIMING.fast))) : 0;
        set(uid, ok, pts, shared.lvl);
      }
      break;
    case "majorite": {
      const counts = [0, 0, 0, 0];
      for (const uid of who) { const a = answerOf(game, state, uid); if (a) counts[a.choice]++; }
      const top = Math.max(...counts);
      const majority = top >= 2 ? counts.map((c, i) => (c === top ? i : -1)).filter((i) => i >= 0) : [];
      for (const uid of who) {
        const a = answerOf(game, state, uid);
        set(uid, resultFor(shared, a), a && majority.includes(a.choice) ? 2 : 0, shared.lvl, a && majority.includes(a.choice) ? { maj: 1 } : {});
      }
      next.majority = majority;
      break;
    }
    case "paris":
      for (const uid of who) {
        const bet = [1, 2, 3, 5].includes(game.bets?.[state.round]?.[state.step]?.[uid]) ? game.bets[state.round][state.step][uid] : 1;
        const ok = resultFor(shared, answerOf(game, state, uid));
        set(uid, ok, ok === 1 ? bet : -bet, shared.lvl, { bet });
      }
      break;
    case "mortSubite": {
      const outcomes = who.map((uid) => [uid, resultFor(shared, answerOf(game, state, uid))]);
      const survivors = outcomes.filter(([, ok]) => ok === 1).map(([uid]) => uid);
      // Si tout le monde se trompe, personne n'est éliminé.
      const alive = survivors.length ? survivors : who;
      const last = state.step + 1 >= round.questions.length;
      // Une série se termine quand il ne reste qu'un survivant : il prend le bonus,
      // puis tout le monde repart pour une nouvelle série, jusqu'à la fin des questions prévues.
      const seriesOver = last || alive.length <= 1;
      for (const [uid, ok] of outcomes) {
        const survived = alive.includes(uid);
        const bonus = seriesOver && survived ? (alive.length === 1 ? 8 : 3) : 0;
        set(uid, ok, (survived ? 1 : 0) + bonus, shared.lvl, { ...(survived ? {} : { out: 1 }), ...(bonus ? { bonus } : {}) });
      }
      next.alive = seriesOver && !last ? active : alive;
      next.lastStep = last;
      next.newSeries = seriesOver && !last;
      break;
    }
    case "echelle": {
      const levels = { ...(state.levels ?? {}) };
      for (const uid of Object.keys(levels)) {
        if (!who.includes(uid)) continue;
        const lvl = levels[uid];
        const ok = resultFor(round.pools?.[lvl]?.[state.step], answerOf(game, state, uid));
        set(uid, ok, ok === 1 ? lvl + 1 : 0, lvl);
        levels[uid] = ok === 1 ? Math.min(3, lvl + 1) : Math.max(0, lvl - 1);
      }
      next.asked = state.levels;
      next.levels = levels;
      break;
    }
    case "quitteDouble": {
      const { k } = state.ladder;
      const pots = { ...(state.ladder.pots ?? {}) };
      const stillIn = [];
      for (const uid of who) {
        const ok = resultFor(shared, answerOf(game, state, uid));
        if (ok === 1) {
          pots[uid] = 2 ** k;
          stillIn.push(uid);
          // Dernière marche : la cagnotte est encaissée d'office.
          set(uid, ok, k === 4 ? pots[uid] : 0, shared.lvl, k === 4 ? { bank: pots[uid] } : {});
        } else {
          set(uid, ok, 0, shared.lvl, pots[uid] || k > 0 ? { lost: 2 ** Math.max(0, k - 1) } : {});
          delete pots[uid];
        }
      }
      next.ladder = { ...state.ladder, in: k === 4 ? [] : stillIn, pots };
      break;
    }
    case "cadeau": {
      const { target, level } = state.gift;
      const q = round.pools?.[level]?.[state.step];
      const ok = resultFor(q, answerOf(game, state, target));
      const pts = LEVEL_POINTS[level];
      set(target, ok, ok === 1 ? pts : 0, level);
      if (ok !== 1) set(state.chooser, null, pts, null, { gift: 1 });
      break;
    }
    case "plateau": {
      const q = round.board?.[state.selected];
      const ok = resultFor(q, answerOf(game, state, state.chooser));
      set(state.chooser, ok, ok === 1 ? q.points : 0, q.lvl, { solo: 1 });
      break;
    }
    case "espion": {
      // La réponse de l'équipe est la plus choisie ; une égalité compte comme une erreur.
      const counts = [0, 0, 0, 0];
      for (const uid of who) {
        const a = answerOf(game, state, uid);
        if (a) counts[a.choice]++;
        set(uid, resultFor(shared, a), 0, shared.lvl);
      }
      const top = Math.max(...counts);
      const choices = counts.map((c, i) => (c === top ? i : -1)).filter((i) => i >= 0);
      const teamChoice = top > 0 && choices.length === 1 ? choices[0] : -1;
      next.teamChoice = teamChoice;
      next.teamLog = [...(state.teamLog ?? []), teamChoice === shared.correct ? 1 : 0];
      break;
    }
    case "duel": {
      const [a, b] = state.duelists ?? [];
      const correct = [a, b].filter((uid) => resultFor(shared, answerOf(game, state, uid)) === 1);
      const winner = correct.sort((x, y) => (answerOf(game, state, x)?.at ?? 0) - (answerOf(game, state, y)?.at ?? 0))[0] ?? null;
      for (const uid of [a, b].filter(Boolean)) set(uid, resultFor(shared, answerOf(game, state, uid)), uid === winner ? 5 : 0, shared.lvl);
      for (const [uid, pick] of Object.entries(game.bets?.[state.round]?.[0] ?? {})) {
        if (uid !== a && uid !== b && winner && pick === winner) set(uid, null, 2, null, { betWin: 1 });
      }
      next.winner = winner ?? "";
      break;
    }
    default:
      break;
  }
  return { results, next };
}

// Ce que l'écran principal doit faire maintenant. Renvoie null s'il n'y a rien à faire.
// ctx = { active: [uids connectés], goneFor(uid) → ms, scores: classement actuel }
export function nextTransition(game, now, ctx) {
  const state = game.state ?? {};
  const round = roundOf(game);
  const expect = { phase: state.phase, round: state.round, step: state.step };
  const due = now >= (state.deadline ?? Infinity);
  const r = state.round;
  const s = state.step ?? 0;

  switch (state.phase) {
    case "intro":
      return due ? { expect, state: beginRound(game, state, now, ctx.active, ctx.scores) } : null;

    case "bet": {
      // Paris : tout le monde a misé. Duel : tous les spectateurs ont parié.
      const bets = game.bets?.[r]?.[s] ?? {};
      const bettors = round.mode === "duel" ? ctx.active.filter((uid) => !(state.duelists ?? []).includes(uid)) : ctx.active;
      const done = bettors.every((uid) => bets[uid] !== undefined);
      if (!due && !done) return null;
      return { expect, state: askState(game, state, now) };
    }

    case "pick": {
      const pick = game.picks?.[r]?.[s];
      if (ctx.goneFor(state.chooser) > 10000) return { expect, state: nextTurn(game, state, now, ctx) };
      if (round.mode === "plateau") {
        if (Number.isInteger(pick) && pick >= 0 && pick < round.board.length && !state.used?.[pick]) {
          return { expect, state: askState(game, state, now, { selected: pick, used: { ...(state.used ?? {}), [pick]: true } }) };
        }
        if (!due) return null;
        // Temps écoulé : une case au hasard.
        const free = round.board.map((_, i) => i).filter((i) => !state.used?.[i]);
        const auto = free[Math.floor(Math.random() * free.length)];
        return { expect, state: askState(game, state, now, { selected: auto, used: { ...(state.used ?? {}), [auto]: true } }) };
      }
      // Cadeau empoisonné
      const valid = pick && ctx.active.includes(pick.target) && pick.target !== state.chooser && [0, 1, 2, 3].includes(pick.level);
      if (!valid && !due) return null;
      const others = ctx.active.filter((uid) => uid !== state.chooser);
      if (!others.length) return { expect, state: endRound(game, state, now, ctx.active) };
      const gift = valid ? { target: pick.target, level: pick.level } : { target: others[Math.floor(Math.random() * others.length)], level: 1 };
      return { expect, state: askState(game, state, now, { gift }) };
    }

    case "ask": {
      const who = eligible(game, ctx.active, state);
      const answered = who.every((uid) => answerOf(game, state, uid));
      if (!due && !(who.length && answered)) return null;
      const { results, next } = resolveAsk(game, state, now, ctx.active);
      const writes = { [`results/${r}/${s}`]: results };
      for (const uid of Object.keys(results)) {
        const q = questionFor(game, uid, state);
        if (q) writes[`asked/${questionKey(q.question)}`] = true;
      }
      return { expect, state: next, writes };
    }

    case "decide": {
      const pending = (state.ladder?.in ?? []).filter((uid) => ctx.active.includes(uid));
      const choices = game.decisions?.[r]?.[s] ?? {};
      if (!due && !pending.every((uid) => choices[uid])) return null;
      // Sans réponse, on encaisse (le choix prudent).
      const pots = state.ladder.pots ?? {};
      const writes = {};
      const stay = [];
      for (const uid of pending) {
        if (choices[uid] === "double") stay.push(uid);
        else {
          writes[`results/${r}/${s}/${uid}/pts`] = pots[uid] ?? 0;
          writes[`results/${r}/${s}/${uid}/bank`] = pots[uid] ?? 0;
        }
      }
      const ladder = { ...state.ladder, in: stay };
      return { expect, state: afterLadderStep(game, { ...state, ladder }, now, ctx), writes };
    }

    case "sprint": {
      if (!due) return null;
      const list = round.lists?.[s] ?? [];
      const results = {};
      for (const uid of ctx.active) {
        const answers = game.sprint?.[r]?.[s]?.[uid] ?? {};
        const entries = Object.entries(answers);
        const right = entries.filter(([i, a]) => a?.choice === list[i]?.correct).length;
        results[uid] = { pts: right, done: entries.length };
      }
      const writes = { [`results/${r}/${s}`]: results };
      const answeredIdx = new Set(Object.values(game.sprint?.[r]?.[s] ?? {}).flatMap((a) => Object.keys(a ?? {})));
      for (const i of answeredIdx) if (list[i]) writes[`asked/${questionKey(list[i].question)}`] = true;
      return { expect, state: { ...state, phase: "reveal", accept: null, start: now, deadline: now + TIMING.reveal }, writes };
    }

    case "reveal": {
      if (!due) return null;
      return { expect, state: afterReveal(game, state, now, ctx) };
    }

    case "role":
    case "word":
      if (!due && !ctx.skip) return null;
      if (state.phase === "role") return { expect, state: askState(game, { ...state, step: state.step }, now, { k: 0 }) };
      return { expect, state: clueState(state, now, 0) };

    case "clue": {
      // Le joueur qui parle valide son indice (ou l'écran principal passe, ou le temps est écoulé).
      const done = game.picks?.[r]?.[s] === true || ctx.skip || due || ctx.goneFor(state.chooser) > 10000;
      if (!done) return null;
      const uc = state.uc;
      const order = uc.order.filter((uid) => uc.alive.includes(uid));
      if (uc.turn + 1 < order.length) return { expect, state: clueState(state, now, uc.turn + 1) };
      return { expect, state: { ...state, chooser: null, phase: "ballot", accept: "ballot", step: s + 1, start: now, deadline: now + TIMING.ballot } };
    }

    case "ballot": {
      const mode = round.mode;
      const voters = mode === "undercover" ? state.uc.alive.filter((uid) => ctx.active.includes(uid)) : ctx.active;
      const ballots = game.ballots?.[r]?.[s] ?? {};
      if (!due && !ctx.skip && !(voters.length && voters.every((uid) => ballots[uid]))) return null;
      const tally = {};
      for (const uid of voters) {
        const target = ballots[uid];
        if (target && target !== uid && game.players?.[target]) tally[target] = (tally[target] ?? 0) + 1;
      }
      const top = Math.max(0, ...Object.values(tally));
      const leaders = Object.keys(tally).filter((t) => tally[t] === top);
      const accused = top && leaders.length === 1 ? leaders[0] : "";
      const verdict = { ...state, phase: "verdict", accept: null, accused, start: now, deadline: now + TIMING.verdict };
      if (mode === "espion") {
        const found = accused === state.spy;
        const results = {};
        for (const uid of state.team ?? []) {
          if (uid === state.spy) results[uid] = { pts: found ? 0 : SPY_POINTS.escaped, spy: 1 };
          else results[uid] = { pts: found ? SPY_POINTS.found : 0 };
        }
        return { expect, state: { ...verdict, found }, writes: { [`results/${r}/${s}`]: results } };
      }
      // Undercover : la personne désignée est éliminée et son rôle révélé.
      const uc = { ...state.uc, alive: state.uc.alive.filter((uid) => uid !== accused) };
      const outcome = ucOutcome(uc);
      const writes = {};
      if (outcome) {
        const results = {};
        for (const [uid, role] of Object.entries(uc.roles)) {
          const won = (outcome === "civils") === (role === "civil");
          results[uid] = { pts: won ? UNDERCOVER_POINTS[role === "civil" ? "civil" : "undercover"] : 0, ...(role === "undercover" ? { uc: 1 } : {}) };
        }
        writes[`results/${r}/${s}`] = results;
      }
      return { expect, state: { ...verdict, uc: { ...uc, winner: outcome ?? "" } }, writes };
    }

    case "verdict":
      if (!due && !ctx.skip) return null;
      if (round.mode === "undercover" && !state.uc?.winner) return { expect, state: ucAfterVerdict(game, state, now, ctx) };
      return { expect, state: { ...state, phase: "end", accept: "continue", start: now, deadline: null } };

    case "end": {
      // On attend que quelqu'un choisisse : partie suivante ou mode suivant.
      const choice = game.choices?.[r]?.[s];
      if (choice === "again") {
        const g = (round.mode === "espion" ? state.g : state.uc.g) + 1;
        const more = round.mode === "espion" ? g < (round.games?.length ?? 0) : g < (round.pairs?.length ?? 0);
        if (more) {
          const base = { ...keep(state), round: r, step: s + 1, ...(state.spy ? { lastSpy: state.spy } : {}) };
          return { expect, state: round.mode === "espion" ? spyGame(game, base, now, ctx.active, g) : undercoverGame(game, base, now, ctx.active, g) };
        }
      }
      if (choice === "again" || choice === "next") return { expect, state: endRound(game, state, now, ctx.active) };
      return null;
    }

    case "vote": {
      const voters = ctx.active;
      if (!due && !(voters.length && voters.every((uid) => game.votes?.[uid]))) return null;
      const tally = {};
      for (const [voter, target] of Object.entries(game.votes ?? {})) {
        if (voter !== target && game.players?.[target] && target !== game.hostId) tally[target] = (tally[target] ?? 0) + 1;
      }
      const top = Math.max(0, ...Object.values(tally));
      const shame = top ? Object.keys(tally).filter((t) => tally[t] === top) : [];
      const voted = { ...state, voted: true, ...(shame.length ? { shame } : {}) };
      return { expect, state: introState(voted, state.round + 1, now) };
    }

    default:
      return null;
  }
}

function nextTurn(game, state, now, ctx) {
  const round = roundOf(game, state.round);
  const order = (state.order ?? []).filter((uid) => ctx.active.includes(uid));
  const finished = round.mode === "plateau"
    ? Object.keys(state.used ?? {}).length >= round.board.length
    : state.turn + 1 >= round.count;
  if (finished || !order.length) return endRound(game, state, now, ctx.active);
  const position = (state.order ?? []).indexOf(state.chooser);
  const nextChooser = order.find((uid) => (state.order.indexOf(uid) > position)) ?? order[0];
  const { gift, selected, winner, ...rest } = state;
  return { ...rest, phase: "pick", accept: "pick", step: state.step + 1, turn: state.turn + 1, chooser: nextChooser, start: now, deadline: now + TIMING.pick };
}

function afterLadderStep(game, state, now, ctx) {
  const round = roundOf(game, state.round);
  const { i, k } = state.ladder;
  const stillIn = (state.ladder.in ?? []).filter((uid) => ctx.active.includes(uid));
  if (stillIn.length && k < 4) {
    return askState(game, { ...state, step: state.step + 1 }, now, { ladder: { ...state.ladder, k: k + 1, in: stillIn } });
  }
  if (i + 1 < (round.ladders?.length ?? 0)) {
    return askState(game, { ...state, step: state.step + 1 }, now, { ladder: { i: i + 1, k: 0, in: ctx.active, pots: {} } });
  }
  return endRound(game, state, now, ctx.active);
}

function afterReveal(game, state, now, ctx) {
  const round = roundOf(game, state.round);
  const nextStep = { ...state, step: state.step + 1, accept: null };
  delete nextStep.majority;
  switch (round.mode) {
    case "paris":
      if (state.step + 1 >= round.questions.length) return endRound(game, state, now, ctx.active);
      return { ...nextStep, phase: "bet", accept: "bets", start: now, deadline: now + TIMING.bet };
    case "mortSubite":
      if (state.lastStep) return endRound(game, state, now, ctx.active);
      return askState(game, nextStep, now, { lastStep: false, newSeries: false });
    case "echelle":
      if (state.step + 1 >= round.count) return endRound(game, state, now, ctx.active);
      return askState(game, nextStep, now);
    case "quitteDouble": {
      const correct = (state.ladder.in ?? []).filter((uid) => ctx.active.includes(uid));
      // Ceux qui viennent de trouver choisissent : encaisser ou doubler.
      if (correct.length && state.ladder.k < 4) {
        return { ...state, phase: "decide", accept: "decisions", start: now, deadline: now + TIMING.decide };
      }
      return afterLadderStep(game, { ...state, ladder: { ...state.ladder, in: correct } }, now, ctx);
    }
    case "cadeau":
    case "plateau":
      return nextTurn(game, state, now, ctx);
    case "chrono":
      if (state.step + 1 >= round.count) return endRound(game, state, now, ctx.active);
      return { ...nextStep, phase: "sprint", accept: "sprint", start: now, deadline: now + TIMING.sprint };
    case "duel":
      return endRound(game, state, now, ctx.active);
    case "espion":
      if (state.k + 1 < 5) return askState(game, { ...nextStep, k: state.k + 1, teamChoice: null }, now);
      return { ...nextStep, teamChoice: null, phase: "ballot", accept: "ballot", start: now, deadline: now + TIMING.ballot };
    case "undercover":
      return ucAfterVerdict(game, state, now, ctx);
    default:
      if (state.step + 1 >= (round.questions?.length ?? 0)) return endRound(game, state, now, ctx.active);
      return askState(game, nextStep, now);
  }
}

/* ---------- L'espion ---------- */

function spyGame(game, base, now, active, g) {
  const candidates = active.filter((uid) => uid !== base.lastSpy);
  const pool = candidates.length ? candidates : active;
  const spy = pool[Math.floor(Math.random() * pool.length)];
  return {
    ...base, g, k: 0, spy, team: active, teamLog: [], teamChoice: null,
    phase: "role", accept: null, start: now, deadline: now + TIMING.role,
  };
}

/* ---------- Undercover ---------- */

function undercoverGame(game, base, now, active, g) {
  const round = roundOf(game, base.round);
  const pair = round.pairs?.[g];
  if (!pair || active.length < 3) return endRound(game, base, now, active);
  const [civilWord, ucWord] = Math.random() < 0.5 ? pair.words : [...pair.words].reverse();
  const players = shuffle(active);
  const ucCount = active.length >= 6 ? 2 : 1;
  const roles = Object.fromEntries(players.map((uid, i) => [uid, i < ucCount ? "undercover" : "civil"]));
  const words = Object.fromEntries(players.map((uid) => [uid, roles[uid] === "civil" ? civilWord : ucWord]));
  const uc = { g, theme: pair.theme ?? "", roles, words, alive: active, order: shuffle(active), turn: 0, cycle: 1, winner: "" };
  return { ...base, uc, phase: "word", accept: null, start: now, deadline: now + TIMING.word };
}

function clueState(state, now, turn) {
  const order = state.uc.order.filter((uid) => state.uc.alive.includes(uid));
  return {
    ...state, uc: { ...state.uc, turn }, chooser: order[turn], phase: "clue", accept: "pick",
    step: state.phase === "word" ? state.step : state.step + 1, start: now, deadline: now + TIMING.clue,
  };
}

// Qui a gagné ? null tant que la partie continue.
function ucOutcome(uc) {
  const undercovers = uc.alive.filter((uid) => uc.roles[uid] === "undercover").length;
  const civils = uc.alive.length - undercovers;
  if (!undercovers) return "civils";
  if (undercovers >= civils) return "undercover";
  return null;
}

// Après l'élimination : nouveau tour d'indices avec les survivants, ou fin de la partie.
function ucAfterVerdict(game, state, now, ctx) {
  if (state.uc.winner) return { ...state, phase: "end", accept: "continue", start: now, deadline: null };
  const alive = state.uc.alive.filter((uid) => ctx.active.includes(uid));
  const order = [...state.uc.order.filter((uid) => alive.includes(uid))];
  order.push(order.shift());
  return clueState({ ...state, phase: "verdict", uc: { ...state.uc, alive, order, cycle: state.uc.cycle + 1 } }, now, 0);
}

export const firstState = (now) => ({ phase: "intro", round: 0, step: 0, start: now, deadline: now + TIMING.intro });
export { SHARED };

export { LEVELS };
export const questionKeyOf = (q) => questionKey(q.question);
