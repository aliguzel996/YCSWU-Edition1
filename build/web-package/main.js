import { initDeviceScene, refreshDeviceScene, setDeviceLightFromViewportPoint, updateDeviceReflectionTilt, updateDeviceUi } from "./device-scene.js";

const USE_DEVICE_SCENE = true;
const deviceDebugMode = new URLSearchParams(window.location.search).get("debug") || "";
const SHOW_HITBOX_DEBUG = deviceDebugMode === "hitboxes" || deviceDebugMode === "clicks";
const shellParams = new URLSearchParams(window.location.search);
const IS_ELECTRON_RUNTIME =
  Boolean(window.specialEdition?.isElectron) ||
  shellParams.get("shell") === "electron" ||
  /Electron/i.test(window.navigator?.userAgent || "");
const HOSTED_MOBILE_BRIDGE_URL = "https://ycswu.co/mobile-bridge.php";

if (deviceDebugMode) {
  document.documentElement.dataset.deviceDebug = deviceDebugMode;
}

function uniqueValues(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function createHttpPreviewApi() {
  async function requestJson(url, payload) {
    const response = await fetch(url, {
      method: payload ? "POST" : "GET",
      headers: payload ? { "Content-Type": "application/json" } : undefined,
      body: payload ? JSON.stringify(payload) : undefined
    });

    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${url}`);
    }

    return response.json();
  }

  const phpBridgeUrl = IS_ELECTRON_RUNTIME
    ? HOSTED_MOBILE_BRIDGE_URL
    : new URL("./mobile-bridge.php", window.location.href).toString();

  function canUsePhpBridge() {
    return IS_ELECTRON_RUNTIME || window.location.protocol === "http:" || window.location.protocol === "https:";
  }

  function getPhpBridgeUrl(apiName, params = {}) {
    const url = new URL(phpBridgeUrl);
    url.searchParams.set("api", apiName);
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, value);
      }
    });
    return url.toString();
  }

  async function requestPhpBridge(apiName, payload, params = {}) {
    if (!canUsePhpBridge()) {
      throw new Error("PHP bridge is unavailable on this protocol");
    }
    return requestJson(getPhpBridgeUrl(apiName, params), payload);
  }

  let staticStatePromise = null;

  function normalizeStaticRegistry(registry = {}) {
    const excludedAppIds = new Set(registry.suite?.excludedAppIds || []);
    const apps = (registry.apps || [])
      .filter((appEntry) => !excludedAppIds.has(appEntry.id))
      .map((appEntry) => {
        const embed = appEntry.embed || {};
        const acceptsKinds = appEntry.acceptsKinds || uniqueValues((appEntry.accepts || []).map((spec) => spec.kind));
        const producesKinds = appEntry.producesKinds || uniqueValues((appEntry.produces || []).map((spec) => spec.kind));
        const acceptsExtensions = appEntry.acceptsExtensions || uniqueValues((appEntry.accepts || []).flatMap((spec) => spec.extensions || []));
        const producesExtensions = appEntry.producesExtensions || uniqueValues((appEntry.produces || []).flatMap((spec) => spec.extensions || []));

        return {
          ...appEntry,
          acceptsKinds,
          producesKinds,
          acceptsExtensions,
          producesExtensions,
          embed: {
            ...embed,
            available: embed.available !== false && Boolean(embed.previewUrl || embed.url || embed.fileUrl)
          }
        };
      });

    return {
      ...registry,
      apps,
      appCount: apps.length
    };
  }

  async function loadStaticState() {
    if (!staticStatePromise) {
      staticStatePromise = (async () => {
        const registryCandidates = ["./config/apps.json", "./apps.json"];
        let registry = null;

        for (const url of registryCandidates) {
          try {
            const response = await fetch(url, { cache: "no-store" });
            if (response.ok) {
              registry = await response.json();
              break;
            }
          } catch {
            // Try the next static registry location.
          }
        }

        return {
          registry: normalizeStaticRegistry(registry || { suite: {}, assetClasses: [], busAdapters: [], apps: [] }),
          assetRoutes: {},
          store: { assets: [], transfers: [] },
          workspacePath: ""
        };
      })();
    }

    return staticStatePromise;
  }

  async function requestState() {
    try {
      return await requestJson("/api/state");
    } catch {
      return loadStaticState();
    }
  }

  return {
    getState: requestState,
    getMobileInfo: async () => {
      try {
        return await requestJson("/api/mobile-info");
      } catch {
        try {
          return await requestPhpBridge("mobile-info");
        } catch {
          return { ok: false, mobileBaseUrl: "", lanUrl: "" };
        }
      }
    },
    getMobileCaptureRequests: async (payload = {}) => {
      try {
        return await requestJson("/api/mobile-capture-requests");
      } catch {
        try {
          return await requestPhpBridge("mobile-capture-requests", null, payload);
        } catch {
          return { requests: [], uploads: [] };
        }
      }
    },
    markMobileCaptureRequest: async (payload) => {
      try {
        return await requestJson("/api/mobile-capture-result", payload);
      } catch {
        try {
          return await requestPhpBridge("mobile-capture-result", payload);
        } catch {
          return { ok: false, state: await loadStaticState() };
        }
      }
    },
    markMobileUploadInjected: async (payload) => {
      try {
        return await requestJson("/api/mobile-upload-injected", payload);
      } catch {
        try {
          return await requestPhpBridge("mobile-upload-injected", payload);
        } catch {
          return { ok: false, state: await loadStaticState() };
        }
      }
    },
    getMobileUploads: async (payload = {}) => {
      try {
        return await requestPhpBridge("mobile-uploads", null, payload);
      } catch {
        return { ok: false, uploads: [] };
      }
    },
    importAssets: async () => ({ ok: true, imported: [], state: await requestState() }),
    createScratchAsset: async (payload) => {
      try {
        return await requestJson("/api/create-scratch-asset", payload);
      } catch {
        return { ok: false, state: await loadStaticState() };
      }
    },
    captureAsset: async (payload) => {
      try {
        return await requestJson("/api/capture-asset", payload);
      } catch {
        try {
          return await requestPhpBridge("capture-asset", payload);
        } catch {
          return { ok: false, state: await loadStaticState() };
        }
      }
    },
    getAssetData: async (payload) => {
      try {
        return await requestJson("/api/asset-data", payload);
      } catch {
        try {
          return await requestPhpBridge("asset-data", payload);
        } catch {
          return { ok: false, state: await loadStaticState() };
        }
      }
    },
    handoffAsset: async (payload) => {
      try {
        return await requestJson("/api/handoff-asset", payload);
      } catch {
        return { ok: false, state: await loadStaticState() };
      }
    },
    clearWorkspace: async () => {
      try {
        return await requestJson("/api/clear-workspace", {});
      } catch {
        return { ok: false, state: await loadStaticState() };
      }
    },
    openPath: async () => ({ ok: true }),
    openExternal: async (url) => {
      window.open(url, "_blank", "noopener,noreferrer");
      return { ok: true };
    }
  };
}

const httpPreviewApi = createHttpPreviewApi();
const api = window.specialEdition || httpPreviewApi;
const mobileBridgeApi = IS_ELECTRON_RUNTIME ? httpPreviewApi : api;
const isElectronRuntime = IS_ELECTRON_RUNTIME;
if (isElectronRuntime) {
  document.documentElement.classList.add("is-electron");
}

const MOBILE_STAGE_WIDTH = 1840;
const MOBILE_STAGE_HEIGHT = 874;
const forceMobileStage = new URLSearchParams(window.location.search).get("mobileStage") === "1";

function shouldUseMobileStage() {
  if (isElectronRuntime) {
    return false;
  }

  if (forceMobileStage) {
    return true;
  }

  const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches;
  const maxTouchPoints = navigator.maxTouchPoints || 0;
  const userAgent = navigator.userAgent || "";
  const mobileUserAgent = /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(userAgent);
  const viewportWidth = window.innerWidth || 0;
  const viewportHeight = window.innerHeight || 0;
  const compactViewport = Math.min(viewportWidth, viewportHeight) <= 980;
  const belowDesktopCanvas = Math.max(viewportWidth, viewportHeight) < MOBILE_STAGE_WIDTH;
  const smallerThanStage = viewportWidth < MOBILE_STAGE_WIDTH || viewportHeight < MOBILE_STAGE_HEIGHT;

  return Boolean(smallerThanStage || ((coarsePointer || maxTouchPoints > 0 || mobileUserAgent) && (compactViewport || belowDesktopCanvas)));
}

function getMobileViewportBox() {
  const visualViewport = window.visualViewport;

  if (!visualViewport) {
    return {
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight
    };
  }

  return {
    left: visualViewport.offsetLeft || 0,
    top: visualViewport.offsetTop || 0,
    width: visualViewport.width || window.innerWidth,
    height: visualViewport.height || window.innerHeight
  };
}

function applyMobileStageLayout() {
  const root = document.documentElement;
  const useMobileStage = shouldUseMobileStage();
  root.classList.toggle("is-mobile-stage", useMobileStage);

  if (!useMobileStage) {
    root.style.removeProperty("--mobile-stage-scale");
    root.style.removeProperty("--mobile-stage-left");
    root.style.removeProperty("--mobile-stage-top");
    return;
  }

  const viewport = getMobileViewportBox();
  const scale = Math.min(
    viewport.width / MOBILE_STAGE_WIDTH,
    viewport.height / MOBILE_STAGE_HEIGHT
  );
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const left = viewport.left + Math.max((viewport.width - MOBILE_STAGE_WIDTH * safeScale) / 2, 0);
  const top = viewport.top + Math.max((viewport.height - MOBILE_STAGE_HEIGHT * safeScale) / 2, 0);

  root.style.setProperty("--mobile-stage-scale", safeScale.toFixed(6));
  root.style.setProperty("--mobile-stage-left", `${left.toFixed(2)}px`);
  root.style.setProperty("--mobile-stage-top", `${top.toFixed(2)}px`);

  window.requestAnimationFrame(() => {
    try {
      refreshDeviceScene();
    } catch {
      // The device scene may not have initialized yet.
    }
  });
}

applyMobileStageLayout();
window.addEventListener("resize", applyMobileStageLayout, { passive: true });
window.addEventListener("orientationchange", applyMobileStageLayout, { passive: true });
window.visualViewport?.addEventListener("resize", applyMobileStageLayout, { passive: true });
window.visualViewport?.addEventListener("scroll", applyMobileStageLayout, { passive: true });
const APP_ORDER_KEY = "ycswu-special-edition-app-order";
const ROOMS_TRANSFER_TARGET_KINDS = {
  "ngon-junk": "model3d",
  "pixelmaxxxing": "still-image",
  "moire-maker": "still-image",
  "kira-kira": "still-image",
  "hot-vs-nice": "vector"
};

const ROOMS_DEFAULT_OBJ = `# YCSWU Rooms default model handoff
o ycswu_rooms_default_room
v -1.000000 -0.650000 0.000000
v 1.000000 -0.650000 0.000000
v 1.000000 0.650000 0.000000
v -1.000000 0.650000 0.000000
v -1.000000 -0.650000 0.850000
v 1.000000 -0.650000 0.850000
v 1.000000 0.650000 0.850000
v -1.000000 0.650000 0.850000
v -0.820000 -0.655000 0.180000
v -0.220000 -0.655000 0.180000
v -0.220000 -0.655000 0.660000
v -0.820000 -0.655000 0.660000
v 0.260000 0.655000 0.160000
v 0.820000 0.655000 0.160000
v 0.820000 0.655000 0.660000
v 0.260000 0.655000 0.660000
vn 0.000000 0.000000 1.000000
vn 0.000000 -1.000000 0.000000
vn 0.000000 1.000000 0.000000
vn -1.000000 0.000000 0.000000
vn 1.000000 0.000000 0.000000
vn 0.000000 0.000000 -1.000000
f 1//6 2//6 3//6 4//6
f 5//1 8//1 7//1 6//1
f 1//2 5//2 6//2 2//2
f 4//3 3//3 7//3 8//3
f 1//4 4//4 8//4 5//4
f 2//5 6//5 7//5 3//5
f 9//2 10//2 11//2 12//2
f 13//3 16//3 15//3 14//3
`;

const EMBEDDED_UI_CSS = `
  :root,
  * {
    scrollbar-width: thin !important;
    scrollbar-color: #d9dcdd #171b1f !important;
  }

  *,
  *::before,
  *::after {
    border-radius: 0 !important;
    -webkit-user-select: none !important;
    user-select: none !important;
  }

  ::selection {
    background: transparent !important;
    color: inherit !important;
  }

  input,
  textarea,
  select,
  [contenteditable="true"] {
    -webkit-user-select: text !important;
    user-select: text !important;
  }

  input::selection,
  textarea::selection,
  [contenteditable="true"]::selection {
    background: rgba(210, 218, 224, 0.55) !important;
    color: inherit !important;
  }

  html,
  body {
    width: 100% !important;
    min-width: 0 !important;
    height: 100% !important;
    min-height: 100% !important;
    margin: 0 !important;
    box-sizing: border-box !important;
    background: #ffffff !important;
  }

  body.special-edition-embedded {
    position: relative !important;
    width: 100% !important;
    height: 100% !important;
    min-height: 100% !important;
    margin: 0 !important;
    overflow: hidden !important;
    background: #ffffff !important;
  }

  body.special-edition-embedded::before {
    content: "" !important;
    position: fixed !important;
    inset: 0 !important;
    z-index: -1 !important;
    pointer-events: none !important;
    background: #ffffff !important;
  }

  body.special-edition-embedded > #root,
  body.special-edition-embedded > .app-shell,
  body.special-edition-embedded > .desktop-shell,
  body.special-edition-embedded > .app {
    height: 100% !important;
    min-height: 100% !important;
  }

  *::-webkit-scrollbar {
    width: 9px !important;
    height: 9px !important;
  }

  *::-webkit-scrollbar-track {
    background: linear-gradient(90deg, #070809, #262c31 34%, #08090a 50%, #20262b 72%, #060708) !important;
    border: 1px solid #050607 !important;
    border-radius: 0 !important;
    box-shadow: inset 0 0 4px rgba(255, 255, 255, 0.18), inset 0 0 8px rgba(0, 0, 0, 0.84) !important;
  }

  *::-webkit-scrollbar-thumb {
    background:
      linear-gradient(90deg, #626a70 0%, #fafafa 22%, #9ba2a7 44%, #f7f8f8 56%, #697178 100%),
      repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.28) 0 1px, rgba(0, 0, 0, 0.12) 1px 3px) !important;
    border: 1px solid #050607 !important;
    border-radius: 0 !important;
    box-shadow: inset 1px 0 0 rgba(255, 255, 255, 0.72), inset -1px 0 0 rgba(0, 0, 0, 0.45), 0 0 4px rgba(255, 255, 255, 0.18) !important;
  }

  *::-webkit-scrollbar-button {
    display: none !important;
    width: 0 !important;
    height: 0 !important;
  }

  body,
  button,
  input,
  select,
  textarea,
  label,
  output,
  p,
  span,
  small,
  a,
  li,
  td,
  th {
    font-family: "Courier New", Courier, monospace !important;
    font-size: 13px !important;
    line-height: 1.28 !important;
    letter-spacing: 0 !important;
  }

  h1,
  h2,
  h3,
  h4,
  h5,
  h6,
  legend,
  .title,
  .heading,
  .panel-title,
  .pane-title,
  .preview-header,
  .topbar-status,
  .topbar-metric,
  .topbar-metric strong {
    font-family: "Courier New", Courier, monospace !important;
    font-size: 14px !important;
    line-height: 1.15 !important;
    letter-spacing: 0 !important;
  }

  body.special-edition-embedded .preview-topbar,
  body.special-edition-embedded .preview-toolbar,
  body.special-edition-embedded .preview-controls,
  body.special-edition-embedded .preview-actions,
  body.special-edition-embedded .preview-toggle-group,
  body.special-edition-embedded .canvas-actions,
  body.special-edition-embedded .thumb-tools,
  body.special-edition-embedded .topbar,
  body.special-edition-embedded .toolbar,
  body.special-edition-embedded .tool-bar,
  body.special-edition-embedded .toolbar-slider,
  body.special-edition-embedded .toolbar-group,
  body.special-edition-embedded .control-bar,
  body.special-edition-embedded .viewport-toolbar,
  body.special-edition-embedded .viewport-controls,
  body.special-edition-embedded .viewport-panel-slot,
  body.special-edition-embedded .scene-toolbar,
  body.special-edition-embedded .scene-controls,
  body.special-edition-embedded .floating-toolbar,
  body.special-edition-embedded .export-panel,
  body.special-edition-embedded [class*="preview-toolbar"],
  body.special-edition-embedded [class*="preview-controls"],
  body.special-edition-embedded [class*="preview-actions"],
  body.special-edition-embedded [class*="viewport-toolbar"],
  body.special-edition-embedded [class*="viewport-controls"],
  body.special-edition-embedded [class*="scene-toolbar"],
  body.special-edition-embedded [class*="scene-controls"],
  body.special-edition-embedded [class*="topbar"] {
    display: none !important;
  }

  body.special-edition-app-fibonacci-grid-maker .topbar,
  body.special-edition-app-fibonacci-grid-maker .export-panel {
    display: flex !important;
  }

  body.special-edition-app-fibonacci-grid-maker .custom-pair.is-hidden {
    display: none !important;
  }

  body.special-edition-app-ngon-junk,
  body.special-edition-app-ngon-junk #root,
  body.special-edition-app-ngon-junk .app-shell {
    width: 100vw !important;
    height: 100vh !important;
    min-height: 0 !important;
    max-width: 100vw !important;
    max-height: 100vh !important;
    overflow: hidden !important;
    box-sizing: border-box !important;
  }

  body.special-edition-app-ngon-junk .app-shell {
    grid-template-columns: minmax(248px, 296px) minmax(0, 1fr) !important;
    gap: 8px !important;
    padding: 8px 12px 8px 8px !important;
  }

  body.special-edition-app-ngon-junk .sidebar {
    display: flex !important;
    flex-direction: column !important;
    min-width: 0 !important;
    min-height: 0 !important;
    max-height: 100% !important;
    gap: 9px !important;
    overflow-x: hidden !important;
    overflow-y: auto !important;
    padding: 8px 10px 8px 8px !important;
    scrollbar-gutter: stable !important;
    visibility: visible !important;
    opacity: 1 !important;
  }

  body.special-edition-app-ngon-junk .topline,
  body.special-edition-app-ngon-junk .toolbar,
  body.special-edition-app-ngon-junk .slider-head {
    display: flex !important;
    min-height: 24px !important;
    visibility: visible !important;
    opacity: 1 !important;
  }

  body.special-edition-app-ngon-junk .toolbar.toolbar-grid {
    display: grid !important;
    grid-template-columns: 1fr !important;
    grid-template-rows: 30px 30px 30px !important;
    align-items: stretch !important;
    justify-content: stretch !important;
    gap: 7px !important;
    width: 100% !important;
    min-height: 104px !important;
    height: auto !important;
    overflow: visible !important;
    margin-bottom: 9px !important;
    visibility: visible !important;
    opacity: 1 !important;
  }

  body.special-edition-app-ngon-junk .toolbar-grid > .ui-button,
  body.special-edition-app-ngon-junk .toolbar-grid > .toolbar-sample-button,
  body.special-edition-app-ngon-junk .toolbar-grid > .toolbar-toggle {
    display: block !important;
    width: 100% !important;
    min-height: 30px !important;
    height: 30px !important;
    max-height: 30px !important;
    margin: 0 !important;
    box-sizing: border-box !important;
    padding: 6px 8px !important;
    font-size: 10px !important;
    line-height: 1.15 !important;
    position: relative !important;
    visibility: visible !important;
    opacity: 1 !important;
  }

  body.special-edition-app-ngon-junk .toolbar-grid > .toolbar-toggle {
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    gap: 8px !important;
  }

  body.special-edition-app-ngon-junk .toolbar-grid > .toolbar-toggle .chip {
    min-width: 54px !important;
    height: 26px !important;
    padding: 5px 8px !important;
  }

  body.special-edition-app-ngon-junk .toolbar-grid > .toolbar-sample-button {
    color: #000 !important;
    background: #fff !important;
    border: 1px solid #000 !important;
  }

  body.special-edition-app-ngon-junk .sidebar > .toolbar-grid + input + input + .panel,
  body.special-edition-app-ngon-junk .toolbar-grid + .toolbar,
  body.special-edition-app-ngon-junk .toolbar + .panel {
    margin-top: 9px !important;
  }

  body.special-edition-app-ngon-junk .viewer-panel {
    min-width: 0 !important;
    min-height: 0 !important;
    max-width: 100% !important;
    max-height: 100% !important;
    overflow: hidden !important;
    position: relative !important;
  }

  body.special-edition-app-ngon-junk .background-panel,
  body.special-edition-app-ngon-junk .light-panel,
  body.special-edition-app-ngon-junk .aa-panel,
  body.special-edition-app-ngon-junk .retopo-panel,
  body.special-edition-app-ngon-junk .uv-panel {
    width: auto !important;
    min-width: 62px !important;
    padding: 6px !important;
    gap: 4px !important;
  }

  body.special-edition-app-ngon-junk .panel-collapse-chip {
    min-width: 24px !important;
    min-height: 24px !important;
    padding: 2px 6px !important;
  }

  body.special-edition-app-ngon-junk .viewer-export-bar {
    display: flex !important;
    bottom: 14px !important;
    left: 50% !important;
    top: auto !important;
    right: auto !important;
    max-width: calc(100% - 56px) !important;
    padding: 4px !important;
    gap: 3px !important;
    z-index: 12 !important;
    overflow-x: auto !important;
    overflow-y: visible !important;
    transform: translateX(-50%) !important;
  }

  body.special-edition-app-ngon-junk .special-edition-background-panel {
    position: absolute !important;
    left: var(--special-background-left, 14px) !important;
    top: var(--special-background-top, 50%) !important;
    bottom: auto !important;
    transform: var(--special-background-transform, translateY(-50%)) !important;
    z-index: 13 !important;
    display: grid !important;
    gap: 6px !important;
    width: 268px !important;
    max-width: calc(100% - 28px) !important;
    max-height: calc(100% - 104px) !important;
    padding: 6px !important;
    overflow: visible !important;
    background: rgba(255, 255, 255, 0.96) !important;
    border: 1px solid #000 !important;
    box-sizing: border-box !important;
  }

  body.special-edition-app-ngon-junk .special-edition-background-panel.is-collapsed {
    width: auto !important;
    min-width: 94px !important;
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    overflow: visible !important;
  }

  body.special-edition-app-ngon-junk .special-edition-background-panel.is-collapsed .special-edition-background-body {
    display: none !important;
  }

  body.special-edition-app-ngon-junk .special-edition-background-title {
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    gap: 8px !important;
    width: 100% !important;
    color: #000 !important;
    background: #fff !important;
    border: 1px dashed #000 !important;
    padding: 4px 6px !important;
    font-size: 10px !important;
    text-transform: lowercase !important;
    cursor: grab !important;
    touch-action: none !important;
    user-select: none !important;
  }

  body.special-edition-app-ngon-junk .special-edition-background-panel.is-dragging .special-edition-background-title {
    cursor: grabbing !important;
  }

  body.special-edition-app-ngon-junk .special-edition-background-body {
    display: grid !important;
    gap: 6px !important;
    min-width: 0 !important;
  }

  body.special-edition-app-ngon-junk .special-edition-background-panel .viewer-export-group {
    display: grid !important;
    gap: 6px !important;
    width: 100% !important;
    max-width: none !important;
  }

  body.special-edition-app-ngon-junk .special-edition-background-panel .viewer-gradient-stack,
  body.special-edition-app-ngon-junk .special-edition-background-panel .viewer-gradient-controls {
    display: flex !important;
    flex-wrap: wrap !important;
    align-items: center !important;
    gap: 4px !important;
    width: 100% !important;
  }

  body.special-edition-app-ngon-junk .special-edition-background-panel .viewer-color-chip {
    display: flex !important;
    align-items: center !important;
    gap: 6px !important;
    width: 100% !important;
  }

  body.special-edition-app-ngon-junk .background-panel {
    left: 14px !important;
    top: 58px !important;
    bottom: auto !important;
    transform: none !important;
    width: 268px !important;
    max-width: calc(100% - 28px) !important;
    max-height: calc(100% - 104px) !important;
    overflow: auto !important;
  }

  body.special-edition-app-ngon-junk .background-panel.panel-collapsed {
    width: auto !important;
    min-width: 94px !important;
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    overflow: visible !important;
  }

  body.special-edition-app-ngon-junk .viewer-export-bar.special-edition-export-free {
    bottom: auto !important;
    left: var(--special-export-left, 50%) !important;
    top: var(--special-export-top, auto) !important;
    right: auto !important;
    transform: none !important;
  }

  body.special-edition-app-ngon-junk .viewer-export-bar.special-edition-export-collapsed {
    width: auto !important;
    min-width: 0 !important;
    max-width: none !important;
    height: auto !important;
    min-height: 0 !important;
    max-height: 38px !important;
    align-items: center !important;
    overflow: visible !important;
  }

  body.special-edition-app-ngon-junk .viewer-export-bar.special-edition-export-collapsed > :not(.viewer-export-title) {
    display: none !important;
  }

  body.special-edition-app-ngon-junk .viewer-export-title {
    cursor: grab !important;
    border: 1px dashed #000 !important;
    background: #fff !important;
    padding: 4px 6px !important;
    white-space: nowrap !important;
    user-select: none !important;
  }

  body.special-edition-app-ngon-junk .viewer-export-group,
  body.special-edition-app-ngon-junk .viewer-export-group-compact,
  body.special-edition-app-ngon-junk .viewer-gradient-controls {
    gap: 3px !important;
  }

  body.special-edition-app-ngon-junk .viewer-export-title:active {
    cursor: grabbing !important;
  }

  body.special-edition-app-ngon-junk .viewer-export-button,
  body.special-edition-app-ngon-junk .viewer-export-chip,
  body.special-edition-app-ngon-junk .special-edition-export-dock {
    min-height: 28px !important;
    padding: 4px 6px !important;
    font-size: 10px !important;
  }

  body.special-edition-app-ngon-junk .viewer-export-button {
    width: 50px !important;
  }

  body.special-edition-app-ngon-junk .frame-panel {
    top: 14px !important;
    z-index: 11 !important;
  }

  body.special-edition-app-ngon-junk .frame-panel .chip,
  body.special-edition-app-ngon-junk .frame-dock-reset-chip {
    min-height: 28px !important;
    padding: 4px 7px !important;
    font-size: 10px !important;
  }

  body.special-edition-app-ngon-junk .panel-collapsed.aa-panel,
  body.special-edition-app-ngon-junk .panel-collapsed.retopo-panel,
  body.special-edition-app-ngon-junk .panel-collapsed.background-panel {
    bottom: 14px !important;
  }

  body.special-edition-app-ngon-junk .panel-collapsed.aa-panel {
    top: auto !important;
    left: 14px !important;
    right: auto !important;
    width: auto !important;
    min-width: 84px !important;
    max-width: max-content !important;
    height: auto !important;
    min-height: 0 !important;
    max-height: 40px !important;
    display: inline-grid !important;
    align-content: center !important;
    overflow: visible !important;
  }

  body.special-edition-app-ngon-junk .panel-collapsed.aa-panel > :not(:first-child) {
    display: none !important;
  }

  body.special-edition-app-ngon-junk .panel-collapsed.aa-panel > :first-child {
    display: flex !important;
    align-items: center !important;
    width: auto !important;
    min-height: 26px !important;
  }

  body.special-edition-app-hot-vs-nice,
  body.special-edition-app-gift-converter,
  body.special-edition-app-giffer {
    width: 100vw !important;
    height: 100vh !important;
    min-height: 0 !important;
    max-width: 100vw !important;
    max-height: 100vh !important;
    overflow: hidden !important;
  }

  body.special-edition-app-hot-vs-nice #root,
  body.special-edition-app-gift-converter #root,
  body.special-edition-app-giffer #root {
    width: 100vw !important;
    height: 100vh !important;
    min-height: 0 !important;
    overflow: hidden !important;
  }

  body.special-edition-app-hot-vs-nice .app-shell,
  body.special-edition-app-giffer .app-shell,
  body.special-edition-app-gift-converter .desktop-shell {
    width: 100vw !important;
    height: 100vh !important;
    min-height: 0 !important;
    max-width: 100vw !important;
    max-height: 100vh !important;
    overflow: hidden !important;
    box-sizing: border-box !important;
  }

  body.special-edition-app-hot-vs-nice .app-shell {
    grid-template-columns: minmax(250px, 292px) minmax(0, 1fr) !important;
    gap: 7px !important;
    padding: 8px 16px 8px 8px !important;
  }

  body.special-edition-app-gift-converter .desktop-shell {
    grid-template-columns: minmax(236px, 286px) minmax(0, 1fr) !important;
    gap: 8px !important;
    padding: 8px 16px 8px 8px !important;
  }

  body.special-edition-app-giffer .app-shell {
    grid-template-columns: minmax(246px, 292px) minmax(0, 1fr) !important;
    gap: 8px !important;
    padding: 8px 16px 8px 8px !important;
  }

  body.special-edition-app-hot-vs-nice .sidebar,
  body.special-edition-app-giffer .left-panel,
  body.special-edition-app-gift-converter .left-panel {
    min-width: 0 !important;
    min-height: 0 !important;
    max-height: 100% !important;
    overflow-x: hidden !important;
    overflow-y: auto !important;
    scrollbar-gutter: stable !important;
  }

  body.special-edition-app-hot-vs-nice .main-panel,
  body.special-edition-app-hot-vs-nice main,
  body.special-edition-app-hot-vs-nice .workspace,
  body.special-edition-app-giffer .workspace,
  body.special-edition-app-gift-converter .right-panel,
  body.special-edition-app-gift-converter .workspace-board {
    min-width: 0 !important;
    min-height: 0 !important;
    max-width: 100% !important;
    max-height: 100% !important;
    overflow: hidden !important;
  }

  body.special-edition-app-hot-vs-nice .scroll-shell,
  body.special-edition-app-hot-vs-nice .history-strip,
  body.special-edition-app-hot-vs-nice .variants-panel,
  body.special-edition-app-hot-vs-nice [class*="scroll"],
  body.special-edition-app-giffer .preview-panel,
  body.special-edition-app-giffer .preview-toolbar,
  body.special-edition-app-giffer .thumb-strip,
  body.special-edition-app-gift-converter .board-scroll {
    min-width: 0 !important;
    min-height: 0 !important;
    max-width: 100% !important;
    overflow-x: hidden !important;
    overflow-y: auto !important;
    scrollbar-gutter: stable !important;
    padding-right: 3px !important;
  }

  body.special-edition-app-hot-vs-nice .panel,
  body.special-edition-app-giffer .left-panel,
  body.special-edition-app-giffer .preview-panel,
  body.special-edition-app-gift-converter .left-panel,
  body.special-edition-app-gift-converter .board-topline {
    padding-right: 10px !important;
  }

  body.special-edition-app-hot-vs-nice button,
  body.special-edition-app-hot-vs-nice input,
  body.special-edition-app-hot-vs-nice select,
  body.special-edition-app-hot-vs-nice textarea,
  body.special-edition-app-gift-converter button,
  body.special-edition-app-gift-converter input,
  body.special-edition-app-gift-converter select,
  body.special-edition-app-giffer button,
  body.special-edition-app-giffer input,
  body.special-edition-app-giffer select {
    font-size: 11px !important;
  }

  body.special-edition-app-giffer .app-shell {
    align-items: stretch !important;
  }

  body.special-edition-app-giffer .left-panel {
    height: calc(100vh - 16px) !important;
    max-height: calc(100vh - 16px) !important;
    padding-bottom: 28px !important;
    overscroll-behavior: contain !important;
  }

  body.special-edition-app-giffer .left-panel > :last-child {
    margin-bottom: 24px !important;
  }

  body.special-edition-app-giffer .workspace,
  body.special-edition-app-giffer .preview-panel {
    height: calc(100vh - 16px) !important;
    max-height: calc(100vh - 16px) !important;
  }

  body.special-edition-app-giffer .preview-panel.is-split {
    align-items: stretch !important;
    grid-template-columns: minmax(250px, 0.92fr) minmax(340px, 1.08fr) !important;
    overflow: hidden !important;
  }

  body.special-edition-app-giffer .preview-panel.is-split .preview-pane {
    min-height: 0 !important;
    max-height: 100% !important;
    overflow: hidden !important;
  }

  body.special-edition-app-giffer .preview-panel.is-split .video-stage,
  body.special-edition-app-giffer .preview-panel.is-split .preview-stage {
    min-height: 0 !important;
    height: min(48vh, 410px) !important;
  }

  body.special-edition-app-giffer .preview-panel.is-split .video-controls,
  body.special-edition-app-giffer .preview-panel.is-split .preview-toolbar,
  body.special-edition-app-giffer .preview-panel.is-split .thumb-tools {
    flex: 0 0 auto !important;
    display: flex !important;
  }

  body.special-edition-app-giffer .preview-panel.is-split .thumb-strip {
    flex: 0 1 112px !important;
    max-height: 112px !important;
  }

  body.special-edition-app-hot-vs-nice {
    height: 100vh !important;
    max-height: 100vh !important;
    overflow-x: hidden !important;
    overflow-y: hidden !important;
  }

  body.special-edition-app-hot-vs-nice #root,
  body.special-edition-app-hot-vs-nice .app-shell {
    height: 100vh !important;
    min-height: 0 !important;
    max-height: 100vh !important;
    overflow: hidden !important;
  }

  body.special-edition-app-hot-vs-nice .sidebar,
  body.special-edition-app-hot-vs-nice .main-panel,
  body.special-edition-app-hot-vs-nice main,
  body.special-edition-app-hot-vs-nice .workspace {
    max-height: 100% !important;
  }

  body.special-edition-app-hot-vs-nice .app-shell {
    padding: 8px 14px 8px 8px !important;
  }

  body.special-edition-app-hot-vs-nice .workspace {
    display: flex !important;
    flex-direction: column !important;
    gap: 7px !important;
    height: 100% !important;
    min-height: 0 !important;
    overflow-x: hidden !important;
    overflow-y: auto !important;
    padding-right: 5px !important;
    scrollbar-gutter: stable !important;
  }

  body.special-edition-app-hot-vs-nice .workspace > .panel,
  body.special-edition-app-hot-vs-nice .preview-grid,
  body.special-edition-app-hot-vs-nice .variant-grid {
    flex: 0 0 auto !important;
    max-width: 100% !important;
  }

  body.special-edition-app-hot-vs-nice .topbar {
    display: block !important;
    flex: 0 0 auto !important;
    min-height: 74px !important;
    max-height: 132px !important;
    overflow: hidden !important;
  }

  body.special-edition-app-hot-vs-nice .history-strip {
    display: flex !important;
    min-height: 30px !important;
    max-height: 72px !important;
    overflow-y: auto !important;
  }

  body.special-edition-app-2d-to-3d {
    width: 100vw !important;
    height: 100vh !important;
    min-height: 0 !important;
    max-width: 100vw !important;
    max-height: 100vh !important;
    overflow: hidden !important;
    font-size: 11px !important;
  }

  body.special-edition-app-2d-to-3d #root {
    width: 100vw !important;
    height: 100vh !important;
    min-height: 0 !important;
    overflow: hidden !important;
  }

  body.special-edition-app-2d-to-3d .app-shell {
    width: 100vw !important;
    height: 100vh !important;
    min-height: 0 !important;
    max-width: 100vw !important;
    max-height: 100vh !important;
    overflow: hidden !important;
    align-items: stretch !important;
    gap: 7px !important;
    padding: 7px 16px 7px 9px !important;
    grid-template-columns: minmax(236px, 296px) minmax(0, 1fr) !important;
  }

  body.special-edition-app-2d-to-3d .sidebar {
    min-width: 0 !important;
    min-height: 0 !important;
    max-height: 100% !important;
    gap: 7px !important;
    overflow-x: hidden !important;
    overflow-y: auto !important;
    padding-right: 3px !important;
  }

  body.special-edition-app-2d-to-3d .viewport-panel {
    position: relative !important;
    top: 0 !important;
    align-self: stretch !important;
    width: 100% !important;
    min-width: 0 !important;
    min-height: 0 !important;
    height: 100% !important;
    max-height: 100% !important;
    overflow: hidden !important;
  }

  body.special-edition-app-2d-to-3d .viewport-stage {
    max-width: 100% !important;
    max-height: 100% !important;
  }

  body.special-edition-app-2d-to-3d .viewport-stage-framed {
    height: calc(100% - 22px) !important;
    max-width: calc(100% - 22px) !important;
    max-height: calc(100% - 22px) !important;
  }

  body.special-edition-app-2d-to-3d .panel {
    gap: 6px !important;
    padding: 8px !important;
  }

  body.special-edition-app-2d-to-3d .brand-row,
  body.special-edition-app-2d-to-3d .status-row,
  body.special-edition-app-2d-to-3d .button-row,
  body.special-edition-app-2d-to-3d .inline-row,
  body.special-edition-app-2d-to-3d .field-grid,
  body.special-edition-app-2d-to-3d .slider-field,
  body.special-edition-app-2d-to-3d .source-tabs,
  body.special-edition-app-2d-to-3d .color-grid,
  body.special-edition-app-2d-to-3d .preset-grid,
  body.special-edition-app-2d-to-3d .stat-grid,
  body.special-edition-app-2d-to-3d .background-grid {
    gap: 5px !important;
  }

  body.special-edition-app-2d-to-3d .brand {
    font-size: 13px !important;
    line-height: 1.05 !important;
  }

  body.special-edition-app-2d-to-3d .panel-title,
  body.special-edition-app-2d-to-3d .floating-title,
  body.special-edition-app-2d-to-3d .field-label,
  body.special-edition-app-2d-to-3d .slider-label,
  body.special-edition-app-2d-to-3d .helper,
  body.special-edition-app-2d-to-3d .viewport-note {
    font-size: 10px !important;
    line-height: 1.18 !important;
  }

  body.special-edition-app-2d-to-3d .chip,
  body.special-edition-app-2d-to-3d .action-button,
  body.special-edition-app-2d-to-3d .tab-button,
  body.special-edition-app-2d-to-3d button {
    min-height: 24px !important;
    padding: 4px 6px !important;
    font-size: 10px !important;
  }

  body.special-edition-app-2d-to-3d .text-align-button {
    width: 24px !important;
    height: 24px !important;
    padding: 0 !important;
  }

  body.special-edition-app-2d-to-3d .select-input,
  body.special-edition-app-2d-to-3d .value-input,
  body.special-edition-app-2d-to-3d input,
  body.special-edition-app-2d-to-3d select {
    min-height: 24px !important;
    padding: 3px 5px !important;
    font-size: 10px !important;
  }

  body.special-edition-app-2d-to-3d .text-input {
    min-height: 58px !important;
    padding: 6px !important;
    font-size: 10px !important;
  }

  body.special-edition-app-2d-to-3d .viewport-panel-slot,
  body.special-edition-app-2d-to-3d [class*="viewport-panel-slot"] {
    display: block !important;
  }

  body.special-edition-app-2d-to-3d .viewport-panel-slot.special-edition-2d-panel-minimized,
  body.special-edition-app-2d-to-3d [class*="viewport-panel-slot"].special-edition-2d-panel-minimized {
    width: auto !important;
    min-width: 0 !important;
    max-width: none !important;
    height: auto !important;
    overflow: visible !important;
  }

  body.special-edition-app-2d-to-3d .special-edition-2d-panel-minimized .floating-shell,
  body.special-edition-app-2d-to-3d .special-edition-2d-panel-minimized [class*="floating-shell"] {
    width: auto !important;
    min-width: 58px !important;
    max-width: none !important;
    padding: 4px !important;
  }

  body.special-edition-app-2d-to-3d .special-edition-2d-panel-minimized .floating-body,
  body.special-edition-app-2d-to-3d .special-edition-2d-panel-minimized [class*="floating-body"],
  body.special-edition-app-2d-to-3d .special-edition-2d-panel-minimized .panel-body,
  body.special-edition-app-2d-to-3d .special-edition-2d-panel-minimized [class*="panel-body"] {
    display: none !important;
  }

  body.special-edition-app-2d-to-3d .viewport-panel-slot .floating-header,
  body.special-edition-app-2d-to-3d [class*="viewport-panel-slot"] [class*="floating-header"] {
    cursor: pointer !important;
  }

  body.special-edition-app-pixelmaxxxing {
    overflow: hidden !important;
    background: #f0f0ec !important;
  }

  body.special-edition-app-pixelmaxxxing .app-shell {
    height: 100vh !important;
    width: 100% !important;
    min-width: 0 !important;
    overflow: hidden !important;
    display: grid !important;
    grid-template-columns: clamp(360px, 31vw, 460px) minmax(0, 1fr) !important;
    grid-template-rows: minmax(0, 1fr) !important;
    gap: 10px !important;
    padding: 10px !important;
  }

  body.special-edition-app-pixelmaxxxing .control-grid {
    grid-template-columns: 1fr !important;
    gap: 10px !important;
  }

  body.special-edition-app-pixelmaxxxing .mosaic-card,
  body.special-edition-app-pixelmaxxxing .selection-card,
  body.special-edition-app-pixelmaxxxing .text-card,
  body.special-edition-app-pixelmaxxxing .action-card,
  body.special-edition-app-pixelmaxxxing .palette-card {
    grid-column: 1 / -1 !important;
    min-height: 0 !important;
  }

  body.special-edition-app-pixelmaxxxing .control-panel,
  body.special-edition-app-pixelmaxxxing .preview-panel {
    min-height: 0 !important;
    padding: 10px !important;
    border-color: #d4d4ce !important;
  }

  body.special-edition-app-pixelmaxxxing .control-panel {
    overflow: auto !important;
    gap: 9px !important;
  }

  body.special-edition-app-pixelmaxxxing .preview-panel {
    display: flex !important;
    flex-direction: column !important;
    gap: 6px !important;
    overflow: hidden !important;
  }

  body.special-edition-embedded.special-edition-app-pixelmaxxxing .preview-topbar,
  body.special-edition-embedded.special-edition-app-pixelmaxxxing .preview-topbar-left {
    display: flex !important;
    visibility: visible !important;
    opacity: 1 !important;
  }

  body.special-edition-app-pixelmaxxxing .preview-topbar {
    flex: 0 0 auto !important;
    align-items: center !important;
    justify-content: space-between !important;
    flex-wrap: wrap !important;
    gap: 6px 10px !important;
    min-height: 28px !important;
    margin: 0 0 2px !important;
    overflow: visible !important;
  }

  body.special-edition-app-pixelmaxxxing .preview-topbar-left {
    align-items: center !important;
    flex-wrap: wrap !important;
    gap: 6px 8px !important;
    min-width: 0 !important;
  }

  body.special-edition-embedded.special-edition-app-pixelmaxxxing .preview-mode-actions,
  body.special-edition-embedded.special-edition-app-pixelmaxxxing .zoom-controls,
  body.special-edition-embedded.special-edition-app-pixelmaxxxing .preview-toggle-group {
    display: flex !important;
    visibility: visible !important;
    opacity: 1 !important;
  }

  body.special-edition-app-pixelmaxxxing .preview-mode-actions,
  body.special-edition-app-pixelmaxxxing .zoom-controls,
  body.special-edition-app-pixelmaxxxing .preview-toggle-group,
  body.special-edition-app-pixelmaxxxing .toggle-buttons {
    align-items: center !important;
    flex-wrap: nowrap !important;
    gap: 4px !important;
  }

  body.special-edition-app-pixelmaxxxing .image-size-info,
  body.special-edition-app-pixelmaxxxing .preview-toggle-label,
  body.special-edition-app-pixelmaxxxing .zoom-value {
    display: inline-flex !important;
    align-items: center !important;
    min-height: 22px !important;
    margin: 0 !important;
    white-space: nowrap !important;
    font-size: 10px !important;
    line-height: 1 !important;
  }

  body.special-edition-app-pixelmaxxxing .preview-topbar button {
    min-height: 22px !important;
    padding: 3px 7px !important;
    font-size: 10px !important;
    line-height: 1 !important;
  }

  body.special-edition-app-pixelmaxxxing .zoom-controls .small-button {
    min-width: 24px !important;
    padding-inline: 6px !important;
  }

  body.special-edition-app-pixelmaxxxing .control-card {
    padding: 10px !important;
  }

  body.special-edition-app-pixelmaxxxing .top-title {
    align-items: flex-start !important;
    justify-content: flex-start !important;
    gap: 10px !important;
  }

  body.special-edition-app-pixelmaxxxing .top-title .title-copy {
    display: none !important;
  }

  body.special-edition-app-pixelmaxxxing .title-tools {
    min-width: 0 !important;
    width: 100% !important;
    justify-content: flex-start !important;
  }

  body.special-edition-app-pixelmaxxxing .title-upload {
    width: min(100%, 470px) !important;
  }

  body.special-edition-app-pixelmaxxxing .title-upload label {
    margin: 0 0 4px !important;
    text-align: left !important;
  }

  body.special-edition-app-pixelmaxxxing .custom-file-picker {
    display: grid !important;
    grid-template-columns: minmax(150px, 220px) minmax(0, 1fr) !important;
    gap: 8px !important;
  }

  body.special-edition-app-pixelmaxxxing .file-name-label {
    min-width: 0 !important;
  }

  body.special-edition-app-pixelmaxxxing .canvas-frame {
    flex: 1 1 0 !important;
    width: 100% !important;
    height: auto !important;
    min-height: 220px !important;
    max-height: none !important;
    align-items: center !important;
    justify-content: center !important;
    overflow: hidden !important;
  }

  body.special-edition-embedded.special-edition-app-pixelmaxxxing .canvas-actions,
  body.special-edition-embedded.special-edition-app-pixelmaxxxing .canvas-background-controls,
  body.special-edition-embedded.special-edition-app-pixelmaxxxing .export-actions,
  body.special-edition-embedded.special-edition-app-pixelmaxxxing .frame-actions {
    display: flex !important;
    visibility: visible !important;
    opacity: 1 !important;
  }

  body.special-edition-app-pixelmaxxxing .canvas-actions {
    flex: 0 0 auto !important;
    align-items: center !important;
    justify-content: space-between !important;
    flex-wrap: wrap !important;
    gap: 6px 10px !important;
    margin-top: 4px !important;
    overflow: visible !important;
  }

  body.special-edition-app-pixelmaxxxing .canvas-background-controls,
  body.special-edition-app-pixelmaxxxing .export-actions,
  body.special-edition-app-pixelmaxxxing .frame-actions {
    align-items: center !important;
    flex-wrap: nowrap !important;
    gap: 5px !important;
    min-width: 0 !important;
  }

  body.special-edition-app-pixelmaxxxing .frame-actions {
    margin-left: 0 !important;
  }

  body.special-edition-app-pixelmaxxxing .toolbar-label {
    font-size: 10px !important;
    line-height: 1 !important;
    white-space: nowrap !important;
  }

  body.special-edition-app-pixelmaxxxing .background-swatch {
    width: 24px !important;
    min-width: 24px !important;
    height: 24px !important;
    min-height: 24px !important;
    padding: 0 !important;
  }

  body.special-edition-app-pixelmaxxxing .compact-export-button,
  body.special-edition-app-pixelmaxxxing .frame-button {
    min-height: 24px !important;
    padding: 4px 8px !important;
    font-size: 10px !important;
    line-height: 1 !important;
  }

  body.special-edition-app-pixelmaxxxing .preview-stage,
  body.special-edition-app-pixelmaxxxing #preview-stage,
  body.special-edition-app-pixelmaxxxing #preview-canvas {
    max-width: 100% !important;
    max-height: 100% !important;
  }

  body.special-edition-app-pixelmaxxxing .preview-status {
    margin: 0 0 4px !important;
    min-height: 0 !important;
  }

  body.special-edition-app-pixelmaxxxing .text-layout {
    grid-template-columns: 1fr !important;
  }

  body.special-edition-app-pixelmaxxxing .text-toolbar-stack {
    display: grid !important;
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    gap: 6px !important;
  }

  body.special-edition-app-pixelmaxxxing .grid-inputs.triple {
    grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
    gap: 8px !important;
  }

  body.special-edition-app-pixelmaxxxing .selection-actions,
  body.special-edition-app-pixelmaxxxing .replace-row,
  body.special-edition-app-pixelmaxxxing .action-layout {
    gap: 8px !important;
  }

  body.special-edition-app-pixelmaxxxing .selection-actions {
    grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
  }

  body.special-edition-app-pixelmaxxxing .replace-row,
  body.special-edition-app-pixelmaxxxing .action-layout,
  body.special-edition-app-pixelmaxxxing .double-actions,
  body.special-edition-app-pixelmaxxxing .text-settings-grid,
  body.special-edition-app-pixelmaxxxing .tile-fill-grid,
  body.special-edition-app-pixelmaxxxing .tile-fill-actions {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  }

  body.special-edition-app-pixelmaxxxing .palette-list {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    max-height: 170px !important;
  }

  body.special-edition-app-pixelmaxxxing .text-layer-list {
    min-height: 54px !important;
    max-height: 92px !important;
  }

  body.special-edition-app-pixelmaxxxing .card-heading h3,
  body.special-edition-app-pixelmaxxxing label,
  body.special-edition-app-pixelmaxxxing .hint,
  body.special-edition-app-pixelmaxxxing .static-hint,
  body.special-edition-app-pixelmaxxxing button,
  body.special-edition-app-pixelmaxxxing input,
  body.special-edition-app-pixelmaxxxing select {
    font-size: 11px !important;
  }

  body.special-edition-app-pixelmaxxxing button,
  body.special-edition-app-pixelmaxxxing input,
  body.special-edition-app-pixelmaxxxing select {
    min-height: 30px !important;
    padding: 6px 8px !important;
  }

  body.special-edition-app-pixelmaxxxing input[type="color"] {
    height: 30px !important;
    min-height: 30px !important;
    padding: 3px !important;
  }

  body.special-edition-app-pixelmaxxxing input[type="range"] {
    min-height: 18px !important;
    padding: 0 !important;
  }

  body.special-edition-app-pixelmaxxxing input:not([type="range"]):not([type="color"]),
  body.special-edition-app-pixelmaxxxing textarea {
    -webkit-user-select: text !important;
    user-select: text !important;
    cursor: text !important;
    pointer-events: auto !important;
    touch-action: auto !important;
  }
