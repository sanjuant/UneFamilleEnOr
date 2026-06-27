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
- 🔔 **Buzzers smartphone** : page `/buzzer` — deux téléphones servent de buzzers pour le face-à-face (le premier qui appuie prend la main).

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

1. Sur chaque smartphone (connecté au même réseau), ouvrez **`http://<IP-du-PC>:3000/buzzer`** et choisissez l'équipe.
2. Dans la régie, carte **« 🔔 Buzzers »** : vérifiez que les 2 buzzers sont connectés.
3. Au face-à-face, cliquez **« Armer les buzzers »** : le premier téléphone qui appuie prend la main (annoncé sur l'écran de jeu + buzz). Cliquez **« Réinitialiser »** pour le face-à-face suivant.

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
