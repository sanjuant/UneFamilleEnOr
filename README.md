# 🟡 Une Famille en Or

Interface complète pour animer le jeu **Une Famille en Or** (*Family Feud*) :
une **régie** pour l'animateur et un **écran de jeu** synchronisé en temps réel,
accessibles depuis n'importe quel appareil du réseau local.

## Fonctionnalités

- 🎮 **Jeu complet** : manches normales (×1, ×2, ×3), face-à-face avec buzzer, et **manche finale** (style Fast Money, 5 questions / 2 finalistes, objectif de points).
- 📂 **Chargement de questions** via un simple fichier **JSON**.
- 🔄 **Synchro temps réel** (WebSocket) : la régie pilote, tous les écrans suivent instantanément.
- 🏆 **Comptage des points** automatique (cagnotte × multiplicateur) + ajustement manuel.
- ❌ **Gestion des fautes** (les 3 X) avec animation plein écran.
- 🎵 **Sons** : joue tes propres MP3 (dossier `sounds/`), avec repli automatique sur des sons de synthèse.
- 🎉 Écran de victoire avec confettis.
- 📖 **Règles intégrées** : page `/regles` (avec déroulé détaillé de la manche finale) accessible depuis la régie.
- 🔔 **Buzzers smartphone** : page `/buzzer` — deux téléphones servent de buzzers pour le face-à-face (le premier qui appuie prend la main). **QR code** de connexion intégré.
- ⚡ **Régie fluide** : lancement d'une manche en 1 clic (question + buzzers armés), **raccourcis clavier**, barre d'état permanente, équipe active déduite du buzz.
- 📱 **Vue Animateur** : page `/animateur` (smartphone/tablette) pour l'animateur sur scène — voir la question de la prochaine manche, la lancer, révéler les réponses (ou les **garder masquées** pour ne pas se spoiler).
- 🔒 **Code d'accès** : la régie et l'animateur sont protégés par un code (page **et** commandes WebSocket) ; l'écran de jeu et les buzzers restent ouverts.

### La manche finale, pas à pas

La manche finale est guidée dans la régie : bandeau « Finaliste 1 / Finaliste 2 en jeu », guide
pas-à-pas, **barre de progression** vers l'objectif, **minuteur** (20 s / 25 s), **masquage** des
réponses du finaliste 1 au public, bouton **« Doublon »** (réponse répétée = 0 point) et
**« Révélation finale »**. L'objectif par défaut est de **200 points** (configurable via `target`).

## Installation

```bash
npm install
npm start
```

Puis ouvrez :

- **Écran de jeu** : <http://localhost:3000/>
- **Régie** : <http://localhost:3000/regie>
- **Règles** : <http://localhost:3000/regles>
- **Buzzer** (smartphone) : <http://localhost:3000/buzzer>
- **Animateur** (smartphone/tablette) : <http://localhost:3000/animateur>

### Sur plusieurs appareils (réseau local)

Sur l'écran de jeu (tablette, autre PC, vidéoprojecteur connecté en réseau…),
remplacez `localhost` par l'**adresse IP de ce PC**. Exemple : `http://192.168.1.20:3000/`.

> Pour connaître l'IP du PC sous Windows : `ipconfig` (cherchez « Adresse IPv4 »).

## Déroulé d'une partie

1. Dans la **régie**, cliquez sur **📂 Charger un JSON** (ou **🎲 Exemple**).
2. Réglez les noms d'équipes.
3. Lancez le **générique**, puis sélectionnez une **manche**.
4. Révélez les réponses (clic sur une réponse → 🔔), donnez les **fautes** (❌ → le X),
   puis attribuez la **cagnotte** à l'équipe gagnante.
5. Pour finir, lancez la **manche finale**, saisissez les réponses des finalistes,
   et déclarez le **vainqueur** 🏆.

## Les buzzers (face-à-face)

