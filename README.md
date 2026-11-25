# Mémora — guide pas à pas (débutant)

Application de cartes de révision (comme Anki) avec répétition espacée SM-2 et une IA (Claude) intégrée.
Elle s'installe sur iPhone et Android, fonctionne hors connexion, et **toutes tes données restent sur ton téléphone**.

---

## 1. Ce qu'il y a dans le dossier

| Fichier / dossier | À quoi ça sert |
|---|---|
| `index.html` | La page de l'app |
| `manifest.json` | La « carte d'identité » de l'app (nom, icône) pour l'installer |
| `sw.js` | Le « service worker » : garde une copie de l'app pour qu'elle marche hors connexion |
| `css/style.css` | L'apparence (thème clair / sombre automatique) |
| `js/` | Le code, commenté en français (`sm2.js` = algorithme, `db.js` = stockage, `ai/` = IA, `views/` = écrans) |
| `icons/` | Les icônes de l'app |
| `tests/` | Les tests automatiques (`tests/index.html`) |
| `tools/make-icons.html` | Petite page qui fabrique les icônes PNG |

Tu n'as **rien à installer** pour utiliser l'app : pas de Node, pas de npm, pas de serveur.

---

## 2. Tester sur ton ordinateur (facultatif)

Une app web doit être ouverte via une adresse `http://…` (pas en double-cliquant sur le fichier).

1. Ouvre le dossier de l'app dans l'Explorateur Windows.
2. Clique dans la barre d'adresse du dossier, tape `powershell` puis Entrée : une fenêtre noire s'ouvre **dans ce dossier**.
3. Tape cette commande puis Entrée (Python doit être installé) :
   ```powershell
   python -m http.server 8000
   ```
4. Ouvre Chrome ou Edge à l'adresse **http://localhost:8000** : l'app s'affiche.
5. Pour lancer les tests : **http://localhost:8000/tests/** → tu dois voir « Tous les tests passent ✓ ».
6. Pour arrêter : dans la fenêtre noire, appuie sur `Ctrl + C`.

> Sur un PC d'entreprise, l'antivirus ou les règles de sécurité peuvent bloquer cette étape. Ce n'est pas grave : tu peux passer directement au déploiement (étape 3) et tester sur ton téléphone.

---

## 3. Mettre l'app en ligne gratuitement (GitHub Pages)

### 3.1 Créer un compte GitHub
1. Va sur **https://github.com** → **Sign up**.
2. Saisis ton e-mail, un mot de passe, un nom d'utilisateur (ex. `marie-revise`), puis valide le code reçu par e-mail.
3. Choisis l'offre **Free** (gratuite).

