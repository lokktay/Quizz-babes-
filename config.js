// Colle ici la configuration donnée par la console Firebase
// (Paramètres du projet > Vos applications > Application Web).
export const firebaseConfig = {
  apiKey: "AIzaSyDRAKAq72dTMn-J2OgzK3egGGrHBYqoZoU",
  authDomain: "quizz-fefff.firebaseapp.com",
  databaseURL: "https://quizz-fefff-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "quizz-fefff",
  appId: "1:558587194324:web:ffdc080e88c8f16cfb4441",
};

// Réglages du jeu.
export const SETTINGS = {
  maxPlayers: 10,
  themesPerPlayer: 3,
  questionsPerTheme: 2,
  questionSeconds: 20,
  revealSeconds: 6,
  model: "gemini-3.8-flash",
};
