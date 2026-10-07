/* Règles d'Une Famille en Or — contenu affiché par /regles.
   Sources : Wikipédia (fr/en), règles officielles TF1 Games (PDF), Family Feud.
   Champs d'une section : paragraphs, example {title, html}, steps, app (mode
   d'emploi dans l'application), tips (conseils d'animation), faq [{q, a}]. */
const RULES = {
  intro:
    "« Une Famille en Or » oppose deux familles qui tentent de deviner les réponses les plus citées par un panel de 100 personnes sondées. Au fil des manches, la famille qui marque le plus de points accède à la manche finale, où deux de ses membres jouent pour le gros lot. Voici les règles complètes, les cas particuliers, et comment les appliquer depuis la régie.",
  sections: [
    {
      icon: '🎯',
      title: 'But du jeu',
      paragraphs: [
        "Deux familles s'affrontent pour deviner les réponses les plus citées par un panel de 100 personnes sondées. Chaque réponse rapporte autant de points que de personnes l'ayant donnée : une réponse citée par 28 personnes vaut 28 points.",
        "La partie se joue en plusieurs manches de sondage. La famille en tête à l'issue des manches dispute la manche finale : deux de ses membres doivent atteindre ensemble l'objectif de points (<b>200</b> par défaut) pour remporter le gros lot.",
        "Le nombre de manches varie selon les versions : généralement 4 dans les versions modernes, 5 dans la version des années 1990. Ici, ce sont les manches de votre fichier de questions.",
      ],
    },
    {
      icon: '🗺️',
      title: "Déroulé d'une partie",
      steps: [
        "Présentation des deux familles (5 joueurs chacune à la télévision ; adaptez à votre groupe).",
        "Chaque manche commence par un face-à-face entre un joueur de chaque famille.",
        'La famille qui gagne le face-à-face choisit de jouer la manche ou de passer la main.',
        "La famille qui joue cherche les réponses du tableau ; à la 3e erreur, l'adversaire peut voler la manche.",
        'La famille qui remporte la manche empoche la cagnotte, multipliée selon la manche.',
        "Manche suivante : deux nouveaux joueurs passent au face-à-face (chacun son tour).",
        'Après la dernière manche, la famille qui a le plus de points joue la manche finale.',
      ],
      tips: [
        'Faites tourner les joueurs du face-à-face : chaque membre de la famille passe au buzzer à son tour.',
        "Annoncez les règles importantes avant de commencer (temps de réponse, réponses soufflées, réponses proches) : on évite les contestations en cours de partie.",
      ],
    },
    {
      icon: '🔔',
      title: 'Le face-à-face',
      paragraphs: [
        "Un joueur de chaque famille se place au buzzer. L'animateur lit la question ; le premier qui buzze répond aussitôt (on peut buzzer avant la fin de la question). S'il ne répond pas dans les 3 secondes environ, la parole passe à l'adversaire.",
        "<strong>Réponse n°1 du tableau</strong> : si le premier joueur donne la réponse la plus citée, sa famille gagne immédiatement le face-à-face, sans que l'adversaire réponde.",
        "<strong>Sinon, l'adversaire répond à son tour</strong>, que la première réponse soit au tableau ou non. Il ne peut pas redonner une réponse déjà affichée.",
        "<strong>La réponse la mieux classée l'emporte</strong> : c'est sa place dans le tableau (1re, 2e, 3e…) qui compte, pas l'ordre du buzz. Si une seule des deux réponses est au tableau, elle l'emporte, quelle que soit sa place.",
        "<strong>Toutes les bonnes réponses sont affichées</strong> : chaque réponse trouvée au face-à-face, y compris celle du joueur battu, est révélée au tableau et ses points vont dans la cagnotte de la manche.",
        "<strong>Aucune réponse au tableau</strong> : personne ne gagne. On rejoue le face-à-face sur la même question avec les deux joueurs suivants, jusqu'à ce qu'une réponse soit trouvée.",
        "<strong>Passe ou joue</strong> : la famille qui gagne le face-à-face choisit de JOUER la manche ou de PASSER la main à l'adversaire. On joue presque toujours ; on passe quand la question semble piégeuse, en espérant que l'adversaire fasse 3 fautes et laisse un vol facile.",
      ],
      example: {
        title: 'Exemple',
        html: "Tableau : 1. Banane · 2. Fraise · 3. Pomme… L'équipe A buzze et dit « fraise » (2e) : on la révèle. L'équipe B répond « banane » (1re) : on la révèle aussi. Banane est mieux classée : <strong>l'équipe B gagne le face-à-face</strong> et choisit de jouer ou de passer. La cagnotte contient déjà fraise + banane, et ces deux cases restent découvertes pour la suite de la manche.",
      },
      steps: [
        "Un joueur de chaque famille au buzzer ; l'animateur lit la question.",
        'Le premier qui buzze répond. Réponse n°1 : sa famille gagne directement.',
        "Sinon, l'adversaire répond à son tour.",
        'Chaque réponse présente au tableau est révélée ; la mieux classée gagne la main.',
        'Aucune réponse au tableau : on rejoue avec les deux joueurs suivants.',
        'La famille gagnante choisit : jouer ou passer.',
      ],
      app: [
        "La carte « Manche en cours » de la régie guide chaque manche : face-à-face → jeu → vol → fin de manche, avec la consigne du moment et son bouton principal (touche <kbd>Entrée</kbd>).",
        "Lancer une manche affiche la question et arme les buzzers. L'équipe qui buzze répond la première ; sans buzzers, indiquez-la d'un clic.",
        "Pour chaque joueur, cliquez sa réponse au tableau (touches <kbd>1</kbd> à <kbd>9</kbd>), tapez-la dans « ce que dit le joueur », ou « Pas au tableau » (touche <kbd>X</kbd>). La régie compare les places et donne la main à la mieux classée, puis propose « joue » ou « passe ».",
        "Les X du face-à-face s'affichent à l'écran mais ne comptent pas : ils sont effacés dès que la famille joue ou passe. Aucune réponse au tableau : « Rejouer le face-à-face » efface les X et réarme les buzzers.",
      ],
      tips: [
        "Annoncez la place de chaque réponse (« … c'est la réponse n°2 ! ») : le public comprend tout de suite qui prend la main.",
        "Le joueur qui répond en second connaît la réponse du premier : laissez-lui un instant pour viser plus haut.",
      ],
    },
    {
      icon: '🃏',
      title: 'Jouer la manche',
      paragraphs: [
        "La famille qui a la main répond à tour de rôle : chaque joueur donne une seule réponse, sans l'aide de ses coéquipiers. Chaque réponse présente au tableau est révélée et ses points s'ajoutent à la cagnotte.",
        "<strong>Les fautes (X)</strong> : une réponse absente du tableau, déjà donnée, ou trop lente (environ 3 secondes) vaut un X. Au 3e X, la famille perd la main et l'adversaire tente un vol.",
        "<strong>Tableau complet</strong> : si la famille découvre toutes les réponses avant son 3e X, elle remporte la manche et la cagnotte ; il n'y a pas de vol.",
        "<strong>Réponses proches</strong> : l'animateur juge si une réponse correspond à une case (synonyme, pluriel, formulation différente du même sens). Fixez votre tolérance avant la partie et tenez-vous-y d'une manche à l'autre.",
      ],
      app: [
        "Tapez ce que dit le joueur puis <kbd>Entrée</kbd> : si la réponse est au tableau (même formulée autrement), elle est révélée ; sinon, c'est un X. Vous pouvez aussi cliquer la réponse (touches <kbd>1</kbd> à <kbd>9</kbd>) et donner un X avec la touche <kbd>X</kbd>.",
        'Au 3e X, la régie passe toute seule au vol. Tableau complet : un bouton donne directement la cagnotte à la famille.',
      ],
      tips: [
        "Annoncez le nombre de réponses au tableau avant que la famille ne commence (« il y a 6 réponses à trouver »).",
        'Comptez les X à voix haute : le public suit la menace du vol.',
      ],
    },
    {
      icon: '🕵️',
      title: 'Le vol',
      paragraphs: [
        "Après le 3e X, la famille adverse se concerte (elle a écouté toute la manche), puis donne <strong>une seule réponse</strong>, en général par la voix de son capitaine.",
        "<strong>Vol réussi</strong> : la réponse est au tableau. Elle est révélée, ses points s'ajoutent à la cagnotte, et la famille qui vole remporte TOUTE la cagnotte.",
        "<strong>Vol raté</strong> : la cagnotte revient à la famille qui jouait la manche.",
        "Ensuite, on révèle les réponses restantes pour le public : elles ne rapportent plus de points.",
      ],
      app: [
        "Cliquez (ou tapez) la réponse de la famille qui vole : si elle est au tableau, elle est révélée et la cagnotte lui revient automatiquement. Sinon, « Vol raté » (touche <kbd>X</kbd>) donne la cagnotte à la famille qui jouait.",
        "Une fois donnée, la cagnotte est figée : « Révéler le reste » montre les réponses restantes au public sans toucher aux scores, puis « Manche suivante ».",
      ],
      tips: ["Laissez la famille adverse se concerter quelques secondes à voix basse, puis exigez une réponse claire du capitaine."],
    },
    {
      icon: '✖️',
      title: 'Multiplicateurs',
      paragraphs: [
        "Certaines manches comptent double ou triple pour relancer la partie. Version moderne et jeu de société : la dernière manche compte ×3, les autres ×1. Version des années 1990 : manche 4 ×2, manche 5 ×3.",
        "Le multiplicateur s'applique à toute la cagnotte, au moment de la donner. Ici, il se règle manche par manche avec le champ <b>multiplier</b> du fichier de questions.",
      ],
      tips: ["Rappelez le multiplicateur en annonçant la manche (« attention, cette manche compte triple ! ») : c'est le moment où tout peut basculer."],
    },
    {
      icon: '🏆',
      title: 'La manche finale',
      paragraphs: [
        "La famille gagnante désigne 2 finalistes. Ils répondent aux <strong>mêmes questions</strong> (5 dans la version télé, configurable ici), l'un après l'autre. Le second est isolé pendant le passage du premier : il ne doit entendre ni les questions ni les réponses.",
        "<strong>Temps imparti</strong> (configurable, <b>timers</b>) : 20 secondes pour le 1er finaliste, 25 secondes pour le 2e, qui doit en plus éviter les doublons. Variantes : 15 s / 20 s dans la version des années 1990 ; un sablier unique de 45 s dans le jeu de société.",
        "<strong>Je passe</strong> : un finaliste qui sèche peut passer une question ; on y revient à la fin s'il reste du temps. Une réponse donnée après la fin du chrono ne compte pas.",
        "<strong>Règle du doublon</strong> : le 2e finaliste ne peut pas redonner une réponse du 1er. S'il le fait, l'animateur le signale aussitôt (buzz « déjà dit ») et lui demande une autre réponse ; le chrono continue de tourner. Une réponse en doublon rapporte 0 point.",
        "<strong>Objectif</strong> (configurable, <b>target</b>) : atteindre au moins <strong>200 points</strong> au cumul des deux finalistes pour remporter le gros lot, comme dans la version télé 2007-2014 et le jeu de société officiel. À ne pas confondre avec les 300 points de la version 1990-1999, qui étaient le seuil de qualification pour la finale.",
        "<strong>La révélation</strong> : après le passage du 1er finaliste, on révèle ses réponses et leurs points, puis on les cache avant le retour du 2e. À la fin, on rappelle le score du 1er, puis on dévoile les réponses du 2e une à une, jusqu'à savoir si l'objectif est atteint.",
      ],
      steps: [
        'La famille gagnante désigne ses 2 finalistes ; le 2e part en coulisses.',
        "L'animateur pose les questions au 1er finaliste dans le temps imparti (il peut passer une question et y revenir).",
        "On révèle ses réponses une à une avec leurs points, puis on les masque.",
        'Le 2e finaliste revient et répond aux mêmes questions, avec un peu plus de temps.',
        'Doublon : buzz « déjà dit », 0 point, on lui redemande aussitôt une autre réponse.',
        "Révélation finale : rappel du score du 1er, puis réponses du 2e une à une.",
        "Cumul atteint ou dépassé : la famille remporte le gros lot.",
      ],
      app: [
        "La carte « Manche finale » de la régie est un assistant en 5 étapes : Préparation → Finaliste 1 répond → ses réponses → Finaliste 2 répond → Révélation finale. Chaque étape a son gros bouton « suivant » (raccourci <kbd>Entrée</kbd>).",
        "Saisie : une question à la fois. Cliquez une proposition ou tapez la réponse puis <kbd>Entrée</kbd> : les points sont trouvés automatiquement, même pour une formulation approchante. « Passer » met la question de côté, elle revient à la fin. <kbd>Espace</kbd> lance ou met en pause le chrono.",
        "Doublons : la réponse du 1er finaliste est rappelée sous chaque question, et un doublon (même formulé autrement) est refusé avec un buzz.",
        "Révélations : <kbd>Entrée</kbd> révèle la réponse suivante, <kbd>1</kbd> à <kbd>5</kbd> une réponse précise. Les réponses du 1er finaliste sont masquées au public pendant le passage du 2e, puis rappelées au début de la révélation finale.",
        "Une erreur ? Le « Tableau complet », replié en bas de la carte, permet de corriger n'importe quelle réponse ou n'importe quels points.",
      ],
      tips: [
        "Vérifiez l'isolement du 2e finaliste avant de lancer le chrono du 1er.",
        "Lisez les questions vite et sans commentaire : le chrono tourne pour le finaliste, pas pour l'animateur.",
        "Avant la révélation finale, annoncez combien de points il manque : c'est tout le suspense.",
      ],
    },
    {
      icon: '🧮',
      title: 'Compter les points (côté régie)',
      paragraphs: [
        "Chaque réponse vaut le nombre de personnes (sur 100 sondées) qui l'ont citée.",
        "<strong>Cagnotte d'une manche</strong> : somme des réponses révélées pendant la manche, y compris celles du face-à-face et celle d'un vol réussi, multipliée par le multiplicateur de la manche. Les réponses révélées après coup, pour le public, ne comptent pas.",
        "<strong>Finale</strong> : somme des réponses valides des deux finalistes ; doublons et réponses hors délai valent 0. On compare le cumul à l'objectif (200 points par défaut).",
        "Dans l'application : « Donner la cagnotte » applique le multiplicateur et fige la cagnotte ; une erreur d'équipe se corrige en la redonnant à l'autre (le montant est transféré). En finale, la barre de progression compare le total à l'objectif en temps réel.",
      ],
      tips: [
        "Notez la réponse de chaque finaliste telle qu'il l'a dite : c'est elle qu'on affiche, avec les points de la case correspondante.",
        "Vérifiez le total deux fois avant d'annoncer le résultat de la finale.",
      ],
    },
    {
      icon: '❓',
      title: 'Cas particuliers',
      faq: [
        {
          q: 'Au face-à-face, les deux joueurs trouvent une réponse du tableau : on affiche les deux ?',
          a: "Oui. Toute réponse présente au tableau est révélée et compte dans la cagnotte. La main va à la mieux classée des deux.",
        },
        {
          q: 'Le second joueur du face-à-face redonne la réponse du premier ?',
          a: "Elle est déjà affichée : elle ne compte pas, il doit en proposer une autre.",
        },
        {
          q: "Aucun des deux joueurs n'a de réponse au tableau ?",
          a: "On rejoue le face-à-face sur la même question avec les deux joueurs suivants. Les X affichés pendant le face-à-face ne comptent pas comme fautes de la manche.",
        },
        {
          q: 'Un joueur buzze mais ne répond pas ?',
          a: "Au bout de 3 secondes environ, la parole passe à l'adversaire.",
        },
        {
          q: 'La famille trouve toutes les réponses avant son 3e X ?',
          a: 'Elle remporte la manche et la cagnotte : pas de vol.',
        },
        {
          q: 'Un coéquipier souffle la réponse ?',
          a: "Pendant la manche, chacun répond seul : en règle courante, une réponse soufflée vaut un X. Seule la famille qui tente un vol a le droit de se concerter. Annoncez-le avant de commencer.",
        },
        {
          q: 'La réponse est proche mais pas identique ?',
          a: "L'animateur tranche : même sens, bonne réponse (pluriel, synonyme, précision en plus). En cas de doute, il demande au joueur de préciser.",
        },
        {
          q: 'Que vaut la réponse du vol ?',
          a: "Ses points s'ajoutent à la cagnotte, que la famille qui vole remporte en entier.",
        },
        {
          q: 'Égalité de points à la fin des manches ?',
          a: "Suggestion : un face-à-face « mort subite » sur une nouvelle question, où seule la réponse n°1 compte ; la première famille qui la trouve va en finale.",
        },
        {
          q: 'Finale : le finaliste dit « je passe » ?',
          a: "La question reste vide ; on y revient à la fin s'il reste du temps. Sinon, elle vaut 0 point.",
        },
        {
          q: 'Finale : une réponse arrive après la fin du chrono ?',
          a: 'Elle ne compte pas.',
        },
        {
          q: "Finale : l'objectif n'est pas atteint ?",
          a: "La famille ne remporte pas le gros lot (à la télévision, elle repart avec une somme par point marqué), mais elle reste la gagnante de la partie.",
        },
      ],
    },
  ],
};
