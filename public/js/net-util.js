/* ------------------------------------------------------------------ *
 *  Utilitaire réseau partagé (régie + écran de jeu).
 * ------------------------------------------------------------------ */

/**
 * URL que les téléphones doivent ouvrir pour les buzzers.
 * Sur localhost (page ouverte sur le PC hôte), « localhost » est inutilisable par
 * les mobiles → on prend l'IP LAN détectée par le serveur (state.lanUrl). Sinon
 * (IP LAN ou domaine public en ligne), l'origine de la page convient déjà.
 */
function buzzerBase(s) {
  const h = location.hostname;
  const isLocal = h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '';
  return (isLocal && s && s.lanUrl ? s.lanUrl : location.origin).replace(/\/+$/, '');
}