`;

const MOBILE_BRIDGE_SESSION_ID = `bridge-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
const VIEWPORT_CAPTURE_IMAGE_TARGETS = new Set(["kira-kira", "moire-maker", "pixelmaxxxing"]);

const state = {
  registry: null,
  store: { assets: [], transfers: [] },
  assetRoutes: {},
  selectedAppId: "",
  activeAppId: "",
  appOrder: [],
  selectedAssetId: "",
  workspacePath: "",
  mobileBridgeBaseUrl: "",
  mobileBridgeLocalUrl: "",
  mobileBridgeLanUrl: "",
  mobileBridgeSessionId: MOBILE_BRIDGE_SESSION_ID,
  pendingTransfer: null
};

const mobileBridgeSync = {
  requestIds: new Set(),
  uploadIds: new Set(),
  timer: 0
};

const popouts = {
  left: null,
  right: null
};

const detachDrag = {
  type: "",
  startX: 0,
  startY: 0,
  moved: false
};

const appReorderDrag = {
  appId: "",
  pointerId: -1,
  startX: 0,
  startY: 0,
  started: false
};

let suppressNextAppClick = false;

const elements = {
  shell: document.querySelector(".app-shell"),
  appRail: document.querySelector(".app-rail"),
  appList: document.querySelector("#app-list"),
  appViewport: document.querySelector(".app-viewport"),
  busRail: document.querySelector(".bus-rail"),
  selectedAppFocus: document.querySelector(".bus-rail .side-focus"),
  selectedAppIcon: document.querySelector("#selected-app-icon"),
  selectedAppName: document.querySelector("#selected-app-name"),
  selectedAppHeadline: document.querySelector("#selected-app-headline"),
  selectedAppContract: document.querySelector("#selected-app-contract"),
  phoneBridgeLink: document.querySelector("#phone-bridge-link"),
  phoneBridgeQr: document.querySelector("#phone-bridge-qr"),
  phoneBridgeLabel: document.querySelector("#phone-bridge-label"),
  handoffTargets: document.querySelector("#handoff-targets"),
  viewportTitle: document.querySelector("#viewport-title"),
  viewportMeta: document.querySelector("#viewport-meta"),
  viewportHost: document.querySelector("#viewport-host"),
  reloadApp: document.querySelector("#reload-app"),
  ycswuLink: document.querySelector(".ycswu-metal-link"),
  transferModal: document.querySelector("#transfer-modal"),
  transferModalTitle: document.querySelector("#transfer-modal-title"),
  transferModalBody: document.querySelector("#transfer-modal-body"),
  cancelTransfer: document.querySelector("#cancel-transfer"),
  confirmTransfer: document.querySelector("#confirm-transfer")
};

