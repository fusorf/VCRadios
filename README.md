# VCRadios

Les radios de GTA Vice City en PWA : chaque station « émet en continu » (position
calculée sur une horloge murale commune, persistée entre les sessions), avec
bruit de static au changement, comme en jeu.

## Dev local

```
node dev-server.js
```

puis ouvrir http://localhost:8080.

⚠️ Ne pas tester avec `python -m http.server` ni Live Server : ils ne gèrent
pas les requêtes Range, or seeker dans un MP3 d'1h en dépend — la lecture
partirait d'un moment aléatoire au lieu de la position « live ».
