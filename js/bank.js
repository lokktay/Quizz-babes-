// Banque de questions préparées (dossier banque/, liste dans banque/index.json).
// Le menu des thèmes ne charge que la liste ; seul l'écran principal télécharge
// les questions des thèmes réellement choisis.

let indexPromise = null;
const themeCache = new Map();

// Liste des thèmes : [{ id, label, emoji, file, count }]. Vide si la banque est absente.
export function loadIndex() {
  indexPromise ??= fetch("banque/index.json", { cache: "no-cache" })
    .then((response) => (response.ok ? response.json() : []))
    .catch(() => [])
    .then((list) => (Array.isArray(list) ? list : []));
  return indexPromise;
}

export async function themeById(id) {
  return (await loadIndex()).find((t) => t.id === id) ?? null;
}

// Questions d'un thème, au format attendu par createPools().add().
export async function loadThemeQuestions(id) {
  if (!themeCache.has(id)) {
    themeCache.set(id, (async () => {
      const theme = await themeById(id);
      if (!theme) throw new Error(`Thème introuvable dans la banque : ${id}`);
      const response = await fetch(`banque/${encodeURIComponent(theme.file)}`, { cache: "no-cache" });
      if (!response.ok) throw new Error(`Impossible de charger le thème « ${theme.label} ».`);
      const data = await response.json();
      return (data.questions ?? []).map((q) => ({
        theme: theme.label,
        difficulty: q.difficulty,
        question: q.question,
        correct: q.correct,
        wrong_1: q.wrong?.[0],
        wrong_2: q.wrong?.[1],
        wrong_3: q.wrong?.[2],
      }));
    })().catch((error) => { themeCache.delete(id); throw error; }));
  }
  return themeCache.get(id);
}

// Paires de mots de l'undercover (banque/undercover.json) : [{ theme, words: [mot, mot voisin] }].
export async function loadUndercoverPairs() {
  try {
    const response = await fetch("banque/undercover.json", { cache: "no-cache" });
    const data = response.ok ? await response.json() : {};
    return (data.undercover ?? []).filter((p) => Array.isArray(p.words) && p.words.length === 2 && p.words.every((w) => String(w).trim()));
  } catch {
    return [];
  }
}
