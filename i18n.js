// ---------------------------------------------------------------------------
// Internationalisation. Anglais par défaut ; français si la langue du
// navigateur (qui suit celle de l'OS) est le français. Chargé avant app.js
// et offline.js : scripts classiques, LANG et T sont partagés via
// l'environnement lexical global. Les textes du HTML sont en anglais
// (langue par défaut) et réécrits ici au chargement si besoin.
// ---------------------------------------------------------------------------

const I18N = {
  en: {
    chooseStation: 'Choose your station',
    backTitle: 'Back to selection',
    pauseTitle: 'Turn the radio off',
    offlineTitle: 'Offline listening',
    closeTitle: 'Close',
    hint: 'Keep the app open while downloading',
    downloadAll: 'Download all',
    cancel: 'Cancel',
    deleteAll: 'Delete all',
    confirm: 'Confirm?',
    streamingOnly: 'Streaming only',
    queued: 'Waiting…',
    offlineLabel: 'Offline',
    offlineLower: 'offline',
    storageFull: 'Storage full',
    downloadFailed: 'Download failed',
    noConnection: 'No connection',
    noneDownloaded: 'No station downloaded',
    free: 'free',
    mb: 'MB',
    gb: 'GB',
    decimal: '.',
    pct: (p) => p + '%'
  },
  fr: {
    chooseStation: 'Choisis ta station',
    backTitle: 'Retour à la sélection',
    pauseTitle: 'Couper la radio',
    offlineTitle: 'Écoute hors ligne',
    closeTitle: 'Fermer',
    hint: 'Garde l\'app ouverte pendant le téléchargement',
    downloadAll: 'Tout télécharger',
    cancel: 'Annuler',
    deleteAll: 'Tout supprimer',
    confirm: 'Confirmer ?',
    streamingOnly: 'Streaming seul',
    queued: 'En attente…',
    offlineLabel: 'Hors ligne',
    offlineLower: 'hors ligne',
    storageFull: 'Stockage plein',
    downloadFailed: 'Échec du téléchargement',
    noConnection: 'Hors connexion',
    noneDownloaded: 'Aucune station téléchargée',
    free: 'libres',
    mb: 'Mo',
    gb: 'Go',
    decimal: ',',
    pct: (p) => p + ' %'
  }
};

const LANG = /^fr/i.test(navigator.language || '') ? 'fr' : 'en';
const T = I18N[LANG];

// Textes statiques du DOM (les .txt-marble dupliquent leur texte dans
// data-text pour l'ombre portée du ::before)
{
  document.documentElement.lang = LANG;

  const marble = (el, text) => {
    el.textContent = text;
    el.dataset.text = text;
  };
  marble(document.querySelector('.picker-title'), T.chooseStation);
  marble(document.querySelector('.offline-title'), T.offlineTitle);

  document.getElementById('backButton').title = T.backTitle;
  document.getElementById('pauseButton').title = T.pauseTitle;
  document.getElementById('offlineButton').title = T.offlineTitle;
  document.getElementById('offlineClose').title = T.closeTitle;
  document.getElementById('offlineHint').textContent = T.hint;
  document.getElementById('offlineDlAll').textContent = T.downloadAll;
  document.getElementById('offlinePurgeAll').textContent = T.deleteAll;
}
