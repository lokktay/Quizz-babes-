import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-database.js";
import { firebaseConfig } from "./config.js?v=2";

export const isConfigured = !firebaseConfig.apiKey.startsWith("A_REMPLACER");

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);

export async function signIn() {
  const { user } = await signInAnonymously(auth);
  return user.uid;
}
