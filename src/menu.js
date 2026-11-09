'use strict';

const { Menu, app, shell, dialog } = require('electron');

const credentialsStore = require('./credentials-store');

function buildMenu({ getWindow, navigateTo, settings, onQuit, onTrayToggle, userAgent }) {
  const conf = settings.get();

  const withWindow = (fn) => () => {
    const win = getWindow();
    if (win && !win.isDestroyed()) fn(win);
  };

  const setZoom = (delta) =>
    withWindow((win) => {
      const current = win.webContents.getZoomFactor();
      const next = delta === 0 ? 1 : Math.min(3, Math.max(0.4, Math.round((current + delta) * 100) / 100));
      win.webContents.setZoomFactor(next);
      settings.set('zoomFactor', next);
    });

  const askRestart = async (message) => {
    const win = getWindow();
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      message,
      detail: 'La modifica richiede il riavvio di Outlinux.',
      buttons: ['Riavvia ora', 'Più tardi'],
      defaultId: 0,
      cancelId: 1
    });
    if (response === 0) {
      app.relaunch();
      app.exit(0);
    }
  };

  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Nuovo messaggio',
          accelerator: 'CmdOrCtrl+N',
          click: withWindow((win) => {
            win.webContents.loadURL(`${settings.baseUrl()}/mail/deeplink/compose`, { userAgent });
          })
        },
        { type: 'separator' },
        { label: 'Posta', accelerator: 'CmdOrCtrl+1', click: () => navigateTo('mail') },
        { label: 'Calendario', accelerator: 'CmdOrCtrl+2', click: () => navigateTo('calendar') },
        { label: 'Contatti', accelerator: 'CmdOrCtrl+3', click: () => navigateTo('people') },
        { type: 'separator' },
        {
          label: 'Nascondi nella tray',
          accelerator: 'CmdOrCtrl+W',
          click: withWindow((win) => (settings.get('showTrayIcon') ? win.hide() : win.close()))
        },
        { label: 'Esci', accelerator: 'CmdOrCtrl+Q', click: onQuit }
      ]
    },
    {
      label: 'Modifica',
      submenu: [
        { role: 'undo', label: 'Annulla' },
        { role: 'redo', label: 'Ripeti' },
        { type: 'separator' },
        { role: 'cut', label: 'Taglia' },
        { role: 'copy', label: 'Copia' },
        { role: 'paste', label: 'Incolla' },
        { role: 'pasteAndMatchStyle', label: 'Incolla senza formattazione' },
        { role: 'selectAll', label: 'Seleziona tutto' }
      ]
    },
    {
      label: 'Visualizza',
      submenu: [
        { label: 'Ricarica', accelerator: 'CmdOrCtrl+R', click: withWindow((win) => win.webContents.reload()) },
        {
          label: 'Ricarica ignorando la cache',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: withWindow((win) => win.webContents.reloadIgnoringCache())
        },
        { type: 'separator' },
        { label: 'Aumenta zoom', accelerator: 'CmdOrCtrl+Plus', click: setZoom(0.1) },
        { label: 'Riduci zoom', accelerator: 'CmdOrCtrl+-', click: setZoom(-0.1) },
        { label: 'Zoom originale', accelerator: 'CmdOrCtrl+0', click: setZoom(0) },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Schermo intero' },
        {
          label: 'Nascondi automaticamente la barra dei menu',
          type: 'checkbox',
          checked: conf.autoHideMenuBar,
          click: (item) =>
            withWindow((win) => {
              settings.set('autoHideMenuBar', item.checked);
              win.setAutoHideMenuBar(item.checked);
              win.setMenuBarVisibility(!item.checked);
            })()
        },
        { type: 'separator' },
        { label: 'Strumenti di sviluppo', accelerator: 'F12', click: withWindow((win) => win.webContents.toggleDevTools()) }
      ]
    },
    {
      label: 'Impostazioni',
      submenu: [
        {
          label: 'Account',
          submenu: [
            {
              label: 'Lavoro o scuola (outlook.office.com)',
              type: 'radio',
              checked: !conf.customUrl && conf.service === 'office',
              click: () => {
                settings.set('service', 'office');
                settings.set('customUrl', '');
                navigateTo(settings.get('startPage'));
              }
            },
            {
              label: 'Personale (outlook.live.com)',
              type: 'radio',
              checked: !conf.customUrl && conf.service === 'live',
              click: () => {
                settings.set('service', 'live');
                settings.set('customUrl', '');
                navigateTo(settings.get('startPage'));
              }
            }
          ]
        },
        {
          label: 'Sezione iniziale',
          submenu: ['mail', 'calendar', 'people'].map((section) => ({
            label: { mail: 'Posta', calendar: 'Calendario', people: 'Contatti' }[section],
            type: 'radio',
            checked: conf.startPage === section,
            click: () => settings.set('startPage', section)
          }))
        },
        { type: 'separator' },
        {
          label: 'Mostra icona nella tray',
          type: 'checkbox',
          checked: conf.showTrayIcon,
          click: (item) => {
            settings.set('showTrayIcon', item.checked);
            onTrayToggle(item.checked);
          }
        },
        {
          label: 'Chiudi nella tray',
          type: 'checkbox',
          checked: conf.closeToTray,
          click: (item) => settings.set('closeToTray', item.checked)
        },
        {
          label: 'Riduci a icona nella tray',
          type: 'checkbox',
          checked: conf.minimizeToTray,
          click: (item) => settings.set('minimizeToTray', item.checked)
        },
        {
          label: 'Avvia ridotto a icona',
          type: 'checkbox',
          checked: conf.startMinimized,
          click: (item) => settings.set('startMinimized', item.checked)
        },
        { type: 'separator' },
        {
          label: 'Schermo',
          submenu: [
            {
              label: 'Wayland nativo (consigliato su schermi HiDPI)',
              type: 'radio',
              checked: conf.displayBackend !== 'x11',
              click: () => {
                settings.set('displayBackend', 'auto');
                askRestart('Backend grafico impostato su Wayland nativo.');
              }
            },
            {
              label: 'X11 / XWayland',
              type: 'radio',
              checked: conf.displayBackend === 'x11',
              click: () => {
                settings.set('displayBackend', 'x11');
                askRestart('Backend grafico impostato su X11.');
              }
            },
            { type: 'separator' },
            {
              label: 'Compositing GPU',
              type: 'checkbox',
              checked: conf.gpuCompositing !== false,
              click: (item) => {
                settings.set('gpuCompositing', item.checked);
                askRestart('Compositing GPU ' + (item.checked ? 'attivato' : 'disattivato') + '.');
              }
            },
            {
              label: 'Scala interfaccia',
              submenu: [0, 1, 1.25, 1.5, 1.75, 2].map((scale) => ({
                label: scale === 0 ? 'Automatica' : `${scale}x`,
                type: 'radio',
                checked: Number(conf.forceScaleFactor) === scale,
                click: () => {
                  settings.set('forceScaleFactor', scale);
                  askRestart(
                    scale === 0 ? 'Scala interfaccia automatica.' : `Scala interfaccia forzata a ${scale}x.`
                  );
                }
              }))
            }
          ]
        },
        { type: 'separator' },
        {
          label: 'Correttore ortografico',
          type: 'checkbox',
          checked: conf.spellCheck,
          click: (item) => {
            settings.set('spellCheck', item.checked);
            askRestart('Correttore ortografico ' + (item.checked ? 'attivato' : 'disattivato') + '.');
          }
        },
        {
          label: 'Accelerazione hardware',
          type: 'checkbox',
          checked: conf.hardwareAcceleration,
          click: (item) => {
            settings.set('hardwareAcceleration', item.checked);
            askRestart('Accelerazione hardware ' + (item.checked ? 'attivata' : 'disattivata') + '.');
          }
        },
        { type: 'separator' },
        {
          label: 'Dimentica le credenziali salvate',
          enabled: credentialsStore.hosts().length > 0,
          click: async () => {
            const hosts = credentialsStore.hosts();
            const { response } = await dialog.showMessageBox(getWindow(), {
              type: 'question',
              message: 'Dimenticare le credenziali salvate?',
              detail: `Verranno rimosse le credenziali per: ${hosts.join(', ')}.`,
              buttons: ['Dimentica', 'Annulla'],
              defaultId: 0,
              cancelId: 1
            });
            if (response === 0) credentialsStore.forget();
          }
        },
        { type: 'separator' },
        {
          label: 'Apri il file di configurazione',
          click: () => shell.showItemInFolder(settings.settingsFile())
        }
      ]
    },
    {
      label: 'Aiuto',
      submenu: [
        { label: 'Outlook sul web', click: () => shell.openExternal(settings.baseUrl()) },
        { label: 'Stato dei servizi Microsoft 365', click: () => shell.openExternal('https://portal.office.com/servicestatus') },
        { type: 'separator' },
        {
          label: 'Informazioni su Outlinux',
          click: () =>
            dialog.showMessageBox(getWindow(), {
              type: 'info',
              title: 'Informazioni su Outlinux',
              message: 'Outlinux',
              detail: [
                `Versione ${app.getVersion()}`,
                `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`,
                '',
                'Wrapper desktop non ufficiale di Outlook Web.',
                `Impostazioni: ${settings.settingsFile()}`
              ].join('\n'),
              buttons: ['Chiudi']
            })
        }
      ]
    }
  ];

  return Menu.buildFromTemplate(template);
}

module.exports = buildMenu;