let hitboxDebugLayer = null;
let hitboxDebugFrame = 0;

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getMobileBridgeUrl(appEntry, options = {}) {
  if (!appEntry?.id) {
    return "";
  }

  const baseUrl = (options.preferLocal && state.mobileBridgeLocalUrl)
    ? state.mobileBridgeLocalUrl
    : (state.mobileBridgeBaseUrl || window.location.origin);
  if (/\.php(?:$|\?)/i.test(baseUrl)) {
    const url = new URL(baseUrl, window.location.href);
    url.searchParams.set("app", appEntry.id);
    url.searchParams.set("sid", state.mobileBridgeSessionId);
    return url.toString();
  }
  return `${baseUrl.replace(/\/$/, "")}/mobile-bridge?app=${encodeURIComponent(appEntry.id)}&sid=${encodeURIComponent(state.mobileBridgeSessionId)}`;
}

function getQrImageUrl(value) {
  if (!value) {
    return "";
  }

  if (isElectronRuntime && state.mobileBridgeLocalUrl) {
    return `${state.mobileBridgeLocalUrl.replace(/\/$/, "")}/api/qr?data=${encodeURIComponent(value)}`;
  }

  return `https://api.qrserver.com/v1/create-qr-code/?size=160x160&margin=2&ecc=M&color=ffffff&bgcolor=000000&data=${encodeURIComponent(value)}`;
}

async function loadMobileBridgeInfo() {
  if (!mobileBridgeApi.getMobileInfo) {
    state.mobileBridgeBaseUrl = window.location.origin;
    state.mobileBridgeLocalUrl = "";
    state.mobileBridgeLanUrl = "";
    return;
  }

  try {
    const info = await mobileBridgeApi.getMobileInfo();
    state.mobileBridgeLocalUrl = info?.phpBridge ? "" : (info?.localUrl || "");
    state.mobileBridgeLanUrl = info?.phpBridge ? "" : (info?.lanUrl || "");
    state.mobileBridgeBaseUrl = info?.mobileBridgeUrl || info?.mobileBaseUrl || info?.lanUrl || info?.localUrl || "";
  } catch {
    state.mobileBridgeBaseUrl = "";
    state.mobileBridgeLocalUrl = "";
    state.mobileBridgeLanUrl = "";
  }
}

