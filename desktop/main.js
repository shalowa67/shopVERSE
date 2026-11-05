// ShopVerse desktop app: a secure window around the live ShopVerse website.
const path = require('node:path');
const { app, BrowserWindow, Menu, shell, ipcMain, nativeTheme } = require('electron');
const pkg = require('./package.json');

// The site address can be overridden for testing: SHOPVERSE_URL=http://localhost:3000 npm start
const SITE_URL = new URL(process.env.SHOPVERSE_URL || pkg.shopverse.url);
const ICON = path.join(__dirname, 'build', 'icon.png');

let mainWindow = null;

// Only one ShopVerse window: opening the app again focuses the existing one.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

const isSiteUrl = (target) => {
  try {
    return new URL(target).origin === SITE_URL.origin;
  } catch (error) {
    return false;
  }
};

const openExternally = (target) => {
  try {
    const { protocol } = new URL(target);
    if (['https:', 'http:', 'mailto:', 'tel:'].includes(protocol)) shell.openExternal(target);
  } catch (error) {
    // ignore malformed links
  }
};

function loadSite(targetUrl = SITE_URL.href) {
  if (!mainWindow) return;
  // Render's free plan can take up to a minute to wake the server; the loading page stays
  // on screen until the site has actually loaded. Failures are handled by did-fail-load.
  mainWindow.loadFile(path.join(__dirname, 'pages', 'loading.html'))
    .then(() => mainWindow && mainWindow.loadURL(targetUrl))
    .catch(() => {});
}

function createWindow() {
  nativeTheme.themeSource = 'light';
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 380,
    minHeight: 560,
    show: false,
    title: 'ShopVerse',
    icon: ICON,
    backgroundColor: '#f8fafc',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Links to other websites open in the user's normal browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSiteUrl(url)) {
      mainWindow.loadURL(url);
    } else {
      openExternally(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file://') || isSiteUrl(url)) return;
    event.preventDefault();
    openExternally(url);
  });

  // No internet, or the site is down: show a friendly offline screen with a retry button.
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 /* aborted by a newer navigation */) return;
    mainWindow.loadFile(path.join(__dirname, 'pages', 'offline.html'), {
      query: { target: isSiteUrl(validatedURL) ? validatedURL : SITE_URL.href }
    });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  loadSite();
}

ipcMain.on('shopverse:retry', (event, target) => {
  loadSite(isSiteUrl(target) ? target : SITE_URL.href);
});

const menuTemplate = [
  {
    label: 'ShopVerse',
    submenu: [
      { label: 'Home', accelerator: 'Alt+Home', click: () => loadSite() },
      { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => mainWindow && mainWindow.webContents.reload() },
      { label: 'Back', accelerator: 'Alt+Left', click: () => mainWindow && mainWindow.webContents.navigationHistory.goBack() },
      { label: 'Forward', accelerator: 'Alt+Right', click: () => mainWindow && mainWindow.webContents.navigationHistory.goForward() },
      { type: 'separator' },
      { label: 'Open in browser', click: () => mainWindow && openExternally(mainWindow.webContents.getURL().startsWith('http') ? mainWindow.webContents.getURL() : SITE_URL.href) },
      { type: 'separator' },
      { role: 'quit' }
    ]
  },
  { role: 'editMenu' },
  {
    label: 'View',
    submenu: [{ role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { type: 'separator' }, { role: 'togglefullscreen' }]
  },
  {
    label: 'Help',
    submenu: [{ label: `About ShopVerse ${app.getVersion()}`, enabled: false }]
  }
];

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