1. Dans la régie, carte **« 🔔 Buzzers »** : faites scanner le **QR code** aux joueurs (ou bouton **« 📺 Afficher le QR sur l'écran »**). Sinon, ouvrez `http://<IP-du-PC>:3000/buzzer` sur chaque téléphone. Chaque joueur choisit son équipe.
2. Vérifiez le nombre de buzzers connectés par équipe.
3. Au face-à-face, **« Armer les buzzers »** (ou touche `B`) : le premier téléphone qui appuie prend la main (annoncé sur l'écran de jeu + buzz) et devient l'**équipe active** du plateau.

> Lancer une manche (clic sur la manche, ou « Manche suivante » / touche `N`) **arme automatiquement** les buzzers.

## Confort de régie

- **Lancer une manche en 1 clic** : clic sur une manche = question affichée + buzzers armés. Bouton **« ▶ Lancer la manche suivante »** (touche `N`). Les manches jouées sont cochées ✓.
- **Barre d'état permanente** en haut : vue, manche, question, équipe qui a la main, cagnotte, fautes, état des buzzers.
- **Raccourcis clavier** (bouton **« ⌨ Raccourcis »** ou touche `?`) :
  `1`-`9` révéler/masquer une réponse · `X` faute · `C` effacer les fautes · `R` tout révéler · `←`/`→` cagnotte à l'équipe gauche/droite · `B` armer les buzzers · `N` manche suivante · `L` logo.

## Sécurité — code d'accès

La **régie** (`/regie`) et l'**animateur** (`/animateur`) sont protégés par un **code d'accès partagé**. La protection couvre la page **et** les commandes WebSocket (impossible de piloter le jeu sans le code, même via une connexion directe). L'**écran de jeu** (`/`) et les **buzzers** (`/buzzer`) restent ouverts (les joueurs et le vidéoprojecteur en ont besoin).

- Au démarrage, le serveur affiche le code dans le terminal :
  `🔒 Code d'accès régie/animateur : 2181`
- Par défaut il est **aléatoire** (régénéré à chaque lancement). Pour le fixer :
  ```bash
  REGIE_CODE=moncode npm start
  ```
- Sur l'appareil de régie/animation, on saisit le code une fois (il est mémorisé).

- **Anti-triche** : les réponses non révélées ne sont **pas** envoyées aux écrans non authentifiés (écran de jeu, buzzers, curieux) — impossible de lire les bonnes réponses à l'avance, même en inspectant la page.
- **Anti-brute-force** : après quelques codes erronés depuis un même appareil, les tentatives sont **verrouillées** une minute.

> C'est une protection légère adaptée à une soirée en réseau local privé (anti-curieux / anti-blague), pas une sécurité de niveau Internet.

## Vue Animateur (scène)

L'animateur ouvre **`http://<IP-du-PC>:3000/animateur`** sur son téléphone/tablette. Il peut :
- voir la **question de la prochaine manche** et la **lancer** (▶) ;
- **révéler les réponses** une à une (elles s'affichent sur l'écran de jeu) ;
- basculer en **mode anti-spoiler** (🙈) pour garder les réponses masquées sur son propre écran et ne pas se gâcher la surprise — les réponses déjà révélées au public restent visibles ;
- donner les **fautes** (✖) et la **cagnotte**.

**Pendant la manche finale**, l'animateur voit en plus : le **chrono en direct**, et les **réponses saisies des finalistes** — celles du finaliste 1 restent visibles pour repérer les **doublons** du finaliste 2 (signalés par ⚠). Quand le chrono atteint 0, un **son** retentit sur l'écran de jeu et le chrono disparaît.

C'est une vue compagnon synchronisée : tout ce qu'il fait apparaît sur l'écran de jeu, en complément (ou en remplacement ponctuel) de la régie.

## Format du fichier de questions

Voir [`public/questions.example.json`](public/questions.example.json).

```jsonc
{
  "title": "UNE FAMILLE EN OR",
  "teams": ["Équipe 1", "Équipe 2"],
  "rounds": [
    {
      "multiplier": 1,                       // ×1, ×2, ×3...
      "question": "Citez un fruit...",
      "answers": [
        { "text": "Banane", "points": 32 },  // triées de la plus à la moins citée
        { "text": "Pomme",  "points": 24 }
      ]
    }
  ],
  "final": {                                  // manche finale (optionnelle)
    "target": 200,                            // objectif de points (défaut 200)
    "timers": [20, 25],                       // temps (s) finaliste 1 / finaliste 2
    "questions": [
      { "question": "...", "answers": [ { "text": "...", "points": 40 } ] }
    ]
  }
}
```

## Sons

Déposez vos fichiers dans `sounds/` (voir [`sounds/LISEZ-MOI.txt`](sounds/LISEZ-MOI.txt)).
