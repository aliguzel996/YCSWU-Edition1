const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { pathToFileURL } = require("url");

let electronRuntime = null;

function getElectronRuntime() {
  if (electronRuntime) {
    return electronRuntime;
  }

  try {
    electronRuntime = require("electron");
  } catch {
    electronRuntime = {};
  }

  return electronRuntime;
}

function ensureDir(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function safeFileName(value = "asset") {
  return String(value)
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "asset";
}

function getExtension(filePath = "") {
  return path.extname(filePath).replace(".", "").toLowerCase();
}

function getExtensionForMime(mimeType = "") {
  switch (mimeType.toLowerCase()) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/svg+xml":
      return "svg";
    default:
      return "";
  }
}

function getMimeForExtension(extension = "") {
  switch (extension.toLowerCase()) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "mp4":
      return "video/mp4";
    case "mov":
      return "video/quicktime";
    case "webm":
      return "video/webm";
    case "json":
      return "application/json";
    case "obj":
      return "text/plain";
    case "fbx":
    case "glb":
    case "gltf":
    case "stl":
    case "dae":
    case "usdz":
      return "application/octet-stream";
    default:
      return "application/octet-stream";
  }
}

function parseDataUrl(dataUrl = "") {
  const match = String(dataUrl).match(/^data:([^;,]+)(;base64)?,(.*)$/s);

  if (!match) {
    return null;
  }

  const mimeType = match[1].toLowerCase();
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || "";

  return {
    mimeType,
    buffer: isBase64 ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8")
  };
}

function specsToKinds(specs = []) {
  return unique(specs.map((spec) => spec.kind));
}

function specsToExtensions(specs = []) {
  return unique(specs.flatMap((spec) => spec.extensions || []).map((item) => item.toLowerCase()));
}

function specMatchesKind(specs = [], kind) {
  return specs.some((spec) => spec.kind === kind);
}

function buildExtensionIndex(assetClasses = []) {
  const index = new Map();

  for (const assetClass of assetClasses) {
    for (const extension of assetClass.extensions || []) {
      const key = extension.toLowerCase();
      const current = index.get(key) || [];
      current.push(assetClass.kind);
      index.set(key, unique(current));
    }
  }

  return index;
}

function classifyByExtension(registry, extension) {
  const index = buildExtensionIndex(registry.assetClasses);
  const possibleKinds = index.get(String(extension || "").toLowerCase()) || [];
  return {
    kind: possibleKinds[0] || "unknown",
    possibleKinds: possibleKinds.length ? possibleKinds : ["unknown"]
  };
}

function enrichRegistry(rawRegistry) {
  const apps = rawRegistry.apps
    .filter((appEntry) => !rawRegistry.suite.excludedAppIds.includes(appEntry.id))
    .map((appEntry) => {
      const embed = normalizeEmbed(appEntry);

      return {
        ...appEntry,
        embed,
        acceptsKinds: specsToKinds(appEntry.accepts),
        producesKinds: specsToKinds(appEntry.produces),
        acceptsExtensions: specsToExtensions(appEntry.accepts),
        producesExtensions: specsToExtensions(appEntry.produces)
      };
    });

  return {
    ...rawRegistry,
    apps,
    appCount: apps.length
  };
}

function normalizeEmbed(appEntry) {
  const embed = appEntry.embed || {};

  if (embed.mode === "local" && embed.localRoot) {
    const indexFile = embed.indexFile || "index.html";
    const indexPath = path.join(embed.localRoot, indexFile);
    const available = fs.existsSync(indexPath);

    return {
      ...embed,
      indexFile,
      indexPath,
      available,
      fileUrl: available ? pathToFileURL(indexPath).href : "",
      previewUrl: `/embedded/${appEntry.id}/`
    };
  }

  if (embed.mode === "remote" && embed.url) {
    return {
      ...embed,
      available: true,
      previewUrl: embed.url,
      fileUrl: embed.url
    };
  }

  return {
    mode: "none",
    available: false,
    previewUrl: "",
    fileUrl: ""
  };
}

function buildTransformEdges(registry) {
  const edges = new Map();

  function pushEdge(from, edge) {
    const current = edges.get(from) || [];
    current.push(edge);
    edges.set(from, current);
  }

  for (const appEntry of registry.apps) {
    for (const transform of appEntry.transforms || []) {
      for (const from of transform.from || []) {
        for (const to of transform.to || []) {
          if (from === to) {
            continue;
          }

          pushEdge(from, {
            from,
            to,
            mode: "app",
            id: appEntry.id,
            label: appEntry.name
          });
        }
      }
    }
  }

  for (const adapter of registry.busAdapters || []) {
    for (const from of adapter.from || []) {
      for (const to of adapter.to || []) {
        if (from === to) {
          continue;
        }

        pushEdge(from, {
          from,
          to,
          mode: "bus",
          id: adapter.id,
          label: adapter.name
        });
      }
    }
  }

  return edges;
}

