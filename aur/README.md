# Pacchetto AUR

Pacchetto Arch **source-based** che usa l'Electron di sistema: pesa ~87 KB
(130 KB installati) invece dei ~100 MB di AppImage e `.deb`, che includono ognuno
la propria copia di Chromium. Gli aggiornamenti di sicurezza di Electron arrivano
quindi da `pacman`.

```
PKGBUILD      ricetta del pacchetto
outlinux.sh   lancia l'app con /usr/bin/electron
.SRCINFO      metadati richiesti dall'AUR (rigenerare a ogni modifica)
```

## Cosa installa

| percorso | contenuto |
| --- | --- |
| `/usr/bin/outlinux` | script di avvio |
| `/usr/lib/outlinux/` | `src/`, `assets/`, `package.json` |
| `/usr/share/applications/outlinux.desktop` | voce di menu + handler `mailto:` |
| `/usr/share/icons/hicolor/*/apps/outlinux.png` | icone da 16 a 512 px |

Flag aggiuntivi per Chromium: una opzione per riga in
`~/.config/outlinux-flags.conf`.

## Prova in locale

```bash
cd aur
makepkg -si          # costruisce e installa
```

Il `PKGBUILD` scarica il tag `v$pkgver` dal repository indicato in `url`: perché
funzioni il repo deve esistere e avere quel tag. Per provarlo prima di
pubblicare, basta puntare `source` a una copia locale:

```bash
sed -i "s|git+\$url.git|git+file:///percorso/del/repo|" PKGBUILD
makepkg -f
```

## Pubblicazione su AUR

1. Crea un account su https://aur.archlinux.org e carica la tua chiave SSH
   pubblica nel profilo.
2. Pubblica il codice su GitHub (o altro host git) e crea il tag della release:

   ```bash
   git tag -a v1.0.0 -m "Outlinux 1.0.0"
   git push origin v1.0.0
   ```

3. Allinea `url` e la riga `# Maintainer:` del `PKGBUILD` ai tuoi dati reali.
4. Crea il repository AUR e caricalo:

   ```bash
   git clone ssh://aur@aur.archlinux.org/outlinux.git aur-outlinux
   cp PKGBUILD outlinux.sh aur-outlinux/
   cd aur-outlinux
   makepkg --printsrcinfo > .SRCINFO
   git add PKGBUILD outlinux.sh .SRCINFO
   git commit -m "Aggiunto outlinux 1.0.0"
   git push
   ```

Nel repository AUR vanno **solo** `PKGBUILD`, `outlinux.sh` e `.SRCINFO`: il
codice resta nel repository upstream.

## Nuova versione

```bash
# aggiorna pkgver (e riporta pkgrel=1), poi:
makepkg --printsrcinfo > .SRCINFO
git commit -am "Aggiornato a 1.1.0" && git push
```

Se passi da tag git a tarball di release, sostituisci `source` con l'URL
dell'archivio e genera le somme con `updpkgsums` (niente `SKIP`: per i tarball
l'AUR richiede checksum reali).
