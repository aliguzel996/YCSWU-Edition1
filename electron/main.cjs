const path = require("path");
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { createInteropService } = require("../src/main/interop-service.cjs");
const { createMobileBridgeServer } = require("../src/main/mobile-bridge-server.cjs");

const rendererEntry = path.join(__dirname, "..", "src", "renderer", "index.html");
const appIcon = path.join(__dirname, "..", "src", "renderer", "assets", "favicon.svg");

let mainWindow;
let interopService;
let mobileBridgeServer;
let mobileBridgeStartPromise;

const DEVICE_FRAME_WIDTH = 1840;
const DEVICE_FRAME_HEIGHT = 874;
const DEVICE_CONTROL_TOP_RESERVE = 0;
const DEVICE_WINDOW_WIDTH = DEVICE_FRAME_WIDTH;
const DEVICE_WINDOW_HEIGHT = DEVICE_FRAME_HEIGHT + DEVICE_CONTROL_TOP_RESERVE;

function fitAndShowMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.setContentSize(DEVICE_WINDOW_WIDTH, DEVICE_WINDOW_HEIGHT);
  mainWindow.setMinimumSize(DEVICE_WINDOW_WIDTH, DEVICE_WINDOW_HEIGHT);
  mainWindow.setMaximumSize(DEVICE_WINDOW_WIDTH, DEVICE_WINDOW_HEIGHT);
  mainWindow.setBackgroundColor("#00000000");

  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: DEVICE_WINDOW_WIDTH,
    height: DEVICE_WINDOW_HEIGHT,
    show: false,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    title: "YCSWU Tools Special Edition",
    icon: appIcon,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setBackgroundColor("#00000000");
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(rendererEntry, {
    query: {
      shell: "electron"
    }
  });

  const showFallback = setTimeout(fitAndShowMainWindow, 1800);
  const showWhenReady = () => {
    clearTimeout(showFallback);
    fitAndShowMainWindow();
  };

  mainWindow.once("ready-to-show", showWhenReady);
  mainWindow.webContents.once("did-finish-load", showWhenReady);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIpcHandlers() {
  ipcMain.handle("special:get-state", async () => interopService.getState());
  ipcMain.handle("special:import-assets", async () => interopService.importAssets(mainWindow));
  ipcMain.handle("special:create-scratch-asset", async (_event, payload) => interopService.createScratchAsset(payload));
  ipcMain.handle("special:capture-asset", async (_event, payload) => interopService.createCapturedAsset(payload));
  ipcMain.handle("special:get-asset-data", async (_event, payload) => interopService.getAssetData(payload));
  ipcMain.handle("special:handoff-asset", async (_event, payload) => interopService.handoffAsset(payload));
  ipcMain.handle("special:clear-workspace", async () => interopService.clearWorkspace());
  ipcMain.handle("special:get-mobile-info", async () => {
    if (mobileBridgeStartPromise) {
      await mobileBridgeStartPromise.catch(() => null);
    }

    return mobileBridgeServer?.getInfo() || { ok: false, message: "Mobile bridge hazir degil." };
  });
  ipcMain.handle("special:get-mobile-capture-requests", async () => mobileBridgeServer?.getPendingCaptureRequests() || { ok: true, requests: [] });
  ipcMain.handle("special:mobile-capture-result", async (_event, payload) => mobileBridgeServer?.markMobileCaptureRequest(payload) || { ok: false });
  ipcMain.handle("special:mobile-upload-injected", async (_event, payload) => interopService.markMobileUploadInjected(payload));
  ipcMain.handle("special:open-path", async (_event, targetPath) => {
    if (!targetPath) {
      return { ok: false, message: "Path verilmedi." };
    }

    const result = await shell.openPath(targetPath);
    return { ok: result === "", path: targetPath, message: result };
  });
  ipcMain.handle("special:open-external", async (_event, url) => {
    if (!url) {
      return { ok: false, message: "URL verilmedi." };
    }

    await shell.openExternal(url);
    return { ok: true };
  });
  ipcMain.handle("special:launch-app", async (_event, payload) => interopService.launchApp(payload));
}

app.whenReady().then(async () => {
  app.setAppUserModelId("co.ycswu.tools.special");

  interopService = createInteropService({
    workspaceRoot: path.join(__dirname, ".."),
    userDataPath: app.getPath("userData")
  });

  mobileBridgeServer = createMobileBridgeServer({
    interopService,
    preferredPort: Number(process.env.YCSWU_BRIDGE_PORT || 5174)
  });
  registerIpcHandlers();
  createWindow();
  mobileBridgeStartPromise = mobileBridgeServer.start().catch((error) => {
    console.error("Mobile bridge failed to start:", error);
    return { ok: false, message: error?.message || "Mobile bridge failed to start." };
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  mobileBridgeServer?.close();
});
