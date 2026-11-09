'use strict';

/**
 * Politica di navigazione: decide cosa resta dentro Outlinux e cosa va
 * consegnato al browser di sistema. Nessuna dipendenza da Electron, così la
 * logica è verificabile da sola.
 */

// Domini che restano dentro l'applicazione (Outlook + catena Microsoft).
const INTERNAL_HOSTS = [
  'outlook.office.com',
  'outlook.office365.com',
  'outlook.live.com',
  'outlook.com',
  'office.com',
  'office365.com',
  'microsoft365.com',
  'cloud.microsoft',
  'microsoftonline.com',
  'microsoftonline-p.com',
  'microsoftazuread-sso.com',
  'microsoft.com',
  'live.com',
  'msauth.net',
  'msftauth.net',
  'msocdn.com',
  'office.net',
  'sharepoint.com',
  'onedrive.com',
  'windows.net',
  'skype.com',
  'teams.microsoft.com'
];

/**
 * L'accesso a un account aziendale può passare per domini che non sono di
 * Microsoft: ADFS ospitato dall'azienda (fs.azienda.it), provider MFA, portali
 * SSO. Se li mandassimo al browser di sistema l'autenticazione proseguirebbe lì
 * — e siccome il browser ha già la sessione di Outlook Web, si porterebbe via il
 * focus lasciando l'app ferma alla schermata di accesso.
 */
const AUTH_HOST_PREFIXES = [
  'login.',
  'logon.',
  'signin.',
  'sso.',
  'sts.',
  'adfs.',
  'fs.',
  'auth.',
  'idp.',
  'mfa.',
  'oauth.'
];

const AUTH_PROVIDER_HOSTS = [
  'okta.com',
  'oktapreview.com',
  'duosecurity.com',
  'pingidentity.com',
  'pingone.com',
  'onelogin.com',
  'auth0.com',
  'jumpcloud.com',
  'safenetid.com',
  'entrust.net',
  'yubico.com'
];

// Indizi nel percorso: usati solo per capire se il *flusso in corso* è un
// accesso, mai per decidere che un link qualsiasi sia affidabile.
const AUTH_PATH_HINTS = ['/oauth2/', '/authorize', '/saml', '/adfs/', '/wsfed', '/federation', '/signin', '/login'];

// Schemi che ha senso passare a xdg-open. Tutto il resto (data:, javascript:,
// blob: orfani) al browser non direbbe nulla: si apre una scheda vuota.
const EXTERNAL_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:', 'callto:', 'sms:', 'webcal:'];

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function schemeOf(url) {
  try {
    return new URL(url).protocol.toLowerCase();
  } catch {
    return '';
  }
}

function isInternalUrl(url) {
  const host = hostOf(url);
  if (!host) return false;
  return INTERNAL_HOSTS.some((base) => host === base || host.endsWith('.' + base));
}

/** L'URL somiglia a un endpoint di autenticazione (ADFS, SSO aziendale, MFA). */
function isAuthUrl(url) {
  const host = hostOf(url);
  if (!host) return false;
  if (AUTH_PROVIDER_HOSTS.some((base) => host === base || host.endsWith('.' + base))) return true;
  return AUTH_HOST_PREFIXES.some((prefix) => host.startsWith(prefix));
}

/** La pagina da cui parte la navigazione fa già parte di un flusso di accesso. */
function isAuthFlowInProgress(currentUrl) {
  if (!currentUrl) return false;
  if (isAuthUrl(currentUrl)) return true;
  if (!isInternalUrl(currentUrl)) return false;
  let path;
  try {
    path = new URL(currentUrl).pathname.toLowerCase();
  } catch {
    return false;
  }
  return AUTH_PATH_HINTS.some((hint) => path.includes(hint));
}

/**
 * Finestre che la pagina che le apre riempie da sola.
 *
 * Outlook usa questo schema per "Rispondi", "Rispondi a tutti" e "Apri in una
 * nuova finestra", soprattutto dal calendario: apre `window.open('about:blank')`
 * e poi ci scrive dentro da JavaScript (oppure le assegna l'indirizzo vero
 * qualche istante dopo). Sono URL senza host: non sono interni, ma non sono
 * nemmeno link da consegnare al browser — lì si aprirebbe solo una scheda
 * vuota, e in Outlook `window.open` tornerebbe `null` lasciando la risposta
 * senza finestra. Devono restare dentro l'app.
 */
function isOpenerControlledUrl(url) {
  if (!url) return true;
  const scheme = schemeOf(url);
  return scheme === 'about:' || scheme === 'blob:';
}

/** Ha senso passare questo URL al browser di sistema? */
function canOpenExternally(url) {
  return EXTERNAL_SCHEMES.includes(schemeOf(url));
}

/**
 * Una navigazione resta nell'app se punta a Outlook, se è un endpoint di
 * autenticazione, se stiamo già attraversando un flusso di accesso o se è una
 * finestra che Outlook riempirà da sé: in tutti gli altri casi è un link che
 * l'utente vuole aprire nel proprio browser.
 */
function shouldOpenInApp(url, currentUrl) {
  return isOpenerControlledUrl(url) || isInternalUrl(url) || isAuthUrl(url) || isAuthFlowInProgress(currentUrl);
}

module.exports = {
  INTERNAL_HOSTS,
  AUTH_PROVIDER_HOSTS,
  AUTH_PATH_HINTS,
  hostOf,
  schemeOf,
  isInternalUrl,
  isAuthUrl,
  isAuthFlowInProgress,
  isOpenerControlledUrl,
  canOpenExternally,
  shouldOpenInApp
};
