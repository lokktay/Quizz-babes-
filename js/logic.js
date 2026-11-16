// Règles du jeu sans dépendance à Firebase : filtrage des questions et score.

export function normalize(text) {
  return String(text ?? "").trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

export function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Thèmes choisis par un joueur. Format : { bank: [id…], free: "texte", extra: id, ready: true }.
// (L'ancien format, un simple tableau de textes, reste accepté comme thèmes libres.)
// `noAi` : la partie a renoncé aux thèmes libres, le thème `extra` de la banque les remplace.
export function playerThemes(entry, { noAi = false } = {}) {
  if (Array.isArray(entry)) return entry.map((text) => ({ source: "ai", text }));
  if (!entry?.ready) return [];
  const list = (entry.bank ?? []).map((id) => ({ source: "bank", id }));
  if (noAi) {
    if (entry.extra) list.push({ source: "bank", id: entry.extra });
  } else if (String(entry.free ?? "").trim()) {
    list.push({ source: "ai", text: String(entry.free).trim() });
  }
  return list;
}

// Liste les thèmes de tous les joueurs prêts, sans doublon.
// `bankIndex` : liste de banque/index.json, pour traduire un identifiant en nom de thème.
// Un thème libre identique à un thème de la banque utilise la banque (pas d'appel à l'IA).
export function collectThemes(game, bankIndex = []) {
  const labels = new Map(bankIndex.map((t) => [t.id, t.label]));
  const seen = new Map();
  for (const [uid, entry] of Object.entries(game.themes ?? {})) {
    if (uid === game.hostId) continue;
    const by = game.players?.[uid]?.name ?? "?";
    for (const item of playerThemes(entry, { noAi: Boolean(game.state?.noAi) })) {
      const theme = item.source === "bank" ? labels.get(item.id) : item.text;
      const key = normalize(theme);
      if (!key) continue;
      const existing = seen.get(key);
      if (existing) {
        existing.by.push(by);
        if (item.source === "bank") Object.assign(existing, { source: "bank", bankId: item.id });
      } else {
        seen.set(key, { theme: String(theme).trim(), by: [by], source: item.source, ...(item.id ? { bankId: item.id } : {}) });
      }
    }
  }
  return [...seen.values()].map((t) => ({ ...t, by: [...new Set(t.by)].join(", ") }));
}

const DATE_QUESTION = /(quelle annee|quel siecle|quelle decennie|quelle epoque|quelle date|^quand\b|depuis quand|date de (creation|naissance|deces|mort|sortie|fondation|publication)|annee de (creation|naissance|deces|mort|sortie|fondation|publication))/;
const MONTHS = "janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre";
const DATE_ANSWER = new RegExp(
  `\\b(1\\d{3}|20\\d{2})\\b|\\b\\d{1,2}(er)?\\s+(${MONTHS})\\b|\\bsiecle\\b|\\bannees\\s+\\d|^\\d+\\s*(ans?|mois|jours?|decennies?)$`
);

// Une seule réponse avec un nombre peut être un titre (« 1984 ») ;
// à partir de deux, la question porte sur une date.
export function isAboutDates(question, answers) {
  if (DATE_QUESTION.test(normalize(question))) return true;
  return answers.filter((a) => DATE_ANSWER.test(normalize(a))).length >= 2;
}

export const LEVELS = ["facile", "moyen", "difficile", "tres_difficile"];

// Empreinte courte d'un énoncé, pour retenir les questions déjà posées à un groupe.
export function questionKey(text) {
  let h = 2166136261;
  for (const char of normalize(text).replace(/[^a-z0-9]/g, "")) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return (h >>> 0).toString(36);
}

// Réserve de questions valides par thème, partagée entre la manche 1 et le plateau.
// Une question rejetée n'invalide plus tout le lot : on la jette et on garde les autres.
export function createPools() {
  const pools = new Map();
  const seen = new Set();
  return {
    pools,
    add(raw) {
      const key = normalize(raw.theme);
      if (!key) return;
      const question = String(raw.question ?? "").trim();
      const correct = String(raw.correct ?? "").trim();
      const wrong = [raw.wrong_1, raw.wrong_2, raw.wrong_3].map((a) => String(a ?? "").trim());
      const answers = [correct, ...wrong];
      if (!question || answers.some((a) => !a)) return;
      if (new Set(answers.map(normalize)).size !== 4) return;
      if (seen.has(normalize(question)) || isAboutDates(question, answers)) return;
      seen.add(normalize(question));
      const difficulty = LEVELS.includes(raw.difficulty) ? raw.difficulty : "moyen";
      if (!pools.has(key)) pools.set(key, []);
      pools.get(key).push({ question, correct, wrong, difficulty });
    },
    count(theme) {
      return pools.get(normalize(theme.theme))?.length ?? 0;
    },
  };
}

function toPlayable(item, theme, lvl) {
  const answers = shuffle([item.correct, ...item.wrong]);
  return { theme: theme.theme, by: theme.by, question: item.question, answers, correct: answers.indexOf(item.correct), difficulty: LEVELS[lvl], lvl };
}

// Réserve de questions pour toute la partie : on pioche un thème à tour de rôle (pour varier),
// au niveau demandé ou au plus proche. Les questions déjà posées au groupe passent en dernier.
export function createSupply(themes, pools, isAsked = () => false) {
  const slots = themes.map((theme) => {
    const all = pools.get(normalize(theme.theme)) ?? [];
    const byLevel = LEVELS.map((level) => {
      const items = all.filter((item) => item.difficulty === level);
      return [...shuffle(items.filter((i) => !isAsked(i.question))), ...shuffle(items.filter((i) => isAsked(i.question)))];
    });
    return { theme, byLevel };
  }).filter((slot) => slot.byLevel.some((list) => list.length));
  let pointer = Math.floor(Math.random() * Math.max(1, slots.length));
  const weights = [0.3, 0.35, 0.25, 0.1];
  const randomLevel = () => {
    let x = Math.random();
    for (let i = 0; i < weights.length; i++) if ((x -= weights[i]) < 0) return i;
    return 1;
  };
  return {
    themes: slots.map((slot) => slot.theme),
    // `level` : 0 à 3, ou null pour un niveau au hasard. `themeName` : limiter à un thème.
    take(level = null, themeName = null) {
      const wanted = level ?? randomLevel();
      const candidates = themeName ? slots.filter((s) => s.theme.theme === themeName) : slots;
      for (let attempt = 0; attempt < candidates.length; attempt++) {
        const slot = candidates[(pointer + attempt) % candidates.length];
        const order = [0, 1, -1, 2, -2, 3, -3].map((d) => wanted + d).filter((l) => l >= 0 && l < LEVELS.length);
        for (const lvl of order) {
          const item = slot.byLevel[lvl].shift();
          if (item) {
            pointer = (pointer + attempt + 1) % Math.max(1, candidates.length);
            return toPlayable(item, slot.theme, lvl);
          }
        }
      }
      return null;
    },
  };
}

/* ---------- Scores ---------- */

// Parcourt les résultats enregistrés par l'écran principal, dans l'ordre de la partie.
// results[manche][étape] = { uid: { ok: 1 | 0 | -1, pts, lvl } }  (ok -1 : pas de réponse)
export function resultSteps(game) {
  const steps = [];
  const rounds = Object.entries(game.results ?? {}).filter(([, v]) => v).sort((a, b) => a[0] - b[0]);
  for (const [r, byStep] of rounds) {
    for (const [s, entries] of Object.entries(byStep ?? {}).filter(([, v]) => v).sort((a, b) => a[0] - b[0])) {
      steps.push({ r: Number(r), s: Number(s), entries });
    }
  }
  return steps;
}

// `exclude` : { r, s } à ne pas compter (classement « juste avant » une correction).
export function computeScores(game, { exclude = null } = {}) {
  const totals = new Map();
  const gained = new Map();
  const { phase, round, step } = game.state ?? {};
  const showsGain = phase === "reveal";
  for (const { r, s, entries } of resultSteps(game)) {
    if (exclude && exclude.r === r && exclude.s === s) continue;
    for (const [uid, res] of Object.entries(entries)) {
      totals.set(uid, (totals.get(uid) ?? 0) + (res?.pts ?? 0));
      if (showsGain && r === round && s === step) gained.set(uid, (gained.get(uid) ?? 0) + (res?.pts ?? 0));
    }
  }
  return Object.entries(game.players ?? {})
    .filter(([uid]) => uid !== game.hostId)
    .map(([uid, player]) => ({ uid, name: player.name, score: totals.get(uid) ?? 0, gained: gained.get(uid) ?? 0 }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "fr"));
}

// Série en cours d'un joueur (bonnes réponses > 0, erreurs < 0), jusqu'à l'étape { r, s } incluse.
export function streakOf(game, uid, until = null) {
  let streak = 0;
  const steps = resultSteps(game).filter(({ r, s }) => !until || r < until.r || (r === until.r && s <= until.s));
  for (let i = steps.length - 1; i >= 0; i--) {
    const ok = steps[i].entries[uid]?.ok;
    if (ok === undefined || ok === null) continue;
    const right = ok === 1;
    if (streak === 0) streak = right ? 1 : -1;
    else if ((streak > 0) === right) streak += right ? 1 : -1;
    else break;
  }
  return streak;
}