async function openExternalUrl(url) {
  if (!url || url === "#") {
    return;
  }

  if (api.openExternal) {
    await api.openExternal(url);
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

function ensureHitboxDebugLayer() {
  if (!SHOW_HITBOX_DEBUG) {
    return null;
  }

  if (!hitboxDebugLayer) {
    hitboxDebugLayer = document.createElement("div");
    hitboxDebugLayer.className = "hitbox-debug-layer";
    hitboxDebugLayer.setAttribute("aria-hidden", "true");
    document.body.appendChild(hitboxDebugLayer);
  }

  return hitboxDebugLayer;
}

function addHitboxDebugRect(layer, rect, label, kind) {
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return;
  }

  const box = document.createElement("div");
  box.className = `hitbox-debug-rect is-${kind}`;
  box.style.left = `${rect.left}px`;
  box.style.top = `${rect.top}px`;
  box.style.width = `${rect.width}px`;
  box.style.height = `${rect.height}px`;

  const text = document.createElement("span");
  text.className = "hitbox-debug-label";
  text.textContent = label;
  box.appendChild(text);
  layer.appendChild(box);
}

function expandedButtonRect(button, container) {
  const rect = button.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const xPadding = Math.max(10, containerRect.width * 0.08);
  const yPadding = Math.max(4, rect.height * 0.08);

  return {
    left: containerRect.left - xPadding,
    top: rect.top - yPadding,
    width: containerRect.width + xPadding * 2,
    height: rect.height + yPadding * 2
  };
}

function updateHitboxDebugLayer() {
  const layer = ensureHitboxDebugLayer();
  if (!layer) {
    return;
  }

  layer.replaceChildren();

  const addElementRect = (selector, label, kind) => {
    const element = document.querySelector(selector);
    if (!element) {
      return;
    }
    addHitboxDebugRect(layer, element.getBoundingClientRect(), label, kind);
  };

  addElementRect(".topbar", "top screen", "screen");
  addElementRect(".app-rail > .rail-title", "apps title screen", "screen");
  addElementRect(".surface-header", "viewport title strip", "screen");
  addElementRect(".viewport-host", "main viewport", "viewport");
  addElementRect(".bus-rail > .panel-titlebar", "panel title screen", "screen");
  addElementRect(".side-focus", "selected app screen", "screen");

  elements.appList?.querySelectorAll("[data-app-id]").forEach((button, index) => {
    addHitboxDebugRect(
      layer,
      expandedButtonRect(button, elements.appList),
      `APP ${String(index + 1).padStart(2, "0")} ${button.dataset.appId}`,
      "app"
    );
  });

  elements.handoffTargets?.querySelectorAll("[data-target-id]").forEach((button, index) => {
    addHitboxDebugRect(
      layer,
      expandedButtonRect(button, elements.handoffTargets),
      `SEND ${String(index + 1).padStart(2, "0")} ${button.dataset.targetId}`,
      "target"
    );
  });
}

function scheduleHitboxDebugLayerUpdate() {
  if (!SHOW_HITBOX_DEBUG || hitboxDebugFrame) {
    return;
  }

  hitboxDebugFrame = window.requestAnimationFrame(() => {
    hitboxDebugFrame = 0;
    updateHitboxDebugLayer();
  });
}

function readStoredAppOrder() {
  try {
    const value = JSON.parse(localStorage.getItem(APP_ORDER_KEY) || "[]");
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function reorderRegistryApps(orderIds) {
  if (!state.registry?.apps?.length) {
    return;
  }

  const appsById = new Map(state.registry.apps.map((appEntry) => [appEntry.id, appEntry]));
  const fullOrder = [
    ...orderIds.filter((appId) => appsById.has(appId)),
    ...state.registry.apps.map((appEntry) => appEntry.id).filter((appId) => !orderIds.includes(appId))
  ];

  state.appOrder = fullOrder;
  state.registry.apps = fullOrder.map((appId) => appsById.get(appId)).filter(Boolean);

  if (Array.isArray(state.registry.matrix)) {
    const rowsById = new Map(state.registry.matrix.map((row) => [row.appId, row]));
    state.registry.matrix = fullOrder
      .map((appId) => rowsById.get(appId))
      .filter(Boolean)
      .map((row) => ({
        ...row,
        routes: [...row.routes].sort((left, right) => fullOrder.indexOf(left.targetAppId) - fullOrder.indexOf(right.targetAppId))
      }));
  }
}

function applyStoredAppOrder() {
  reorderRegistryApps(readStoredAppOrder());
}

function persistAppOrder() {
  try {
    localStorage.setItem(APP_ORDER_KEY, JSON.stringify(state.registry.apps.map((appEntry) => appEntry.id)));
  } catch {
    // Storage can fail in hardened preview contexts; live order still updates.
  }
}

function moveAppOrder(draggedAppId, targetIndex) {
  if (!state.registry?.apps?.length) {
    return false;
  }

  const currentIndex = state.registry.apps.findIndex((appEntry) => appEntry.id === draggedAppId);
  if (currentIndex === -1 || targetIndex === -1 || currentIndex === targetIndex) {
    return false;
  }

  const order = state.registry.apps.map((appEntry) => appEntry.id);
  const [movedAppId] = order.splice(currentIndex, 1);
  order.splice(targetIndex, 0, movedAppId);
  reorderRegistryApps(order);
  persistAppOrder();
  render();
  markDraggedAppTile();
  return true;
}

function markDraggedAppTile() {
  elements.appList?.querySelectorAll(".app-tile.is-reordering").forEach((tile) => tile.classList.remove("is-reordering"));

  if (!appReorderDrag.appId) {
    return;
  }

  const tile = elements.appList?.querySelector(`[data-app-id="${CSS.escape(appReorderDrag.appId)}"]`);
  tile?.classList.add("is-reordering");
}

function getAppDropIndex(clientY) {
  const buttons = [...(elements.appList?.querySelectorAll("[data-app-id]") || [])];
  if (!buttons.length) {
    return -1;
  }

  const firstRect = buttons[0].getBoundingClientRect();
  if (clientY <= firstRect.top) {
    return 0;
  }

  for (let index = 0; index < buttons.length; index += 1) {
    const rect = buttons[index].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      return index;
    }
  }

  return buttons.length - 1;
}

function handleAppReorderPointerDown(event) {
  if (event.button !== 0) {
    return;
  }

  const button = event.target instanceof Element ? event.target.closest("[data-app-id]") : null;
  if (!button || !elements.appList?.contains(button)) {
    return;
  }

  appReorderDrag.appId = button.dataset.appId || "";
  appReorderDrag.pointerId = event.pointerId;
  appReorderDrag.startX = event.clientX;
  appReorderDrag.startY = event.clientY;
  appReorderDrag.started = false;
  button.setPointerCapture?.(event.pointerId);
}

function handleAppReorderPointerMove(event) {
  if (!appReorderDrag.appId || appReorderDrag.pointerId !== event.pointerId) {
    return;
  }

  const distance = Math.hypot(event.clientX - appReorderDrag.startX, event.clientY - appReorderDrag.startY);
  if (!appReorderDrag.started && distance < 7) {
    return;
  }

  appReorderDrag.started = true;
  suppressNextAppClick = true;
  elements.appList?.classList.add("is-reordering");
  markDraggedAppTile();
  event.preventDefault();

  const targetIndex = getAppDropIndex(event.clientY);
  if (moveAppOrder(appReorderDrag.appId, targetIndex)) {
    scheduleHitboxDebugLayerUpdate();
  }
}

function endAppReorderDrag(event) {
  if (!appReorderDrag.appId || appReorderDrag.pointerId !== event.pointerId) {
    return;
  }

  if (appReorderDrag.started) {
    suppressNextAppClick = true;
    persistAppOrder();
  }

  const draggedAppId = appReorderDrag.appId;
  appReorderDrag.appId = "";
  appReorderDrag.pointerId = -1;
  appReorderDrag.started = false;
  elements.appList?.classList.remove("is-reordering");
  elements.appList?.querySelector(`[data-app-id="${CSS.escape(draggedAppId)}"]`)?.classList.remove("is-reordering");
  scheduleHitboxDebugLayerUpdate();
}

function getApp(appId = state.selectedAppId) {
  return state.registry?.apps.find((appEntry) => appEntry.id === appId) || null;
}

function getAsset(assetId = state.selectedAssetId) {
  return state.store.assets.find((asset) => asset.id === assetId) || null;
}

function getActiveTransferAsset(sourceApp, targetApp = null) {
  if (!sourceApp) {
    return null;
  }

  const allowedKinds = targetApp ? new Set(getTransferKinds(sourceApp, targetApp)) : null;
  const isOwnedBySource = (asset) => {
    const ownerAppId = asset?.currentAppId || asset?.sourceAppId || "";
    const assetKinds = asset?.possibleKinds?.length ? asset.possibleKinds : [asset?.kind];
    const canTargetImport = !allowedKinds || assetKinds.some((kind) => allowedKinds.has(kind));
    return ownerAppId === sourceApp.id && canTargetImport;
  };
  const selectedAsset = getAsset();

  if (selectedAsset && isOwnedBySource(selectedAsset)) {
    return selectedAsset;
  }

  return state.store.assets.find(isOwnedBySource) || null;
}

function textToDataUrl(text, mimeType = "text/plain") {
  return `data:${mimeType};base64,${btoa(text)}`;
}

const TRANSFER_KIND_PRIORITY = ["model3d", "scene", "video", "animation", "vector", "still-image", "layout", "text", "palette", "archive"];

function sortTransferKinds(kinds = []) {
  return [...kinds].sort((left, right) => {
    const leftIndex = TRANSFER_KIND_PRIORITY.indexOf(left);
    const rightIndex = TRANSFER_KIND_PRIORITY.indexOf(right);
    const normalizedLeft = leftIndex === -1 ? TRANSFER_KIND_PRIORITY.length : leftIndex;
    const normalizedRight = rightIndex === -1 ? TRANSFER_KIND_PRIORITY.length : rightIndex;
    return normalizedLeft - normalizedRight;
  });
}

function getTransferKinds(sourceApp, targetApp) {
  if (sourceApp?.id === "rooms") {
    const roomsKind = ROOMS_TRANSFER_TARGET_KINDS[targetApp?.id];
    return roomsKind && sourceApp.producesKinds?.includes(roomsKind) && targetApp?.acceptsKinds?.includes(roomsKind)
      ? [roomsKind]
      : [];
  }

  return sortTransferKinds(getSharedKinds(sourceApp?.producesKinds || [], targetApp?.acceptsKinds || []));
}

function shouldForceViewportStillCapture(sourceApp, targetApp) {
  if (sourceApp?.id === "ngon-junk" && VIEWPORT_CAPTURE_IMAGE_TARGETS.has(targetApp?.id)) {
    return true;
  }

  if (sourceApp?.id === "pixelmaxxxing" && ["kira-kira", "moire-maker"].includes(targetApp?.id)) {
    return true;
  }

  return sourceApp?.id === "kira-kira" && ["moire-maker", "pixelmaxxxing"].includes(targetApp?.id);
}

function getAssetTransferKinds(asset, sourceApp, targetApp) {
  if (!asset || !targetApp) {
    return [];
  }

  const allowedKinds = new Set(getTransferKinds(sourceApp, targetApp));
  const assetKinds = asset.possibleKinds?.length ? asset.possibleKinds : [asset.kind];
  return sortTransferKinds(assetKinds.filter((kind) => allowedKinds.has(kind) && targetApp.acceptsKinds?.includes(kind)));
}

function getCaptureSpec(sourceApp, targetApp) {
  if (shouldForceViewportStillCapture(sourceApp, targetApp)) {
    return { kind: "still-image", extension: "png", mimeType: "image/png", forceViewport: true };
  }

  const sharedKinds = getTransferKinds(sourceApp, targetApp);
  const kind = sharedKinds[0] || sourceApp?.producesKinds?.[0] || "";

  if (kind === "still-image") {
    return { kind, extension: "png", mimeType: "image/png" };
  }

  if (kind === "vector") {
    return { kind, extension: "svg", mimeType: "image/svg+xml" };
  }

  if (kind === "model3d") {
    return { kind, extension: "obj", mimeType: "text/plain" };
  }

  return { kind, extension: "png", mimeType: "image/png" };
}

function waitForFramePaint(frameWindow) {
  return new Promise((resolve) => {
    const raf = frameWindow?.requestAnimationFrame?.bind(frameWindow)
      || ((callback) => frameWindow?.setTimeout?.(callback, 16) || window.setTimeout(callback, 16));
    raf(() => raf(resolve));
  });
}

function getLargestCanvas(frameDocument) {
  return [...(frameDocument?.querySelectorAll("canvas") || [])]
    .filter((canvas) => {
      const width = canvas.width || canvas.clientWidth;
      const height = canvas.height || canvas.clientHeight;
      return width > 1 && height > 1;
    })
    .sort((left, right) => {
      const leftArea = (left.width || left.clientWidth) * (left.height || left.clientHeight);
      const rightArea = (right.width || right.clientWidth) * (right.height || right.clientHeight);
      return rightArea - leftArea;
    })[0] || null;
}

function getPreferredCaptureCanvas(frameDocument, sourceApp) {
  if (sourceApp?.id === "ngon-junk") {
    return frameDocument?.querySelector(".viewer-canvas canvas, canvas.viewer-canvas, .viewer-panel canvas, .scene canvas, canvas") || getLargestCanvas(frameDocument);
  }

  return getLargestCanvas(frameDocument);
}

function captureSvgDataUrl(frameDocument) {
  const svg = [...(frameDocument?.querySelectorAll("svg") || [])]
    .sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return (rightRect.width * rightRect.height) - (leftRect.width * leftRect.height);
    })[0];

  if (!svg) {
    return "";
  }

  const serialized = new XMLSerializer().serializeToString(svg);
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(serialized)))}`;
}

function isUsableSvgDataUrl(dataUrl = "") {
  const match = String(dataUrl).match(/^data:image\/svg\+xml(?:;charset=[^;,]+)?;base64,(.*)$/i);

  if (!match) {
    return false;
  }

  try {
    const text = decodeURIComponent(escape(atob(match[1] || "")));
    const hasDrawable = /<(path|polygon|polyline|rect|circle|ellipse|line|text|image|g)\b/i.test(text);
    const hasSize = /<svg\b[^>]*(width|height|viewBox)=/i.test(text);
    return hasDrawable && hasSize && text.length > 120;
  } catch {
    return false;
  }
}

function isUsableStillImageDataUrl(frameWindow, dataUrl = "", options = {}) {
  return new Promise((resolve) => {
    if (!String(dataUrl).startsWith("data:image/")) {
      resolve(false);
      return;
    }

    const ImageCtor = frameWindow?.Image || Image;
    const image = new ImageCtor();
    image.addEventListener("load", () => {
      try {
        const canvas = frameWindow?.document?.createElement?.("canvas") || document.createElement("canvas");
        const size = 56;
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(image, 0, 0, size, size);
        const { data } = context.getImageData(0, 0, size, size);
        let visible = 0;
        let lumaSum = 0;
        let lumaSqSum = 0;
        let chromaSum = 0;

        for (let index = 0; index < data.length; index += 4) {
          const alpha = data[index + 3] / 255;

          if (alpha < 0.08) {
            continue;
          }

          const red = data[index];
          const green = data[index + 1];
          const blue = data[index + 2];
          const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
          visible += 1;
          lumaSum += luma;
          lumaSqSum += luma * luma;
          chromaSum += Math.max(red, green, blue) - Math.min(red, green, blue);
        }

        if (visible < size * size * 0.08) {
          resolve(false);
          return;
        }

        const mean = lumaSum / visible;
        const variance = Math.max(lumaSqSum / visible - mean * mean, 0);
        const chroma = chromaSum / visible;
        const minMean = Number.isFinite(options.minMean) ? options.minMean : 12;
        const flatDark = options.strictDark ? mean < minMean : mean < minMean && variance < 40;
        const flatLight = mean > 244 && variance < 30 && chroma < 8;
        const flatSolid = variance < 3 && chroma < 3;
        resolve(!(flatDark || flatLight || flatSolid));
      } catch {
        resolve(false);
      }
    }, { once: true });
    image.addEventListener("error", () => resolve(false), { once: true });
    image.src = dataUrl;
  });
}

async function isUsableCaptureDataUrl(frameWindow, dataUrl = "", kind = "", options = {}) {
  if (!dataUrl || dataUrl === "data:,") {
    return false;
  }

  if (kind === "still-image") {
    return isUsableStillImageDataUrl(frameWindow, dataUrl, options);
  }

  if (kind === "vector") {
    return isUsableSvgDataUrl(dataUrl);
  }

  return true;
}

function blobToDataUrl(frameWindow, blob) {
  return new Promise((resolve, reject) => {
    const Reader = frameWindow.FileReader || FileReader;
    const reader = new Reader();
    reader.addEventListener("load", () => resolve(reader.result || ""));
    reader.addEventListener("error", () => reject(reader.error || new Error("Could not read blob.")));
    reader.readAsDataURL(blob);
  });
}

function getSupportedVideoMime(frameWindow) {
  const MediaRecorderCtor = frameWindow.MediaRecorder;

  if (!MediaRecorderCtor) {
    return "";
  }

  for (const mimeType of ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]) {
    if (!MediaRecorderCtor.isTypeSupported || MediaRecorderCtor.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }

  return "";
}

async function captureCanvasVideoDataUrl(frameWindow, canvas) {
  if (!canvas?.captureStream || !frameWindow?.MediaRecorder) {
    return "";
  }

  const mimeType = getSupportedVideoMime(frameWindow);

  if (!mimeType) {
    return "";
  }

  const stream = canvas.captureStream(24);
  const track = stream.getVideoTracks?.()[0];
  const chunks = [];
  const recorder = new frameWindow.MediaRecorder(stream, { mimeType });
  const done = new Promise((resolve, reject) => {
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size) {
        chunks.push(event.data);
      }
    });
    recorder.addEventListener("stop", resolve, { once: true });
    recorder.addEventListener("error", () => reject(new Error("Video capture failed.")), { once: true });
  });
  const frameTimer = frameWindow.setInterval(() => track?.requestFrame?.(), 100);

  recorder.start(100);
  await new Promise((resolve) => frameWindow.setTimeout(resolve, 1600));
  recorder.stop();
  await done;
  frameWindow.clearInterval(frameTimer);
  stream.getTracks().forEach((item) => item.stop());

  const blob = new frameWindow.Blob(chunks, { type: mimeType.split(";")[0] || "video/webm" });
  return blob.size ? blobToDataUrl(frameWindow, blob) : "";
}

async function createRoomsDefaultModelAsset(sourceApp) {
  const result = await api.captureAsset({
    appId: sourceApp.id,
    kind: "model3d",
    extension: "obj",
    dataUrl: textToDataUrl(ROOMS_DEFAULT_OBJ),
    displayName: "rooms default model"
  });

  if (result?.state) {
    state.store = result.state.store;
    state.assetRoutes = result.state.assetRoutes;
    state.workspacePath = result.state.workspacePath;
  }

  if (result?.asset) {
    state.selectedAssetId = result.asset.id;
  }

  return result?.asset || null;
}

async function captureCurrentEmbeddedAsset(sourceApp, targetApp) {
  if (sourceApp?.id === "rooms" && targetApp?.id === "ngon-junk") {
    return createRoomsDefaultModelAsset(sourceApp);
  }

  const frame = [...elements.viewportHost.querySelectorAll("iframe")].find((item) => item.dataset.appId === sourceApp.id);
  const frameDocument = frame?.contentDocument;
  const frameWindow = frame?.contentWindow;

  if (!frameDocument || !frameWindow) {
    return null;
  }

  const captureSpec = getCaptureSpec(sourceApp, targetApp);
  const allowedKinds = getTransferKinds(sourceApp, targetApp);
  const strictViewportCapture = Boolean(captureSpec.forceViewport);
  let dataUrl = "";

  try {
    if (captureSpec.kind === "still-image") {
      await waitForFramePaint(frameWindow);
    }

    if (captureSpec.kind === "video") {
      const canvas = getPreferredCaptureCanvas(frameDocument, sourceApp);
      dataUrl = await captureCanvasVideoDataUrl(frameWindow, canvas);
      captureSpec.extension = "webm";
      captureSpec.mimeType = "video/webm";

      if (!dataUrl) {
        if (!allowedKinds.includes("still-image")) {
          return null;
        }

        captureSpec.kind = "still-image";
        captureSpec.extension = "png";
        captureSpec.mimeType = "image/png";
      }
    }

    if (captureSpec.kind === "vector") {
      dataUrl = captureSvgDataUrl(frameDocument);

      if (!dataUrl) {
        return null;
      }
    }

    if (!dataUrl) {
      await waitForFramePaint(frameWindow);
      const canvas = getPreferredCaptureCanvas(frameDocument, sourceApp);

      if ((captureSpec.kind === "vector" || captureSpec.kind === "animation" || captureSpec.kind === "model3d") && !allowedKinds.includes("still-image")) {
        return null;
      }

      dataUrl = canvas?.toDataURL("image/png") || "";
      captureSpec.kind = "still-image";
      captureSpec.extension = "png";
      captureSpec.mimeType = "image/png";
    }
  } catch {
    return null;
  }

  if (!dataUrl || dataUrl === "data:,") {
    return null;
  }

  if (!(await isUsableCaptureDataUrl(frameWindow, dataUrl, captureSpec.kind, {
    minMean: strictViewportCapture ? 24 : 12,
    strictDark: strictViewportCapture
  }))) {
    return null;
  }

  const result = await api.captureAsset({
    appId: sourceApp.id,
    kind: captureSpec.kind,
    extension: captureSpec.extension,
    dataUrl,
    displayName: `${sourceApp.name} current ${captureSpec.kind}`
  });

  if (result?.state) {
    state.store = result.state.store;
    state.assetRoutes = result.state.assetRoutes;
    state.workspacePath = result.state.workspacePath;
  }

  if (result?.asset) {
    state.selectedAssetId = result.asset.id;
  }

  return result?.asset || null;
}

async function captureCurrentPhonePreview(appEntry, requestId = "", sessionId = state.mobileBridgeSessionId) {
  const frame = [...elements.viewportHost.querySelectorAll("iframe")].find((item) => item.dataset.appId === appEntry?.id);
  const frameDocument = frame?.contentDocument;
  const frameWindow = frame?.contentWindow;

  if (!appEntry || !frameDocument || !frameWindow) {
    return null;
  }

  let dataUrl = "";

  try {
    dataUrl = captureSvgDataUrl(frameDocument);

    if (!dataUrl) {
      await waitForFramePaint(frameWindow);
      const canvas = getPreferredCaptureCanvas(frameDocument, appEntry);
      dataUrl = canvas?.toDataURL("image/png") || "";
    }
  } catch {
    return null;
  }

  if (!dataUrl || dataUrl === "data:,") {
    return null;
  }

  if (!(await isUsableCaptureDataUrl(frameWindow, dataUrl, "still-image"))) {
    return null;
  }

  const result = await mobileBridgeApi.captureAsset({
    appId: appEntry.id,
    kind: "still-image",
    extension: "png",
    dataUrl,
    displayName: `${appEntry.name} phone preview`,
    mobilePreview: true,
    mobileRequestId: requestId,
    mobileBridgeSessionId: sessionId || state.mobileBridgeSessionId
  });

  if (result?.state) {
    state.store = result.state.store;
    state.assetRoutes = result.state.assetRoutes;
    state.workspacePath = result.state.workspacePath;
  }

  if (result?.asset) {
    state.selectedAssetId = result.asset.id;
  }

  return result?.asset || null;
}

function getImportInput(frameDocument, asset) {
  const inputs = [...(frameDocument?.querySelectorAll('input[type="file"]') || [])];

  if (!inputs.length) {
    return null;
  }

  if (asset?.kind === "still-image") {
    return frameDocument.querySelector("#image-input, #imageInput, input[accept*='image']") || inputs[0];
  }

  if (asset?.kind === "video") {
    return frameDocument.querySelector("input[accept*='video']") || inputs[0];
  }

  if (asset?.kind === "animation") {
    return frameDocument.querySelector("input[accept*='gif'], input[accept*='image']") || inputs[0];
  }

  return inputs[0];
}

function waitForActiveFrame(appId) {
  return new Promise((resolve) => {
    const frame = [...elements.viewportHost.querySelectorAll("iframe")].find((item) => item.dataset.appId === appId);

    if (!frame) {
      resolve(null);
      return;
    }

    let resolved = false;
    const finish = () => {
      if (resolved) {
        return;
      }

      resolved = true;
      resolve(frame);
    };

    try {
      if (frame.contentDocument?.readyState === "complete") {
        frame.contentWindow?.setTimeout(finish, 180);
        return;
      }
    } catch {
      resolve(null);
      return;
    }

    frame.addEventListener("load", () => frame.contentWindow?.setTimeout(finish, 180), { once: true });
    window.setTimeout(finish, 2500);
  });
}

async function createFileForFrame(frameWindow, assetData) {
  const blob = await fetch(assetData.dataUrl).then((response) => response.blob());
  const FileCtor = frameWindow.File || File;
  const extension = assetData.asset?.extension || "";
  const rawName = assetData.name || assetData.asset?.name || "handoff";
  const hasExtension = extension && rawName.toLowerCase().endsWith(`.${extension.toLowerCase()}`);
  const fileName = hasExtension || !extension ? rawName : `${rawName}.${extension}`;

  return new FileCtor([blob], fileName, {
    type: assetData.mimeType || blob.type || "application/octet-stream"
  });
}

function assignFileToInput(frameWindow, input, file) {
  const DataTransferCtor = frameWindow.DataTransfer || DataTransfer;
  const transfer = new DataTransferCtor();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new frameWindow.Event("input", { bubbles: true }));
  input.dispatchEvent(new frameWindow.Event("change", { bubbles: true }));
}

function dispatchFileDrop(frameWindow, frameDocument, file, targetAppId) {
  const dropTarget = targetAppId === "kira-kira"
    ? frameDocument?.querySelector(".stage")
    : frameDocument?.querySelector("[data-drop-zone], .drop-zone, .upload-zone, .canvas-dropzone");

  if (!dropTarget) {
    return false;
  }

  try {
    const DataTransferCtor = frameWindow.DataTransfer || DataTransfer;
    const transfer = new DataTransferCtor();
    transfer.items.add(file);

    for (const eventName of ["dragenter", "dragover", "drop"]) {
      dropTarget.dispatchEvent(new frameWindow.DragEvent(eventName, {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer
      }));
    }

    return true;
  } catch {
    return false;
  }
}

function didAppAcknowledgeImport(frameDocument, targetAppId, fileName) {
  if (targetAppId === "pixelmaxxxing") {
    const chosenName = frameDocument?.querySelector("#chosen-image-name")?.textContent?.trim() || "";
    return chosenName && chosenName !== "No file selected" && (chosenName === fileName || !chosenName.toLowerCase().includes("no file"));
  }

  if (targetAppId === "kira-kira") {
    return frameDocument?.querySelector("#emptyState")?.hidden === true;
  }

  return false;
}

function hasKnownImportAcknowledgement(targetAppId) {
  return targetAppId === "pixelmaxxxing" || targetAppId === "kira-kira";
}

async function injectAssetDataIntoActiveApp(assetData, targetAppId) {
  if (!assetData?.ok || !assetData.dataUrl) {
    return false;
  }

  const frame = await waitForActiveFrame(targetAppId);
  const frameWindow = frame?.contentWindow;

  if (!frameWindow) {
    return false;
  }

  try {
    const file = await createFileForFrame(frameWindow, assetData);
    let injected = false;
    const requiresAcknowledgement = hasKnownImportAcknowledgement(targetAppId);

    for (let attempt = 0; attempt < 24; attempt += 1) {
      const frameDocument = frame.contentDocument;
      const input = getImportInput(frameDocument, assetData.asset);

      if (frameDocument && input) {
        assignFileToInput(frameWindow, input, file);
        dispatchFileDrop(frameWindow, frameDocument, file, targetAppId);
        injected = injected || Boolean(input.files?.length);

        await new Promise((resolve) => window.setTimeout(resolve, 250));

        if (didAppAcknowledgeImport(frameDocument, targetAppId, file.name)) {
          return true;
        }

        if (injected && !requiresAcknowledgement && attempt >= 5) {
          return true;
        }
      } else {
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
    }

    return requiresAcknowledgement ? false : injected;
  } catch {
    return false;
  }
}

async function injectAssetIntoActiveApp(assetId, targetAppId) {
  const assetData = await api.getAssetData?.({ assetId });
  return injectAssetDataIntoActiveApp(assetData, targetAppId);
}

async function syncMobileCaptureRequests() {
  if (!mobileBridgeApi.getMobileCaptureRequests || !mobileBridgeApi.markMobileCaptureRequest || !state.activeAppId) {
    return;
  }

  let payload = null;

  try {
    payload = await mobileBridgeApi.getMobileCaptureRequests({ sessionId: state.mobileBridgeSessionId });
  } catch {
    return;
  }

  const requests = Array.isArray(payload?.requests) ? payload.requests : [];
  const activeApp = getApp(state.activeAppId);

  for (const request of requests) {
    if (!request?.id || request.appId !== activeApp?.id || mobileBridgeSync.requestIds.has(request.id)) {
      continue;
    }

    mobileBridgeSync.requestIds.add(request.id);
    const asset = await captureCurrentPhonePreview(activeApp, request.id, request.sessionId || state.mobileBridgeSessionId);

    try {
      await mobileBridgeApi.markMobileCaptureRequest({
        requestId: request.id,
        sessionId: request.sessionId || state.mobileBridgeSessionId,
        ok: Boolean(asset),
        assetId: asset?.id || "",
        message: asset ? "" : "current viewport cannot be captured"
      });
    } catch {
      // The mobile page will keep polling the asset list if marking fails.
    }
  }
}

async function syncMobileRemoteUploads() {
  if (!mobileBridgeApi.getMobileUploads || !mobileBridgeApi.markMobileUploadInjected || !state.activeAppId) {
    return false;
  }

  let payload = null;

  try {
    payload = await mobileBridgeApi.getMobileUploads({
      appId: state.activeAppId,
      sessionId: state.mobileBridgeSessionId
    });
  } catch {
    return false;
  }

  const uploads = Array.isArray(payload?.uploads) ? payload.uploads : [];
  const upload = uploads.find((asset) => (
    asset?.id
    && asset.mobileUpload
    && asset.mobileInject
    && asset.mobileBridgeSessionId === state.mobileBridgeSessionId
    && !asset.mobileInjectedAt
    && !mobileBridgeSync.uploadIds.has(asset.id)
    && (asset.currentAppId === state.activeAppId || asset.sourceAppId === state.activeAppId)
  ));

  if (!upload) {
    return false;
  }

  mobileBridgeSync.uploadIds.add(upload.id);
  const assetData = upload.dataUrl
    ? { ok: true, asset: upload, dataUrl: upload.dataUrl, mimeType: upload.mimeType, name: upload.name }
    : await mobileBridgeApi.getAssetData?.({ assetId: upload.id, sessionId: state.mobileBridgeSessionId });
  const injected = await injectAssetDataIntoActiveApp(assetData, state.activeAppId);
  if (injected) {
    await mobileBridgeApi.markMobileUploadInjected({ assetId: upload.id, sessionId: state.mobileBridgeSessionId });
  }
  renderSelectedApp();
  return true;
}

async function syncMobileUploads() {
  if (!api.getState || !state.activeAppId) {
    return;
  }

  const handledRemoteUpload = await syncMobileRemoteUploads();
  if (handledRemoteUpload) {
    return;
  }

  let payload = null;

  try {
    payload = await api.getState();
  } catch {
    return;
  }

  if (!payload?.store) {
    return;
  }

  state.store = payload.store;
  state.assetRoutes = payload.assetRoutes || state.assetRoutes;
  state.workspacePath = payload.workspacePath || state.workspacePath;

  const upload = state.store.assets.find((asset) => (
    asset?.mobileUpload
    && asset.mobileInject
    && asset.mobileBridgeSessionId === state.mobileBridgeSessionId
    && !asset.mobileInjectedAt
    && !mobileBridgeSync.uploadIds.has(asset.id)
    && (asset.currentAppId === state.activeAppId || asset.sourceAppId === state.activeAppId)
  ));

  if (!upload) {
    return;
  }

  mobileBridgeSync.uploadIds.add(upload.id);
  const injected = await injectAssetIntoActiveApp(upload.id, state.activeAppId);
  if (injected) {
    await api.markMobileUploadInjected?.({ assetId: upload.id });
  }
  renderSelectedApp();
}

async function syncMobileBridge() {
  await syncMobileCaptureRequests();
  await syncMobileUploads();
}

function startMobileBridgeSync() {
  if (mobileBridgeSync.timer) {
    return;
  }

  mobileBridgeSync.timer = window.setInterval(syncMobileBridge, 1600);
}

async function renderTransferPreviewHtml(asset) {
  const assetData = await api.getAssetData?.({ assetId: asset.id });

  if (!assetData?.ok || !assetData.dataUrl) {
    return `<div class="transfer-preview is-empty">preview unavailable</div>`;
  }

  if (assetData.mimeType?.startsWith("image/")) {
    return `
      <figure class="transfer-preview">
        <img src="${escapeHtml(assetData.dataUrl)}" alt="" />
        <figcaption>${escapeHtml(assetData.name || asset.name)}</figcaption>
      </figure>
    `;
  }

  if (assetData.mimeType?.startsWith("video/")) {
    return `
      <figure class="transfer-preview">
        <video src="${escapeHtml(assetData.dataUrl)}" muted playsinline controls></video>
        <figcaption>${escapeHtml(assetData.name || asset.name)}</figcaption>
      </figure>
    `;
  }

  return `<div class="transfer-preview is-empty">${escapeHtml(assetData.name || asset.name)}</div>`;
}

function joinKinds(kinds = []) {
  return kinds.join(" / ");
}

function getShortHeadline(appEntry) {
  const headline = appEntry?.headline || "";
  const firstPart = headline.split(/[,.]/)[0]?.trim() || headline;
  return firstPart.length > 48 ? `${firstPart.slice(0, 45).trim()}...` : firstPart;
}

function getEmbedUrl(appEntry) {
  if (!appEntry?.embed?.available) {
    return "";
  }

  if (window.location.protocol === "file:") {
    return appEntry.embed.fileUrl || appEntry.embed.url || "";
  }

  return appEntry.embed.previewUrl || appEntry.embed.url || "";
}

function getAppSiteUrl(appEntry) {
  return appEntry?.siteUrl || appEntry?.repoUrl || "";
}

function getSharedKinds(left = [], right = []) {
  const rightSet = new Set(right);
  return left.filter((kind) => rightSet.has(kind));
}

function getActiveSendTargets() {
  const activeApp = getApp(state.activeAppId);

  if (!activeApp) {
    return [];
  }

  return state.registry.apps
    .filter((targetApp) => targetApp.id !== activeApp.id)
    .map((targetApp) => ({
      app: targetApp,
      kinds: getTransferKinds(activeApp, targetApp)
    }))
    .filter((entry) => entry.kinds.length > 0);
}

async function refresh(nextState = {}) {
  const payload = await api.getState();
  state.registry = payload.registry;
  state.store = payload.store;
  state.assetRoutes = payload.assetRoutes;
  state.workspacePath = payload.workspacePath;
  applyStoredAppOrder();

  if (state.selectedAppId && !getApp(state.selectedAppId)) {
    state.selectedAppId = "";
  }

  if (state.activeAppId && !getApp(state.activeAppId)) {
    state.activeAppId = "";
  }

  if (!state.selectedAssetId || !getAsset(state.selectedAssetId)) {
    state.selectedAssetId = state.store.assets[0]?.id || "";
  }

  Object.assign(state, nextState);

  if (state.selectedAppId && !getApp(state.selectedAppId)) {
    state.selectedAppId = "";
  }

  if (state.activeAppId && !getApp(state.activeAppId)) {
    state.activeAppId = "";
  }

  if (!state.selectedAppId && !state.activeAppId && state.registry.apps.length) {
    state.selectedAppId = state.registry.apps[0].id;
    state.activeAppId = state.registry.apps[0].id;
  }

  render();
}

function renderAppList() {
  elements.appList.innerHTML = renderAppListHtml();
}

function renderAppListHtml() {
  return state.registry.apps
    .map((appEntry) => {
      const isActive = appEntry.id === state.selectedAppId;
      const isRunning = appEntry.id === state.activeAppId;
      const accent = appEntry.accent || "#7f8a8f";

      return `
        <button class="app-tile ${isActive ? "is-active" : ""} ${isRunning ? "is-running" : ""}" style="--app-accent: ${escapeHtml(accent)}" data-app-id="${escapeHtml(appEntry.id)}" draggable="false" type="button">
          <span class="app-tile-icon-screen">
            <img class="app-tile-icon" src="${escapeHtml(appEntry.icon)}" alt="" />
          </span>
          <span class="app-tile-name">${escapeHtml(appEntry.name)}</span>
        </button>
      `;
    })
    .join("");
}

function renderSideFocusHtml() {
  const appEntry = getApp();

  if (!appEntry) {
    return "";
  }

  const acceptsHtml = appEntry.acceptsKinds.length
    ? appEntry.acceptsKinds.map((kind) => `<span class="kind-pill">${escapeHtml(kind)}</span>`).join("")
    : `<span class="kind-pill">none</span>`;

  return `
    <section class="app-focus side-focus">
      <div class="app-focus-media">
        <img class="selected-app-icon" src="${escapeHtml(appEntry.icon)}" alt="" />
      </div>
      <div class="app-focus-copy">
        <h1>${escapeHtml(appEntry.name)}</h1>
        <p class="side-focus-headline">${escapeHtml(getShortHeadline(appEntry))}</p>
        <div class="contract-row">
          <span class="contract-label">in</span>
          ${acceptsHtml}
          <span class="contract-label">out</span>
          ${appEntry.producesKinds.map((kind) => `<span class="kind-pill strong">${escapeHtml(kind)}</span>`).join("")}
        </div>
      </div>
    </section>
  `;
}

function renderSelectedApp() {
  const appEntry = getApp();

  if (!appEntry) {
    elements.selectedAppFocus?.classList.remove("is-hidden");
    elements.selectedAppFocus?.classList.add("is-empty");
    elements.selectedAppIcon.removeAttribute("src");
    elements.selectedAppIcon.hidden = true;
    elements.selectedAppName.textContent = "";
    elements.selectedAppHeadline.textContent = "";
    elements.selectedAppContract.innerHTML = "";
    if (elements.phoneBridgeLink) {
      elements.phoneBridgeLink.href = "#";
      elements.phoneBridgeLink.hidden = true;
    }
    if (elements.phoneBridgeQr) {
      elements.phoneBridgeQr.removeAttribute("src");
    }
    if (elements.phoneBridgeLabel) {
      elements.phoneBridgeLabel.textContent = "";
    }
    return;
  }

  elements.selectedAppFocus?.classList.remove("is-hidden");
  elements.selectedAppFocus?.classList.remove("is-empty");
  elements.selectedAppIcon.src = appEntry.icon;
  elements.selectedAppIcon.hidden = false;
  elements.selectedAppName.innerHTML = `load-download to:<strong>${escapeHtml(appEntry.name)}</strong>`;
  elements.selectedAppHeadline.textContent = getShortHeadline(appEntry);
  const bridgeUrl = getMobileBridgeUrl(appEntry);
  const bridgeLinkUrl = getMobileBridgeUrl(appEntry, { preferLocal: isElectronRuntime });
  if (elements.phoneBridgeLink) {
    elements.phoneBridgeLink.href = bridgeLinkUrl || bridgeUrl || "#";
    elements.phoneBridgeLink.title = bridgeUrl || "";
    elements.phoneBridgeLink.hidden = !bridgeUrl;
  }
  if (elements.phoneBridgeQr) {
    elements.phoneBridgeQr.src = getQrImageUrl(bridgeUrl);
  }
  if (elements.phoneBridgeLabel) {
    elements.phoneBridgeLabel.textContent = "";
  }
  const acceptsHtml = appEntry.acceptsKinds.length
    ? appEntry.acceptsKinds.map((kind) => `<span class="kind-pill">${escapeHtml(kind)}</span>`).join("")
    : `<span class="kind-pill">none</span>`;
  elements.selectedAppContract.innerHTML = `
    <span class="contract-label">in</span>
    ${acceptsHtml}
    <span class="contract-label">out</span>
    ${appEntry.producesKinds.map((kind) => `<span class="kind-pill strong">${escapeHtml(kind)}</span>`).join("")}
  `;
  document.documentElement.style.setProperty("--active-accent", appEntry.accent || "#111111");
}

function renderViewport() {
  const appEntry = getApp(state.activeAppId);
  elements.appViewport?.classList.toggle("is-empty", !appEntry);
  elements.reloadApp.classList.toggle("is-hidden", !appEntry);

  if (!appEntry) {
    elements.viewportTitle.textContent = "";
    elements.viewportMeta.textContent = "";
    elements.viewportMeta.removeAttribute("href");
    elements.viewportMeta.removeAttribute("title");
    elements.viewportMeta.removeAttribute("aria-label");
    elements.viewportHost.innerHTML = "";
    return;
  }

  const embedUrl = getEmbedUrl(appEntry);
  const siteUrl = getAppSiteUrl(appEntry);
  elements.viewportTitle.textContent = appEntry.name;
  elements.viewportMeta.textContent = siteUrl || "no public web link";
  if (siteUrl) {
    elements.viewportMeta.href = siteUrl;
    elements.viewportMeta.title = siteUrl;
    elements.viewportMeta.setAttribute("aria-label", `open ${appEntry.name} website`);
  } else {
    elements.viewportMeta.removeAttribute("href");
    elements.viewportMeta.removeAttribute("title");
    elements.viewportMeta.removeAttribute("aria-label");
  }

  if (!embedUrl) {
    elements.viewportHost.innerHTML = `
      <div class="viewport-empty">
        <img class="viewport-empty-icon" src="${escapeHtml(appEntry.icon)}" alt="" />
        <div class="empty-title">${escapeHtml(appEntry.name)}</div>
        <div class="empty-copy">embedded web build missing</div>
      </div>
    `;
    return;
  }

  const currentFrame = elements.viewportHost.querySelector("iframe");

  if (currentFrame?.dataset.appId === appEntry.id && currentFrame?.getAttribute("src") === embedUrl) {
    applyEmbeddedPreferences(currentFrame);
    return;
  }

  elements.viewportHost.innerHTML = `
    <iframe
      class="app-frame"
      data-app-id="${escapeHtml(appEntry.id)}"
      src="${escapeHtml(embedUrl)}"
      title="${escapeHtml(appEntry.name)}"
      sandbox="allow-downloads allow-forms allow-modals allow-pointer-lock allow-popups allow-same-origin allow-scripts"
    ></iframe>
  `;

  const frame = elements.viewportHost.querySelector("iframe");
  attachFrameZoomBlockers(frame);
  frame.addEventListener("load", () => {
    applyEmbeddedPreferences(frame);
    attachFrameZoomBlockers(frame);
    window.setTimeout(() => attachFrameZoomBlockers(frame), 80);
    window.setTimeout(() => attachFrameZoomBlockers(frame), 360);
  });
}

function applyEmbeddedPreferences(frame) {
  try {
    const frameDocument = frame.contentDocument;
    attachFrameZoomBlockers(frame);

    if (!frameDocument) {
      return;
    }

    attachZoomBlockers(frameDocument);
    attachSelectionBlockers(frameDocument);

    const appClass = frame.dataset.appId ? `special-edition-app-${frame.dataset.appId.replace(/[^a-z0-9-]/gi, "-")}` : "";
    frameDocument.body?.classList.add("special-edition-embedded");
    if (appClass) {
      frameDocument.body?.classList.add(appClass);
    }

    let style = frameDocument.getElementById("special-edition-embedded-ui");
    if (!style) {
      style = frameDocument.createElement("style");
      style.id = "special-edition-embedded-ui";
      frameDocument.head.append(style);
    }
    style.textContent = EMBEDDED_UI_CSS;

    if (frame.dataset.appId === "ngon-junk") {
      scheduleNgonJunkEmbeddedAdjustments(frameDocument);
    }

    if (frame.dataset.appId === "pixelmaxxxing") {
      schedulePixelmaxxxingEmbeddedAdjustments(frameDocument);
    }

    if (frame.dataset.appId === "2d-to-3d") {
      schedule2dTo3dEmbeddedAdjustments(frameDocument);
    }
  } catch {
    // Remote apps cannot be styled from the shell iframe boundary.
  }
}

function schedule2dTo3dEmbeddedAdjustments(frameDocument) {
  let attempts = 0;
  const applyAdjustments = () => {
    minimize2dTo3dViewportPanels(frameDocument);
    translate2dTo3dLabels(frameDocument);
    attempts += 1;

    if (attempts < 20) {
      frameDocument.defaultView?.setTimeout(applyAdjustments, 140);
    }
  };

  applyAdjustments();
}

function translate2dTo3dLabels(frameDocument) {
  frameDocument.querySelectorAll("span").forEach((span) => {
    const text = span.textContent?.trim().toLocaleLowerCase("tr");

    if (text === "arkaplani dahil et?" || text === "arkaplanı dahil et?") {
      span.textContent = "include background?";
    }
  });
}

function minimize2dTo3dViewportPanels(frameDocument) {
  const panels = frameDocument.querySelectorAll(".viewport-panel-slot, [class*='viewport-panel-slot']");

  panels.forEach((panel) => {
    if (panel.dataset.specialEditionPanelPrimed !== "1") {
      panel.dataset.specialEditionPanelPrimed = "1";
      panel.classList.add("special-edition-2d-panel-minimized");
    }

    const header = panel.querySelector(".floating-header, [class*='floating-header']");

    if (!header || header.dataset.specialEditionToggleBound === "1") {
      return;
    }

    header.dataset.specialEditionToggleBound = "1";
    header.addEventListener("click", (event) => {
      panel.classList.toggle("special-edition-2d-panel-minimized");
      event.stopPropagation();
    });
  });
}

function schedulePixelmaxxxingEmbeddedAdjustments(frameDocument) {
  let attempts = 0;
  const applyAdjustments = () => {
    const controlPanel = frameDocument.querySelector(".control-panel");

    if (controlPanel && controlPanel.dataset.specialEditionScrollPrimed !== "1") {
      controlPanel.scrollTop = 0;
      controlPanel.scrollLeft = 0;
      controlPanel.dataset.specialEditionScrollPrimed = "1";
    }

    const frameWindow = frameDocument.defaultView;

    if (frameWindow?.Event) {
      frameWindow.dispatchEvent(new frameWindow.Event("resize"));
    }

    attempts += 1;

    if (attempts < 14) {
      frameDocument.defaultView?.setTimeout(applyAdjustments, 120);
    }
  };

  applyAdjustments();
}

function scheduleNgonJunkEmbeddedAdjustments(frameDocument) {
  let attempts = 0;
  const applyAdjustments = () => {
    collapseNgonJunkPanels(frameDocument);
    enhanceNgonJunkBackgroundPanel(frameDocument);
    enhanceNgonJunkExportDock(frameDocument);
    attempts += 1;

    if (attempts < 24) {
      frameDocument.defaultView?.setTimeout(applyAdjustments, 140);
    }
  };

  applyAdjustments();
}

function collapseNgonJunkPanels(frameDocument) {
  const selectors = [
    ".background-panel",
    ".light-panel",
    ".aa-panel",
    ".retopo-panel",
    ".uv-panel"
  ];

  for (const selector of selectors) {
    const panel = frameDocument.querySelector(selector);
    const collapseButton = panel?.querySelector(".panel-collapse-chip");

    if (!panel || !collapseButton || panel.dataset.specialEditionInitialCollapsed === "1") {
      continue;
    }

    if (collapseButton.textContent?.trim() === "-") {
      panel.dataset.specialEditionInitialCollapsed = "1";
      collapseButton.click();
    }
  }
}

function resetNgonJunkExportDock(exportBar) {
  exportBar.classList.remove("special-edition-export-free");
  exportBar.style.removeProperty("--special-export-left");
  exportBar.style.removeProperty("--special-export-top");
  Object.assign(exportBar.style, {
    bottom: "14px",
    left: "50%",
    right: "auto",
    top: "auto",
    transform: "translateX(-50%)"
  });
}

function attachNgonJunkExportDrag(frameDocument, exportBar, title) {
  const frameWindow = frameDocument.defaultView;
  let dragState = null;

  title.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }

    const barRect = exportBar.getBoundingClientRect();
    const containerRect = exportBar.parentElement?.getBoundingClientRect();

    if (!containerRect) {
      return;
    }

    dragState = {
      moved: false,
      offsetX: event.clientX - barRect.left,
      offsetY: event.clientY - barRect.top,
      startX: event.clientX,
      startY: event.clientY
    };
    title.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  title.addEventListener("pointermove", (event) => {
    if (!dragState) {
      return;
    }

    const containerRect = exportBar.parentElement?.getBoundingClientRect();

    if (!containerRect) {
      return;
    }

    const distance = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY);
    dragState.moved = dragState.moved || distance > 4;

    if (!dragState.moved) {
      return;
    }

    const width = exportBar.offsetWidth || exportBar.getBoundingClientRect().width;
    const height = exportBar.offsetHeight || exportBar.getBoundingClientRect().height;
    const nextLeft = Math.min(
      Math.max(0, event.clientX - containerRect.left - dragState.offsetX),
      Math.max(0, containerRect.width - width)
    );
    const nextTop = Math.min(
      Math.max(0, event.clientY - containerRect.top - dragState.offsetY),
      Math.max(0, containerRect.height - height)
    );

    exportBar.classList.add("special-edition-export-free");
    exportBar.style.setProperty("--special-export-left", `${nextLeft}px`);
    exportBar.style.setProperty("--special-export-top", `${nextTop}px`);
  });

  title.addEventListener("pointerup", (event) => {
    if (!dragState) {
      return;
    }

    title.releasePointerCapture?.(event.pointerId);

    if (!dragState.moved) {
      exportBar.classList.toggle("special-edition-export-collapsed");
    }

    dragState = null;
    event.preventDefault();
  });

  title.addEventListener("pointercancel", () => {
    dragState = null;
  });

  frameWindow?.addEventListener("blur", () => {
    dragState = null;
  });
}

function getNgonJunkBackgroundExportGroup(exportBar) {
  return Array.from(exportBar.children).find((child) => {
    return (
      child.classList?.contains("viewer-export-group") &&
      (child.querySelector(".viewer-gradient-stack") ||
        child.querySelector(".viewer-gradient-controls") ||
        child.querySelector(".viewer-color-chip"))
    );
  });
}

function setNgonJunkBackgroundPanelPosition(panel, left, top) {
  const containerRect = panel.parentElement?.getBoundingClientRect();

  if (!containerRect) {
    return;
  }

  const width = panel.offsetWidth || panel.getBoundingClientRect().width || 94;
  const height = panel.offsetHeight || panel.getBoundingClientRect().height || 34;
  const nextLeft = Math.min(Math.max(0, left), Math.max(0, containerRect.width - width));
  const nextTop = Math.min(Math.max(0, top), Math.max(0, containerRect.height - height));

  panel.style.setProperty("--special-background-left", `${nextLeft}px`);
  panel.style.setProperty("--special-background-top", `${nextTop}px`);
  panel.style.setProperty("--special-background-transform", "none");
}

function rectanglesOverlap(first, second, padding = 8) {
  return !(
    first.right + padding <= second.left ||
    first.left >= second.right + padding ||
    first.bottom + padding <= second.top ||
    first.top >= second.bottom + padding
  );
}

function getNgonJunkOpenPanelRects(frameDocument, viewerPanel, backgroundPanel) {
  const containerRect = viewerPanel?.getBoundingClientRect();

  if (!containerRect) {
    return [];
  }

  return Array.from(frameDocument.querySelectorAll(
    ".light-panel, .aa-panel, .retopo-panel, .uv-panel, .frame-panel, .viewer-export-bar"
  ))
    .filter((item) => {
      return (
        item !== backgroundPanel &&
        !item.contains(backgroundPanel) &&
        !item.classList.contains("panel-collapsed") &&
        !item.classList.contains("special-edition-export-collapsed") &&
        item.offsetParent !== null
      );
    })
    .map((item) => {
      const rect = item.getBoundingClientRect();
      return {
        left: rect.left - containerRect.left,
        top: rect.top - containerRect.top,
        right: rect.right - containerRect.left,
        bottom: rect.bottom - containerRect.top
      };
    });
}

function clampNgonJunkBackgroundCandidate(candidate, containerRect, width, height) {
  return {
    left: Math.min(Math.max(0, candidate.left), Math.max(0, containerRect.width - width)),
    top: Math.min(Math.max(0, candidate.top), Math.max(0, containerRect.height - height))
  };
}

function getNgonJunkBackgroundRect(candidate, width, height) {
  return {
    left: candidate.left,
    top: candidate.top,
    right: candidate.left + width,
    bottom: candidate.top + height
  };
}

function positionNgonJunkBackgroundPanel(frameDocument, panel, { force = false } = {}) {
  if (!panel || (panel.dataset.specialEditionBackgroundDragged === "1" && !force)) {
    return;
  }

  const viewerPanel = panel.parentElement || frameDocument.querySelector(".viewer-panel");
  const containerRect = viewerPanel?.getBoundingClientRect();

  if (!containerRect) {
    return;
  }

  const width = panel.offsetWidth || panel.getBoundingClientRect().width || 94;
  const height = panel.offsetHeight || panel.getBoundingClientRect().height || 34;
  const openRects = getNgonJunkOpenPanelRects(frameDocument, viewerPanel, panel);
  const baseCandidate = clampNgonJunkBackgroundCandidate({
    left: 14,
    top: Math.round((containerRect.height - height) / 2)
  }, containerRect, width, height);
  const candidates = [baseCandidate];

  for (const rect of openRects) {
    candidates.push(
      { left: rect.right + 10, top: baseCandidate.top },
      { left: 14, top: rect.bottom + 10 },
      { left: rect.left - width - 10, top: baseCandidate.top },
      { left: 14, top: rect.top - height - 10 }
    );
  }

  const best = candidates
    .map((candidate) => clampNgonJunkBackgroundCandidate(candidate, containerRect, width, height))
    .find((candidate) => {
      const candidateRect = getNgonJunkBackgroundRect(candidate, width, height);
      return openRects.every((rect) => !rectanglesOverlap(candidateRect, rect));
    }) || baseCandidate;

  setNgonJunkBackgroundPanelPosition(panel, best.left, best.top);
}

function updateNgonJunkBackgroundTitle(panel) {
  const title = panel?.querySelector(".special-edition-background-title");
  const icon = title?.lastElementChild;
  const collapsed = panel?.classList.contains("is-collapsed");

  if (icon) {
    icon.textContent = collapsed ? "+" : "-";
  }

  title?.setAttribute("aria-expanded", collapsed ? "false" : "true");
}

function attachNgonJunkBackgroundPanelDrag(frameDocument, panel, title) {
  if (!panel || !title || panel.dataset.specialEditionBackgroundDragAttached === "1") {
    return;
  }

  panel.dataset.specialEditionBackgroundDragAttached = "1";
  const frameWindow = frameDocument.defaultView;
  let dragState = null;

  title.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }

    const panelRect = panel.getBoundingClientRect();
    const containerRect = panel.parentElement?.getBoundingClientRect();

    if (!containerRect) {
      return;
    }

    dragState = {
      moved: false,
      offsetX: event.clientX - panelRect.left,
      offsetY: event.clientY - panelRect.top,
      startX: event.clientX,
      startY: event.clientY
    };
    panel.classList.add("is-dragging");
    title.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  });

  title.addEventListener("pointermove", (event) => {
    if (!dragState) {
      return;
    }

    const containerRect = panel.parentElement?.getBoundingClientRect();

    if (!containerRect) {
      return;
    }

    const distance = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY);
    dragState.moved = dragState.moved || distance > 4;

    if (!dragState.moved) {
      return;
    }

    panel.dataset.specialEditionBackgroundDragged = "1";
    setNgonJunkBackgroundPanelPosition(
      panel,
      event.clientX - containerRect.left - dragState.offsetX,
      event.clientY - containerRect.top - dragState.offsetY
    );
    event.preventDefault();
    event.stopPropagation();
  });

  title.addEventListener("pointerup", (event) => {
    if (!dragState) {
      return;
    }

    title.releasePointerCapture?.(event.pointerId);
    panel.classList.remove("is-dragging");

    if (!dragState.moved) {
      panel.classList.toggle("is-collapsed");
      updateNgonJunkBackgroundTitle(panel);
      if (panel.dataset.specialEditionBackgroundDragged === "1") {
        const left = Number.parseFloat(panel.style.getPropertyValue("--special-background-left")) || 14;
        const top = Number.parseFloat(panel.style.getPropertyValue("--special-background-top")) || 14;
        setNgonJunkBackgroundPanelPosition(panel, left, top);
      } else {
        positionNgonJunkBackgroundPanel(frameDocument, panel, { force: true });
      }
    }

    dragState = null;
    event.preventDefault();
    event.stopPropagation();
  });

  title.addEventListener("pointercancel", () => {
    dragState = null;
    panel.classList.remove("is-dragging");
  });

  title.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    panel.classList.toggle("is-collapsed");
    updateNgonJunkBackgroundTitle(panel);
    if (panel.dataset.specialEditionBackgroundDragged === "1") {
      const left = Number.parseFloat(panel.style.getPropertyValue("--special-background-left")) || 14;
      const top = Number.parseFloat(panel.style.getPropertyValue("--special-background-top")) || 14;
      setNgonJunkBackgroundPanelPosition(panel, left, top);
    } else {
      positionNgonJunkBackgroundPanel(frameDocument, panel, { force: true });
    }
    event.preventDefault();
  });

  frameWindow?.addEventListener("blur", () => {
    dragState = null;
    panel.classList.remove("is-dragging");
  });
}

function enhanceNgonJunkBackgroundPanel(frameDocument) {
  const exportBar = frameDocument.querySelector('.viewer-export-bar[data-dock-key="export"]');
  const viewerPanel = frameDocument.querySelector(".viewer-panel");

  if (!exportBar || !viewerPanel) {
    return;
  }

  if (viewerPanel.dataset.specialEditionBackgroundObserver !== "1") {
    viewerPanel.dataset.specialEditionBackgroundObserver = "1";
    const Observer = frameDocument.defaultView?.MutationObserver || MutationObserver;
    let pending = 0;
    const observer = new Observer(() => {
      frameDocument.defaultView?.clearTimeout(pending);
      pending = frameDocument.defaultView?.setTimeout(() => {
        enhanceNgonJunkBackgroundPanel(frameDocument);
      }, 30);
    });
    observer.observe(viewerPanel, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  }

  let panel = frameDocument.querySelector(".special-edition-background-panel");
  let body = panel?.querySelector(".special-edition-background-body");

  if (!panel || !body) {
    panel = frameDocument.createElement("section");
    panel.className = "special-edition-background-panel is-collapsed";
    panel.dataset.specialEditionBackgroundPanel = "1";

    const title = frameDocument.createElement("button");
    title.type = "button";
    title.className = "special-edition-background-title";
    title.innerHTML = "<span>background</span><span>+</span>";

    body = frameDocument.createElement("div");
    body.className = "special-edition-background-body";
    panel.append(title, body);
    viewerPanel.append(panel);
  }

  const title = panel.querySelector(".special-edition-background-title");
  attachNgonJunkBackgroundPanelDrag(frameDocument, panel, title);
  updateNgonJunkBackgroundTitle(panel);
  positionNgonJunkBackgroundPanel(frameDocument, panel);

  const group = getNgonJunkBackgroundExportGroup(exportBar);

  if (group && group.parentElement !== body) {
    for (const child of Array.from(body.children)) {
      child.remove();
    }

    body.append(group);
    exportBar.classList.add("special-edition-export-background-split");
  }
}

function enhanceNgonJunkExportDock(frameDocument) {
  const exportBar = frameDocument.querySelector('.viewer-export-bar[data-dock-key="export"]');

  if (!exportBar || exportBar.dataset.specialEditionExportEnhanced === "1") {
    return;
  }

  exportBar.dataset.specialEditionExportEnhanced = "1";
  exportBar.classList.add("special-edition-export-collapsed");
  const title = exportBar.querySelector(".viewer-export-title") || exportBar.firstElementChild;
  title?.setAttribute("title", "click to expand");
  if (title) {
    title.addEventListener(
      "pointerdown",
      (event) => {
        event.stopPropagation();
      },
      true
    );
    title.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      exportBar.classList.toggle("special-edition-export-collapsed");
    });
  }

  const dockButton = frameDocument.createElement("button");
  dockButton.type = "button";
  dockButton.className = "chip viewer-export-chip special-edition-export-dock";
  dockButton.textContent = "dock";
  dockButton.addEventListener("click", (event) => {
    event.stopPropagation();
    resetNgonJunkExportDock(exportBar);
    exportBar.classList.add("special-edition-export-collapsed");
  });

  title?.insertAdjacentElement("afterend", dockButton);
  exportBar.addEventListener("dblclick", (event) => {
    event.stopPropagation();
    resetNgonJunkExportDock(exportBar);
    exportBar.classList.add("special-edition-export-collapsed");
  });
}

function renderTargets() {
  elements.handoffTargets.innerHTML = renderTargetsHtml();
}

function renderTargetsHtml() {
  const activeApp = getApp(state.activeAppId);

  if (!activeApp) {
    return `<div class="rail-empty">select an app first</div>`;
  }

  const targets = getActiveSendTargets();

  if (!targets.length) {
    return "";
  }

  return targets
    .map(({ app, kinds }) => {
      return `
        <button class="target-tile compact-target is-transfer-ready" data-target-id="${escapeHtml(app.id)}" type="button">
          <img class="target-icon" src="${escapeHtml(app.icon)}" alt="" />
          <span class="target-name">${escapeHtml(app.name)}</span>
          <span class="target-route">imports ${escapeHtml(kinds.join(" / "))}</span>
        </button>
      `;
    })
    .join("");
}

function getElementScrollState(element) {
  if (!element) {
    return { ratio: 0, hasScroll: false };
  }

  const maxScroll = Math.max(element.scrollHeight - element.clientHeight, 0);

  return {
    ratio: maxScroll > 0 ? element.scrollTop / maxScroll : 0,
    hasScroll: maxScroll > 1
  };
}

function syncDeviceHardwareUi() {
  if (!USE_DEVICE_SCENE) {
    return;
  }

  if (!state.registry?.apps?.length) {
    updateDeviceUi({
      apps: [],
      targets: [],
      appScrollRatio: 0,
      targetScrollRatio: 0,
      appHasScroll: false,
      targetHasScroll: false,
      showApps: true,
      showTargets: true
    });
    return;
  }

  if (elements.appList && elements.appList.scrollTop !== 0) {
    elements.appList.scrollTop = 0;
  }

  if (elements.handoffTargets && elements.handoffTargets.scrollTop !== 0) {
    elements.handoffTargets.scrollTop = 0;
  }

  const targets = getActiveSendTargets();
  const showApps = true;
  const showTargets = true;

  updateDeviceUi({
    apps: state.registry.apps.map((appEntry) => ({
      id: appEntry.id,
      name: appEntry.name,
      icon: appEntry.icon,
      accent: appEntry.accent,
      active: appEntry.id === state.activeAppId
    })),
    targets: targets.map(({ app, kinds }) => ({
      id: app.id,
      name: app.name,
      icon: app.icon,
      accent: app.accent,
      meta: `imports ${kinds.join(" / ")}`,
      active: false
    })),
    activeAppId: state.activeAppId,
    selectedAppId: state.selectedAppId,
    appScrollRatio: 0,
    targetScrollRatio: 0,
    appHasScroll: false,
    targetHasScroll: false,
    showApps,
    showTargets
  });
}

function render() {
  renderAppList();
  renderSelectedApp();
  renderViewport();
  renderTargets();
  renderShellControls();
  renderPopouts();
  if (USE_DEVICE_SCENE) {
    syncDeviceHardwareUi();
    refreshDeviceScene();
  }
  scheduleHitboxDebugLayerUpdate();
}

function renderShellControls() {
  elements.shell.classList.remove("is-left-collapsed", "is-right-collapsed", "is-left-detached", "is-right-detached");
}

function refreshHardwareLayout() {
  renderShellControls();
  if (USE_DEVICE_SCENE) {
    syncDeviceHardwareUi();
    refreshDeviceScene();
  }
  scheduleHitboxDebugLayerUpdate();
}

function toggleAppSelection(appId) {
  const isSameSelection = state.selectedAppId === appId && state.activeAppId === appId;
  state.selectedAppId = isSameSelection ? "" : appId;
  state.activeAppId = isSameSelection ? "" : appId;
  render();
}

function resolveRailButtonByPoint(event, container, selector) {
  const direct = event.target instanceof Element ? event.target.closest(selector) : null;
  if (direct && container?.contains(direct)) {
    return direct;
  }

  if (!container) {
    return null;
  }

  const containerRect = container.getBoundingClientRect();
  const xPadding = Math.max(10, containerRect.width * 0.08);
  if (
    event.clientX < containerRect.left - xPadding ||
    event.clientX > containerRect.right + xPadding ||
    event.clientY < containerRect.top - 6 ||
    event.clientY > containerRect.bottom + 6
  ) {
    return null;
  }

  let closestButton = null;
  let closestDistance = Infinity;

  container.querySelectorAll(selector).forEach((button) => {
    const rect = button.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }

    const verticalPadding = Math.max(4, rect.height * 0.08);
    if (event.clientY < rect.top - verticalPadding || event.clientY > rect.bottom + verticalPadding) {
      return;
    }

    const centerY = rect.top + rect.height / 2;
    const distance = Math.abs(event.clientY - centerY);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestButton = button;
    }
  });

  return closestButton;
}

async function handleAppClick(event) {
  if (suppressNextAppClick) {
    suppressNextAppClick = false;
    event.preventDefault();
    return;
  }

  const button = resolveRailButtonByPoint(event, elements.appList, "[data-app-id]");

  if (!button) {
    return;
  }

  toggleAppSelection(button.dataset.appId);
}

async function handleTargetClick(event) {
  const button = event.target instanceof Element
    ? event.target.closest("[data-target-id]")
    : null;

  if (!button) {
    return;
  }

  await openTransferModal(button.dataset.targetId);
}

const POINTER_LIT_SELECTOR = ".icon-button, .command-button, .kind-pill, .transfer-confirm-row";

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function handlePointerLighting(event) {
  const target = event.target instanceof Element ? event.target.closest(POINTER_LIT_SELECTOR) : null;

  if (!target) {
    return;
  }

  const rect = target.getBoundingClientRect();

  if (!rect.width || !rect.height) {
    return;
  }

  const x = clampNumber((event.clientX - rect.left) / rect.width, 0, 1);
  const y = clampNumber((event.clientY - rect.top) / rect.height, 0, 1);
  const dx = (x - 0.5) * 2;
  const dy = (y - 0.5) * 2;
  const angle = 126 + dx * 18 - dy * 10;

  target.style.setProperty("--button-light-angle", `${angle.toFixed(1)}deg`);
  target.style.setProperty("--button-shadow-x", `${(dx * 2.5).toFixed(2)}px`);
  target.style.setProperty("--button-shadow-y", `${(dy * 2.5).toFixed(2)}px`);
}

function attachPointerLighting(rootDocument = document) {
  rootDocument.addEventListener("pointermove", handlePointerLighting);
}

attachPointerLighting(document);

const deviceHardwareMotion = {
  currentScale: 1,
  currentX: 0,
  currentY: 0,
  currentTiltX: 0,
  currentTiltY: 0,
  targetScale: 1,
  targetX: 0,
  targetY: 0,
  targetTiltX: 0,
  targetTiltY: 0,
  frame: 0,
  idleTimer: 0,
  pressTimer: 0,
  pressed: false
};
const deviceLightDrag = {
  active: false,
  pointerId: -1
};

function isPointerInsideDeviceShell(event) {
  const rect = elements.shell?.getBoundingClientRect();
  if (!rect) {
    return false;
  }

  return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
}

function isPointerInsideOpenModal(event) {
  const modal = elements.transferModal;
  return Boolean(modal && !modal.classList.contains("is-hidden") && event.target instanceof Node && modal.contains(event.target));
}

function isPointerInsideInteractiveDeviceArea(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) {
    return false;
  }

  return Boolean(target.closest([
    ".topbar",
    ".app-rail",
    ".workspace",
    ".bus-rail",
    "button",
    "a",
    "input",
    "select",
    "textarea",
    "iframe",
    "[role='button']",
    "[contenteditable='true']",
    ".modal-shell"
  ].join(",")));
}

function isDeviceLightControlEvent(event) {
  if (isElectronRuntime) {
    return false;
  }

  if (isPointerInsideOpenModal(event)) {
    return false;
  }

  if (!isPointerInsideDeviceShell(event)) {
    return true;
  }

  return !isPointerInsideInteractiveDeviceArea(event);
}

function updateDeviceLightFromPointer(event) {
  if (!USE_DEVICE_SCENE) {
    return;
  }

  setDeviceLightFromViewportPoint(event.clientX, event.clientY, window.innerWidth, window.innerHeight);
}

function handleDeviceLightPointerDown(event) {
  if (event.button > 0 || !isDeviceLightControlEvent(event)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  deviceLightDrag.active = true;
  deviceLightDrag.pointerId = event.pointerId;
  updateDeviceLightFromPointer(event);
}

function handleDeviceLightPointerMove(event) {
  if (deviceLightDrag.active && deviceLightDrag.pointerId === event.pointerId) {
    event.preventDefault();
    event.stopPropagation();
    updateDeviceLightFromPointer(event);
    return;
  }

  if (isElectronRuntime && event.pointerType !== "touch" && isDeviceLightControlEvent(event)) {
    updateDeviceLightFromPointer(event);
  }
}

function endDeviceLightDrag(event) {
  if (!deviceLightDrag.active || deviceLightDrag.pointerId !== event.pointerId) {
    return;
  }

  deviceLightDrag.active = false;
  deviceLightDrag.pointerId = -1;
}

function applyDeviceHardwareMotion() {
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty("--device-proximity-scale", deviceHardwareMotion.currentScale.toFixed(5));
  rootStyle.setProperty("--device-proximity-x", `${deviceHardwareMotion.currentX.toFixed(2)}px`);
  rootStyle.setProperty("--device-proximity-y", `${deviceHardwareMotion.currentY.toFixed(2)}px`);
  rootStyle.setProperty("--device-tilt-x", `${deviceHardwareMotion.currentTiltX.toFixed(3)}deg`);
  rootStyle.setProperty("--device-tilt-y", `${deviceHardwareMotion.currentTiltY.toFixed(3)}deg`);

  if (USE_DEVICE_SCENE) {
    updateDeviceReflectionTilt(deviceHardwareMotion.currentTiltX, deviceHardwareMotion.currentTiltY);
  }
}

function animateDeviceHardwareMotion() {
  deviceHardwareMotion.frame = 0;
  const ease = deviceHardwareMotion.pressed ? 0.16 : 0.026;
  deviceHardwareMotion.currentScale += (deviceHardwareMotion.targetScale - deviceHardwareMotion.currentScale) * ease;
  deviceHardwareMotion.currentX += (deviceHardwareMotion.targetX - deviceHardwareMotion.currentX) * ease;
  deviceHardwareMotion.currentY += (deviceHardwareMotion.targetY - deviceHardwareMotion.currentY) * ease;
  deviceHardwareMotion.currentTiltX += (deviceHardwareMotion.targetTiltX - deviceHardwareMotion.currentTiltX) * ease;
  deviceHardwareMotion.currentTiltY += (deviceHardwareMotion.targetTiltY - deviceHardwareMotion.currentTiltY) * ease;
  applyDeviceHardwareMotion();

  const settled =
    Math.abs(deviceHardwareMotion.targetScale - deviceHardwareMotion.currentScale) < 0.0005 &&
    Math.abs(deviceHardwareMotion.targetX - deviceHardwareMotion.currentX) < 0.04 &&
    Math.abs(deviceHardwareMotion.targetY - deviceHardwareMotion.currentY) < 0.04 &&
    Math.abs(deviceHardwareMotion.targetTiltX - deviceHardwareMotion.currentTiltX) < 0.01 &&
    Math.abs(deviceHardwareMotion.targetTiltY - deviceHardwareMotion.currentTiltY) < 0.01;

  if (!settled) {
    deviceHardwareMotion.frame = requestAnimationFrame(animateDeviceHardwareMotion);
  }
}

function requestDeviceHardwareMotionFrame() {
  if (!deviceHardwareMotion.frame) {
    deviceHardwareMotion.frame = requestAnimationFrame(animateDeviceHardwareMotion);
  }
}

function setDeviceHardwareTarget(nextTarget = {}) {
  Object.assign(deviceHardwareMotion, nextTarget);
  requestDeviceHardwareMotionFrame();
}

function resetDeviceHardwareMotion() {
  window.clearTimeout(deviceHardwareMotion.idleTimer);
  window.clearTimeout(deviceHardwareMotion.pressTimer);
  deviceHardwareMotion.pressed = false;
  setDeviceHardwareTarget({
    targetScale: 1,
    targetX: 0,
    targetY: 0,
    targetTiltX: 0,
    targetTiltY: 0
  });
}

function handleDeviceHardwarePointerMove(event) {
  if (event.pointerType === "touch") {
    return;
  }

  const width = Math.max(window.innerWidth, 1);
  const height = Math.max(window.innerHeight, 1);
  const nx = (event.clientX / width - 0.5) * 2;
  const ny = (event.clientY / height - 0.5) * 2;
  const pressScale = deviceHardwareMotion.pressed ? -0.0011 : 0;

  setDeviceHardwareTarget({
    targetScale: 1 + pressScale,
    targetX: -nx * 0.18,
    targetY: -ny * 0.13,
    targetTiltX: -ny * 0.26,
    targetTiltY: nx * 0.36
  });

  window.clearTimeout(deviceHardwareMotion.idleTimer);
  deviceHardwareMotion.idleTimer = window.setTimeout(resetDeviceHardwareMotion, 760);
}

function handleDeviceHardwarePointerDown(event) {
  if (event.button > 0) {
    return;
  }

  if (!isPointerInsideDeviceShell(event)) {
    return;
  }

  deviceHardwareMotion.pressed = true;
  window.clearTimeout(deviceHardwareMotion.pressTimer);
  setDeviceHardwareTarget({
    targetScale: 0.9989
  });

  deviceHardwareMotion.pressTimer = window.setTimeout(() => {
    deviceHardwareMotion.pressed = false;
    setDeviceHardwareTarget({
      targetScale: 1
    });
  }, 130);
}

function handleDeviceHardwarePointerUp() {
  window.clearTimeout(deviceHardwareMotion.pressTimer);
  deviceHardwareMotion.pressed = false;
  setDeviceHardwareTarget({
    targetScale: 1
  });
}

let forbiddenZoomTimer = 0;

function pulseForbiddenZoom() {
  window.clearTimeout(forbiddenZoomTimer);
  window.clearTimeout(deviceHardwareMotion.idleTimer);
  window.clearTimeout(deviceHardwareMotion.pressTimer);
  deviceHardwareMotion.pressed = false;

  setDeviceHardwareTarget({
    targetScale: 0.999,
    targetX: 0,
    targetY: 0.012,
    targetTiltX: -0.0015,
    targetTiltY: 0
  });

  forbiddenZoomTimer = window.setTimeout(resetDeviceHardwareMotion, 160);
}

function blockBrowserZoom(event) {
  if (event.cancelable !== false) {
    event.preventDefault();
  }

  event.stopPropagation?.();
  event.stopImmediatePropagation?.();
  pulseForbiddenZoom();
}

const ZOOM_KEY_VALUES = new Set(["+", "-", "=", "_", "0"]);
const ZOOM_KEY_CODES = new Set(["Equal", "Minus", "Digit0", "NumpadAdd", "NumpadSubtract", "Numpad0", "NumpadEqual"]);

function handleZoomKeydown(event) {
  if (!(event.ctrlKey || event.metaKey)) {
    return;
  }

  if (!ZOOM_KEY_VALUES.has(event.key) && !ZOOM_KEY_CODES.has(event.code)) {
    return;
  }

  blockBrowserZoom(event);
}

function handleZoomWheel(event) {
  if (event.ctrlKey || event.metaKey) {
    blockBrowserZoom(event);
  }
}

function attachZoomBlockers(rootDocument = document) {
  const documentElement = rootDocument.documentElement;

  if (!documentElement || documentElement.dataset.specialEditionZoomBlocked === "1") {
    return;
  }

  documentElement.dataset.specialEditionZoomBlocked = "1";
  rootDocument.addEventListener("wheel", handleZoomWheel, { passive: false, capture: true });
  rootDocument.addEventListener("mousewheel", handleZoomWheel, { passive: false, capture: true });
  rootDocument.addEventListener("keydown", handleZoomKeydown, { capture: true });
  rootDocument.addEventListener("keypress", handleZoomKeydown, { capture: true });
  ["gesturestart", "gesturechange", "gestureend"].forEach((eventName) => {
    rootDocument.addEventListener(eventName, blockBrowserZoom, { passive: false, capture: true });
  });
}

function attachZoomBlockersToWindow(targetWindow = window) {
  if (!targetWindow || targetWindow.__specialEditionZoomBlocked === true) {
    return;
  }

  targetWindow.__specialEditionZoomBlocked = true;
  targetWindow.addEventListener("wheel", handleZoomWheel, { passive: false, capture: true });
  targetWindow.addEventListener("mousewheel", handleZoomWheel, { passive: false, capture: true });
  targetWindow.addEventListener("keydown", handleZoomKeydown, { capture: true });
  targetWindow.addEventListener("keypress", handleZoomKeydown, { capture: true });
  ["gesturestart", "gesturechange", "gestureend"].forEach((eventName) => {
    targetWindow.addEventListener(eventName, blockBrowserZoom, { passive: false, capture: true });
  });
}

function attachWindowZoomBlockers() {
  attachZoomBlockersToWindow(window);
}

function attachFrameZoomBlockers(frame) {
  try {
    const frameWindow = frame?.contentWindow;
    const frameDocument = frame?.contentDocument || frameWindow?.document;

    if (frameWindow) {
      attachZoomBlockersToWindow(frameWindow);
    }

    if (frameDocument) {
      attachZoomBlockers(frameDocument);
      attachSelectionBlockers(frameDocument);
    }
  } catch {
    // Remote embeds cannot expose their window/document to the shell.
  }
}

function clearDocumentSelection(targetDocument = document) {
  try {
    targetDocument.defaultView?.getSelection?.()?.removeAllRanges();
  } catch {
    // Cross-origin or detached documents may reject selection access.
  }
}

function isEditableSelectionTarget(target) {
  const selector = "input, textarea, select, [contenteditable='true'], [contenteditable='']";
  const element = target?.nodeType === 1 ? target : target?.parentElement;

  if (!element) {
    return false;
  }

  return Boolean(element.matches?.(selector) || element.closest?.(selector));
}

function attachSelectionBlockers(targetDocument = document) {
  if (!targetDocument || targetDocument.__specialEditionSelectionBlocked) {
    return;
  }

  targetDocument.__specialEditionSelectionBlocked = true;

  const blockSelection = (event) => {
    if (isEditableSelectionTarget(event.target)) {
      return;
    }

    event.preventDefault();
    clearDocumentSelection(targetDocument);
  };

  const clearSelection = (event) => {
    if (isEditableSelectionTarget(event?.target) || isEditableSelectionTarget(targetDocument.activeElement)) {
      return;
    }

    clearDocumentSelection(targetDocument);
  };

  targetDocument.addEventListener("selectstart", blockSelection, { capture: true });
  targetDocument.addEventListener("dragstart", blockSelection, { capture: true });
  targetDocument.addEventListener("pointerdown", clearSelection, { passive: true, capture: true });
  targetDocument.addEventListener("pointermove", clearSelection, { passive: true, capture: true });
  targetDocument.addEventListener("selectionchange", clearSelection, { passive: true });
}

function initTopbarLedResolver() {
  const topbar = document.querySelector("body > .app-shell > .topbar");
  const track = topbar?.querySelector(".topbar-loop-track");
  let tiles = Array.from(topbar?.querySelectorAll(".topbar-loop-tile") || []);

  if (!topbar || !tiles.length || topbar.dataset.specialEditionLedResolver === "1") {
    return;
  }

  topbar.dataset.specialEditionLedResolver = "1";

  const templateImages = Array.from(tiles[0]?.querySelectorAll("img") || []);

  if (!templateImages.length) {
    return;
  }

  if (track) {
    for (let tileIndex = tiles.length + 1; tileIndex <= 8; tileIndex += 1) {
      const tile = document.createElement("span");
      tile.className = `topbar-loop-tile topbar-loop--${tileIndex}`;
      templateImages.forEach((image) => {
        const clone = image.cloneNode(false);
        clone.removeAttribute("id");
        tile.append(clone);
      });
      track.append(tile);
    }

    tiles = Array.from(topbar.querySelectorAll(".topbar-loop-tile"));
  }

  tiles.forEach((tile) => {
    tile.querySelectorAll(".topbar-led-canvas").forEach((canvas) => canvas.remove());
    tile.querySelectorAll("img").forEach((image) => {
      image.decoding = "async";
      image.draggable = false;
      image.setAttribute("aria-hidden", "true");
    });
  });
}

initTopbarLedResolver();

if (!isElectronRuntime) {
  document.addEventListener("pointermove", handleDeviceHardwarePointerMove, { passive: true });
}
if (!isElectronRuntime) {
  document.addEventListener("pointerdown", handleDeviceLightPointerDown, { passive: false, capture: true });
  document.addEventListener("pointermove", handleDeviceLightPointerMove, { passive: false, capture: true });
  document.addEventListener("pointerup", endDeviceLightDrag, { passive: true, capture: true });
  document.addEventListener("pointercancel", endDeviceLightDrag, { passive: true, capture: true });
}
if (!isElectronRuntime) {
  document.addEventListener("pointerdown", handleDeviceHardwarePointerDown, { passive: true });
  document.addEventListener("pointerup", handleDeviceHardwarePointerUp, { passive: true });
  document.addEventListener("pointerleave", resetDeviceHardwareMotion);
} else {
  resetDeviceHardwareMotion();
}
window.addEventListener("blur", resetDeviceHardwareMotion);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    resetDeviceHardwareMotion();
  }
});
attachZoomBlockers(document);
attachWindowZoomBlockers();
attachSelectionBlockers(document);

elements.appRail.addEventListener("pointerdown", handleAppReorderPointerDown);
elements.appRail.addEventListener("pointermove", handleAppReorderPointerMove);
elements.appRail.addEventListener("pointerup", endAppReorderDrag);
elements.appRail.addEventListener("pointercancel", endAppReorderDrag);
elements.appRail.addEventListener("click", handleAppClick);
document.addEventListener("pointermove", handleAppReorderPointerMove);
document.addEventListener("pointerup", endAppReorderDrag);
document.addEventListener("pointercancel", endAppReorderDrag);
if (USE_DEVICE_SCENE) {
  elements.appList.addEventListener("scroll", () => {
    syncDeviceHardwareUi();
    scheduleHitboxDebugLayerUpdate();
  }, { passive: true });
}
elements.busRail.addEventListener("click", handleTargetClick);
if (USE_DEVICE_SCENE) {
  elements.handoffTargets.addEventListener("scroll", () => {
    syncDeviceHardwareUi();
    scheduleHitboxDebugLayerUpdate();
  }, { passive: true });
}

elements.reloadApp.addEventListener("click", () => {
  const frame = elements.viewportHost.querySelector("iframe");

  if (frame) {
    frame.src = frame.src;
  }
});

elements.viewportMeta.addEventListener("click", (event) => {
  const siteUrl = elements.viewportMeta.getAttribute("href");

  if (!siteUrl || siteUrl === "#") {
    event.preventDefault();
    return;
  }

  event.preventDefault();
  void openExternalUrl(siteUrl);
});

document.addEventListener("click", (event) => {
  const link = event.target instanceof Element ? event.target.closest("[data-external-link]") : null;

  if (!link) {
    return;
  }

  const siteUrl = link.getAttribute("href");

  if (!siteUrl || siteUrl === "#") {
    event.preventDefault();
    return;
  }

  event.preventDefault();
  void openExternalUrl(siteUrl);
});

elements.cancelTransfer.addEventListener("click", closeTransferModal);
elements.transferModal.addEventListener("click", (event) => {
  if (event.target === elements.transferModal) {
    closeTransferModal();
  }
});

elements.confirmTransfer.addEventListener("click", confirmTransfer);

document.addEventListener("pointerdown", (event) => {
  const header = event.target.closest("[data-detach-panel]");

  if (!header) {
    return;
  }

  detachDrag.type = "";
  detachDrag.moved = false;
  document.querySelectorAll("[data-detach-panel].is-dragging").forEach((dragHeader) => dragHeader.classList.remove("is-dragging"));
});

document.addEventListener("pointermove", () => {
  detachDrag.type = "";
  detachDrag.moved = false;
});

document.addEventListener("pointerup", () => {
  detachDrag.type = "";
  detachDrag.moved = false;
  document.querySelectorAll("[data-detach-panel].is-dragging").forEach((header) => header.classList.remove("is-dragging"));
});

document.addEventListener("pointercancel", () => {
  detachDrag.type = "";
  detachDrag.moved = false;
  document.querySelectorAll("[data-detach-panel].is-dragging").forEach((header) => header.classList.remove("is-dragging"));
});

if (USE_DEVICE_SCENE) {
  try {
    window.ycswuDeviceSceneRequested = true;
    initDeviceScene();
  } catch (error) {
    console.error("Special Edition device scene failed to initialize.", error);
  }
}
window.addEventListener("resize", scheduleHitboxDebugLayerUpdate);
window.addEventListener("orientationchange", scheduleHitboxDebugLayerUpdate);
loadMobileBridgeInfo().then(() => renderSelectedApp());
startMobileBridgeSync();
refresh();

async function openTransferModal(targetAppId) {
  const sourceApp = getApp(state.activeAppId);
  const targetApp = getApp(targetAppId);

  if (!sourceApp || !targetApp) {
    return;
  }

  let asset = await captureCurrentEmbeddedAsset(sourceApp, targetApp);

  if (!asset && !shouldForceViewportStillCapture(sourceApp, targetApp)) {
    asset = getActiveTransferAsset(sourceApp, targetApp);

    if (!asset) {
      openTransferWarning("nothing to send", "No active output was captured. Use export/save in the current app, then try again.");
      return;
    }
  }

  if (!asset) {
    openTransferWarning("viewport capture failed", "The current viewport could not be captured. Move or refresh the model view, then try again.");
    return;
  }

  state.selectedAssetId = asset.id;

  const sharedKinds = getAssetTransferKinds(asset, sourceApp, targetApp);

  if (!sharedKinds.length) {
    openTransferWarning("format mismatch", `${sourceApp.name} output cannot be imported into ${targetApp.name}.`);
    return;
  }

  const previewHtml = await renderTransferPreviewHtml(asset);

  state.pendingTransfer = {
    targetAppId,
    sharedKinds,
    assetId: asset.id
  };

  elements.transferModalTitle.textContent = "send to app?";
  elements.confirmTransfer.classList.remove("is-hidden");
  elements.cancelTransfer.textContent = "cancel";
  elements.transferModalBody.innerHTML = `
    ${previewHtml}
    <div class="transfer-confirm-row">
      <span>from</span>
      <strong>${escapeHtml(sourceApp.name)}</strong>
    </div>
    <div class="transfer-confirm-row">
      <span>to</span>
      <strong>${escapeHtml(targetApp.name)}</strong>
    </div>
    <div class="transfer-confirm-row">
      <span>object</span>
      <strong>${escapeHtml(asset ? asset.name : `current ${sourceApp.name} output`)}</strong>
    </div>
    <div class="transfer-confirm-row">
      <span>formats</span>
      <strong>${escapeHtml(sharedKinds.join(" / "))}</strong>
    </div>
    <div class="modal-note">${escapeHtml(asset.path)}</div>
  `;
  elements.transferModal.classList.remove("is-hidden");
}

function openTransferWarning(title, message) {
  state.pendingTransfer = null;
  elements.transferModalTitle.textContent = title;
  elements.transferModalBody.innerHTML = `<div class="modal-warning">${escapeHtml(message)}</div>`;
  elements.confirmTransfer.classList.add("is-hidden");
  elements.cancelTransfer.textContent = "close";
  elements.transferModal.classList.remove("is-hidden");
}

function closeTransferModal() {
  state.pendingTransfer = null;
  elements.transferModal.classList.add("is-hidden");
  elements.transferModalTitle.textContent = "send to app?";
  elements.confirmTransfer.classList.remove("is-hidden");
  elements.cancelTransfer.textContent = "cancel";
}

async function confirmTransfer() {
  if (!state.pendingTransfer) {
    openTransferWarning("nothing to send", "There is no active object to transfer.");
    return;
  }

  const { targetAppId, assetId } = state.pendingTransfer;
  const sourceAppId = state.activeAppId;
  const nextState = {
    selectedAppId: targetAppId,
    activeAppId: targetAppId
  };

  if (assetId) {
    const handoff = await api.handoffAsset({
      assetId,
      sourceAppId,
      targetAppId
    });

    if (!handoff?.ok) {
      openTransferWarning("transfer failed", handoff?.message || "This output is not compatible with the target app.");
      return;
    }

    if (handoff.state) {
      state.store = handoff.state.store;
      state.assetRoutes = handoff.state.assetRoutes;
    }

    nextState.selectedAssetId = assetId;
  }

  closeTransferModal();
  await refresh(nextState);
  const imported = await injectAssetIntoActiveApp(assetId, targetAppId);

  if (!imported) {
    openTransferWarning("import failed", "The app opened, but Special Edition could not attach the file automatically.");
  }
}

function openPopout(type, position = {}) {
  const popout = popouts[type];
  if (popout && !popout.closed) {
    try {
      popout.close();
    } catch {
      // Ignore blocked auxiliary-window close attempts.
    }
  }
  popouts[type] = null;
  elements.shell.classList.remove(type === "left" ? "is-left-detached" : "is-right-detached");
  refreshHardwareLayout();
}

function openPopoutLegacy(type, position = {}) {
  void position;
  openPopout(type);
  return;

  const title = type === "left" ? "YCSWU apps" : "YCSWU panel";
  const width = type === "left" ? 320 : 380;
  const height = 760;
  const stylesheetUrl = new URL("./styles.css", window.location.href).href;
  const positionFeatures = Number.isFinite(position.left) && Number.isFinite(position.top)
    ? `,left=${Math.max(0, Math.round(position.left))},top=${Math.max(0, Math.round(position.top))}`
    : "";
  const popout = window.open("", `special-${type}-panel`, `width=${width},height=${height},resizable=yes,scrollbars=yes${positionFeatures}`);

  if (!popout) {
    return;
  }

  popouts[type] = popout;
  elements.shell.classList.remove(type === "left" ? "is-left-collapsed" : "is-right-collapsed");
  elements.shell.classList.add(type === "left" ? "is-left-detached" : "is-right-detached");
  refreshHardwareLayout();

  popout.document.open();
  popout.document.write(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${escapeHtml(title)}</title>
        <link rel="stylesheet" href="${escapeHtml(stylesheetUrl)}" />
        <style>
          html,
          body {
            height: 100%;
            margin: 0;
            overflow: hidden;
            background: #07090a !important;
          }

          .pop-shell {
            height: 100%;
            display: grid;
            grid-template-rows: 32px minmax(0, 1fr);
            padding: 8px;
            gap: 8px;
            background: #372b15 !important;
          }

          *,
          *::before,
          *::after {
            border-radius: 0 !important;
          }

          .pop-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 6px;
            background: #000000;
            background-size: auto;
            color: #e9fcff;
            border: 0;
            border-radius: 0;
            padding: 4px 6px;
            font-size: 12px;
            cursor: move;
            box-shadow: inset 0 0 12px rgba(92, 225, 255, 0.18), inset 0 0 0 1px rgba(0, 0, 0, 0.72);
            text-shadow: 0 0 7px rgba(107, 229, 255, 0.56);
          }

          .pop-actions {
            display: flex;
            gap: 4px;
          }

          .pop-actions .icon-button {
            min-height: 20px;
            border: 0;
            background: transparent;
            color: #e9fcff;
            box-shadow: none;
            padding: 2px 6px;
            text-shadow: 0 0 7px rgba(107, 229, 255, 0.56);
          }

          .pop-actions .icon-button:hover {
            background: transparent;
            color: #ffffff;
            box-shadow: none;
            text-shadow:
              0 0 5px rgba(184, 245, 255, 0.98),
              0 0 13px rgba(89, 222, 255, 0.75),
              0 0 22px rgba(89, 222, 255, 0.42);
          }

          .pop-body {
            min-height: 0;
            overflow: auto;
            display: block;
            background: #332814 !important;
          }

          .is-mini .pop-shell {
            grid-template-rows: 32px;
            height: auto;
          }

          .is-mini .pop-body {
            display: none;
          }

          .pop-body .app-list,
          .pop-body .target-grid {
            position: static !important;
            width: 100% !important;
            height: auto !important;
            min-height: 100% !important;
            display: flex !important;
            flex-direction: column;
            gap: 6px !important;
            padding: 8px !important;
            overflow: auto !important;
            background: #332814 !important;
          }

          .pop-body .app-tile,
          .pop-body .target-tile {
            min-height: 0 !important;
            height: 52px !important;
            flex: 0 0 52px !important;
            position: relative;
            display: block !important;
            padding: 0 !important;
            background: #846735 !important;
            color: #050403 !important;
            border: 0 !important;
            outline: 0 !important;
            box-shadow: inset 0 0 0 1px rgba(241, 210, 143, 0.38) !important;
            text-shadow: 0 1px 0 rgba(255, 235, 190, 0.22) !important;
          }

          .pop-body .app-tile::before,
          .pop-body .target-tile::before {
            display: none !important;
          }

          .pop-body .app-tile:hover,
          .pop-body .app-tile:focus,
          .pop-body .target-tile:hover,
          .pop-body .target-tile:focus {
            background: #846735 !important;
            outline: 0 !important;
            box-shadow: inset 0 0 0 1px rgba(241, 210, 143, 0.38) !important;
            filter: none !important;
          }

          .pop-body .app-tile-icon-screen {
            position: absolute;
            left: 10px;
            top: 7px;
            width: 38px;
            height: 38px;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            background:
              repeating-linear-gradient(0deg, rgba(97, 230, 255, 0.06) 0 1px, transparent 1px 7px),
              repeating-linear-gradient(90deg, rgba(97, 230, 255, 0.045) 0 1px, transparent 1px 7px),
              #000000 !important;
            box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.8), inset 0 0 8px rgba(80, 218, 255, 0.08) !important;
          }

          .pop-body .app-tile-icon {
            width: 86% !important;
            height: 86% !important;
            max-width: none !important;
            max-height: none !important;
            object-fit: cover;
            filter: brightness(0.58) saturate(0.72);
            opacity: 0.68;
          }

          .pop-body .app-tile.is-running .app-tile-icon {
            filter: brightness(1.35) saturate(1.25) drop-shadow(0 0 5px rgba(121, 231, 255, 0.42));
            opacity: 1;
          }

          .pop-body .app-tile.is-running .app-tile-icon-screen {
            box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.82), inset 0 0 11px rgba(121, 231, 255, 0.22), 0 0 8px rgba(121, 231, 255, 0.24) !important;
          }

          .pop-body .app-tile-name {
            position: absolute;
            left: 66px;
            right: 10px;
            top: 0;
            height: 100%;
            display: flex;
            align-items: center;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-size: 12px !important;
            line-height: 1 !important;
          }

          .pop-body .app-tile-meta {
            display: none !important;
          }

          .pop-body .target-tile {
            display: grid !important;
            grid-template-columns: 42px minmax(0, 1fr);
            align-items: center;
            gap: 10px;
            padding: 7px 10px !important;
          }

          .side-focus h1 {
            font-size: 18px;
            margin: 0;
            font-weight: 400;
          }
        </style>
      </head>
      <body>
        <div class="pop-shell">
          <div class="pop-head">
            <span>${escapeHtml(title)}</span>
            <div class="pop-actions">
              <button class="icon-button" data-pop-action="mini" type="button">min</button>
              <button class="icon-button" data-pop-action="dock" type="button">dock</button>
            </div>
          </div>
          <div id="pop-body" class="pop-body"></div>
        </div>
      </body>
    </html>
  `);
  popout.document.close();

  popout.addEventListener("beforeunload", () => {
    popouts[type] = null;
    elements.shell.classList.remove(type === "left" ? "is-left-detached" : "is-right-detached");
    refreshHardwareLayout();
    render();
  });

  popout.document.addEventListener("click", (event) => handlePopoutClick(event, type));
  attachPointerLighting(popout.document);
  attachPopoutWindowMover(popout);
  renderPopouts();
}

