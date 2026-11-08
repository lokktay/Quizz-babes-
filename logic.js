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

// Liste les thèmes de tous les joueurs, sans doublon.
export function collectThemes(game) {
  const seen = new Map();
  for (const [uid, list] of Object.entries(game.themes ?? {})) {
    if (uid === game.hostId) continue;
    const by = game.players?.[uid]?.name ?? "?";
    for (const theme of Object.values(list)) {
      const key = normalize(theme);
      if (!key) continue;
      if (seen.has(key)) seen.get(key).by.push(by);
      else seen.set(key, { theme: String(theme).trim(), by: [by] });
    }
  }
  return [...seen.values()].map((t) => ({ theme: t.theme, by: [...new Set(t.by)].join(", ") }));
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

// Transforme la réponse de l'IA en banque de questions jouable.
export function prepareBank(rawQuestions, themes, perTheme) {
  const slots = new Map(themes.map((t) => [normalize(t.theme), { ...t, picked: [] }]));
  const seenQuestions = new Set();

  for (const raw of rawQuestions) {
    const slot = slots.get(normalize(raw.theme));
    if (!slot || slot.picked.length >= perTheme) continue;

    const question = String(raw.question ?? "").trim();
    const correct = String(raw.correct ?? "").trim();
    const wrong = [raw.wrong_1, raw.wrong_2, raw.wrong_3].map((a) => String(a ?? "").trim());
    const answers = [correct, ...wrong];

    if (!question || answers.some((a) => !a)) continue;
    if (new Set(answers.map(normalize)).size !== 4) continue;
    if (seenQuestions.has(normalize(question))) continue;
    if (isAboutDates(question, answers)) continue;

    seenQuestions.add(normalize(question));
    const mixed = shuffle(answers);
    slot.picked.push({
      theme: slot.theme,
      by: slot.by,
      question,
      answers: mixed,
      correct: mixed.indexOf(correct),
    });
  }

  return shuffle([...slots.values()].flatMap((s) => s.picked));
}

// Point d'entrée unique du barème : à modifier quand les règles seront détaillées.
// answer = { choice, at } ou undefined si le joueur n'a pas répondu.
export function pointsFor(question, answer) {
  return answer && answer.choice === question.correct ? 1 : 0;
}

// Le classement est recalculé à partir des réponses enregistrées.
// La question en cours ne compte qu'une fois sa correction affichée.
export function computeScores(game) {
  const { phase, index = 0 } = game.state;
  const questions = game.questions ?? [];
  const lastCounted =
    phase === "finished" ? questions.length - 1 : phase === "reveal" ? index : index - 1;

  return Object.entries(game.players ?? {})
    .map(([uid, player]) => {
      let score = 0;
      let gained = 0;
      for (let i = 0; i <= lastCounted && i < questions.length; i++) {
        const points = pointsFor(questions[i], game.answers?.[i]?.[uid]);
        score += points;
        if (i === index && phase === "reveal") gained = points;
      }
      return { uid, name: player.name, score, gained };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "fr"));
}
