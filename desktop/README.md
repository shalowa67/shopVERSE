# ShopVerse for Windows

A desktop app that opens the live ShopVerse marketplace
(<https://shopverse-mr72.onrender.com>) in its own window, packaged as a standard
Windows installer: `ShopVerse-Setup.exe`.

The installer lets people choose the install folder, adds Desktop and Start menu
shortcuts, and registers an uninstaller under **Settings → Apps**.

## Build and publish on GitHub (recommended)

GitHub can build and publish the installer for you, with nothing to download locally:

1. On GitHub, open the **Actions** tab → **Build Windows installer** → **Run workflow**.
2. After about 5 minutes the installer appears under **Releases** as
   `ShopVerse-Setup.exe`, and the download link on the website's `/install` page
   starts working.

For a new version, bump `version` in `desktop/package.json`, push, and run the
workflow again.

## Build the installer on your own computer

You need Node.js 22 or newer and a fast connection, because Electron is about
110 MB. Run these from this `desktop` folder:

```bash
npm install
npm run dist
```

The installer is written to `desktop/dist/ShopVerse-Setup.exe`.

To try the app without building it, run `npm start`. To point it at a local server
instead of the live site, set `SHOPVERSE_URL` first:

```powershell
$env:SHOPVERSE_URL = "http://localhost:3000"; npm start
```

## Publish it so people can download it

The website's `/install` page links to
`https://github.com/shalowa67/shopVERSE/releases/latest/download/ShopVerse-Setup.exe`.
To make that link work:

1. On GitHub, open **Releases → Draft a new release**.
2. Create a tag such as `desktop-v1.0.0`.
3. Attach `desktop/dist/ShopVerse-Setup.exe`. Keep that exact file name.
4. Click **Publish release**.

For each new version, bump `version` in `desktop/package.json`, rebuild and publish
a new release the same way.

## Changing the site address

The address is set in `desktop/package.json` under `"shopverse": { "url": ... }`.
Change it, then rebuild.

## Windows SmartScreen warning

The installer is not code-signed, so the first time someone runs it Windows may show
**"Windows protected your PC"**. They can click **More info → Run anyway**. Buying a
code-signing certificate and adding it to the `build.win` settings removes the warning.