function attachPopoutWindowMover(popout) {
  const head = popout.document.querySelector(".pop-head");
  let moving = false;
  let startScreenX = 0;
  let startScreenY = 0;
  let startLeft = 0;
  let startTop = 0;

  head?.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) {
      return;
    }

    moving = true;
    startScreenX = event.screenX;
    startScreenY = event.screenY;
    startLeft = popout.screenX;
    startTop = popout.screenY;
    event.preventDefault();
  });

  popout.document.addEventListener("pointermove", (event) => {
    if (!moving) {
      return;
    }

    try {
      popout.moveTo(startLeft + event.screenX - startScreenX, startTop + event.screenY - startScreenY);
    } catch {
      moving = false;
    }
  });

  popout.document.addEventListener("pointerup", () => {
    moving = false;
  });

  popout.document.addEventListener("pointercancel", () => {
    moving = false;
  });
}

async function handlePopoutClick(event, type) {
  const actionButton = event.target.closest("[data-pop-action]");

  if (actionButton) {
    const action = actionButton.dataset.popAction;

    if (action === "mini") {
      const popout = popouts[type];
      popout.document.body.classList.toggle("is-mini");
      return;
    }

    if (action === "dock") {
      const popout = popouts[type];
      popouts[type] = null;
      elements.shell.classList.remove(type === "left" ? "is-left-detached" : "is-right-detached");
      refreshHardwareLayout();
      popout.close();
      render();
      return;
    }

  }

  const appButton = event.target.closest("[data-app-id]");

  if (appButton) {
    toggleAppSelection(appButton.dataset.appId);
    return;
  }

  const targetButton = event.target.closest("[data-target-id]");

  if (targetButton) {
    await openTransferModal(targetButton.dataset.targetId);
  }
}

function renderPopouts() {
  ["left", "right"].forEach((type) => {
    const popout = popouts[type];
    if (popout && !popout.closed) {
      try {
        popout.close();
      } catch {
        // Auxiliary window may already be closing.
      }
    }
    popouts[type] = null;
  });
  elements.shell.classList.remove("is-left-detached", "is-right-detached", "is-left-collapsed", "is-right-collapsed");
}

function renderPopoutsLegacy() {
  if (popouts.left && !popouts.left.closed) {
    const body = popouts.left.document.querySelector("#pop-body");
    if (body) {
      body.innerHTML = `<div class="app-list">${renderAppListHtml()}</div>`;
    }
  }

  if (popouts.right && !popouts.right.closed) {
    const body = popouts.right.document.querySelector("#pop-body");
    if (body) {
      body.innerHTML = `
        ${renderSideFocusHtml()}
        <div class="rail-title second">send to</div>
        <div class="target-grid compact">${renderTargetsHtml()}</div>
      `;
    }
  }
}