function createDirectRoute(fromKinds, toKinds) {
  const directKinds = fromKinds.filter((kind) => toKinds.includes(kind));

  if (!directKinds.length) {
    return null;
  }

  return {
    possible: true,
    mode: "direct",
    routeKinds: [directKinds[0]],
    segments: [],
    label: directKinds[0]
  };
}

function findKindRoute(registry, fromKinds, toKinds) {
  const directRoute = createDirectRoute(fromKinds, toKinds);

  if (directRoute) {
    return directRoute;
  }

  const edges = buildTransformEdges(registry);
  const targets = new Set(toKinds);
  const queue = fromKinds.map((kind) => ({ kind, path: [] }));
  const visited = new Set(fromKinds);
  const maxDepth = 5;

  while (queue.length) {
    const current = queue.shift();

    if (current.path.length >= maxDepth) {
      continue;
    }

    for (const edge of edges.get(current.kind) || []) {
      const nextPath = [...current.path, edge];

      if (targets.has(edge.to)) {
        const hasBus = nextPath.some((segment) => segment.mode === "bus");
        const hasApp = nextPath.some((segment) => segment.mode === "app");

        return {
          possible: true,
          mode: hasBus ? "bus-route" : hasApp ? "app-route" : "route",
          routeKinds: [fromKinds[0], ...nextPath.map((segment) => segment.to)],
          segments: nextPath,
          label: nextPath.map((segment) => segment.label).join(" > ")
        };
      }

      if (!visited.has(edge.to)) {
        visited.add(edge.to);
        queue.push({ kind: edge.to, path: nextPath });
      }
    }
  }

  return {
    possible: false,
    mode: "none",
    routeKinds: [],
    segments: [],
    label: ""
  };
}

function resolveAppRoute(registry, sourceApp, targetApp) {
  const route = findKindRoute(registry, sourceApp.producesKinds, targetApp.acceptsKinds);

  return {
    ...route,
    sourceAppId: sourceApp.id,
    targetAppId: targetApp.id,
    sourceKinds: sourceApp.producesKinds,
    targetKinds: targetApp.acceptsKinds
  };
}

function resolveAssetRoute(registry, asset, targetApp) {
  const sourceKinds = unique(asset.possibleKinds || [asset.kind]);
  const route = createDirectRoute(sourceKinds, targetApp.acceptsKinds) || {
    possible: false,
    mode: "none",
    routeKinds: [],
    segments: [],
    label: ""
  };

  return {
    ...route,
    assetId: asset.id,
    targetAppId: targetApp.id,
    sourceKinds,
    targetKinds: targetApp.acceptsKinds
  };
}

function buildMatrix(registry) {
  return registry.apps.map((sourceApp) => ({
    appId: sourceApp.id,
    appName: sourceApp.name,
    routes: registry.apps.map((targetApp) => resolveAppRoute(registry, sourceApp, targetApp))
  }));
}

function loadRegistry(workspaceRoot) {
  const rawRegistry = readJson(path.join(workspaceRoot, "config", "apps.json"), null);

  if (!rawRegistry || !Array.isArray(rawRegistry.apps)) {
    throw new Error("Special Edition registry bulunamadi.");
  }

  const registry = enrichRegistry(rawRegistry);
  return {
    ...registry,
    matrix: buildMatrix(registry)
  };
}

function createEmptyStore() {
  return {
    assets: [],
    transfers: [],
    updatedAt: new Date().toISOString()
  };
}

class InteropService {
  constructor({ workspaceRoot, userDataPath }) {
    this.workspaceRoot = workspaceRoot;
    this.userDataPath = userDataPath;
    this.registry = loadRegistry(workspaceRoot);
    this.assetRoot = path.join(userDataPath, "asset-bus");
    this.storePath = path.join(userDataPath, "handoff-state.json");
    ensureDir(this.assetRoot);
  }

  readStore() {
    return readJson(this.storePath, createEmptyStore());
  }

  writeStore(store) {
    writeJson(this.storePath, {
      ...store,
      updatedAt: new Date().toISOString()
    });
  }

