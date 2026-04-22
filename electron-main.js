import { app, BrowserWindow } from "electron";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

let mainWindow;
let serverProcess;

const host = "127.0.0.1";
const port = 3001;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    autoHideMenuBar: true
  });

  mainWindow.loadURL(`http://${host}:${port}/`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  const serverPath = app.isPackaged
    ? process.resourcesPath
    : fileURLToPath(new URL(".", import.meta.url));

  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: serverPath,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, HOST: host, PORT: String(port) }
  });

  serverProcess.unref();

  void createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (serverProcess) {
    serverProcess.kill();
  }
  app.quit();
});

app.on("before-quit", () => {
  if (serverProcess) {
    serverProcess.kill();
  }
});
