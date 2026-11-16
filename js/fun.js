// Tout ce qui rend le jeu plus vivant : avatars et accessoires, écran de chambrage, réactions,
// lancers, confettis, titres de fin et image récap.
// Les animations sont calculées à partir de l'état de la partie, avec un hasard « tiré au sort »
// à partir de l'identifiant de la question : tous les écrans affichent la même chose au même moment.

import { resultSteps, streakOf } from "./logic.js?v=7";

const esc = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/* ---------- Hasard partagé ---------- */

function hash(text) {
  let h = 2166136261;
  for (const char of String(text)) h = Math.imul(h ^ char.codePointAt(0), 16777619);
  return h >>> 0;
}

function seeded(text) {
  let a = hash(text);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rand, list) => list[Math.floor(rand() * list.length)];

/* ---------- Avatars ---------- */

export const AVATAR_EMOJIS = [
  "🦊", "🐸", "🐼", "🐙", "🦄", "🐯", "🐵", "🐧", "🦖", "👽",
  "🤖", "👻", "🐲", "🦉", "🐨", "🦁", "🐷", "🦩", "🐢", "🦔",
];
const AVATAR_COLORS = ["#ff4fd8", "#53ff9a", "#ffe66d", "#5bc0ff", "#ff8a3d", "#b07bff", "#ff5b73", "#3dffe0"];
const PHOTO = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

export const isValidAvatar = (avatar) => AVATAR_EMOJIS.includes(avatar) || (PHOTO.test(avatar ?? "") && avatar.length < 30000);
const colorFor = (uid, name) => AVATAR_COLORS[hash(uid ?? name ?? "") % AVATAR_COLORS.length];
const faceFor = (player) => (AVATAR_EMOJIS.includes(player?.avatar) ? player.avatar : (player?.name ?? "?").trim().charAt(0).toUpperCase() || "?");

// `badges` : { top: "👑", side: "🔥" } — accessoires affichés autour de l'avatar.
export function avatarHtml(player, uid, size = "", badges = null) {
  const avatar = player?.avatar;
  const inner = avatar && PHOTO.test(avatar) ? `<img src="${avatar}" alt="">` : esc(faceFor(player));
  return `<span class="av ${size}" aria-hidden="true">
    <span class="avatar" style="--av:${colorFor(uid, player?.name)}">${inner}</span>
    ${badges?.top ? `<span class="badge-top">${badges.top}</span>` : ""}
    ${badges?.side ? `<span class="badge-side">${badges.side}</span>` : ""}
  </span>`;
}

export function avatarPickerHtml(current) {
  return `
    <section class="card">
      <div class="row">
        <h2>Ton avatar</h2>
        <span id="avatar-current"></span>
      </div>
      <div class="avatar-grid" id="avatar-grid">
        ${AVATAR_EMOJIS.map((emoji) => `
          <button type="button" class="avatar-choice ${emoji === current ? "on" : ""}" data-avatar="${emoji}" aria-label="Avatar ${emoji}">${emoji}</button>`).join("")}
      </div>
      <label class="photo-button">
        <input type="file" accept="image/*" capture="user" id="avatar-photo" hidden>
        <span>📷 Prendre une photo</span>
      </label>
      <p class="hint">La photo reste dans la partie et disparaît avec elle (24 h au plus).</p>
    </section>`;
}

