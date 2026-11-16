// Sons du jeu, entièrement synthétisés : aucun fichier audio à héberger.
// Les voix utilisent la synthèse vocale du navigateur (en français quand elle est disponible).

const KEY = "quizz.sound";
let ctx = null;
let enabled = null;

function stored() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

// Par défaut : le son est activé sur l'écran principal, coupé sur les téléphones.
export function isOn(defaultOn) {
  if (enabled === null) enabled = stored() ? stored() === "on" : defaultOn;
  return enabled;
}

export function setOn(value) {
  enabled = value;
  try { localStorage.setItem(KEY, value ? "on" : "off"); } catch { /* navigation privée */ }
  if (value) unlock();
  else speechSynthesis?.cancel?.();
}

// Les navigateurs n'autorisent le son qu'après un geste de l'utilisateur.
export function unlock() {
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
  } catch { ctx = null; }
}
window.addEventListener("pointerdown", unlock, { passive: true });
window.addEventListener("keydown", unlock);

const ready = () => enabled && ctx && ctx.state === "running";

function tone(freq, start, duration, { type = "square", volume = 0.12, slideTo = null, vibrato = 0 } = {}) {
  const t = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
  if (vibrato) {
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 6;
    depth.gain.value = vibrato;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + duration);
  }
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.02);
  gain.gain.setValueAtTime(volume, t + duration * 0.7);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

let noiseBuffer = null;
function noise(start, duration, { volume = 0.3, type = "bandpass", freq = 1500, freqTo = null, q = 1 } = {}) {
  if (!noiseBuffer) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime + start;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, t);
  if (freqTo) filter.frequency.exponentialRampToValueAtTime(freqTo, t + duration);
  filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start(t);
  src.stop(t + duration + 0.05);
}

function applause(start = 0, length = 1.8) {
  for (let i = 0; i < length * 40; i++) {
    noise(start + Math.random() * length, 0.06, { volume: 0.12 + Math.random() * 0.12, freq: 1200 + Math.random() * 1800, q: 0.8 });
  }
}

function fanfare() {
  [523, 659, 784].forEach((f, i) => tone(f, i * 0.11, 0.13, { type: "square", volume: 0.09 }));
  [523, 659, 784, 1047].forEach((f) => tone(f, 0.36, 0.6, { type: "triangle", volume: 0.07 }));
}

// « Wah wah wah waaah » : le classique trombone triste.
function sadTrombone() {
  [[311, 293], [293, 277], [277, 262]].forEach(([from, to], i) =>
    tone(from, i * 0.42, 0.38, { type: "sawtooth", volume: 0.08, slideTo: to }));
  tone(262, 1.26, 1.1, { type: "sawtooth", volume: 0.08, slideTo: 247, vibrato: 7 });
}

// Foule qui fait « ooooh » : plusieurs voix graves légèrement désaccordées.
function crowdOoh(start = 0) {
  for (let i = 0; i < 7; i++) {
    const base = 170 + Math.random() * 120;
    tone(base, start + Math.random() * 0.08, 1.1, { type: "sawtooth", volume: 0.025, slideTo: base * 0.82, vibrato: 3 });
  }
  noise(start, 1.1, { volume: 0.05, freq: 600, freqTo: 400, q: 3 });
}

function fart(start = 0) {
  tone(90, start, 0.55, { type: "sawtooth", volume: 0.16, slideTo: 55, vibrato: 25 });
  noise(start, 0.5, { volume: 0.12, type: "lowpass", freq: 400, freqTo: 150 });
}

function splash(start = 0) {
  noise(start, 0.7, { volume: 0.45, type: "highpass", freq: 600, freqTo: 3000, q: 0.5 });
  noise(start + 0.05, 0.9, { volume: 0.25, type: "bandpass", freq: 2500, freqTo: 800, q: 0.7 });
}

function speak(text, { pitch = 1, rate = 1.05 } = {}) {
  if (!("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "fr-FR";
  const voice = speechSynthesis.getVoices().find((v) => v.lang?.startsWith("fr"));
  if (voice) utterance.voice = voice;
  utterance.pitch = pitch;
  utterance.rate = rate;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

const spoken = (title) => title.replace(/[!…?]/g, "").toLowerCase();

export function playHype(hype) {
  if (!ready() || !hype) return;
  const title = spoken(hype.title);
  if (/caca/i.test(hype.title)) {
    fart(0);
    splash(0.55);
    const names = hype.people.map((p) => p.name).join(" et ");
    setTimeout(() => speak(`${names || "Quelqu'un"} a fait caca dans la piscine !`, { pitch: 1.3 }), 900);
  } else if (hype.tone === "good") {
    fanfare();
    applause(0.4);
    setTimeout(() => speak(title, { pitch: 1.2, rate: 1.1 }), 500);
  } else {
    if (Math.random() < 0.5) sadTrombone();
    else crowdOoh();
    setTimeout(() => speak(title, { pitch: 0.8, rate: 0.95 }), 450);
  }
}

export function tick(urgent) {
  if (!ready()) return;
  tone(urgent ? 1320 : 880, 0, 0.05, { type: "square", volume: 0.05 });
}

// Petit carillon au moment où la bonne réponse s'affiche.
export function reveal() {
  if (!ready()) return;
  tone(659, 0, 0.12, { type: "triangle", volume: 0.08 });
  tone(988, 0.1, 0.3, { type: "triangle", volume: 0.08 });
}

// Projectile qui s'écrase sur un avatar.
export function splat() {
  if (!ready()) return;
  tone(700, 0, 0.35, { type: "sine", volume: 0.06, slideTo: 200 });
  noise(0.35, 0.3, { volume: 0.35, type: "lowpass", freq: 900, freqTo: 200 });
}

export function pop() {
  if (!ready()) return;
  tone(500 + Math.random() * 500, 0, 0.09, { type: "sine", volume: 0.08, slideTo: 1400 });
}

export function finale() {
  if (!ready()) return;
  fanfare();
  [0.8, 1.0, 1.2].forEach((t, i) => tone([784, 988, 1175][i], t, 0.25, { type: "square", volume: 0.07 }));
  tone(1568, 1.45, 0.9, { type: "triangle", volume: 0.08, vibrato: 8 });
  applause(0.6, 3);
  setTimeout(() => speak("Bravo !", { pitch: 1.2 }), 1500);
}
