const { app, BrowserWindow, ipcMain, dialog } = require('electron');
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

let isLoggedIn = false;

function createWindow() {
  const win = new BrowserWindow({
    width: 397,
    height: 506,
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
    show: true
  });

  win.setMenuBarVisibility(false);

  // Handle window close confirmation
  win.on('close', (e) => {
    if (isLoggedIn) {
      const choice = dialog.showMessageBoxSync(win, {
        type: 'question',
        buttons: ['Yes', 'No'],
        title: 'Confirm Exit',
        message: 'You are sure the close? (আপনি কি শিওর আছেন যে অ্যাপ্লিকেশনটি আপনি কেটে দিতে চাচ্ছেন?)'
      });
      
      if (choice === 1) {
        e.preventDefault();
      }
    }
  });

  // Handle manual resize requests from renderer
  ipcMain.on('resize-window', (event, { width, height }) => {
    if (win) {
      win.setContentSize(width, height);
      win.center();
      // Heuristic: if width is large, they are logged in
      if (width > 500) {
        isLoggedIn = true;
      } else {
        isLoggedIn = false;
      }
    }
  });

  // Wait for server to potentially start
  if (isDev) {
    win.loadURL('http://localhost:3000');
  } else {
    // Production: Load local file immediately for instant UI
    const indexPath = path.join(__dirname, 'dist/index.html');
    win.loadFile(indexPath).catch(err => {
      console.error('Failed to load local file:', err);
      // Fallback to retry loop if file fails (maybe not built yet?)
      const url = 'http://localhost:3000';
      const loadWithRetry = (count = 0) => {
        win.loadURL(url).then(() => {
          win.show();
          win.focus();
        }).catch(() => {
          if (count < 20) {
            setTimeout(() => loadWithRetry(count + 1), 500);
          }
        });
      };
      loadWithRetry();
    });
  }
  
  win.show();
  win.focus();
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
