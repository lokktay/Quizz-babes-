// Prépare la banque de questions pour le site.
//
// Usage (depuis le dossier du site) :  node outils/banque.mjs
//
// - enlève les balises ```json que Gemini ajoute parfois autour du JSON ;
// - vérifie chaque question (4 réponses différentes, niveau valide, pas de date) ;
// - écarte les fichiers en double (même contenu sous deux noms) ;
// - écrit banque/index.json, la liste des thèmes lue par le site.
//
// À relancer après chaque ajout ou modification d'un fichier dans banque/.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { normalize, isAboutDates } from "../js/logic.js";

const DIR = path.resolve("banque");
const LEVELS = ["facile", "moyen", "difficile", "tres_difficile"];

// Emoji du menu, choisi d'après le nom du thème (le premier motif qui correspond).
const EMOJIS = [
  [/caca/, "💩"], [/criminel|crime|polic/, "🔪"], [/diplomat/, "🕊️"], [/mario/, "🍄"], [/mickey/, "🐭"],
  [/psych/, "🍍"], [/vitality/, "🐝"], [/hunter/, "🎣"], [/sport.*20[0-9]{2}/, "🏆"],
  [/arcane/, "🧪"], [/league of legend|\blol\b/, "⚔️"],[/escalade|grimpe/, "🧗"], [/chien/, "🐕"], [/chat\b|chats\b/, "🐈"],
  [/animau/, "🦁"], [/dessin|animation|anime/, "🎨"], [/disney/, "🏰"], [/dragon/, "🐉"], [/equitation|cheva/, "🐎"],
  [/esport|e-sport/, "🎮"], [/friends|serie/, "🛋️"], [/game of throne|trone/, "👑"], [/geograph/, "🌍"],
  [/musique|instrument/, "🎸"], [/olympi|\bjo\b/, "🏅"], [/minecraft/, "⛏️"], [/one piece|manga/, "🏴‍☠️"],
  [/pokemon/, "⚡"], [/science/, "🔬"], [/sport/, "⚽"], [/youtube|internet/, "📺"], [/cuisine|recette/, "🍳"],
  [/jeux de societe|societe/, "🎲"], [/plante|jardin|fleur/, "🌿"], [/cinema|film/, "🎬"], [/histoire/, "📜"],
  [/rap|musique/, "🎤"], [/jeu video|jeux video/, "🕹️"], [/voiture|auto/, "🏎️"], [/mer|ocean/, "🌊"],
];
const emojiFor = (text) => EMOJIS.find(([re]) => re.test(normalize(text)))?.[1] ?? "❓";
const slug = (text) => normalize(text).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Répare les erreurs courantes des réponses de Gemini recollées à la main :
// balises ``` au milieu (après un « continue »), crochet manquant devant "wrong",
// et en dernier recours, récupère chaque question une par une.
function repair(text) {
  const fixes = [];
  let fixed = text;
  if (/^\s*```/m.test(fixed)) {
    fixed = fixed.replace(/^\s*```(?:json)?\s*$/gm, "");
    fixes.push("balises ``` au milieu");
  }
  const bracket = fixed.replace(/("wrong"\s*:\s*)"/g, '$1["');
  if (bracket !== fixed) {
    fixed = bracket;
    fixes.push("crochet manquant");
  }
  try {
    return { ...JSON.parse(fixed), repaired: fixes.join(", ") };
  } catch { /* on passe à la récupération question par question */ }
  const theme = fixed.match(/"theme"\s*:\s*"([^"]+)"/)?.[1];
  const questions = [];
  for (const match of fixed.matchAll(/\{\s*"difficulty"[^{}]*?\]\s*\}/g)) {
    try { questions.push(JSON.parse(match[0])); } catch { /* question irrécupérable */ }
  }
  if (!theme || questions.length < 16) return null;
  fixes.push(`${questions.length} questions récupérées une par une`);
  return { theme, questions, repaired: fixes.join(", ") };
}

const report = [];
const entries = [];
const seenContent = new Map();

