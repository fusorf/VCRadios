// Génère une page HTML 512x512 par station : fond noir, quadrilatère fixe
// (graine = clé) rempli de la texture camouflage, logo centré par-dessus.
const fs = require('fs'), path = require('path');
const [root, outDir] = process.argv.slice(2);
const st = {
  EMOTION: 'Emotion98.3-GTAVC-Logo.webp', ESPANT: 'RadioEspantoso-GTAVC-Logo.webp', FEVER: 'Fever_105.webp',
  FLASH: 'FlashFM.webp', KCHAT: 'KChat-GTAVC-Logo.webp', VCPR: 'ViceCityPublicRadio-GTAVC-Logo.svg',
  VROCK: 'V-Rock-GTAVC-Logo.svg', WAVE: 'Wave103-GTAVC-Logo.svg', WILD: 'WildstylePirateRadio.webp'
};
const url = (p) => 'file:///' + path.join(root, p).split(path.sep).join('/');
for (const [key, logo] of Object.entries(st)) {
  let h = 0; for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const rnd = () => { h = (h * 1103515245 + 12345) >>> 0; return (h >>> 8) / 16777216; };
  const r = () => (3 + rnd() * 10).toFixed(1); // coins 3 à 13 % vers l'intérieur
  const poly = `polygon(${r()}% ${r()}%, ${100 - r()}% ${r()}%, ${100 - r()}% ${100 - r()}%, ${r()}% ${100 - r()}%)`;
  const bx = Math.round(rnd() * 600), by = Math.round(rnd() * 600); // cadrage de texture varié
  fs.writeFileSync(path.join(outDir, key + '.html'), `<!doctype html><html><head><style>
html,body{margin:0;width:512px;height:512px;background:#000;overflow:hidden}
.t{position:absolute;inset:0;background:#46414f url('${url('logos/background.webp')}') ${bx}px ${by}px;background-size:860px;clip-path:${poly};display:flex;align-items:center;justify-content:center}
img{width:76%;height:66%;object-fit:contain}
</style></head><body><div class="t"><img src="${url('logos/' + logo)}"></div></body></html>`);
}