  getState() {
    const store = this.readStore();
    const assetRoutes = {};

    for (const asset of store.assets) {
      assetRoutes[asset.id] = this.registry.apps.map((appEntry) => resolveAssetRoute(this.registry, asset, appEntry));
    }

    return {
      registry: this.registry,
      assetRoutes,
      store,
      workspacePath: this.assetRoot
    };
  }

  createAssetRecord({ sourcePath, sourceAppId = "", kind = "", possibleKinds = [], virtual = false, displayName = "" }) {
    const extension = getExtension(sourcePath);
    const classified = kind
      ? { kind, possibleKinds: unique([kind, ...possibleKinds]) }
      : classifyByExtension(this.registry, extension);

    return {
      id: `asset-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      name: displayName || path.basename(sourcePath),
      path: sourcePath,
      extension,
      kind: classified.kind,
      possibleKinds: classified.possibleKinds,
      sourceAppId,
      currentAppId: sourceAppId,
      virtual,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      handoffCount: 0
    };
  }

  async importAssets(ownerWindow) {
    const { dialog } = getElectronRuntime();

    if (!dialog) {
      return { ok: false, message: "Electron dialog kullanilamiyor.", imported: [], state: this.getState() };
    }

    const filters = [
      {
        name: "YCSWU compatible assets",
        extensions: unique(this.registry.assetClasses.flatMap((assetClass) => assetClass.extensions))
      },
      { name: "All files", extensions: ["*"] }
    ];

    const result = await dialog.showOpenDialog(ownerWindow, {
      title: "Import asset",
      properties: ["openFile", "multiSelections"],
      filters
    });

    if (result.canceled || !result.filePaths.length) {
      return { ok: true, imported: [], state: this.getState() };
    }

    const store = this.readStore();
    const imported = [];

    for (const filePath of result.filePaths) {
      const fileName = safeFileName(path.basename(filePath));
      const targetPath = path.join(this.assetRoot, `${Date.now()}-${fileName}`);
      fs.copyFileSync(filePath, targetPath);
      const asset = this.createAssetRecord({ sourcePath: targetPath, displayName: path.basename(filePath) });
      store.assets.unshift(asset);
      imported.push(asset);
    }

    this.writeStore(store);
    return { ok: true, imported, state: this.getState() };
  }

  createScratchAsset(payload = {}) {
    const appEntry = this.registry.apps.find((item) => item.id === payload.appId) || this.registry.apps[0];
    const produceSpec = appEntry.produces[payload.produceIndex || 0] || appEntry.produces[0];
    const extension = produceSpec.extensions?.[0] || "json";
    const fileName = `${safeFileName(appEntry.id)}-${produceSpec.kind}.${extension}.asset.json`;
    const targetPath = path.join(this.assetRoot, `${Date.now()}-${fileName}`);
    const assetPayload = {
      appId: appEntry.id,
      appName: appEntry.name,
      kind: produceSpec.kind,
      extension,
      createdAt: new Date().toISOString()
    };

    writeJson(targetPath, assetPayload);

    const store = this.readStore();
    const asset = this.createAssetRecord({
      sourcePath: targetPath,
      sourceAppId: appEntry.id,
      kind: produceSpec.kind,
      possibleKinds: [produceSpec.kind],
      virtual: true,
      displayName: `${appEntry.name} ${produceSpec.kind}`
    });
    asset.extension = extension;
    store.assets.unshift(asset);
    this.writeStore(store);

    return { ok: true, asset, state: this.getState() };
  }

  createCapturedAsset(payload = {}) {
    const appEntry = this.registry.apps.find((item) => item.id === payload.appId);
    const parsed = parseDataUrl(payload.dataUrl);

    if (!appEntry) {
      return { ok: false, message: "Kaynak uygulama bulunamadi.", state: this.getState() };
    }

    if (!parsed || !parsed.buffer.length) {
      return { ok: false, message: "Yakalanacak cikti bulunamadi.", state: this.getState() };
    }

    const kind = payload.kind || appEntry.produces?.[0]?.kind || "unknown";
    const extension = payload.extension || getExtensionForMime(parsed.mimeType) || "bin";
    const fileName = `${Date.now()}-${safeFileName(appEntry.id)}-${safeFileName(kind)}.${extension}`;
    const targetPath = path.join(this.assetRoot, fileName);
    fs.writeFileSync(targetPath, parsed.buffer);

    const store = this.readStore();
    const asset = this.createAssetRecord({
      sourcePath: targetPath,
      sourceAppId: appEntry.id,
      kind,
      possibleKinds: [kind],
      virtual: false,
      displayName: payload.displayName || `${appEntry.name} ${kind}`
    });
    asset.extension = extension;
    asset.captured = true;
    asset.mobileUpload = Boolean(payload.mobileUpload);
    asset.mobileInject = Boolean(payload.mobileInject);
    asset.mobilePreview = Boolean(payload.mobilePreview);
    asset.mobileRequestId = payload.mobileRequestId || "";
    asset.mobileBridgeSessionId = payload.mobileBridgeSessionId || payload.mobileSessionId || "";
    asset.originalName = payload.originalName || "";
    store.assets.unshift(asset);
    this.writeStore(store);

    return { ok: true, asset, state: this.getState() };
  }

  getAssetData(payload = {}) {
    const asset = this.readStore().assets.find((item) => item.id === payload.assetId);

    if (!asset || !asset.path || !fs.existsSync(asset.path)) {
      return { ok: false, message: "Asset dosyasi bulunamadi.", state: this.getState() };
    }

    const buffer = fs.readFileSync(asset.path);
    const mimeType = getMimeForExtension(asset.extension || getExtension(asset.path));

    return {
      ok: true,
      asset,
      name: asset.name || path.basename(asset.path),
      mimeType,
      dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`
    };
  }

