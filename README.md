# Outlinux

Wrapper desktop di **Outlook sul web** per Linux, costruito con Electron.
Non è un'applicazione ufficiale Microsoft: incapsula `outlook.office.com`
(o `outlook.live.com`) in una finestra nativa con tray, notifiche, badge dei
messaggi non letti e gestione dei link `mailto:`.

## Funzionalità

- Sessione persistente: l'accesso viene ricordato tra un avvio e l'altro.
- Icona nella tray con conteggio dei non letti, chiusura/riduzione nella tray.
- Badge sul launcher (`app.setBadgeCount`) e conteggio nel titolo della finestra.
- Notifiche desktop native (permesso concesso automaticamente al dominio Outlook).
- I link esterni si aprono nel browser di sistema; l'intero flusso di accesso
  resta nell'app, anche quando passa per ADFS aziendale, SSO o provider MFA.
- Gestore di `mailto:` — apre direttamente la finestra di composizione.
- Scorciatoie per Posta (`Ctrl+1`), Calendario (`Ctrl+2`), Contatti (`Ctrl+3`),
  nuovo messaggio (`Ctrl+N`), zoom (`Ctrl+±/0`), ricarica (`Ctrl+R`).
- Credenziali di dominio ricordabili, cifrate nel portachiavi di sistema.
- Correttore ortografico multilingua (italiano + inglese di default).
- Menu contestuale nativo con suggerimenti ortografici e azioni sui link.
- User agent Chrome "pulito": Outlook Web non riconosce Electron e serve
  l'interfaccia completa.

## Requisiti

- Node.js 18+ e npm
- Per rigenerare le icone: `librsvg` (`rsvg-convert`)

## Sviluppo

```bash
npm install
npm start          # avvia l'app
npm run dev        # avvia con DevTools aperti
npm run lint       # ESLint: intercetta riferimenti a identificatori inesistenti
npm run smoke      # avvia l'app e verifica caricamento + assenza di eccezioni
npm run popup-test # verifica dove finiscono popup e link (non serve rete)
```

`popup-test` intercetta le richieste https e serve una pagina finta, quindi gira
senza rete e senza account, su impostazioni temporanee. Controlla che i pop-out
di Outlook — "Rispondi", "Rispondi a tutti", le finestre aperte con
`window.open('about:blank')` e riempite da JavaScript — restino dentro l'app, e
che i link veri vadano invece al browser di sistema.

Se `npm install` non riesce a scaricare il binario di Electron da GitHub (rete
filtrata, proxy aziendale), ci sono tre strade:

```bash
# 1) mirror alternativo
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install

# 2) usare l'Electron di sistema (pacchetto `electron` della distribuzione)
npm run start:system

# 3) scaricare lo zip a mano nella cache di @electron/get, che è indicizzata
#    per sha256 dell'URL della directory di download
node -e "const c=require('crypto'),p=require('path');const u=new URL(process.argv[1]);
  u.hash='';u.search='';u.pathname=p.posix.dirname(u.pathname);
  console.log(c.createHash('sha256').update(u.toString()).digest('hex'))" \
  https://github.com/electron/electron/releases/download/v44.4.3/electron-v44.4.3-linux-x64.zip
# poi: curl -L <url> -o ~/.cache/electron/<hash>/electron-v44.4.3-linux-x64.zip
#      node node_modules/electron/install.js
```

Il downloader di Electron usa `fetch`, che **ignora** le variabili `HTTP_PROXY`:
dietro un proxy la terza strada è spesso l'unica che funziona.

## Pacchettizzazione

```bash
npm run dist            # AppImage + .deb in dist/
npm run dist:appimage   # solo AppImage
npm run dist:deb        # solo .deb
npm run dist:rpm        # solo .rpm (richiede rpmbuild: su Arch `sudo pacman -S rpm-tools`)
npm run dist:dir        # build non impacchettata (dist/linux-unpacked)
```

Su Arch il target `.deb` richiede `libxcrypt-compat`: il `fpm` incluso in
electron-builder usa un Ruby 2.3 collegato a `libcrypt.so.1`.

```bash
sudo pacman -S libxcrypt-compat   # necessario per npm run dist:deb
```