// En cas de doublon, on garde en priorité le fichier dont le nom ressemble au thème.
const themeOf = (text) => normalize(text.match(/"theme"\s*:\s*"([^"]*)"/)?.[1] ?? "");
const nameMatches = (file, text) => {
  const name = normalize(path.basename(file, ".json")).replace(/[^a-z0-9]/g, "");
  const theme = themeOf(text).replace(/[^a-z0-9]/g, "");
  return Boolean(name && theme && (theme.includes(name.slice(0, 5)) || name.includes(theme.slice(0, 5))));
};
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".json") && f !== "index.json")
  .map((file) => ({ file, matches: nameMatches(file, fs.readFileSync(path.join(DIR, file), "utf8")) }))
  .sort((a, b) => Number(b.matches) - Number(a.matches) || a.file.localeCompare(b.file, "fr"))
  .map((f) => f.file);

for (const file of files) {
  const full = path.join(DIR, file);
  let text = fs.readFileSync(full, "utf8");
  const notes = [];

  // 1. Balises Markdown autour du JSON
  const unfenced = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  if (unfenced !== text.trim()) {
    text = unfenced;
    notes.push("balises ```json retirées");
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    data = repair(text);
    if (!data) {
      report.push(`✘ ${file} : JSON illisible (${error.message}). Fichier ignoré.`);
      continue;
    }
    notes.push(`réparé (${data.repaired})`);
    delete data.repaired;
  }
  if (notes.length) fs.writeFileSync(full, `${JSON.stringify(data, null, 2)}\n`);

  // 2. Doublon de contenu
  const hash = crypto.createHash("md5").update(JSON.stringify(data.questions ?? data)).digest("hex");
  if (seenContent.has(hash)) {
    report.push(`✘ ${file} : même contenu que ${seenContent.get(hash)} (thème « ${data.theme} »). Fichier ignoré : regénère-le avec le bon thème.`);
    continue;
  }
  seenContent.set(hash, file);

  // 3. Questions
  const questions = Array.isArray(data.questions) ? data.questions : [];
  let kept = 0;
  const rejected = [];
  const counts = Object.fromEntries(LEVELS.map((l) => [l, 0]));
  const seen = new Set();
  for (const [i, q] of questions.entries()) {
    const answers = [q.correct, ...(Array.isArray(q.wrong) ? q.wrong : [])].map((a) => String(a ?? "").trim());
    const why = !q.question || answers.length !== 4 || answers.some((a) => !a) ? "format"
      : !LEVELS.includes(q.difficulty) ? `niveau « ${q.difficulty} »`
        : new Set(answers.map(normalize)).size !== 4 ? "réponses en double"
          : isAboutDates(q.question, answers) ? "porte sur une date"
            : seen.has(normalize(q.question)) ? "question en double" : null;
    if (why) { rejected.push(`#${i + 1} ${why}`); continue; }
    seen.add(normalize(q.question));
    counts[q.difficulty]++;
    kept++;
  }

  const theme = String(data.theme ?? path.basename(file, ".json")).trim();
  const label = theme.length > 28 ? path.basename(file, ".json") : theme;
  entries.push({ id: slug(label), label, emoji: emojiFor(`${label} ${theme}`), file, count: kept, levels: counts });
  const weak = LEVELS.filter((l) => counts[l] < 4);
  report.push(`✔ ${file} → « ${label} » : ${kept} questions${notes.length ? ` (${notes.join(", ")})` : ""}`
    + `${rejected.length ? `\n    ignorées : ${rejected.join(", ")}` : ""}`
    + `${weak.length ? `\n    ⚠ moins de 4 questions en : ${weak.join(", ")}` : ""}`);
}

entries.sort((a, b) => a.label.localeCompare(b.label, "fr"));
fs.writeFileSync(path.join(DIR, "index.json"), `${JSON.stringify(entries, null, 2)}\n`);
console.log(report.join("\n"));
console.log(`\n${entries.length} thèmes écrits dans banque/index.json`);
