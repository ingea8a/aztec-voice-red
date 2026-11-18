const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  Tray,
  nativeImage,
  session,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

let mainWindow = null;
let tray = null;
let currentShortcut = 'CommandOrControl+Space';
let shortcutRegistered = false;

function registerAppShortcut(accelerator) {
  try {
    globalShortcut.unregisterAll();
  } catch {
    // ignore
  }
  try {
    const ok = globalShortcut.register(accelerator, () => {
      if (mainWindow) {
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.webContents.send('aztec:toggle-dictation');
      }
    });
    currentShortcut = accelerator;
    shortcutRegistered = ok;
    return { ok, shortcut: accelerator };
  } catch (err) {
    shortcutRegistered = false;
    return { ok: false, shortcut: accelerator, error: String(err) };
  }
}

function transcribeWavWithWindowsSpeech(wavBuffer, lang) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ ok: false, error: 'Windows Speech solo está disponible en Windows.' });
      return;
    }

    const tmpWav = path.join(os.tmpdir(), `aztec-voice-${Date.now()}.wav`);
    fs.writeFileSync(tmpWav, Buffer.from(wavBuffer));

    const culture = lang === 'en' ? 'en-US' : 'es-MX';
    const psScript = `
      Add-Type -AssemblyName System.Speech
      $wav = '${tmpWav.replace(/'/g, "''")}'
      try {
        $culture = [System.Globalization.CultureInfo]::GetCultureInfo('${culture}')
        $rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine($culture)
      } catch {
        $rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine
      }
      $grammar = New-Object System.Speech.Recognition.DictationGrammar
      $rec.LoadGrammar($grammar)
      $rec.SetInputToWaveFile($wav)
      $texts = @()
      while ($true) {
        $res = $rec.Recognize()
        if ($null -eq $res) { break }
        if ($res.Text) { $texts += $res.Text }
      }
      $rec.Dispose()
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      Write-Output ($texts -join ' ')
    `;

    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
      { timeout: 25000, windowsHide: true },
      (err, stdout, stderr) => {
        try {
          fs.unlinkSync(tmpWav);
        } catch {
          // ignore
        }
        if (err) {
          resolve({ ok: false, error: stderr || err.message });
          return;
        }
        const text = (stdout || '').trim();
        resolve({ ok: true, text });
      }
    );
  });
}

function createWindow() {
  const iconPath = path.join(__dirname, '..', 'public', 'assets', 'aztec_logo_icon.png');

  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 820,
    minHeight: 580,
    title: 'Aztec Voice — Edición Roja',
    backgroundColor: '#fdf9f9',
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const iconPath = path.join(__dirname, '..', 'public', 'assets', 'aztec_logo_icon.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 });
  tray = new Tray(icon);
  tray.setToolTip('Aztec Voice — Edición Roja');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir Aztec Voice',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: 'Iniciar / Detener dictado',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.webContents.send('aztec:toggle-dictation');
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Salir',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  // Grant microphone permissions automatically inside Electron
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'media' || permission === 'audioCapture') {
      callback(true);
    } else {
      callback(false);
    }
  });

  createWindow();
  createTray();
  registerAppShortcut(currentShortcut);

  ipcMain.handle('aztec:get-shortcut-status', () => ({
    ok: shortcutRegistered,
    shortcut: currentShortcut,
  }));

  ipcMain.handle('aztec:set-shortcut', (_event, accelerator) => {
    return registerAppShortcut(accelerator);
  });

  ipcMain.handle('aztec:transcribe-wav', async (_event, payload) => {
    return transcribeWavWithWindowsSpeech(payload.wavBuffer, payload.lang || 'es');
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
