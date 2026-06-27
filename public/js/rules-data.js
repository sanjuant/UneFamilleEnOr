/* Règles d'Une Famille en Or — contenu affiché par /regles.
   Sources : Wikipédia (fr/en), règles officielles TF1 Games (PDF), Family Feud. */
const RULES = {
  intro:
    "« Une Famille en Or » oppose deux familles qui tentent de deviner les réponses les plus citées par un panel de 100 personnes sondées. Au fil des manches, la famille qui marque le plus de points accède à la manche finale, où deux de ses membres jouent pour le gros lot. Voici les règles complètes du jeu.",
  sections: [
    {
      icon: '🎯',
      title: 'But du jeu',
      paragraphs: [
        "Deux familles s'affrontent en devinant les réponses les plus populaires données par un panel de 100 personnes interrogées sur une question de sondage. Chaque réponse vaut le nombre de personnes l'ayant citée.",
        "Le jeu se déroule en plusieurs manches. La famille qui mène au terme des manches accède à la manche finale, où deux de ses membres tentent ensemble d'atteindre l'objectif de points pour remporter le gros lot.",
        "Le nombre de manches et les seuils varient selon la version (voir <b>target</b> dans la configuration) : généralement 4 manches dans les versions modernes, 5 dans la version historique des années 1990.",
      ],
    },
    {
      icon: '🃏',
      title: 'Les manches',
      paragraphs: [
        "À chaque manche, l'animateur pose une question de sondage. Le tableau cache plusieurs réponses « Top » (5, 6 ou 7 selon la question), classées de la plus citée à la moins citée. Après le face-à-face, la famille qui a la main énumère des réponses à tour de rôle.",
        "Chaque bonne réponse découvre la case correspondante et révèle ses points (la valeur sondage). Les réponses absentes du panel comptent comme des fautes.",
        "<strong>Les fautes / le X</strong> : une réponse qui ne figure pas dans le tableau donne un « X » (croix rouge). Au bout de 3 X, la main passe à la famille adverse.",
        "<strong>Le vol (passe ou joue)</strong> : lorsqu'une famille a commis 3 fautes, l'équipe adverse dispose d'UNE seule proposition pour tenter de « voler » la manche. Si sa réponse figure parmi les cases encore cachées, elle rafle TOUS les points accumulés dans la manche ; sinon, les points reviennent à la famille qui jouait.",
        "<strong>Multiplicateurs</strong> : certaines manches comptent les points multipliés pour accélérer la course. Version moderne / jeu de société : la dernière (4e) manche compte ×3, les autres en ×1. Version 1990s : manche 4 = ×2, manche 5 = ×3.",
      ],
      tips: [
        "Annoncez clairement le nombre de réponses attendues au tableau avant que la famille ne commence à jouer.",
        "Rappelez le multiplicateur en cours d'annonce de la manche (×1, ×2 ou ×3) pour entretenir le suspense.",
        "Comptez les X à voix haute pour que le public suive la progression vers le changement de main.",
      ],
    },
    {
      icon: '🔔',
      title: 'Le face-à-face (buzzer de début de manche)',
      paragraphs: [
        "Au début de chaque manche, un représentant de chaque famille s'avance au buzzer (« phase de rapidité »). L'animateur pose la question et le plus rapide au buzzer donne une réponse.",
        "Si sa réponse est la PREMIÈRE / la plus citée du tableau (la « Top réponse »), sa famille prend directement la main. Si sa réponse figure dans le tableau mais sans être la première, l'adversaire au buzzer peut à son tour proposer une réponse : celui dont la réponse est la mieux placée (la plus citée) gagne la main pour sa famille. Si la réponse n'est pas dans le tableau, l'adversaire propose une réponse pour tenter de prendre la main.",
        "La famille qui remporte le face-à-face choisit alors de JOUER la manche (énumérer les réponses) ou de PASSER la main à l'adversaire.",
        "Dans le jeu de société, des cartes « Duels » (questions bonus annexes) interviennent après les 2e et 3e manches.",
      ],
      steps: [
        'Un représentant de chaque famille se place au buzzer.',
        "L'animateur pose la question ; le plus rapide buzze et répond.",
        'On compare la place de la réponse dans le tableau pour déterminer quelle famille gagne la main.',
        'La famille gagnante choisit : jouer la manche ou passer la main.',
      ],
      tips: [
        "Ne validez la réponse au buzzer qu'après avoir vérifié sa position exacte dans le classement.",
        "Laissez un court instant de suspense avant d'annoncer qui prend la main.",
      ],
    },
    {
      icon: '🏆',
      title: 'La manche finale',
      paragraphs: [
        "La famille gagnante désigne 2 de ses membres comme finalistes. Ils répondront aux <strong>mêmes questions</strong> (5 dans la version télé, configurable ici), l'un après l'autre, le second étant isolé pendant le passage du premier.",
        "<strong>Temps imparti</strong> (valeur configurable) : version télé moderne 2007-2014, 1er finaliste moins de 20 secondes, 2e finaliste moins de 25 secondes. Le 2e dispose d'un peu plus de temps car il doit éviter les doublons. Variantes : 15 s / 20 s en version 1990s ; sablier unique de 45 secondes dans le jeu de société.",
        "<strong>Règle du doublon</strong> : pendant le passage du 1er finaliste, le 2e est isolé (cabine / coulisses) et n'entend pas ses réponses. Quand le 2e joue, il ne peut PAS donner une réponse déjà énoncée par le premier. S'il répète une réponse identique, l'animateur le signale (buzzer / alerte « réponse déjà donnée ») et lui demande IMMÉDIATEMENT une autre réponse ; la réponse en doublon rapporte 0 point.",
        "<strong>Objectif</strong> (configurable, <b>target</b>) : atteindre ou dépasser <strong>200 points</strong> au cumul des deux finalistes pour remporter le gros lot. C'est le seuil de référence de la version télé 2007-2014 et du jeu de société officiel TF1 Games. À ne pas confondre avec les 300 points, qui étaient l'objectif de QUALIFICATION pour accéder à la finale dans la version 1990-1999.",
        "<strong>Comment on gagne</strong> : on additionne les points sondage des réponses valides des deux finalistes (doublons = 0). Si le total atteint ou dépasse l'objectif, la famille remporte le gros lot ; sinon, elle repart avec un gain moindre.",
      ],
      steps: [
        'La famille gagnante désigne ses 2 finalistes.',
        'Le 1er finaliste reste au centre du plateau ; le 2e est isolé en coulisses pour ne rien entendre.',
        "L'animateur pose les questions au 1er finaliste dans le temps imparti ; il répond vite et peut « passer » une question pour y revenir s'il reste du temps.",
        'On révèle les réponses du 1er finaliste et leurs points, puis on les MASQUE.',
        'Le 2e finaliste revient et répond aux mêmes questions, avec un temps un peu plus long.',
        "S'il répète une réponse déjà donnée, le doublon est signalé (0 point) et on lui redemande aussitôt une autre réponse.",
        'On additionne les points des deux finalistes.',
        "Si le cumul atteint ou dépasse l'objectif (200 points par défaut), la famille remporte le gros lot ; sinon, gain réduit.",
      ],
      tips: [
        "Vérifiez bien l'isolement du 2e finaliste avant de lancer la première série de questions.",
        'Masquez les points du 1er finaliste avant de faire revenir le 2e, mais gardez ses réponses notées en régie pour détecter les doublons.',
        'Soyez réactif sur le signal de doublon et relancez immédiatement le finaliste pour ne pas lui faire perdre de temps.',
        'Rappelez le total cumulé et le nombre de points restants avant la révélation finale pour maximiser le suspense.',
      ],
    },
    {
      icon: '🧮',
      title: 'Comment compter les points (côté régie)',
      paragraphs: [
        "Chaque réponse vaut le nombre de personnes (sur 100 sondées) l'ayant citée : si 28 personnes ont donné la réponse, elle vaut 28 points.",
        'En manche normale, additionnez les points des réponses découvertes, puis appliquez le multiplicateur de la manche (×1, ×2 ou ×3). En cas de vol réussi, transférez la totalité des points de la manche à la famille adverse.',
        'En finale, additionnez les points sondage des réponses valides des DEUX finalistes. Les réponses en doublon valent 0 point. Comparez le cumul à l\'objectif (200 points par défaut, <b>target</b> configurable).',
        "Dans l'application : le bouton « Donner la cagnotte » applique automatiquement le multiplicateur, et la barre de progression de la finale compare le total à l'objectif en temps réel.",
      ],
      tips: [
        'Notez secrètement les réponses du 1er finaliste pour pouvoir vérifier les doublons du 2e sans hésitation.',
        'Affichez puis masquez les points du 1er finaliste : ils restent visibles en régie mais cachés au public et au 2e finaliste.',
        "Vérifiez le total cumulé deux fois avant d'annoncer le résultat de la finale.",
      ],
    },
  ],
};
