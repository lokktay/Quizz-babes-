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
  bankPicks: 3, // thèmes choisis dans la banque, plus 1 thème libre (IA) ou 1 de plus dans la banque sans IA
  freeThemeWaitSeconds: 20, // au-delà, le créateur peut lancer sans les thèmes libres
  questionsPerTheme: 5,
  questionSeconds: 20,
  revealSeconds: 9,
  difficultyPoints: {
    facile: 1,
    moyen: 3,
    difficile: 5,
    tres_difficile: 7,
  },
  model: "gemini-3.8-flash",
};