Prima di distribuire i pacchetti, sostituisci in `package.json` i campi
`author`, `homepage` e `build.linux.maintainer` con i tuoi dati reali:
`homepage` al momento è un segnaposto.

Per far riconoscere `mailto:` al sistema dopo l'installazione:

```bash
xdg-settings set default-url-scheme-handler mailto outlinux.desktop
```

## Installazione

### A livello utente (nessun permesso di root)

```bash
APP=~/.local/lib/outlinux
mkdir -p $APP ~/.local/bin ~/.local/share/applications
cp -r src assets package.json $APP/
cp aur/outlinux.sh ~/.local/bin/outlinux   # e sostituisci _APP_DIR con $APP
chmod +x ~/.local/bin/outlinux
sed "s|^Exec=outlinux %U$|Exec=$HOME/.local/bin/outlinux %U|" outlinux.desktop \
  > ~/.local/share/applications/outlinux.desktop
for s in 16 24 32 48 64 128 256 512; do
  install -Dm644 build/icons/${s}x${s}.png ~/.local/share/icons/hicolor/${s}x${s}/apps/outlinux.png
done
update-desktop-database ~/.local/share/applications
```

Usa l'Electron di sistema (pacchetto `electron`), quindi occupa ~200 KB.

### Su Arch Linux (AUR)

Nella cartella `aur/` c'è un `PKGBUILD` che usa l'Electron di sistema (pacchetto
`electron`), quindi il pacchetto pesa ~87 KB invece di ~100 MB:

```bash
cd aur && makepkg -si
```

Istruzioni per pubblicarlo sull'AUR: `aur/README.md`.

## Configurazione

Le impostazioni si modificano dal menu **Impostazioni** e vengono salvate in
`~/.config/Outlinux/settings.json`:

| Chiave | Valori | Descrizione |
| --- | --- | --- |
| `service` | `office` \| `live` | Account di lavoro/scuola o personale |
| `customUrl` | URL | Sovrascrive `service` (es. Exchange on-premise) |
| `startPage` | `mail` \| `calendar` \| `people` | Sezione all'avvio |
| `minimizeToTray` / `closeToTray` | bool | Comportamento della finestra |
| `startMinimized` | bool | Avvio in background |
| `showTrayIcon` | bool | Icona nella tray |
| `spellCheckLanguages` | array | Es. `["it", "en-US"]` |
| `hardwareAcceleration` | bool | Disattivala in caso di artefatti grafici |
| `displayBackend` | `auto` \| `x11` | `auto` usa Wayland nativo quando disponibile |
| `gpuCompositing` | bool | Disattivato in automatico se il processo GPU crasha |
| `authServerAllowlist` | stringa | Domini per l'autenticazione integrata (es. `fs.azienda.it`) |
| `forceScaleFactor` | numero | `0` = automatica; forza la scala solo sotto X11 |
| `zoomFactor` | numero | Livello di zoom persistente |

I dati di sessione (cookie, cache) stanno in `~/.config/Outlinux`. Per un logout
completo è sufficiente eliminare quella cartella.

## Schermi HiDPI e scaling

Sotto XWayland Chromium non conosce il fattore di scala del compositor: su un
monitor con scaling frazionario (es. 1.5) l'interfaccia di Outlook viene disegnata
a 1x e risulta minuscola. Outlinux evita il problema avviandosi con il backend
**Wayland nativo** (`--ozone-platform=wayland`), che applica la scala corretta,
anche frazionaria.

Il flag deve essere presente sulla riga di comando — Chromium lo legge prima che
il processo principale possa impostarlo — quindi:

- `npm start` lo aggiunge tramite `scripts/start.js`;
- l'app impacchettata, se lanciata senza flag, si riavvia una volta con il flag
  corretto (`ensureNativeWayland()` in `src/main.js`).

Dal menu **Impostazioni › Schermo** si può tornare a X11/XWayland o forzare una
scala fissa (utile solo sotto X11). Per diagnosticare:

```bash
OUTLINUX_DEBUG=1 npm start
# [outlinux] argv: … --ozone-platform=wayland | scaleFactor: 1.4997… | display: 1707x1067
```

Se la scala risulta `1` su uno schermo HiDPI, l'app sta girando sotto XWayland.

### Crash del processo GPU

