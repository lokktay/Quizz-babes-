# Quizz entre amis

Un site de quiz en français, hébergé gratuitement sur GitHub Pages. Firebase sert à faire circuler les réponses entre les appareils. Le créateur garde l'écran principal et lit les questions ; les autres joueurs répondent sur leur téléphone.

## Ce que fait le jeu

- Une partie accueille **10 personnes au maximum, créateur compris** : le créateur et jusqu'à 9 joueurs sur téléphone.
- Le créateur ne propose pas de thèmes et ne répond pas. Il garde l'écran qui affiche les questions.
- Chaque autre joueur propose 3 thèmes depuis son téléphone.
- L'IA prépare les questions à partir de ces thèmes.
- Les téléphones affichent les choix de réponse. Le classement et les corrections apparaissent après chaque question.

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

Il faut bien faire cette étape même si tu avais déjà publié les anciennes règles, sinon les permissions nécessaires au nouveau fonctionnement ne seront pas actives.

### 3. Créer une clé Gemini pour l'intelligence artificielle

Firebase ne fournit pas l'IA. Les questions sont créées par Gemini, le service de Google.

1. Connecte-toi à [Google AI Studio](https://aistudio.google.com/).
2. Ouvre la page [API keys](https://aistudio.google.com/api-keys) et crée une clé API.
3. Garde cette clé pour toi.
4. Le jour du quiz, le créateur colle cette clé dans le formulaire du site.

**Tu n'as pas besoin de Gemini Pro pour utiliser l'API, et Gemini Pro ne paie pas les requêtes de l'API.** Google propose un niveau gratuit pour certains modèles, avec des limites de requêtes. Le site utilise `gemini-3.8-flash`, indiqué comme gratuit sur le niveau standard dans la [page officielle des tarifs](https://ai.google.dev/gemini-api/docs/pricing) au moment où ce guide a été mis à jour. Les modèles et quotas peuvent changer ; vérifie les [tarifs](https://ai.google.dev/gemini-api/docs/pricing) et les [règles de facturation](https://ai.google.dev/gemini-api/docs/billing). Pour rester en gratuit, ne configure pas de facturation ni ne passe au niveau payant. Si tu atteins une limite gratuite, attends que le quota se réinitialise ; le quiz ne pourra pas regénérer les questions avant.

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
2. Entre ton pseudo, le nom de la partie et ta clé API Gemini, puis crée la partie.
3. Clique sur **Copier le lien** et envoie ce lien aux autres joueurs.
4. Chaque joueur ouvre le lien sur son téléphone, entre son pseudo et rejoint la partie.
5. Quand tout le monde est arrivé, le créateur clique sur **Lancer la partie**.
6. Les joueurs sur téléphone entrent chacun leurs trois thèmes. Le créateur attend sur l'ordinateur et ne saisit pas de thèmes.
7. Le créateur affiche et lit les questions sur l'ordinateur ; les autres choisissent une réponse sur leur téléphone.

Le maximum de **10 comprend le créateur**. Si tu veux 10 joueurs qui répondent en plus du créateur, il faudra changer la limite.

## Essai avant de partager le site

Tu peux d'abord tester l'adresse GitHub Pages toi-même :

1. Ouvre-la sur l'ordinateur et crée une partie.
2. Ouvre le lien de la partie sur un téléphone (ou dans une fenêtre privée d'un autre navigateur).
3. Rejoins avec un autre pseudo et vérifie que tu peux envoyer trois thèmes.
4. Lance le quiz et vérifie que la question apparaît sur l'ordinateur, tandis que le téléphone affiche seulement les choix.

Tu n'as pas besoin d'installer un programme sur ton ordinateur pour le mettre en ligne : tu peux faire le premier essai directement sur l'adresse GitHub Pages.
