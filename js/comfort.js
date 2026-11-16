// Confort : QR code pour rejoindre, écran qui ne se met pas en veille, plein écran.

const QR_LIB = "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js";
let qrLoading = null;

function loadQr() {
  qrLoading ??= new Promise((resolve, reject) => {
    if (window.qrcode) return resolve(window.qrcode);
    const script = document.createElement("script");
    script.src = QR_LIB;
    script.onload = () => (window.qrcode ? resolve(window.qrcode) : reject(new Error("QR indisponible")));
    script.onerror = () => { qrLoading = null; reject(new Error("QR indisponible")); };
    document.head.append(script);
  });
  return qrLoading;
}

// Image (data URL) du QR code de `text`. La bibliothèque n'est chargée qu'au premier besoin.
export async function qrDataUrl(text) {
  const qrcode = await loadQr();
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createDataURL(8, 2);
}

/* ---------- Écran toujours allumé ---------- */

let lock = null;
let wanted = false;
let requesting = false;

// Empêche le téléphone de se mettre en veille pendant la partie (si le navigateur le permet).
export async function keepAwake(on) {
  wanted = on;
  if (on && !lock && !requesting && "wakeLock" in navigator && document.visibilityState === "visible") {
    requesting = true;
    try {
      lock = await navigator.wakeLock.request("screen");
      lock.addEventListener("release", () => { lock = null; });
      if (!wanted) { lock.release().catch(() => {}); lock = null; }
    } catch { lock = null; }
    requesting = false;
  } else if (!on && lock) {
    lock.release().catch(() => {});
    lock = null;
  }
}
// Le verrou saute quand on change d'onglet : on le reprend au retour.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && wanted) keepAwake(true);
});

/* ---------- Plein écran ---------- */

export const canFullscreen = () => Boolean(document.fullscreenEnabled || document.webkitFullscreenEnabled);
export const isFullscreen = () => Boolean(document.fullscreenElement || document.webkitFullscreenElement);

export function toggleFullscreen() {
  if (isFullscreen()) return (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
  const el = document.documentElement;
  return (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
}