// Recadre la photo en carré de 128 px, assez légère pour passer par Firebase (~8 Ko).
export async function photoToAvatar(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    canvas.getContext("2d").drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 128, 128);
    for (const quality of [0.75, 0.6, 0.45]) {
      const data = canvas.toDataURL("image/jpeg", quality);
      if (data.length < 30000) return data;
    }
    throw new Error("Photo trop lourde.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

/* ---------- Accessoires ---------- */

const NO_BADGES = ["lobby", "themes", "generating"];

// Accessoires du moment : 👑 au leader, 💩 au looser élu, 🔥 / 🌧️ selon la série en cours.
export function badges(game, scores) {
  const map = new Map();
  if (!game.state || NO_BADGES.includes(game.state.phase)) return map;
  const set = (uid, key, value) => map.set(uid, { ...(map.get(uid) ?? {}), [key]: value });
  if (scores[0]?.score > 0 && scores[0].score !== scores[1]?.score) set(scores[0].uid, "top", "👑");
  for (const uid of game.state.shame ?? []) set(uid, "top", "💩");
  for (const sc of scores) {
    const streak = streakOf(game, sc.uid);
    if (streak >= 3) set(sc.uid, "side", "🔥");
    else if (streak <= -3) set(sc.uid, "side", "🌧️");
  }
  return map;
}

/* ---------- Écran de chambrage ---------- */

const LINES = {
  solo: [
    "{name} a trouvé, et personne d'autre. Respect.",
    "Tout le monde s'est planté… sauf {name}.",
    "{name} contre le reste du monde : 1 – 0.",
    "Une seule bonne réponse : celle de {name}.",
  ],
  aloneWrong: [
    "Tout le monde a trouvé. Sauf {name}. Looser.",
    "{name} a fait caca dans la piscine !",
    "{name} a choisi la voie de la différence. Mauvaise idée.",
    "Une seule erreur sur la table : {name}. On ne dira rien. Enfin si : looser.",
    "Il suffisait de copier les autres, {name}…",
  ],
  allWrong: [
    "Personne. Absolument personne. Bande de loosers.",
    "Zéro sur toute la ligne. Magnifique.",
    "Tout le monde a fait caca dans la piscine.",
    "Grand moment de solitude collective.",
    "L'IA a gagné cette manche, bande de nuls.",
  ],
  allRight: [
    "Tout le monde a trouvé. Trop facile ?",
    "Carton plein pour toute la table !",
    "Un sans-faute collectif. Émouvant.",
  ],
  hot: [
    "{name} enchaîne {n} bonnes réponses d'affilée !",
    "{name} est en feu : {n} à la suite !",
    "Quelqu'un arrête {name} ? {n} d'affilée.",
  ],
  cold: [
    "{name} en est à {n} erreurs de suite. Looser assumé.",
    "{name} : {n} mauvaises réponses d'affilée. On croit en toi. Un peu.",
    "{n} à la suite pour {name}. La piscine est fermée pour nettoyage.",
    "Série noire pour {name}. Quelqu'un peut l'aider ?",
  ],
  fastest: [
    "{name} a dégainé plus vite que son ombre.",
    "Réponse éclair et juste pour {name}.",
    "{name} n'a même pas hésité.",
  ],
  randomGood: ["Bien joué {name} !", "{name} gère la situation.", "Belle réponse de {name}."],
  randomBad: [
    "{name}… vraiment ?",
    "{name} a répondu au hasard, et le hasard a dit non.",
    "On va faire comme si on n'avait rien vu, {name}.",
    "{name}, c'était pourtant écrit en gros. Looser.",
    "{name} a fait caca dans la piscine !",
    "Applaudissez bien fort {name}, notre looser du moment.",
  ],
  jackpot: ["{name} décroche la question très difficile !", "{name} empoche le gros lot !", "Coup de maître de {name} !"],
  bigWin: ["{name} assure sur une question difficile.", "Joli coup de {name} !"],
  easyFail: [
    "{name} a raté la question facile. LA FACILE.",
    "Une question à 1 point et {name} trouve le moyen de la rater. Looser.",
    "{name} a fait caca dans la piscine… du petit bain.",
  ],
  tooBold: ["{name} a visé trop haut cette fois.", "Trop gourmand, {name} ! Looser."],
  silent: ["{name} n'a rien répondu. Le stress ?", "Silence radio pour {name}. Pause toilettes ? Pause piscine ?"],
  leader: [
    "{name} prend la tête !",
    "Nouveau leader : {name}. Les autres, réveillez-vous.",
    "{name} passe devant tout le monde. La couronne change de tête.",
  ],
  remontada: ["{name} remonte de {n} places d'un coup !", "Remontada de {name} : +{n} places !"],
  eliminated: [
    "{name} : éliminé·e. Merci d'être venu·e.",
    "Et {name} quitte la piscine… par le toboggan des loosers.",
    "{name} est out. Direction le banc de touche.",
  ],
  survivor: ["{name} tient debout jusqu'au bout !", "Seul·e survivant·e : {name}. Respect.", "{name} a survécu à tout le monde."],
  bust: ["{name} a tout perdu. Il fallait encaisser !", "{name} a voulu doubler… et a fait caca dans la piscine.", "Cagnotte envolée pour {name}."],
  bigBank: ["{name} encaisse {n} points !", "Le coffre-fort de {name} déborde : {n} points."],
  betLoss: ["{name} a tout misé… et tout perdu.", "{name} vient de perdre {n} points au casino. Looser."],
  betWin: ["{name} a misé gros et ça paye : +{n} !", "Coup de poker gagnant pour {name}."],
  backfire: ["Le cadeau de {giver} était bien empoisonné : {name} se plante.", "{name} a ouvert le cadeau… et il a explosé."],
  duelWin: ["{name} remporte le duel !", "Duel plié par {name}.", "{name} gagne le face-à-face."],
  duelFail: ["Duel nul : personne n'a trouvé. Pathétique.", "Deux duellistes, zéro bonne réponse."],
  ladderTop: ["{name} atteint le sommet de l'échelle !", "{name} est tout en haut. Qui le ou la fera tomber ?"],
  ladderFall: ["{name} dégringole de l'échelle !", "Chute libre pour {name}."],
  sprintKing: ["{name} a tout dévoré : {n} bonnes réponses !", "{name}, plus rapide que son ombre : {n} réponses justes."],
  sheep: ["Le troupeau a parlé, {name} a suivi.", "Bêêê : {name} pense comme tout le monde."],
  spyFound: ["{name} était l'espion ! Démasqué·e en beauté.", "Grillé·e, {name} ! L'espion, c'était toi.", "{name}, l'espion le moins discret de l'histoire."],
  spyEscaped: ["{name} était l'espion… et personne n'a rien vu.", "Bravo {name} : espion de génie, l'équipe est ridicule.", "{name} a roulé tout le monde dans la farine."],
  spyWrong: ["Vous avez accusé {name}… qui était innocent·e. Bande de loosers.", "{name} n'y était pour rien. L'espion rigole."],
  ucCaught: ["{name} était l'undercover ! Bien vu.", "Démasqué·e, {name} ! Le mot ne collait pas."],
  ucWrong: ["{name} était civil·e… Vous venez d'éliminer un·e allié·e.", "Oups : {name} avait le bon mot. Looser collectif."],
  ucWin: ["{name} gagne en undercover : chapeau l'artiste.", "L'undercover {name} a berné tout le monde !"],
  blackSheep: ["{name} a voulu faire son malin : seul·e contre le troupeau.", "{name}, le mouton noir de la soirée.", "Tout le monde d'accord… sauf {name}. Looser."],
  shame: [
    "Le peuple a parlé : {name} porte le chapeau jusqu'à la fin.",
    "{name}, looser de la manche par décision populaire.",
    "Démocratie : 1, {name} : 0.",
  ],
};

const TITLES = {
  good: ["BOOM !", "EXCELLENT !", "INCROYABLE !", "LÉGENDAIRE !", "MAGISTRAL !", "QUEL CERVEAU !"],
  bad: ["LOOSER !", "AÏE AÏE AÏE", "OUPS…", "CATASTROPHE", "LA HONTE", "CACA DANS LA PISCINE !", "NUL !"],
  hot: ["EN FEU !", "INARRÊTABLE !", "SÉRIE EN COURS"],
  jackpot: ["JACKPOT !", "LE GROS LOT !", "GÉNIE !"],
  leader: ["NOUVEAU LEADER !", "CHANGEMENT EN TÊTE !"],
  remontada: ["REMONTADA !", "ÇA REMONTE !"],
  shame: ["LOOSER DU PEUPLE !", "LE PEUPLE A VOTÉ"],
  eliminated: ["ÉLIMINÉ !", "OUT !", "BYE BYE"],
  survivor: ["TOUJOURS DEBOUT !", "INCREVABLE !"],
  bust: ["TOUT PERDU !", "CAGNOTTE ENVOLÉE"],
  bigBank: ["JACKPOT !", "ENCAISSÉ !"],
  betLoss: ["RUINÉ !", "LE CASINO GAGNE"],
  betWin: ["BANCO !", "COUP DE POKER !"],
  backfire: ["EMPOISONNÉ !", "CADEAU PIÉGÉ"],
  duelWin: ["DUEL GAGNÉ !", "K.O. !"],
  duelFail: ["DUEL RATÉ", "MATCH NUL"],
  ladderTop: ["AU SOMMET !"],
  ladderFall: ["DÉGRINGOLADE !"],
  sprintKing: ["ÉCLAIR !", "TURBO !"],
  sheep: ["BÊÊÊ !"],
  blackSheep: ["MOUTON NOIR !"],
  spyFound: ["DÉMASQUÉ !", "GRILLÉ !"],
  spyEscaped: ["INSAISISSABLE !", "AGENT SECRET !"],
  spyWrong: ["MAUVAISE PISTE !", "RATÉ !"],
  ucCaught: ["TROUVÉ !", "DÉMASQUÉ !"],
  ucWrong: ["ERREUR JUDICIAIRE !", "INNOCENT !"],
  ucWin: ["CHAPEAU L'ARTISTE !", "ARNAQUE RÉUSSIE !"],
};

const EMOJIS = {
  good: ["🎉", "⭐", "👏", "🏆", "✨"],
  bad: ["💀", "🤡", "💩", "🙈", "🫠"],
  hot: ["🔥", "🔥", "⚡", "🔥"],
  jackpot: ["💰", "🎰", "💎", "🏆", "✨"],
  cold: ["🧊", "🥶", "❄️"],
  silent: ["🦗", "😶", "💤"],
  leader: ["👑", "✨", "👑", "⭐"],
  remontada: ["🚀", "📈", "⚡"],
  shame: ["💩", "🗳️", "💩", "🤡"],
  eliminated: ["💀", "🪦", "👋"],
  survivor: ["🧟", "🏆", "✨"],
  bust: ["💸", "💩", "🫠"],
  bigBank: ["💰", "💎", "🤑"],
  betLoss: ["💸", "🎰", "🤡"],
  betWin: ["🎰", "💰", "🍀"],
  backfire: ["🎁", "☠️", "💥"],
  duelWin: ["⚔️", "🏆", "🥊"],
  duelFail: ["🤦", "😶"],
  ladderTop: ["🪜", "⛰️", "🚀"],
  ladderFall: ["🪜", "📉", "🫠"],
  sprintKing: ["⚡", "🏃", "⏱️"],
  sheep: ["🐑", "🐑", "🐏"],
  blackSheep: ["🐑", "🖤", "🐏"],
  spyFound: ["🕵️", "🔍", "🎯"],
  spyEscaped: ["🕵️", "🕶️", "😎"],
  spyWrong: ["🤦", "🕵️", "❌"],
  ucCaught: ["🎭", "🔍", "🎯"],
  ucWrong: ["⚖️", "😇", "🤦"],
  ucWin: ["🎭", "🎩", "😈"],
};

function participants(game) {
  return Object.entries(game.players ?? {})
    .filter(([uid]) => uid !== game.hostId)
    .map(([uid, p]) => ({ uid, ...p }));
}

function event(rand, kind, tone, people, vars = {}) {
  const names = people.map((p) => p.name).join(" et ");
  const line = pick(rand, LINES[kind]).replaceAll("{name}", names).replaceAll("{n}", vars.n ?? "").replaceAll("{giver}", vars.giver ?? "");
  const title = pick(rand, TITLES[TITLES[kind] ? kind : tone]);
  const emojis = /caca/i.test(title + line) ? ["💩", "🏊", "💩", "🛟"] : EMOJIS[EMOJIS[kind] ? kind : tone];
  return { tone, title, line, people, emojis };
}

// Changement de leader ou grosse remontée entre deux classements (même tri que computeScores).
function rankingCandidates(rand, game, ranking) {
  const out = [];
  if (!ranking?.before || !ranking?.after || ranking.after.length < 2) return out;
  const { before, after } = ranking;
  const uniqueLeader = (list) => (list[0]?.score > 0 && list[0].score !== list[1]?.score ? list[0].uid : null);
  const newLeader = uniqueLeader(after);
  if (newLeader && newLeader !== uniqueLeader(before) && before[0]?.score > 0) {
    out.push([0.85, () => event(rand, "leader", "good", [{ uid: newLeader, ...game.players[newLeader] }])]);
  }
  const climbs = after.map((s, rank) => ({ s, gain: before.findIndex((b) => b.uid === s.uid) - rank })).filter((c) => c.gain >= 2);
  if (climbs.length && before.some((b) => b.score > 0)) {
    const best = climbs.sort((a, b) => b.gain - a.gain)[0];
    out.push([0.6, () => event(rand, "remontada", "good", [{ uid: best.s.uid, ...game.players[best.s.uid] }], { n: best.gain })]);
  }
  return out;
}

const SHARED_MODES = ["classique", "rapide", "mortSubite", "paris", "quitteDouble"];

// Animation (ou non) après la correction de l'étape { r, s }. Même résultat sur tous les écrans.
// `ranking` : { before, after } — classements avant et après, pour repérer un nouveau leader.
export function hypeFor(game, ranking, at = null, withCooldown = true) {
  const r = at?.r ?? game.state.round;
  const s = at?.s ?? game.state.step;
  const entries = game.results?.[r]?.[s];
  if (!entries) return null;
  const mode = game.rounds?.[r]?.mode;
  const rand = seeded(`${game.createdAt}:${r}:${s}`);
  for (const [chance, make] of rankingCandidates(rand, game, ranking)) if (rand() < chance) return make();

  const P = (uid) => ({ uid, ...game.players?.[uid] });
  const list = Object.entries(entries).filter(([uid]) => game.players?.[uid]);
  const with_ = (test) => list.filter(([, e]) => test(e)).map(([uid]) => P(uid));
  const right = with_((e) => e.ok === 1);
  const wrong = with_((e) => e.ok === 0);
  const answered = list.filter(([, e]) => e.ok !== undefined).length;
  const candidates = [];
  const top = (key) => list.reduce((best, [uid, e]) => ((e[key] ?? 0) > (best?.[1][key] ?? 0) ? [uid, e] : best), null);

  // Moments propres à chaque mode : prioritaires.
  if (mode === "mortSubite") {
    const winner = list.find(([, e]) => e.bonus === 8);
    if (winner) candidates.push([0.9, () => event(rand, "survivor", "good", [P(winner[0])])]);
    const out = with_((e) => e.out);
    if (out.length && out.length <= 3) candidates.push([0.45, () => event(rand, "eliminated", "bad", out)]);
  }
  if (mode === "quitteDouble") {
    const bank = top("bank");
    if (bank && bank[1].bank >= 8) candidates.push([0.85, () => event(rand, "bigBank", "good", [P(bank[0])], { n: bank[1].bank })]);
    const lost = top("lost");
    if (lost && lost[1].lost >= 4) candidates.push([0.8, () => event(rand, "bust", "bad", [P(lost[0])])]);
  }
  if (mode === "paris") {
    const worst = list.reduce((b, [uid, e]) => (e.pts < (b?.[1].pts ?? 0) ? [uid, e] : b), null);
    if (worst && worst[1].pts <= -5) candidates.push([0.7, () => event(rand, "betLoss", "bad", [P(worst[0])], { n: -worst[1].pts })]);
    const best = list.reduce((b, [uid, e]) => (e.pts > (b?.[1].pts ?? 0) ? [uid, e] : b), null);
    if (best && best[1].pts >= 5) candidates.push([0.55, () => event(rand, "betWin", "good", [P(best[0])], { n: best[1].pts })]);
  }
  if (mode === "cadeau") {
    const giver = list.find(([, e]) => e.gift);
    if (giver && wrong.length) candidates.push([0.75, () => event(rand, "backfire", "bad", wrong, { giver: game.players?.[giver[0]]?.name })]);
    if (with_((e) => e.ok === 1 && e.lvl === 3).length) candidates.push([0.8, () => event(rand, "jackpot", "good", right)]);
  }
  if (mode === "duel") {
    const winner = game.state.winner;
    if (winner && game.players?.[winner]) candidates.push([0.85, () => event(rand, "duelWin", "good", [P(winner)])]);
    else if (answered) candidates.push([0.6, () => event(rand, "duelFail", "bad", with_((e) => e.ok !== undefined))]);
  }
  if (mode === "plateau") {
    const solo = list.find(([, e]) => e.solo);
    if (solo) {
      const [uid, e] = solo;
      if (e.ok === 1 && e.lvl === 3) candidates.push([0.9, () => event(rand, "jackpot", "good", [P(uid)])]);
      if (e.ok === 1 && e.lvl === 2) candidates.push([0.45, () => event(rand, "bigWin", "good", [P(uid)])]);
      if (e.ok === 0 && e.lvl === 0) candidates.push([0.85, () => event(rand, "easyFail", "bad", [P(uid)])]);
      if (e.ok === -1) candidates.push([0.6, () => event(rand, "silent", "bad", [P(uid)])]);
      if (e.ok === 0 && e.lvl === 3) candidates.push([0.35, () => event(rand, "tooBold", "bad", [P(uid)])]);
    }
  }
  if (mode === "echelle") {
    const climbed = with_((e) => e.ok === 1 && e.lvl === 2);
    if (climbed.length) candidates.push([0.5, () => event(rand, "ladderTop", "good", [climbed[0]])]);
    const fell = with_((e) => e.ok !== 1 && e.lvl === 3);
    if (fell.length) candidates.push([0.55, () => event(rand, "ladderFall", "bad", [fell[0]])]);
  }
  if (mode === "chrono") {
    const best = top("pts");
    if (best && best[1].pts >= 5) candidates.push([0.75, () => event(rand, "sprintKing", "good", [P(best[0])], { n: best[1].pts })]);
  }
  if (mode === "majorite") {
    const sheep = with_((e) => e.maj);
    const rebels = with_((e) => e.ok !== undefined && e.ok !== -1 && !e.maj);
    if (answered >= 3 && rebels.length === 1 && sheep.length) candidates.push([0.75, () => event(rand, "blackSheep", "bad", rebels)]);
    if (sheep.length) candidates.push([0.2, () => event(rand, "sheep", "good", [pick(rand, sheep)])]);
  }

  // Juste après une autre animation, on ne garde que les gros moments.
  const recent = withCooldown && s > 0 && hypeFor(game, null, { r, s: s - 1 }, false);

  if (SHARED_MODES.includes(mode) && answered >= 2) {
    const n = answered;
    if (right.length === 0) candidates.push([0.75, () => event(rand, "allWrong", "bad", [])]);
    if (n >= 3 && right.length === 1) candidates.push([0.8, () => event(rand, "solo", "good", right)]);
    if (n >= 3 && right.length === n - 1 && wrong.length === 1) candidates.push([0.7, () => event(rand, "aloneWrong", "bad", wrong)]);
    if (right.length === n) candidates.push([0.3, () => event(rand, "allRight", "good", [])]);
  }
  const at_ = { r, s };
  const hot = right.filter((p) => [3, 5, 7, 10].includes(streakOf(game, p.uid, at_)));
  if (hot.length) candidates.push([0.7, () => event(rand, "hot", "good", [hot[0]], { n: streakOf(game, hot[0].uid, at_) })]);
  const cold = with_((e) => e.ok !== undefined && e.ok !== 1).filter((p) => streakOf(game, p.uid, at_) === -3);
  if (cold.length) candidates.push([0.5, () => event(rand, "cold", "bad", [cold[0]], { n: 3 })]);
  if (right.length) candidates.push([0.1, () => event(rand, "randomGood", "good", [pick(rand, right)])]);
  if (wrong.length) candidates.push([0.14, () => event(rand, "randomBad", "bad", [pick(rand, wrong)])]);

  for (const [chance, make] of candidates) {
    if (rand() < chance) {
      if (recent && chance < 0.75) return null;
      return make();
    }
  }
  return null;
}

// Animation au moment du verdict (espion, undercover). Même résultat sur tous les écrans.
export function verdictHype(game) {
  const st = game.state;
  const rand = seeded(`${game.createdAt}:verdict:${st.round}:${st.step}`);
  const P = (uid) => ({ uid, ...game.players?.[uid] });
  if (st.spy !== undefined && !st.uc) {
    if (st.found) return event(rand, "spyFound", "good", [P(st.spy)]);
    if (st.accused) return rand() < 0.5 ? event(rand, "spyWrong", "bad", [P(st.accused)]) : event(rand, "spyEscaped", "good", [P(st.spy)]);
    return event(rand, "spyEscaped", "good", [P(st.spy)]);
  }
  const uc = st.uc;
  if (!uc) return null;
  if (uc.winner === "undercover") {
    return event(rand, "ucWin", "good", Object.keys(uc.roles).filter((uid) => uc.roles[uid] === "undercover").map(P));
  }
  if (!st.accused) return null;
  return uc.roles[st.accused] === "undercover" ? event(rand, "ucCaught", "good", [P(st.accused)]) : event(rand, "ucWrong", "bad", [P(st.accused)]);
}

export function shameHype(game) {
  const people = (game.state.shame ?? []).filter((uid) => game.players?.[uid]).map((uid) => ({ uid, ...game.players[uid] }));
  return people.length ? event(seeded(`${game.createdAt}:shame`), "shame", "bad", people) : null;
}

let hypeTimer;
export function showHype(hype, avatarFor) {
  if (!hype) return;
  document.querySelector(".hype")?.remove();
  clearTimeout(hypeTimer);
  const el = document.createElement("div");
  el.className = `hype ${hype.tone}`;
  el.setAttribute("role", "status");
  const rain = reducedMotion() ? "" : Array.from({ length: 22 }, (_, i) => {
    const emoji = hype.emojis[i % hype.emojis.length];
    return `<span class="rain" style="--x:${Math.round(Math.random() * 100)}%;--d:${(Math.random() * 0.8).toFixed(2)}s;--s:${(0.8 + Math.random() * 0.9).toFixed(2)}">${emoji}</span>`;
  }).join("");
  el.innerHTML = `
    ${rain}
    <div class="hype-box">
      <p class="hype-title">${esc(hype.title).replace(/ ([!?…])/g, " $1")}</p>
      ${hype.people.length ? `<div class="hype-people">${hype.people.map((p) => avatarFor(p, "xl")).join("")}</div>` : `<div class="hype-people big-emoji">${hype.emojis[0]}</div>`}
      <p class="hype-line">${esc(hype.line)}</p>
    </div>`;
  el.addEventListener("click", () => el.remove());
  document.body.append(el);
  hypeTimer = setTimeout(() => el.remove(), 5400);
}

/* ---------- Réactions et lancers ---------- */

export const REACTIONS = ["😂", "🔥", "👏", "😱", "🤡", "💀"];
export const THROWABLES = ["🍅", "🌹", "💩"];
const IMPACT = { "🍅": "💥", "🌹": "💖", "💩": "🤢" };

const seenReactions = new Set();
let reactionsGame = null;

// Joue les réactions arrivées depuis la dernière mise à jour. Renvoie { floats, throws } pour les sons.
export function playReactions(gameId, game, avatarFor) {
  const entries = Object.entries(game.reactions ?? {});
  const result = { floats: 0, throws: 0 };
  if (reactionsGame !== gameId) {
    reactionsGame = gameId;
    seenReactions.clear();
    entries.forEach(([key]) => seenReactions.add(key));
    return result;
  }
  for (const [key, reaction] of entries) {
    if (seenReactions.has(key)) continue;
    seenReactions.add(key);
    const from = game.players?.[reaction?.uid];
    if (THROWABLES.includes(reaction?.e) && game.players?.[reaction.to]) {
      result.throws++;
      throwAt(reaction.e, { uid: reaction.uid, ...from }, { uid: reaction.to, ...game.players[reaction.to] }, avatarFor);
      continue;
    }
    if (!REACTIONS.includes(reaction?.e)) continue;
    result.floats++;
    const el = document.createElement("div");
    el.className = "float-reaction";
    el.style.setProperty("--x", `${8 + Math.random() * 84}%`);
    el.innerHTML = `<span class="float-emoji">${reaction.e}</span>${from ? avatarFor({ uid: reaction.uid, ...from }, "xs") : ""}`;
    document.body.append(el);
    setTimeout(() => el.remove(), 2600);
  }
  return result;
}

// Un projectile part du bord de l'écran et s'écrase sur l'avatar de la cible.
function throwAt(emoji, from, to, avatarFor) {
  const fromLeft = Math.random() < 0.5;
  const el = document.createElement("div");
  el.className = "throw";
  el.style.setProperty("--tx", `${20 + Math.random() * 60}%`);
  el.style.setProperty("--ty", `${28 + Math.random() * 30}%`);
  el.style.setProperty("--fx", fromLeft ? "-60vw" : "60vw");
  el.innerHTML = `
    <div class="throw-target">
      ${avatarFor(to, "lg")}
      <span class="throw-names">${esc(from.name ?? "?")} → ${esc(to.name)}</span>
      <span class="throw-projectile">${emoji}</span>
      <span class="throw-impact">${IMPACT[emoji]}${emoji === "🍅" ? "🍅" : ""}</span>
    </div>`;
  document.body.append(el);
  setTimeout(() => el.remove(), 2200);
}

let reactionBar = null;
// `getTargets()` renvoie les joueurs visables : [{ uid, name, html }].
export function setReactionBar(visible, onReact, getTargets) {
  if (!reactionBar) {
    reactionBar = document.createElement("div");
    reactionBar.className = "reaction-dock";
    reactionBar.innerHTML = `
      <div class="target-sheet" hidden>
        <p class="target-title"></p>
        <div class="target-list"></div>
      </div>
      <div class="reaction-bar">
        ${REACTIONS.map((e) => `<button type="button" data-react="${e}" aria-label="Réagir ${e}">${e}</button>`).join("")}
        <span class="sep" aria-hidden="true"></span>
        ${THROWABLES.map((e) => `<button type="button" class="throwable" data-throw="${e}" aria-label="Lancer ${e} sur un joueur">${e}</button>`).join("")}
      </div>`;
    const sheet = reactionBar.querySelector(".target-sheet");
    let last = 0;
    let aiming = null;
    const ready = () => Date.now() - last >= 800;
    reactionBar.addEventListener("click", (event) => {
      const react = event.target.closest("[data-react]");
      const toss = event.target.closest("[data-throw]");
      const target = event.target.closest("[data-target]");
      if (react && ready()) {
        last = Date.now();
        react.classList.remove("pop");
        void react.offsetWidth;
        react.classList.add("pop");
        reactionBar.onReact?.(react.dataset.react);
      } else if (toss) {
        aiming = aiming === toss.dataset.throw ? null : toss.dataset.throw;
        reactionBar.querySelectorAll("[data-throw]").forEach((b) => b.classList.toggle("on", b.dataset.throw === aiming));
        if (aiming) {
          const targets = reactionBar.getTargets?.() ?? [];
          sheet.querySelector(".target-title").textContent = targets.length ? `Lancer ${aiming} sur…` : "Personne à viser.";
          sheet.querySelector(".target-list").innerHTML = targets.map((t) =>
            `<button type="button" data-target="${esc(t.uid)}">${t.html}<span>${esc(t.name)}</span></button>`).join("");
        }
        sheet.hidden = !aiming;
      } else if (target && aiming && ready()) {
        last = Date.now();
        reactionBar.onReact?.(aiming, target.dataset.target);
        aiming = null;
        sheet.hidden = true;
        reactionBar.querySelectorAll("[data-throw]").forEach((b) => b.classList.remove("on"));
      }
    });
    document.body.append(reactionBar);
  }
  reactionBar.onReact = onReact;
  reactionBar.getTargets = getTargets;
  reactionBar.hidden = !visible;
  if (!visible) reactionBar.querySelector(".target-sheet").hidden = true;
  document.body.classList.toggle("with-reactions", visible);
}

/* ---------- Confettis ---------- */

export function celebrate() {
  if (reducedMotion()) return;
  const layer = document.createElement("div");
  layer.className = "confetti";
  const colors = ["#ff4fd8", "#53ff9a", "#ffe66d", "#5bc0ff", "#ff8a3d"];
  layer.innerHTML = Array.from({ length: 90 }, () => `<i style="--x:${Math.random() * 100}%;--c:${pick(Math.random, colors)};--d:${(Math.random() * 1.5).toFixed(2)}s;--r:${Math.round(Math.random() * 720 - 360)}deg;--t:${(2.4 + Math.random() * 1.6).toFixed(2)}s"></i>`).join("");
  document.body.append(layer);
  setTimeout(() => layer.remove(), 5000);
}

/* ---------- Titres de fin ---------- */

export const AWARD_NAMES = {
  sniper: ["⚡", "Le Sniper"],
  machine: ["🔥", "La Machine"],
  kamikaze: ["🪂", "Le Kamikaze"],
  caca: ["💩", "A fait caca dans la piscine"],
  clown: ["🤡", "Le Roi de l'approximation"],
  ghost: ["👻", "Le Fantôme"],
  supporter: ["📣", "Le Supporter"],
  target: ["🎯", "La Cible"],
  survivor: ["🧟", "Le Survivant"],
  flambeur: ["🎰", "Le Flambeur"],
  eclair: ["🏃", "L'Éclair"],
  looser: ["🥄", "Le Looser officiel"],
};

// Chaque titre revient au joueur qui a le plus gros score dans sa catégorie (égalités incluses).
export function awards(game, scores) {
  const players = participants(game);
  if (!players.length) return [];
  const stats = new Map(players.map((p) => [p.uid, {
    firstRight: 0, bestStreak: 0, streak: 0, easyFails: 0, silent: 0, kamikaze: 0, reactions: 0, wrong: 0, hit: 0,
    survivor: 0, betLost: 0, sprint: 0,
  }]));

  for (const { r, s, entries } of resultSteps(game)) {
    const mode = game.rounds?.[r]?.mode;
    const answers = game.answers?.[r]?.[s] ?? {};
    let fastest = null;
    for (const [uid, e] of Object.entries(entries)) {
      const st = stats.get(uid);
      if (!st || !e) continue;
      if (e.ok === -1) st.silent++;
      if (e.ok === 0) {
        st.wrong++;
        if (e.lvl === 0) st.easyFails++;
      }
      if (e.ok !== undefined) {
        st.streak = e.ok === 1 ? st.streak + 1 : 0;
        st.bestStreak = Math.max(st.bestStreak, st.streak);
      }
      if (e.ok === 1 && answers[uid] && (!fastest || (answers[uid].at ?? 0) < (answers[fastest].at ?? 0))) fastest = uid;
      if (mode === "plateau" && e.solo && e.lvl === 3) st.kamikaze++;
      if (e.bonus === 8) st.survivor++;
      if (e.bet && e.pts < 0) st.betLost -= e.pts;
      if (mode === "chrono") st.sprint += e.pts ?? 0;
    }
    if (fastest && SHARED_MODES.includes(mode)) stats.get(fastest).firstRight++;
  }

  for (const reaction of Object.values(game.reactions ?? {})) {
    if (stats.has(reaction?.uid)) stats.get(reaction.uid).reactions++;
    if (reaction?.to && stats.has(reaction.to) && reaction.e !== "🌹") stats.get(reaction.to).hit++;
  }

  const name = (uid) => game.players?.[uid]?.name ?? "?";
  const best = (stat, min) => {
    const top = Math.max(...players.map((p) => stats.get(p.uid)[stat]));
    if (top < min) return null;
    return { uids: players.filter((p) => stats.get(p.uid)[stat] === top).map((p) => p.uid), value: top };
  };
  const plural = (n, word) => `${n} ${word}${n > 1 ? "s" : ""}`;

  const list = [];
  const add = (key, winner, detail) => {
    if (!winner) return;
    const [emoji, title] = AWARD_NAMES[key];
    list.push({ key, uids: winner.uids, names: winner.uids.map(name).join(" et "), emoji, title, detail: detail(winner.value) });
  };
  add("sniper", best("firstRight", 2), (n) => `${n} fois le plus rapide à trouver la bonne réponse`);
  add("machine", best("bestStreak", 3), (n) => `${n} bonnes réponses d'affilée`);
  add("kamikaze", best("kamikaze", 1), (n) => `${plural(n, "case")} très difficile${n > 1 ? "s" : ""} tentée${n > 1 ? "s" : ""} au plateau`);
  add("caca", best("easyFails", 1), (n) => `${plural(n, "question")} facile${n > 1 ? "s" : ""} ratée${n > 1 ? "s" : ""}`);
  add("clown", best("wrong", 5), (n) => `${n} mauvaises réponses`);
  add("ghost", best("silent", 2), (n) => `${n} questions sans répondre`);
  add("supporter", best("reactions", 5), (n) => `${n} réactions envoyées`);
  add("survivor", best("survivor", 1), (n) => `${plural(n, "série")} de mort subite remportée${n > 1 ? "s" : ""}`);
  add("flambeur", best("betLost", 5), (n) => `${n} points perdus aux paris`);
  add("eclair", best("sprint", 8), (n) => `${n} bonnes réponses au contre-la-montre`);
  add("target", best("hit", 3), (n) => `${plural(n, "projectile")} reçu${n > 1 ? "s" : ""} en pleine figure`);
  if (scores.length >= 2) {
    const last = scores.at(-1);
    list.push({
      key: "looser", uids: [last.uid], names: last.name, emoji: "🥄", title: "Le Looser officiel",
      detail: `Dernière place avec ${last.score} pt${last.score > 1 ? "s" : ""}. La cuillère en bois est à toi.`,
    });
  }
  return list;
}

/* ---------- Image récap à partager ---------- */

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function drawAvatar(ctx, player, uid, x, y, size) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = colorFor(uid, player?.name);
  ctx.fill();
  ctx.clip();
  if (player?.avatar && PHOTO.test(player.avatar)) {
    try { ctx.drawImage(await loadImage(player.avatar), x - size / 2, y - size / 2, size, size); } catch { /* image illisible */ }
  } else {
    ctx.fillStyle = "#100e1d";
    ctx.font = `${Math.round(size * 0.55)}px "Rubik", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(faceFor(player), x, y + size * 0.04);
  }
  ctx.restore();
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#05040a";
  ctx.beginPath();
  ctx.arc(x, y, size / 2, 0, Math.PI * 2);
  ctx.stroke();
}

function fitText(ctx, text, maxWidth) {
  let t = String(text);
  while (ctx.measureText(t).width > maxWidth && t.length > 1) t = `${t.slice(0, -2)}…`;
  return t;
}

export async function recapImage(game, scores, awardList) {
  await document.fonts?.ready;
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#2a2350");
  grad.addColorStop(1, "#100e1d");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = "center";
  ctx.fillStyle = "#ff4fd8";
  ctx.font = '700 34px "Rubik", system-ui, sans-serif';
  ctx.fillText(fitText(ctx, `${game.groupName ? `${game.groupName} · ` : ""}${game.name}`, W - 120).toUpperCase(), W / 2, 90);
  ctx.fillStyle = "#53ff9a";
  ctx.font = '72px "Bungee", "Rubik", system-ui, sans-serif';
  ctx.fillText("QUIZZ ENTRE AMIS", W / 2, 175);

  // Podium
  const steps = [[1, 270, 150], [0, 540, 230], [2, 810, 100]];
  for (const [rank, x, height] of steps) {
    const s = scores[rank];
    if (!s) continue;
    const base = 640;
    ctx.fillStyle = ["#ffe66d", "#5bc0ff", "#ff8a3d"][rank];
    roundRect(ctx, x - 120, base - height, 240, height, 14);
    ctx.fill();
    ctx.fillStyle = "#100e1d";
    ctx.font = '64px "Bungee", "Rubik", sans-serif';
    ctx.fillText(String(rank + 1), x, base - height / 2 + 24);
    await drawAvatar(ctx, game.players?.[s.uid], s.uid, x, base - height - 95, rank === 0 ? 150 : 120);
    if (rank === 0) {
      ctx.font = "70px system-ui";
      ctx.fillText("👑", x, base - height - 175);
    }
    ctx.fillStyle = "#ffffff";
    ctx.font = '700 32px "Rubik", system-ui, sans-serif';
    ctx.fillText(fitText(ctx, s.name, 230), x, base + 46);
    ctx.fillStyle = "#aaa5c5";
    ctx.font = '500 28px "Rubik", system-ui, sans-serif';
    ctx.fillText(`${s.score} pts`, x, base + 84);
  }

  // Titres
  ctx.textAlign = "left";
  let y = 790;
  for (const award of awardList.slice(0, 6)) {
    ctx.fillStyle = "#1b1830";
    roundRect(ctx, 80, y - 50, W - 160, 76, 14);
    ctx.fill();
    ctx.font = "44px system-ui";
    ctx.fillText(award.emoji, 104, y + 4);
    ctx.fillStyle = "#53ff9a";
    ctx.font = '700 30px "Rubik", system-ui, sans-serif';
    ctx.fillText(fitText(ctx, award.title.toUpperCase(), 520), 176, y - 4);
    ctx.fillStyle = "#ffffff";
    ctx.font = '500 26px "Rubik", system-ui, sans-serif';
    ctx.fillText(fitText(ctx, award.names, 760), 176, y + 26);
    y += 92;
  }

  ctx.textAlign = "center";
  ctx.fillStyle = "#6f6990";
  ctx.font = '500 24px "Rubik", system-ui, sans-serif';
  ctx.fillText(new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }), W / 2, H - 40);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}
