const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, nativeTheme } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const readline = require('readline');

let currentSearch = null;

function searcherBinaryPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'searcher.exe');
  }
  return path.join(__dirname, '..', 'searcher', 'target', 'release', 'searcher.exe');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 760,
    minHeight: 500,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function registerIpc() {
  ipcMain.handle('get-default-folder', () => os.homedir());

  ipcMain.handle('set-theme', (event, theme) => {
    if (!['system', 'light', 'dark'].includes(theme)) return;
    nativeTheme.themeSource = theme;
  });

  ipcMain.handle('pick-folder', async (event, currentFolder, title) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: title || 'Search this folder',
      defaultPath: currentFolder || os.homedir(),
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('get-thumbnail', async (event, filePath) => {
    try {
      const image = await nativeImage.createThumbnailFromPath(filePath, { width: 96, height: 96 });
      return image.isEmpty() ? null : image.toDataURL();
    } catch {
      return null;
    }
  });

  ipcMain.handle('open-file', (event, filePath) => shell.openPath(filePath));
  ipcMain.handle('show-in-folder', (event, filePath) => shell.showItemInFolder(filePath));

  ipcMain.on('search-start', (event, options) => startSearch(event.sender, options));
  ipcMain.on('search-cancel', () => cancelSearch());
}

function startSearch(sender, options) {
  cancelSearch();

  const args = ['--root', options.root, '--query', options.query || '', '--category', options.category || 'all'];
  if (options.modifiedAfter) args.push('--modified-after', options.modifiedAfter);
  if (options.modifiedBefore) args.push('--modified-before', options.modifiedBefore);
  if (options.includeHidden) args.push('--include-hidden');

  let child;
  try {
    child = spawn(searcherBinaryPath(), args, { windowsHide: true });
  } catch (err) {
    sender.send('search-error', `Could not start the search engine: ${err.message}`);
    return;
  }
  currentSearch = child;

  // Batch results so thousands of matches don't flood IPC one message at a time.
  let batch = [];
  let flushTimer = null;
  const flush = () => {
    flushTimer = null;
    if (!batch.length || sender.isDestroyed()) return;
    sender.send('search-results', batch);
    batch = [];
  };

  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      return;
    }
    if (record.type === 'file') {
      batch.push(record);
      if (batch.length >= 200) flush();
      else if (!flushTimer) flushTimer = setTimeout(flush, 50);
      return;
    }
    if (record.type === 'done') {
      flush();
      if (!sender.isDestroyed()) sender.send('search-done', record);
      return;
    }
    if (record.type === 'error') {
      flush();
      if (!sender.isDestroyed()) sender.send('search-error', record.message);
    }
  });

  let stderrText = '';
  child.stderr.on('data', (d) => { stderrText += d; });

  child.on('error', (err) => {
    if (!sender.isDestroyed()) sender.send('search-error', `Search engine failed: ${err.message}`);
  });
  child.on('close', (code, signal) => {
    if (flushTimer) clearTimeout(flushTimer);
    flush();
    if (currentSearch === child) currentSearch = null;
    const wasKilled = signal !== null || child.killed;
    if (code !== 0 && !wasKilled && !sender.isDestroyed()) {
      sender.send('search-error', stderrText.trim() || `Search engine exited with code ${code}`);
    }
  });
}

function cancelSearch() {
  if (!currentSearch) return;
  currentSearch.kill();
  currentSearch = null;
}
