const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("specialEdition", {
  isElectron: true,
  getState: () => ipcRenderer.invoke("special:get-state"),
  importAssets: () => ipcRenderer.invoke("special:import-assets"),
  createScratchAsset: (payload) => ipcRenderer.invoke("special:create-scratch-asset", payload),
  captureAsset: (payload) => ipcRenderer.invoke("special:capture-asset", payload),
  getAssetData: (payload) => ipcRenderer.invoke("special:get-asset-data", payload),
  handoffAsset: (payload) => ipcRenderer.invoke("special:handoff-asset", payload),
  clearWorkspace: () => ipcRenderer.invoke("special:clear-workspace"),
  getMobileInfo: () => ipcRenderer.invoke("special:get-mobile-info"),
  getMobileCaptureRequests: () => ipcRenderer.invoke("special:get-mobile-capture-requests"),
  markMobileCaptureRequest: (payload) => ipcRenderer.invoke("special:mobile-capture-result", payload),
  markMobileUploadInjected: (payload) => ipcRenderer.invoke("special:mobile-upload-injected", payload),
  openPath: (targetPath) => ipcRenderer.invoke("special:open-path", targetPath),
  openExternal: (url) => ipcRenderer.invoke("special:open-external", url),
  launchApp: (payload) => ipcRenderer.invoke("special:launch-app", payload)
});
