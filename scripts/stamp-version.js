// Tamponne le numéro de build (date + heure, heure de Paris) avant une release :
// - version.js : affiché discrètement en bas à gauche de l'app ;
// - pwabuilder-adv-sw.js : CACHE_VERSION = même numéro, donc chaque release
//   modifie le SW → mise à jour du précache chez tous les utilisateurs.
// Usage : node scripts/stamp-version.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const parts = Object.fromEntries(
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date()).map(p => [p.type, p.value])
);
const version = `${parts.year}.${parts.month}.${parts.day}-${parts.hour}${parts.minute}`;

fs.writeFileSync(path.join(ROOT, 'version.js'),
`// Généré par scripts/stamp-version.js — ne pas éditer à la main.
// Numéro de build de débug = date et heure du build (heure de Paris).
const BUILD_VERSION = '${version}';
{
  const el = document.getElementById('buildVersion');
  if (el) el.textContent = 'build ' + BUILD_VERSION;
}
`);

const swPath = path.join(ROOT, 'pwabuilder-adv-sw.js');
const sw = fs.readFileSync(swPath, 'utf8');
const stamped = sw.replace(/const CACHE_VERSION = '[^']*';/, `const CACHE_VERSION = '${version}';`);
if (stamped === sw && !sw.includes(`'${version}'`)) {
  console.error('CACHE_VERSION introuvable dans pwabuilder-adv-sw.js');
  process.exit(1);
}
fs.writeFileSync(swPath, stamped);

console.log('build ' + version);
