# Cursor Maze

Un petit jeu web où **le personnage est littéralement le curseur de la souris**.
Chaque partie génère un labyrinthe parfait ; il faut rejoindre la sortie sans
toucher les murs et sans croiser les points rouges.

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
```

## Contrôles

| Action | Commande |
| --- | --- |
| Se déplacer | Souris (le curseur est le personnage) |
| Commencer / niveau suivant / réessayer | Clic, `Espace` ou `Entrée` |
| Pause | `Échap` ou `P` (ou bouton HUD) |
| Recommencer | `R` (ou bouton HUD) |
| Couper le son | `M` (ou bouton HUD, mémorisé dans `localStorage`) |

Le jeu est pensé pour un écran desktop avec une souris.

## Règles

- 3 cœurs. Toucher un mur coûte **un seul** cœur par contact, suivi d'environ
  une seconde d'invulnérabilité. Le contact ne se réarme qu'après être revenu
  dans un couloir, donc rester immobile dans un mur ne vide pas les cœurs.
- Toucher un ennemi termine immédiatement la partie.
- Sortir par la case turquoise en bas à droite déclenche la victoire.
- À 0 cœur ou après un ennemi, « Réessayer » régénère un labyrinthe et remet
  3 cœurs ; le compteur de tentatives s'incrémente.
- Le nombre d'ennemis vaut `2 + floor(niveau / 2)`, plafonné à 6. Ils
  patrouillent le graphe du labyrinthe sans traverser de mur et n'apparaissent
  jamais sur la sortie ni à moins de deux cellules du départ.
- Sortir le pointeur du plateau ne cause aucun dégât.

## Architecture

```
src/
  app/
    layout.tsx        métadonnées, lang, CSS global
    page.tsx          point d'entrée (rend le composant client)
    globals.css       thème sombre, HUD, overlays, boutons
    icon.svg          favicon
  components/
    GameClient.tsx    état React du HUD, boucle rAF, pointeur, overlays
    Icons.tsx         icônes SVG inline (aucune dépendance)
  lib/
    maze.ts           génération (recursive backtracker), graphe, BFS
    collision.ts      murs en coordonnées unitaires, cercle / rectangle
    enemies.ts        spawn et déplacement le long des couloirs
    game.ts           machine à états : cœurs, invulnérabilité, victoire/défaite
    sound.ts          synthèse Web Audio (oscillateurs + bruit filtré)
    render.ts         pré-rendu du labyrinthe + rendu canvas par frame
    format.ts         formatage du chrono
```

Séparation volontaire :

- **`maze.ts`, `collision.ts`, `enemies.ts` et `game.ts` ne dépendent ni de
  React ni du DOM** : ce sont des modules purs, testables en Node.
- `GameClient` ne fait que mesurer le plateau, transmettre la position du
  pointeur, appeler `game.tick(dt)` dans une unique boucle
  `requestAnimationFrame` et afficher le HUD. Tous les listeners, l'AudioContext
  et la boucle sont nettoyés au démontage.
- `render.ts` garde un calque hors écran du labyrinthe (mis en cache par maze)
  et ne redessine que les éléments dynamiques : halo de sortie, ennemis,
  curseur, vignette de dégâts.

### Détails de gameplay

- Le labyrinthe est généré sur une grille impaire avec un recursive backtracker
  itératif : toutes les cellules sont reliées, donc la sortie est toujours
  atteignable (vérifiable par BFS avec `distanceField`).
- La taille de cellule et le nombre de colonnes/lignes sont calculés à partir
  du viewport (cellule ~64 px, minimum 56 px sur un écran desktop) : le
  labyrinthe remplit l'espace disponible sans scroll.
- Les collisions utilisent un rayon de 8 px autour du pointeur et des murs
  épais de 14 % d'une cellule ; seuls les murs du voisinage 3×3 sont testés.
- Les ennemis se déplacent de centre de cellule en centre de cellule à
  70–110 px/s et choisissent un voisin ouvert, sans revenir en arrière sauf
  dans un cul-de-sac.
- Les sons sont courts et distincts : démarrage, impact de mur, perte de cœur,
  ennemi, victoire (arpège), défaite, clic UI. `prefers-reduced-motion` coupe
  les pulsations et clignotements.