  markMobileUploadInjected(payload = {}) {
    const store = this.readStore();
    const asset = store.assets.find((item) => item.id === payload.assetId);

    if (!asset) {
      return { ok: false, message: "Asset dosyasi bulunamadi.", state: this.getState() };
    }

    asset.mobileInjectedAt = new Date().toISOString();
    asset.updatedAt = asset.mobileInjectedAt;
    this.writeStore(store);
    return { ok: true, asset, state: this.getState() };
  }

  handoffAsset(payload = {}) {
    const store = this.readStore();
    const asset = store.assets.find((item) => item.id === payload.assetId);
    const targetApp = this.registry.apps.find((item) => item.id === payload.targetAppId);

    if (!asset || !targetApp) {
      return { ok: false, message: "Asset ya da hedef uygulama bulunamadi.", state: this.getState() };
    }

    const route = resolveAssetRoute(this.registry, asset, targetApp);

    if (!route.possible) {
      return { ok: false, message: "Bu asset icin uygun rota bulunamadi.", route, state: this.getState() };
    }

    const transfer = {
      id: `transfer-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      assetId: asset.id,
      fromAppId: payload.sourceAppId || asset.currentAppId || asset.sourceAppId || "",
      targetAppId: targetApp.id,
      route,
      createdAt: new Date().toISOString()
    };

    asset.currentAppId = targetApp.id;
    asset.updatedAt = transfer.createdAt;
    asset.handoffCount = (asset.handoffCount || 0) + 1;
    store.transfers.unshift(transfer);
    this.writeStore(store);

    return { ok: true, transfer, state: this.getState() };
  }

  clearWorkspace() {
    const store = createEmptyStore();
    this.writeStore(store);

    for (const entry of fs.readdirSync(this.assetRoot, { withFileTypes: true })) {
      const targetPath = path.join(this.assetRoot, entry.name);

      if (entry.isFile()) {
        fs.unlinkSync(targetPath);
      }
    }

    return { ok: true, state: this.getState() };
  }

  launchApp(payload = {}) {
    const appEntry = this.registry.apps.find((item) => item.id === payload.appId);

    if (!appEntry) {
      return { ok: false, message: "Uygulama bulunamadi." };
    }

    const asset = payload.assetId ? this.readStore().assets.find((item) => item.id === payload.assetId) : null;
    const knownPath = (appEntry.launch?.knownPaths || []).find((candidate) => fs.existsSync(candidate));

    if (knownPath) {
      const args = asset && fs.existsSync(asset.path) ? [asset.path] : [];
      const child = spawn(knownPath, args, {
        detached: true,
        stdio: "ignore"
      });
      child.unref();

      return { ok: true, mode: "executable", path: knownPath, args };
    }

    if (appEntry.siteUrl) {
      const { shell } = getElectronRuntime();
      const url = asset ? `${appEntry.siteUrl}?handoff=${encodeURIComponent(asset.id)}` : appEntry.siteUrl;
      if (shell) {
        shell.openExternal(url);
      }
      return { ok: true, mode: "site", url };
    }

    return { ok: false, message: "Launch path ya da site URL yok." };
  }
}

function createInteropService(options) {
  return new InteropService(options);
}

module.exports = {
  buildMatrix,
  createInteropService,
  findKindRoute,
  loadRegistry,
  resolveAppRoute,
  resolveAssetRoute
};