Su alcune combinazioni di driver e compositor — tipicamente portatili ibridi
AMD + NVIDIA sotto Wayland con versioni di Electron più vecchie della 40 — il
processo GPU di Chromium crasha di continuo (`gbm_pixmap_wayland: Cannot create
bo …`) fino a terminare l'app con `GPU process isn't usable. Goodbye.`.

Outlinux se ne accorge da solo: dopo 3 crash imposta `gpuCompositing: false` e si
riavvia, disattivando il compositing GPU (`--disable-gpu-compositing`). Il
rendering passa alla CPU: l'app resta fluida per l'uso quotidiano.

La si può riattivare da **Impostazioni › Schermo › Compositing GPU**. Con
Electron 44 — la versione attualmente usata dal progetto — il problema non si
presenta e il compositing resta attivo.

## Struttura

```
src/main.js          processo principale: finestra, tray, sessione, mailto, backend grafico
scripts/start.js     avvio in sviluppo con i flag di piattaforma corretti
src/preload.js       lettura del conteggio non letti dal titolo della pagina
src/menu.js          barra dei menu e impostazioni
src/context-menu.js  menu contestuale nativo
src/settings.js      persistenza della configurazione
assets/              icone runtime e pagina offline
build/               sorgenti SVG e icone per electron-builder
```

## Autenticazione e link esterni

Una navigazione resta dentro l'app quando punta a Outlook/Microsoft, quando
l'host è un endpoint di autenticazione (`login.`, `sts.`, `adfs.`, `fs.`, `sso.`,
Okta, Duo, Ping, OneLogin…) o quando il flusso di accesso è già in corso. Tutto
il resto — i link contenuti nei messaggi — si apre nel browser di sistema.

Serve perché l'accesso a un account aziendale spesso esce dai domini Microsoft:
se quei passaggi finissero nel browser, l'autenticazione proseguirebbe lì e, con
la sessione di Outlook Web già aperta, il browser si porterebbe via il focus
lasciando l'app alla schermata di accesso.

### Accesso con ADFS aziendale (pagina bianca)

Molti ADFS reindirizzano a `/adfs/ls/wia`, l'endpoint dell'autenticazione
integrata Windows, che risponde `401` con `WWW-Authenticate: Negotiate, NTLM`.
Il corpo di un 401 è vuoto: senza gestione della sfida si vede una **pagina
bianca fissa**. Chromium inoltre non risponde a Negotiate/NTLM se il dominio non
è autorizzato esplicitamente.

Outlinux riconosce il caso: intercetta il 401, propone di autorizzare il dominio
(salvato in `authServerAllowlist`) e si riavvia. Al tentativo successivo compare
una finestra che chiede nome utente e password — il formato accettato dipende
dall'ADFS, di solito `DOMINIO\\utente` oppure `utente@azienda.it`.

Le credenziali si possono **ricordare**: la finestra ha una casella
"Ricorda le credenziali" e la password viene cifrata con `safeStorage`, cioè nel
portachiavi di sistema (su Linux via libsecret), in
`~/.config/Outlinux/credentials.enc` con permessi `600`. Ai lanci successivi
l'accesso avviene senza chiedere nulla; se il server le rifiuta vengono
dimenticate e la finestra ricompare. Per cancellarle a mano:
**Impostazioni › Dimentica le credenziali salvate**.

Senza un portachiavi attivo (`gnome-keyring`, `kwallet`) Electron ripiegherebbe
su una cifratura fittizia: in quel caso Outlinux non salva nulla e la casella
sparisce, con una nota nella finestra.

Si può anche impostare in anticipo:

```json
"authServerAllowlist": "fs.azienda.it,*.intra.azienda.it"
```

Con un ticket Kerberos valido (`kinit`) l'accesso avviene senza digitare nulla.

## Note

- Il conteggio dei non letti viene letto dal titolo di Outlook Web: se Microsoft
  cambia il formato, il badge può mostrare 0 finché non si aggiorna la regex in
  `src/preload.js`.
- Alcune funzioni di Outlook (add-in, condivisione file locali) dipendono dal
  browser e potrebbero comportarsi diversamente.

## Licenza

MIT. "Outlook" e "Microsoft 365" sono marchi di Microsoft Corporation;
questo progetto non è affiliato né approvato da Microsoft.
