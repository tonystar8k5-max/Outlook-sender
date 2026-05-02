const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const isDev = process.env.NODE_ENV === 'development';

let serverProcess;

function startServer() {
  const appPath = app.getAppPath();
  let serverPath;

  if (isDev) {
    serverPath = path.join(__dirname, 'server.ts');
  } else {
    // In production, get the path to the unpacked server file
    // electron-builder puts unpacked files in app.asar.unpacked
    serverPath = path.join(appPath, '..', 'app.asar.unpacked', 'dist', 'server.cjs');
    
    // Fallback if not using asarUnpack or path differs
    if (!require('fs').existsSync(serverPath)) {
      serverPath = path.join(appPath, 'dist', 'server.cjs');
    }
  }
  
  console.log('Targeting server at:', serverPath);

  try {
    console.log(`Starting backend server: ${serverPath}`);
    serverProcess = fork(serverPath, [], {
      env: { ...process.env, NODE_ENV: 'production', PORT: '3000' },
      execArgv: isDev ? ['--import', 'tsx'] : [] 
    });

    serverProcess.on('error', (err) => {
      console.error('Server Process Error:', err);
    });

    serverProcess.on('exit', (code) => {
      console.log(`Server exited with code ${code}`);
      if (!isDev && code !== 0) {
        console.log('Attempting server restart...');
        setTimeout(startServer, 2000);
      }
    });
  } catch (e) {
    console.error('Failed to fork server:', e);
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1184,
    height: 871,
    minWidth: 1184,
    minHeight: 871,
    maxWidth: 1184,
    maxHeight: 871,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    title: "Nexa outlook sender",
    backgroundColor: '#0a0a0a',
    show: false
  });

  win.setMenuBarVisibility(false);

  // Function to load the URL with retries
  const loadWithRetry = (url, count = 0) => {
    win.loadURL(url).then(() => {
      win.show();
    }).catch(() => {
      if (count < 10) {
        console.log(`Retrying connection to server (${count + 1}/10)...`);
        setTimeout(() => loadWithRetry(url, count + 1), 2000);
      } else {
        // Final fallback: try local file if server never starts
        win.loadFile(path.join(__dirname, 'dist/index.html'));
        win.show();
      }
    });
  };

  // Wait for server to potentially start
  if (isDev) {
    win.loadURL('http://localhost:3000');
    win.show();
  } else {
    // In production, give server time to boot
    setTimeout(() => {
      loadWithRetry('http://localhost:3000');
    }, 5000);
  }
}

app.whenReady().then(() => {
  startServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (serverProcess) serverProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});
