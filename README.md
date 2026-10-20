# Cursor Maze

Un petit jeu web où **le curseur guide un avatar** dans un labyrinthe.
Chaque partie génère un labyrinthe parfait ; il faut rejoindre la sortie sans
toucher les murs et sans croiser les points rouges. Le curseur système reste
libre, mais l'avatar ne traverse jamais un mur.

Next.js (App Router) + TypeScript + React. Aucune librairie de jeu, d'UI ou
d'audio : le rendu est fait sur un `<canvas>` et le son est synthétisé en temps
réel avec la Web Audio API. Aucun fichier audio dans le projet.

## Lancer

Prérequis : Node.js 22+ et npm 10+.

```bash
npm install
npm run dev
```

Ouvrir <http://localhost:3000>. Pour une vérification de production :

```bash
npm run build
npm start
```

Autres scripts :

```bash
npm run lint       # ESLint (config Next.js)
npm run typecheck  # tsc --noEmit
npm test           # tests logique headless (node:assert + tsc)
```

## Contrôles

| Action | Commande |
| --- | --- |
| Guider l'avatar | Souris |
| Commencer / niveau suivant / réessayer | Clic, `Espace` ou `Entrée` |
| Lancer le chrono | Poser le curseur sur le marqueur de départ |
| Pause | `Échap` ou `P` (ou bouton HUD) |
| Recommencer | `R` (ou bouton HUD) |
| Couper le son | `M` (ou bouton HUD, mémorisé dans `localStorage`) |

Le jeu est pensé pour un écran desktop avec une souris.

## Règles

- Après « Commencer », le jeu passe en phase **prête** : le chrono reste à
  zéro tant que le curseur n'est pas dans la cellule de départ. Il en va de
  même après « Réessayer » et « Niveau suivant ».
- L'avatar poursuit le curseur (900 px/s) et reste bloqué par les murs, même
  pendant l'invulnérabilité : impossible de gagner en traversant un mur. Il
  glisse le long des murs quand le pas direct est bloqué et colle au curseur
  à moins de 3 px dans le même couloir.
- **Conduite manuelle assumée** : l'avatar suit une ligne directe vers le
  curseur, sans pathfinding ni assistance. Pointer la sortie à travers un mur
  ne suffit donc pas : il faut le guider virage par virage. Se bloquer dans un
  angle tant que le curseur est de l'autre côté du mur est intentionnel.
- 3 cœurs. Toucher un mur coûte **un seul** cœur par contact, suivi d'environ
  une seconde d'invulnérabilité. Le contact ne se réarme qu'après être revenu
  dans un couloir, donc rester immobile dans un mur ne vide pas les cœurs.
- Grâce de spawn : pendant la première seconde et tant que l'avatar n'a pas
  atteint un couloir, aucun dégât de mur n'est possible. C'est vrai au
  démarrage comme après « Réessayer » ou un niveau suivant.
- Toucher un ennemi termine immédiatement la partie.
- Sortir par la case turquoise en bas à droite déclenche la victoire.
- À 0 cœur ou après un ennemi, « Réessayer » régénère un labyrinthe et remet
  3 cœurs ; le compteur de tentatives s'incrémente.
- Le nombre d'ennemis vaut `2 + floor(niveau / 2)`, plafonné à 6. Ils
  patrouillent le graphe du labyrinthe sans traverser de mur et n'apparaissent
  jamais sur la sortie ni à moins de deux cellules du départ.
- Sortir le curseur du plateau pendant une partie met le jeu en pause
  immédiatement (motif « curseur hors du plateau »). Le chrono et
  l'invulnérabilité sont figés ; on reprend uniquement avec « Reprendre » ou
  `Échap`, jamais automatiquement. La reprise n'est acceptée que si le curseur
  est revenu dans le plateau ; sinon le jeu reste en pause.

## Architecture

```
src/
  app/
    layout.tsx        métadonnées, lang, CSS global
    page.tsx          point d'entrée (rend le composant client)
    globals.css       thème sombre, HUD, overlays, boutons
    icon.svg          favicon
  components/
    GameClient.tsx    état React du HUD, boucle rAF, cible pointeur, overlays
    Icons.tsx         icônes SVG inline (aucune dépendance)
  lib/
    maze.ts           génération (recursive backtracker), graphe, BFS
    collision.ts      murs en coordonnées unitaires, cercle / rectangle
    enemies.ts        spawn et déplacement le long des couloirs
    game.ts           avatar, phases (ready/pause), cœurs, invulnérabilité
    sound.ts          synthèse Web Audio (oscillateurs + bruit filtré)
    render.ts         pré-rendu du labyrinthe + rendu canvas par frame
    format.ts         formatage du chrono
tests/
    game.test.ts      avatar/murs, glissement, phase ready, pause auto, régressions
```

Séparation volontaire :

- **`maze.ts`, `collision.ts`, `enemies.ts` et `game.ts` ne dépendent ni de
  React ni du DOM** : ce sont des modules purs, testables en Node.
- `GameClient` ne fait que mesurer le plateau, transmettre la cible du
  pointeur, appeler `game.tick(dt)` dans une unique boucle
  `requestAnimationFrame` et afficher le HUD. Tous les listeners, l'AudioContext
  et la boucle sont nettoyés au démontage.
- `render.ts` garde un calque hors écran du labyrinthe (mis en cache par maze)
  et ne redessine que les éléments dynamiques : halo de sortie, marqueur de
  départ, ennemis, avatar, réticule du curseur, vignette de dégâts.

### Détails de gameplay

- Le labyrinthe est généré sur une grille impaire avec un recursive backtracker
  itératif : toutes les cellules sont reliées, donc la sortie est toujours
  atteignable (vérifiable par BFS avec `distanceField`).
- La taille de cellule et le nombre de colonnes/lignes sont calculés à partir
  du viewport (cellule ~64 px, minimum 56 px) : les dimensions sont réduites
  jusqu'à tenir ce minimum, avec un plancher absolu de 7×5. Le labyrinthe
  remplit l'espace disponible sans scroll.
- Le chrono suit l'horloge réelle par pas de 200 ms (plafond 250 ms pour
  ignorer un retour d'onglet) et ne compte pas les pauses. La simulation des
  ennemis garde un pas plafonné à 48 ms pour rester stable.
- Les collisions utilisent un corps de 8 px autour de l'avatar et des murs
  épais de 14 % d'une cellule ; seuls les murs du voisinage 3×3 sont testés.
  Le déplacement est découpé en sous-pas de 4 px maximum (rayon / 2) pour
  interdire tout tunneling à 900 px/s. Un pas bloqué en diagonale est retenté
  axe par axe (glissement), et l'avatar s'arrête si les deux axes sont bloqués.
  Une sonde de 4 px autour du corps détecte le frôlement et applique le
  contact de mur, avec le verrou « un cœur par contact » existant.
- Les ennemis se déplacent de centre de cellule en centre de cellule à
  70–110 px/s et choisissent un voisin ouvert, sans revenir en arrière sauf
  dans un cul-de-sac.
- Les sons sont courts et distincts : démarrage, impact de mur, perte de cœur,
  ennemi, victoire (arpège), défaite, clic UI. `prefers-reduced-motion` coupe
  les pulsations et clignotements.