### 3.2 Créer le dépôt (le « dossier en ligne » de l'app)
1. En haut à droite, clique sur **+** → **New repository**.
2. **Repository name** : par exemple `memora` (sans espace ni accent).
3. Coche **Public** (obligatoire pour GitHub Pages gratuit. Rien de secret n'est dans le code : ta clé API reste sur ton téléphone).
4. Clique sur **Create repository**.

### 3.3 Envoyer les fichiers
1. Sur la page du dépôt, clique sur le lien **uploading an existing file** (ou **Add file → Upload files**).
2. Ouvre le dossier de l'app sur ton ordinateur, **sélectionne tout son contenu** (`Ctrl + A`) : `index.html`, `manifest.json`, `sw.js`, les dossiers `css`, `js`, `icons`, `tests`, `tools`, et `README.md`.
3. **Glisse-dépose** le tout dans la page GitHub. Attends que tous les fichiers apparaissent dans la liste.
4. En bas, clique sur **Commit changes**.

> ⚠️ Il faut envoyer le *contenu* du dossier, pas le dossier lui-même : `index.html` doit être à la racine du dépôt.

### 3.4 Activer GitHub Pages
1. Dans le dépôt : **Settings** (onglet en haut) → **Pages** (menu de gauche).
2. Sous **Build and deployment** → **Source** : choisis **Deploy from a branch**.
3. **Branch** : choisis `main` et `/ (root)`, puis **Save**.
4. Attends 1 à 2 minutes et recharge la page : l'adresse de ton app s'affiche, du type
   **https://ton-nom.github.io/memora/**

C'est cette adresse que tu ouvriras sur ton téléphone.

---

## 4. Installer l'app sur ton téléphone

### iPhone (Safari obligatoire)
1. Ouvre l'adresse de ton app dans **Safari** (pas Chrome).
2. Touche le bouton **Partager** (carré avec une flèche vers le haut).
3. Fais défiler et choisis **Sur l'écran d'accueil**, puis **Ajouter**.
4. Ouvre ensuite l'app **depuis son icône** (pas depuis Safari) : elle s'affiche en plein écran et fonctionne hors connexion.

### Android (Chrome)
1. Ouvre l'adresse de ton app dans **Chrome**.
2. Touche le menu **⋮** (en haut à droite) → **Installer l'application** (ou **Ajouter à l'écran d'accueil**).
3. Confirme. L'icône apparaît avec tes autres applications.

> Ouvre l'app une première fois avec internet : elle se met alors en mémoire et marchera ensuite **hors connexion** (sauf les fonctions IA, qui ont besoin du réseau).

---

## 5. Activer l'IA (clé API Claude)

1. Va sur **https://console.anthropic.com** et crée un compte.
2. **Billing** : ajoute un moyen de paiement et un peu de crédit (par ex. 5 $). **L'usage est payant**, en général quelques centimes à quelques dizaines de centimes par cours.
3. **Limits** : fixe une limite de dépense mensuelle pour être tranquille.
4. **API Keys → Create Key** : copie la clé (elle commence par `sk-ant-`, elle ne s'affiche qu'une fois).
5. Dans l'app : **Accueil → ⚙ Réglages → Intelligence artificielle**, colle la clé, touche **Enregistrer et tester**.

La clé est stockée uniquement sur ton téléphone et n'est jamais incluse dans les sauvegardes.
Le modèle par défaut est **Claude Opus 5.5** (le plus fiable). Tu peux choisir Sonnet 5.5 (moins cher) ou Haiku 5.5 (très économique) dans les Réglages.

### Comment l'IA évite d'oublier des notions
1. Tu colles ton cours ou tu prends des photos.
2. L'IA **liste d'abord toutes les notions**. Tu ajoutes, supprimes ou corriges cette liste.
3. Après ta validation seulement, elle crée les cartes et/ou la fiche.
4. Une **vérification automatique** contrôle chaque notion. Si une notion n'est pas couverte, l'app te le signale et propose les cartes manquantes (ou un complément de fiche).
5. Tu relis chaque carte (modifier / retirer) avant de les ajouter.

---

## 6. Rappels : ce qui marche vraiment (honnêtement)

Une app web sans serveur **ne peut pas** programmer une notification à heure fixe de façon fiable. Voici le détail :

| Fonction | iPhone | Android |
|---|---|---|
| Badge (chiffre sur l'icône) | ✔ iOS 16.4+, app installée **et** notifications autorisées. Mis à jour à l'ouverture de l'app | Selon le téléphone : un point ou un chiffre |
| Notification quotidienne automatique | ✘ Impossible (Apple ne réveille pas les apps web) | ~ Possible si l'app est installée : Chrome la réveille environ une fois par jour, **heure non garantie** |
| Rappel dans l'app à l'ouverture | ✔ | ✔ |
| **Rappel par calendrier (solution fiable)** | ✔ Calendrier iPhone | ✔ Google Agenda |

**Solution de repli recommandée** : dans **Réglages → Rappels**, choisis l'heure puis touche **Ajouter le rappel à mon calendrier**. Ouvre le fichier `.ics` obtenu et ajoute-le à ton calendrier : une alerte sonnera chaque jour à l'heure choisie.
Autre option sur iPhone : app **Raccourcis → Automatisation → Heure de la journée → Ouvrir l'app**.

---

## 7. Sauvegarder tes cartes (important)

Tes cartes ne sont **que** sur ton téléphone. Si tu supprimes l'app, changes de téléphone, ou si le navigateur fait du ménage, elles peuvent être perdues.

- **Réglages → Données → Sauvegarder** crée un fichier `.json` complet (avec les images). Range-le dans iCloud Drive, Google Drive ou envoie-le-toi par e-mail.
- **Restaurer** remet tout à partir de ce fichier (cela remplace les données actuelles).
- L'app te rappelle de sauvegarder (tous les 7 jours par défaut, réglable).
- **Export / import CSV** : pour échanger des cartes avec un tableur (Excel, Google Sheets) ou depuis Anki (export « Notes en texte brut »). Colonnes : `paquet;recto;verso` (sous-paquets avec `::`, ex. `Histoire::XXe siècle`).

> Sur iPhone, une app **installée** sur l'écran d'accueil garde ses données beaucoup plus sûrement que la même adresse ouverte dans Safari.

---

## 8. Mettre l'app à jour après une modification

1. Modifie le(s) fichier(s).
2. Ouvre `sw.js` et augmente la version : `const CACHE_VERSION = 'v1';` → `'v2'` (puis `'v3'`…).
3. Renvoie les fichiers modifiés sur GitHub (**Add file → Upload files**, ils remplacent les anciens) → **Commit changes**.
4. Sur le téléphone, ouvre l'app : un bandeau **« Nouvelle version disponible → Mettre à jour »** apparaît.

Tes cartes ne sont pas touchées par une mise à jour.

---

## 9. Utilisation rapide

- **Accueil** : objectif du jour (jauge), série de jours, cartes à réviser par paquet (bleu = nouvelles, orange = en cours, vert = à revoir).
- **Paquets** : arborescence (paquet parent → sous-paquets). Dans un paquet : ✎ pour le nom et le nombre de nouvelles cartes par jour (20 par défaut).
- **Révision** : « Voir la réponse » puis **À revoir / Difficile / Bien / Facile**. Le délai avant le prochain passage est écrit sous chaque bouton.
- **Cartes difficiles** : entraînement sur les cartes les plus ratées (ne change pas le planning).
- **Mode examen** : QCM chronométré créé à partir d'un paquet (marche hors connexion). À la fin, l'IA peut **expliquer tes erreurs**.
- **Créer (IA)** : cartes depuis un texte ou des photos, fiche de révision, quiz.
- **Fiches** : tes fiches, liées à leurs cartes. **Exporter en PDF** ouvre l'impression du téléphone → choisis **Enregistrer en PDF** (Android) ou, sur iPhone, **Partager → Enregistrer dans Fichiers**.
- **Stats** : calendrier de régularité, cartes apprises par jour, taux de réussite (global et par paquet), prévision des 14 prochains jours, cartes les plus ratées.

Sur ordinateur : `Espace` = voir la réponse, `1` `2` `3` `4` = noter.

---

## 10. Dépannage

| Problème | Solution |
|---|---|
| Page blanche sur GitHub | Vérifie que `index.html` est à la racine du dépôt et attends 2 minutes |
| L'app ne se met pas à jour | As-tu augmenté `CACHE_VERSION` dans `sw.js` ? Ferme complètement l'app et rouvre-la |
| « Clé API invalide » | Recopie la clé en entier (elle commence par `sk-ant-`) |
| « Crédit épuisé » | Ajoute du crédit sur console.anthropic.com → Billing |
| Pas de bouton « Sur l'écran d'accueil » sur iPhone | Utilise Safari, pas Chrome |
| Pas de notifications sur iPhone | iOS 16.4 minimum, app installée, ouverte depuis son icône, puis Réglages → Rappels → Autoriser |
| L'IA est longue | Normal pour un long cours (1 à 3 minutes). Garde l'app ouverte |
