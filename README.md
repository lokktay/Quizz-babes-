# Quizz entre amis

Un site de quiz en français, hébergé gratuitement sur GitHub Pages. Firebase sert à faire circuler les réponses entre les appareils. Le créateur garde l'écran principal et lit les questions ; les autres joueurs répondent sur leur téléphone.

## Ce que fait le jeu

- Une partie accueille **10 personnes au maximum, créateur compris** : le créateur et jusqu'à 9 joueurs sur téléphone.
- Le créateur ne propose pas de thèmes et ne répond pas. Il garde l'écran qui affiche les questions.
- Chaque autre joueur choisit 3 thèmes dans la banque de questions et propose 1 thème libre, écrit par l'IA (Gemini).
- **Modes de jeu :** en créant la partie, le créateur choisit les modes (joués dans l'ordre où il les coche) et une durée de 20 min à 2 h. Le temps est réparti à peu près également entre les modes ; seul le plateau a une taille fixe (4 cases par thème, 6 thèmes au plus).

  | Mode | Principe |
  |---|---|
  | 🎯 Classique | Tout le monde répond à la même question : 2 points par bonne réponse. |
  | 🧩 Le plateau | Cases par thème et difficulté (1, 3, 5, 7 points) ; chacun son tour choisit une case et répond seul. |
  | ⚡ Le plus rapide | De 5 à 1 point selon la vitesse de la bonne réponse. |
  | 💀 Mort subite | Une erreur élimine ; 1 point par question survécue, +8 pour la dernière personne en vie, puis une nouvelle série repart. |
  | ⏱️ Contre-la-montre | 90 s pour enchaîner un maximum de bonnes réponses sur son téléphone ; une erreur bloque 2 s. |
  | 🎰 Paris | On voit le thème et la difficulté, on mise 1, 2, 3 ou 5 points : gagnés si juste, perdus si faux. |
  | 🎲 Quitte ou double | Cagnotte 1, 2, 4, 8, 16 sur des questions de plus en plus dures ; encaisser ou doubler après chaque bonne réponse. |
  | 🪜 L'échelle | Chacun monte d'un niveau en cas de bonne réponse, redescend sinon ; 1 à 4 points selon le niveau. |
  | 🎁 Cadeau empoisonné | À son tour, on choisit qui répond et à quelle difficulté ; en cas d'erreur, les points vont à celui ou celle qui a offert. |
  | 🐑 Majorité | 2 points si l'on donne la même réponse que la majorité, juste ou non. |
  | ⚔️ Duels | Environ un duel tous les 2 modes (4 au plus) : deux joueurs tirés au sort s'affrontent ; les autres parient sur le gagnant (+2). |

- Les corrections et le classement sont affichés après chaque question.
- **Qui a répondu quoi :** pendant une question, l'écran principal montre qui a déjà répondu (sans dévoiler la réponse). À la correction, les avatars apparaissent d'abord sous chaque réponse, puis la bonne réponse s'allume.
- **Vote du looser :** à partir de 3 joueurs, la fin de la première manche ouvre un vote secret de 20 secondes. La personne choisie porte un chapeau 💩 jusqu'à la fin.
- **Ambiance :**
  - chaque joueur choisit un avatar (un personnage, ou une photo prise avec son téléphone) ;
  - les avatars portent des accessoires selon la partie : 👑 pour le leader, 🔥 pendant une série de bonnes réponses, 🌧️ après 3 erreurs, 💩 pour le looser élu ;
  - les joueurs envoient des réactions (😂 🔥 👏…) qui s'envolent sur tous les écrans, ou lancent une tomate 🍅, une rose 🌹 ou un caca 💩 sur un autre joueur ;
  - de temps en temps, un grand écran (avec sons et voix) félicite ou chambre un joueur : seul à avoir trouvé, seul à s'être trompé, série en cours, nouveau leader, remontada…
- **Fin de partie :** podium, titres de la soirée (Le Sniper, Le Kamikaze, La Cible, Le Looser officiel…), image récap à partager, et bouton **Revanche** qui relance une partie avec le même groupe.
- **Mémoire du groupe :** si tu indiques un nom de groupe en créant la partie, le site garde l'historique (victoires, parties, dernières places, titres) et évite de reposer les questions déjà vues par ce groupe.
- **Signalements :** pendant la correction, un joueur peut signaler une réponse fausse. Les questions signalées sont listées en fin de partie et enregistrées dans Firebase (dossier `reports`), pour nettoyer la banque de questions.
- **Confort :**
  - QR code à scanner pour rejoindre la partie ;
  - mode TV (📺) pour lire de loin sur l'écran principal, et plein écran (⛶) ;
  - le téléphone ne se met pas en veille pendant la partie ;
  - un joueur qui perd la connexion garde son tour 10 secondes au plateau.

  Le son est activé par défaut sur l'écran principal et coupé sur les téléphones (bouton 🔊 en haut à droite).

La limite de 10 joueurs est appliquée par le site lors d'une arrivée normale. Les règles Realtime Database ne savent pas compter les joueurs avec `numChildren()` ; cette limite n'est donc pas une protection serveur contre quelqu'un qui contournerait le site. Pour un quiz entre amis, utilise le site normalement. Une limite garantie côté serveur demanderait d'ajouter un petit backend Firebase (Cloud Functions).

## À faire une seule fois

### 1. Vérifier la connexion anonyme de Firebase

Dans [Firebase Console](https://console.firebase.google.com/) :

1. Ouvre le projet **quizz-fefff**.
2. Ouvre **Authentication** (Authentification), puis **Sign-in method** (Mode de connexion).
3. Active le fournisseur **Anonymous** (Anonyme), puis enregistre.

Le site utilise cette connexion pour reconnaître chaque appareil pendant une partie. Les joueurs n'ont pas besoin de créer un compte.

### 2. Publier les règles de la base de données à jour

Les règles laissent uniquement le créateur faire avancer le quiz. La limite de 10 est appliquée par le site, pas par les règles Firebase.

1. Ouvre **Realtime Database** dans Firebase Console.
2. Va dans l'onglet **Règles**.
3. Dans le dossier du site, ouvre `database.rules.json`, sélectionne tout son contenu et copie-le.
4. Remplace tout le texte de l'éditeur de règles Firebase par ce contenu.
5. Clique sur **Publier**.

Il faut bien faire cette étape même si tu avais déjà publié les anciennes règles, sinon les permissions pour choisir une case, envoyer une réponse dans la seconde manche, changer d'avatar, réagir, voter, signaler une question, lancer une revanche et garder l'historique du groupe ne seront pas actives. L'historique des groupes (`groups`) est modifiable par tout appareil connecté au site : c'est suffisant entre amis, mais ce n'est pas une protection contre la triche. Chaque fois que tu remplaces `database.rules.json` dans le dossier du site, pense aussi à republier ces règles dans Firebase.

Après les changements du jeu, remplace également sur GitHub les fichiers modifiés `js/app.js`, `js/game.js`, `js/logic.js`, `js/ai.js`, `js/fun.js`, `js/sound.js`, `js/comfort.js`, `js/bank.js`, `js/modes.js`, `js/config.js`, `index.html`, `css/style.css` et le dossier `banque/`, en les gardant dans les dossiers `js` et `css`. GitHub Pages republiera le site après le commit. Le `README.md` est le mode d'emploi.

### 3. Créer une clé Gemini pour l'intelligence artificielle

Firebase ne fournit pas l'IA. Les questions sont créées par Gemini, le service de Google.

1. Connecte-toi à [Google AI Studio](https://aistudio.google.com/).
2. Ouvre la page [API keys](https://aistudio.google.com/api-keys) et crée une clé API.
3. Garde cette clé pour toi.
4. Le jour du quiz, le créateur colle cette clé dans le formulaire du site.

**Tu n'as pas besoin de Gemini Pro pour utiliser l'API, et Gemini Pro ne paie pas les requêtes de l'API.** Google propose un niveau gratuit pour certains modèles, avec des limites de requêtes. Le site utilise `gemini-3.8-flash`, indiqué comme gratuit sur le niveau standard dans la [page officielle des tarifs](https://ai.google.dev/gemini-api/docs/pricing) au moment où ce guide a été mis à jour. Le jeu génère en une seule fois les questions de la manche 1 et du plateau : une requête pour 3 thèmes, envoyées en parallèle (3 requêtes pour 9 thèmes, en général moins d'une minute). Seuls les thèmes incomplets sont redemandés, et les questions déjà obtenues sont gardées si le créateur clique sur **Relancer**. Le niveau gratuit est très limité (de l'ordre de 5 requêtes par minute et d'une vingtaine par jour selon les projets ; tes vraies limites sont affichées dans Google AI Studio) : le site ne dépasse jamais 5 requêtes par minute, et prévient clairement quand le quota du jour est épuisé. Les modèles et quotas peuvent changer ; vérifie les [tarifs](https://ai.google.dev/gemini-api/docs/pricing) et les [règles de facturation](https://ai.google.dev/gemini-api/docs/billing). Pour rester en gratuit, ne configure pas de facturation ni ne passe au niveau payant. Si tu atteins une limite gratuite, attends que le quota se réinitialise ; le quiz ne pourra pas regénérer les questions avant.

**Données et sécurité :** Google indique que les requêtes du niveau gratuit peuvent être utilisées pour améliorer ses produits. N'entre donc pas de renseignements privés dans les thèmes. La clé n'est pas écrite dans les fichiers du site et le site ne l'enregistre pas, mais le navigateur du créateur l'envoie à Google pour générer les questions. Ne publie pas et ne partage pas cette clé.

## Mettre le site sur GitHub

Tu n'as pas besoin de programmer ni de modifier les fichiers pour cette étape. Il faut envoyer **tout le contenu du dossier du site**, en gardant les mêmes noms et les mêmes dossiers.

### 1. Créer un dépôt vide

1. Connecte-toi sur [github.com](https://github.com/) ou crée un compte.
2. Clique sur **+** en haut à droite, puis **New repository**.
3. Donne un nom, par exemple `quizz-entre-amis`.
4. Choisis **Public**. Le code du site sera visible, mais il ne contient pas ta clé Gemini.
5. Ne coche pas les cases qui proposent d'ajouter un README, un fichier `.gitignore` ou une licence : tu as déjà les fichiers du site.
6. Clique sur **Create repository**.

### 2. Envoyer les fichiers du site

Sur la page du nouveau dépôt :

1. Choisis **uploading an existing file** (envoyer des fichiers existants).
2. Depuis le dossier `quizz-entre-amis` sur ton ordinateur, dépose dans la page les éléments suivants :
   - le fichier `index.html` ;
   - le fichier `README.md` ;
   - le fichier `database.rules.json` ;
   - le dossier `css` avec son fichier `style.css` ;
   - le dossier `js` avec ses fichiers JavaScript.
3. Vérifie que `index.html` apparaît à la racine du dépôt et que les dossiers `css` et `js` sont présents.
4. En bas de la page, clique sur **Commit changes** pour terminer l'envoi.

En résumé : envoie les fichiers et dossiers tels qu'ils sont dans le dossier du site. **N'envoie jamais ta clé Gemini**. La configuration Firebase qui se trouve dans `js/config.js` est prévue pour être intégrée au site web.

### 3. Allumer l'hébergement gratuit

1. Dans le dépôt GitHub, ouvre **Settings** (Paramètres), puis **Pages** dans le menu.
2. Sous **Build and deployment**, choisis **Deploy from a branch**.
3. Sélectionne la branche **main** et le dossier **/(root)**, puis clique sur **Save**.
4. Attends quelques minutes et actualise cette page. GitHub affichera l'adresse de ton site. Elle ressemble à `https://ton-nom.github.io/quizz-entre-amis/`.

Si tu vois une erreur 404 juste après l'activation, attends quelques minutes, puis réessaie.

### 4. Autoriser l'adresse GitHub dans Firebase

Quand tu connais l'adresse GitHub de ton site :

1. Retourne dans Firebase Console > **Authentication** > **Settings** (Paramètres).
2. Ouvre **Authorized domains** (Domaines autorisés) et clique sur **Add domain**.
3. Ajoute seulement le domaine, sans `https://` et sans le nom du dépôt. Par exemple, pour `https://ton-nom.github.io/quizz-entre-amis/`, ajoute `ton-nom.github.io`.
4. Enregistre.

## Comment lancer une partie

1. Ouvre l'adresse du site sur l'ordinateur qui servira d'écran principal.
2. Entre ton pseudo, le nom de la partie et, si tu veux des thèmes libres, ta clé API Gemini, puis crée la partie.
3. Fais scanner le QR code, ou clique sur **Copier le lien** et envoie ce lien aux autres joueurs.
4. Chaque joueur ouvre le lien sur son téléphone, entre son pseudo et rejoint la partie.
5. Quand tout le monde est arrivé, le créateur clique sur **Lancer la partie**.
6. Chaque joueur choisit **3 thèmes dans la banque** (un thème pris par quelqu'un n'est plus disponible) et écrit **1 thème libre**, dont l'IA prépare les questions. Sans clé Gemini, chacun choisit 4 thèmes dans la banque.
   - Si l'IA met plus de 20 secondes ou échoue, le créateur peut cliquer sur **Lancer sans les thèmes libres** : chaque joueur choisit alors un thème de plus dans la banque, à la place de son thème libre.
7. Pendant la manche 1, le créateur affiche et lit les questions sur l'ordinateur ; tous les autres répondent en même temps sur leur téléphone.
8. Au plateau, le gagnant de la première manche commence. À son tour, le joueur choisit un thème et un niveau de points, puis répond seul sur son téléphone. Une case choisie ne peut plus être reprise.

Le maximum de **10 comprend le créateur**. Si tu veux 10 joueurs qui répondent en plus du créateur, il faudra changer la limite.

## La banque de questions

Les thèmes à choisir sont dans le dossier `banque/` : un fichier JSON par thème, au format :

```json
{
  "theme": "Nom du thème",
  "questions": [
    {"difficulty": "facile", "question": "...", "correct": "...", "wrong": ["...", "...", "..."]}
  ]
}
```

Les niveaux sont `facile`, `moyen`, `difficile` et `tres_difficile`. Il faut au moins 4 questions par niveau ; 20 par niveau permettent de rejouer longtemps sans revoir les mêmes questions (le site évite celles déjà posées au groupe).

**Après chaque ajout ou modification d'un fichier**, lance depuis le dossier du site :

```
node outils/banque.mjs
```

L'outil retire les balises ```` ```json ```` que Gemini ajoute parfois, vérifie chaque question, écarte les fichiers en double et met à jour `banque/index.json`, la liste des thèmes affichée dans le menu. Publie ensuite le dossier `banque/` avec le reste du site.

## Essai avant de partager le site

Tu peux d'abord tester l'adresse GitHub Pages toi-même :

1. Ouvre-la sur l'ordinateur et crée une partie.
2. Ouvre le lien de la partie sur un téléphone (ou dans une fenêtre privée d'un autre navigateur).
3. Rejoins avec un autre pseudo et vérifie que tu peux envoyer trois thèmes.
4. Lance le quiz et vérifie que la question apparaît sur l'ordinateur, tandis que le téléphone affiche seulement les choix.

Tu n'as pas besoin d'installer un programme sur ton ordinateur pour le mettre en ligne : tu peux faire le premier essai directement sur l'adresse GitHub Pages.
