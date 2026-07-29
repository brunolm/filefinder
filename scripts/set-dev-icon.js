const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const rcedit = path.join(root, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const icon = path.join(root, 'build', 'icon.ico');

if (process.platform !== 'win32') process.exit(0);
if (!fs.existsSync(rcedit) || !fs.existsSync(electronExe) || !fs.existsSync(icon)) process.exit(0);

const result = spawnSync(rcedit, [electronExe, '--set-icon', icon], { stdio: 'inherit' });
if (result.status !== 0) {
  console.warn('Could not set Electron dev icon (is electron.exe in use?)');
}
