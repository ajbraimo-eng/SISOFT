const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, exec } = require('child_process');

const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const STARTUP_SHORTCUT_NAME = 'Sisoft.lnk';

const DEFAULT_SETTINGS = {
  openFullscreen: true,
  autoStart: false
};

function readSettings() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) {
      return { ...DEFAULT_SETTINGS };
    }
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return {
      openFullscreen:
        raw.openFullscreen === undefined
          ? DEFAULT_SETTINGS.openFullscreen
          : Boolean(raw.openFullscreen),
      autoStart:
        raw.autoStart === undefined
          ? DEFAULT_SETTINGS.autoStart
          : Boolean(raw.autoStart)
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(next) {
  const settings = {
    openFullscreen: Boolean(next.openFullscreen),
    autoStart: Boolean(next.autoStart)
  };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
  return settings;
}

function getStartupDir() {
  if (process.platform !== 'win32') return '';
  return path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup'
  );
}

function getStartupShortcutPath() {
  const dir = getStartupDir();
  return dir ? path.join(dir, STARTUP_SHORTCUT_NAME) : '';
}

function getLauncherBatPath() {
  const candidates = [
    path.join(__dirname, 'Iniciar-Sisoft.bat'),
    path.join(__dirname, 'Iniciar-Isoft.bat'),
    path.join(__dirname, '..', 'Iniciar-Sisoft.bat'),
    path.join(__dirname, '..', 'Iniciar-Isoft.bat')
  ];
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

function createStartupShortcut() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      return resolve({ ok: false, error: 'Arranque automático só está disponível no Windows.' });
    }
    const bat = getLauncherBatPath();
    if (!fs.existsSync(bat)) {
      return resolve({ ok: false, error: 'Iniciar-Sisoft.bat não encontrado.' });
    }
    const startupDir = getStartupDir();
    if (!startupDir) {
      return resolve({ ok: false, error: 'Pasta de arranque do Windows não encontrada.' });
    }
    try {
      if (!fs.existsSync(startupDir)) {
        fs.mkdirSync(startupDir, { recursive: true });
      }
      const cmdPath = path.join(startupDir, 'Sisoft.cmd');
      const content = [
        '@echo off',
        `start "" /min ${JSON.stringify(bat)}`,
        ''
      ].join('\r\n');
      fs.writeFileSync(cmdPath, content, 'utf8');
      // Limpar atalho antigo Isoft, se existir
      for (const legacy of ['Isoft.cmd', 'Isoft.lnk']) {
        const legacyPath = path.join(startupDir, legacy);
        try {
          if (fs.existsSync(legacyPath)) fs.unlinkSync(legacyPath);
        } catch {
          /* ignore */
        }
      }
      resolve({ ok: true, path: cmdPath, mode: 'cmd' });
    } catch (err) {
      resolve({ ok: false, error: err.message || 'Falha ao criar arranque automático.' });
    }
  });
}

function removeStartupShortcut() {
  if (process.platform !== 'win32') {
    return { ok: true };
  }
  const paths = [
    getStartupShortcutPath(),
    path.join(getStartupDir(), 'Sisoft.cmd'),
    path.join(getStartupDir(), 'Isoft.cmd'),
    path.join(getStartupDir(), 'Isoft.lnk')
  ];
  for (const file of paths) {
    try {
      if (file && fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
  return { ok: true };
}

function isAutoStartEnabled() {
  if (process.platform !== 'win32') return false;
  const startupDir = getStartupDir();
  if (!startupDir) return false;
  return (
    fs.existsSync(path.join(startupDir, 'Sisoft.cmd')) ||
    fs.existsSync(path.join(startupDir, STARTUP_SHORTCUT_NAME)) ||
    fs.existsSync(path.join(startupDir, 'Isoft.cmd')) ||
    fs.existsSync(path.join(startupDir, 'Isoft.lnk'))
  );
}

async function applyAutoStart(enabled) {
  if (enabled) {
    const result = await createStartupShortcut();
    return result;
  }
  return removeStartupShortcut();
}

function findBrowserExecutable() {
  if (process.platform !== 'win32') return '';
  const candidates = [
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || '';
}

/**
 * Abre o Sisoft no browser. Em Windows, usa Edge/Chrome em modo app + fullscreen.
 */
function openInBrowser(url, options = {}) {
  const fullscreen =
    options.fullscreen !== undefined
      ? Boolean(options.fullscreen)
      : readSettings().openFullscreen;

  if (process.platform === 'win32') {
    const browser = findBrowserExecutable();
    if (browser) {
      const args = fullscreen
        ? ['--new-window', '--start-fullscreen', `--app=${url}`]
        : ['--new-window', `--app=${url}`];
      try {
        const child = spawn(browser, args, {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        });
        child.unref();
        return { ok: true, mode: fullscreen ? 'fullscreen-app' : 'app', browser };
      } catch (error) {
        console.error('Falha ao abrir browser em modo app:', error.message || error);
      }
    }
  }

  const command =
    process.platform === 'win32'
      ? `cmd /c start "" "${url}"`
      : process.platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(command, () => undefined);
  return { ok: true, mode: 'default' };
}

async function updateSettings(partial = {}) {
  const current = readSettings();
  const next = {
    openFullscreen:
      partial.openFullscreen === undefined
        ? current.openFullscreen
        : Boolean(partial.openFullscreen),
    autoStart:
      partial.autoStart === undefined
        ? current.autoStart
        : Boolean(partial.autoStart)
  };

  if (partial.autoStart !== undefined) {
    const result = await applyAutoStart(Boolean(partial.autoStart));
    if (!result.ok) {
      return {
        error: result.error || 'Não foi possível atualizar o arranque automático.',
        status: 500
      };
    }
    next.autoStart = isAutoStartEnabled();
  } else {
    next.autoStart = isAutoStartEnabled();
  }

  const saved = writeSettings(next);
  return {
    ...saved,
    autoStartActive: isAutoStartEnabled(),
    canAutoStart: process.platform === 'win32',
    platform: process.platform
  };
}

function getPublicSettings() {
  const settings = readSettings();
  const autoStartActive = isAutoStartEnabled();
  return {
    ...settings,
    // Prefer real shortcut state when reading
    autoStart: autoStartActive,
    autoStartActive,
    platform: process.platform,
    canAutoStart: process.platform === 'win32'
  };
}

module.exports = {
  readSettings,
  writeSettings,
  updateSettings,
  getPublicSettings,
  openInBrowser,
  isAutoStartEnabled,
  applyAutoStart
};
