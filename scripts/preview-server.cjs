const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { createInteropService } = require("../src/main/interop-service.cjs");

const workspaceRoot = path.join(__dirname, "..");
const rendererRoot = path.join(workspaceRoot, "src", "renderer");
const userDataPath = path.join(workspaceRoot, "work", "preview-user-data");
const port = Number(process.env.PORT || 5173);
const interopService = createInteropService({ workspaceRoot, userDataPath });
const registry = interopService.getState().registry;
const mobileCaptureRequests = [];

function sendJson(response, value) {
  const body = JSON.stringify(value);
  response.writeHead(200, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store, max-age=0",
    "Content-Length": Buffer.byteLength(body)
  });
  response.end(body);
}

function sendText(response, statusCode, value) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain",
    "Cache-Control": "no-store, max-age=0"
  });
  response.end(value);
}

function sendHtml(response, value) {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0"
  });
  response.end(value);
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getLanAddress() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const item of addresses || []) {
      if (item.family === "IPv4" && !item.internal) {
        return item.address;
      }
    }
  }

  return "127.0.0.1";
}

function getMobileBaseUrl(request = null) {
  const host = request?.headers?.host || `127.0.0.1:${port}`;
  const lanAddress = getLanAddress();
  const hostPort = host.includes(":") ? host.split(":").pop() : String(port);
  return `http://${lanAddress}:${hostPort}`;
}

function getRequestUrl(request) {
  return new URL(request.url, `http://${request.headers.host || `127.0.0.1:${port}`}`);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      resolve(body ? JSON.parse(body) : {});
    });
    request.on("error", reject);
  });
}

function getStaticPath(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split("?")[0]);

  if (cleanPath === "/") {
    return path.join(rendererRoot, "index.html");
  }

  const normalized = path.normalize(cleanPath.replace(/^\/+/, ""));
  const targetPath = path.join(rendererRoot, normalized);

  if (!targetPath.startsWith(rendererRoot)) {
    return null;
  }

  return targetPath;
}

function resolveLocalEmbed(appId) {
  const appEntry = registry.apps.find((item) => item.id === appId);

  if (!appEntry || appEntry.embed?.mode !== "local" || !appEntry.embed.localRoot) {
    return null;
  }

  return appEntry;
}

function safeJoinInside(root, requestPath) {
  const normalized = path.normalize(requestPath.replace(/^\/+/, ""));
  const targetPath = path.join(root, normalized);
  const relative = path.relative(root, targetPath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return targetPath;
}

function getEmbeddedPath(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split("?")[0]);
  const embeddedMatch = cleanPath.match(/^\/embedded\/([^/]+)\/?(.*)$/);

  if (embeddedMatch) {
    const appEntry = resolveLocalEmbed(embeddedMatch[1]);

    if (!appEntry) {
      return null;
    }

    const requestPath = embeddedMatch[2] || appEntry.embed.indexFile || "index.html";
    return safeJoinInside(appEntry.embed.localRoot, requestPath);
  }

  for (const appEntry of registry.apps) {
    if (appEntry.embed?.mode !== "local" || !appEntry.embed.localRoot) {
      continue;
    }

    for (const basePath of appEntry.embed.basePaths || []) {
      if (!cleanPath.startsWith(basePath)) {
        continue;
      }

      const requestPath = cleanPath.slice(basePath.length) || appEntry.embed.indexFile || "index.html";
      return safeJoinInside(appEntry.embed.localRoot, requestPath);
    }
  }

  return null;
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  switch (extension) {
    case ".html":
      return "text/html";
    case ".css":
      return "text/css";
    case ".js":
      return "text/javascript";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".ico":
      return "image/x-icon";
    case ".json":
      return "application/json";
    case ".wasm":
      return "application/wasm";
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".webm":
      return "video/webm";
    default:
      return "application/octet-stream";
  }
}

function getMobileAssetCandidates(appId, sessionId = "") {
  const store = interopService.getState().store || { assets: [] };
  const imageKinds = new Set(["still-image", "vector", "animation", "video"]);

  return store.assets.filter((asset) => (
    asset
    && imageKinds.has(asset.kind)
    && (asset.currentAppId === appId || asset.sourceAppId === appId)
    && (!sessionId || asset.mobileBridgeSessionId === sessionId)
    && (!sessionId || asset.mobilePreview || asset.mobileUpload)
  ));
}

function getMobileLatestAsset(appId, sessionId = "") {
  return getMobileAssetCandidates(appId, sessionId)[0] || null;
}

function getAssetById(assetId) {
  return (interopService.getState().store?.assets || []).find((asset) => asset.id === assetId) || null;
}

function streamMobileAsset(request, response, assetId) {
  const asset = getAssetById(assetId);

  if (!asset?.path || !fs.existsSync(asset.path)) {
    sendText(response, 404, "asset not found");
    return;
  }

  const url = getRequestUrl(request);
  const contentType = getContentType(asset.path);
  const disposition = url.searchParams.get("download")
    ? `attachment; filename="${path.basename(asset.path).replaceAll('"', "")}"`
    : "inline";

  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Disposition": disposition,
    "Cache-Control": "no-store, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0"
  });
  fs.createReadStream(asset.path).pipe(response);
}

function renderMobileBridgePage(appId, request) {
  const requestUrl = getRequestUrl(request);
  const appEntry = registry.apps.find((item) => item.id === appId) || registry.apps[0];
  const safeAppId = appEntry?.id || "";
  const appName = appEntry?.name || "YCSWU";
  const baseUrl = getMobileBaseUrl(request);
  const mobileSessionId = requestUrl.searchParams.get("sid") || `phone-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(appName)} mobile bridge</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        background: #000;
        color: #f4fbff;
        font-family: "Courier New", Courier, monospace;
      }
      main {
        width: min(520px, 100%);
        margin: 0 auto;
        padding: 18px;
        display: grid;
        gap: 14px;
      }
      header,
      section {
        border: 1px solid #f4fbff;
        background: #050607;
      }
      header {
        padding: 12px;
        text-shadow: 0 0 8px rgba(112, 232, 255, 0.55);
      }
      h1 {
        margin: 0;
        font-size: 18px;
        line-height: 1.1;
        text-transform: lowercase;
      }
      p {
        margin: 6px 0 0;
        color: rgba(244, 251, 255, 0.72);
        font-size: 12px;
        line-height: 1.35;
      }
      .preview {
        min-height: 260px;
        display: grid;
        place-items: center;
        padding: 12px;
        background:
          linear-gradient(rgba(102, 231, 255, 0.06), rgba(102, 231, 255, 0.02)),
          #000;
      }
      .preview img {
        max-width: 100%;
        max-height: 62vh;
        image-rendering: auto;
      }
      .preview video {
        max-width: 100%;
        max-height: 62vh;
        background: #000;
      }
      .empty {
        color: rgba(244, 251, 255, 0.58);
        font-size: 12px;
        text-align: center;
      }
      .controls {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        padding: 12px;
      }
      button,
      a.button,
      label.button {
        display: grid;
        place-items: center;
        min-height: 42px;
        padding: 10px;
        border: 1px solid #f4fbff;
        background: #fff;
        color: #000;
        font: inherit;
        font-weight: 700;
        text-align: center;
        text-decoration: none;
      }
      input[type="file"] {
        position: absolute;
        opacity: 0;
        pointer-events: none;
      }
      .status {
        grid-column: 1 / -1;
        min-height: 18px;
        color: rgba(244, 251, 255, 0.72);
        font-size: 12px;
      }
      .history {
        padding: 12px;
      }
      .history h2 {
        margin: 0 0 10px;
        font-size: 13px;
        line-height: 1;
        text-transform: lowercase;
        text-shadow: 0 0 8px rgba(112, 232, 255, 0.46);
      }
      .history-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
      }
      .history-item {
        min-width: 0;
        display: grid;
        gap: 5px;
        color: #f4fbff;
        text-decoration: none;
      }
      .history-item img {
        width: 100%;
        aspect-ratio: 1;
        object-fit: cover;
        border: 1px solid rgba(244, 251, 255, 0.72);
        background: #000;
      }
      .history-item span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 10px;
        color: rgba(244, 251, 255, 0.72);
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>${escapeHtml(appName)}</h1>
        <p>${escapeHtml(baseUrl)} / phone bridge</p>
      </header>
      <section class="preview" id="preview"><div class="empty">waiting for current image</div></section>
      <section class="controls">
        <button id="refresh" type="button">refresh</button>
        <a id="download" class="button" href="#" download hidden>download</a>
        <label class="button" for="upload">upload image</label>
        <button id="send-upload" type="button" disabled>send to device</button>
        <input id="upload" type="file" accept="image/*" />
        <div id="status" class="status"></div>
      </section>
      <section class="history">
        <h2>session images</h2>
        <div id="history" class="history-grid"></div>
      </section>
    </main>
    <script>
      const appId = ${JSON.stringify(safeAppId)};
      const mobileSessionId = ${JSON.stringify(mobileSessionId)};
      const preview = document.querySelector("#preview");
      const statusEl = document.querySelector("#status");
      const download = document.querySelector("#download");
      const historyEl = document.querySelector("#history");
      const historyKey = "ycswu-mobile-history:" + appId + ":" + mobileSessionId;
      let latestAssetId = "";
      let pendingUploadAssetId = "";
      let historyItems = [];

      try {
        historyItems = JSON.parse(sessionStorage.getItem(historyKey) || "[]");
      } catch {
        historyItems = [];
      }

      function setStatus(text) {
        statusEl.textContent = text || "";
      }

      function saveHistory() {
        try {
          sessionStorage.setItem(historyKey, JSON.stringify(historyItems.slice(0, 18)));
        } catch {
          // Large phone photos can exceed sessionStorage; the live in-memory list still remains.
        }
      }

      function renderHistory() {
        if (!historyItems.length) {
          historyEl.innerHTML = '<div class="empty">no session images yet</div>';
          return;
        }

        historyEl.innerHTML = historyItems.map((item) => (
          '<a class="history-item" href="' + item.downloadUrl + '" download>' +
            '<img alt="" src="' + item.src + '" />' +
            '<span>' + item.type + ' / ' + item.name + '</span>' +
          '</a>'
        )).join("");
      }

      function renderPreviewAsset(asset) {
        const source = asset.viewUrl + '&t=' + Date.now();
        if ((asset.mimeType || '').startsWith('video/')) {
          preview.innerHTML = '<video src="' + source + '" muted playsinline controls loop></video>';
          return source;
        }

        preview.innerHTML = '<img alt="" src="' + source + '" />';
        return source;
      }

      function addHistory(item) {
        if (!item || !item.key) return;
        historyItems = [item, ...historyItems.filter((entry) => entry.key !== item.key)].slice(0, 18);
        saveHistory();
        renderHistory();
      }

      async function requestCurrentCapture() {
        try {
          await fetch("/api/mobile-capture-request", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ appId, sessionId: mobileSessionId })
          });
        } catch {
          setStatus("desktop capture request failed");
        }
      }

      async function refreshState() {
        const response = await fetch("/api/mobile-bridge-state?app=" + encodeURIComponent(appId) + "&sid=" + encodeURIComponent(mobileSessionId), { cache: "no-store" });
        const data = await response.json();
        const asset = data.latestAsset;

        if (!asset) {
          preview.innerHTML = '<div class="empty">open this QR while the desktop app has an image output</div>';
          download.hidden = true;
          latestAssetId = "";
          return;
        }

        if (asset.id !== latestAssetId) {
          latestAssetId = asset.id;
          const previewSrc = renderPreviewAsset(asset);
          download.href = asset.downloadUrl;
          download.hidden = false;
          addHistory({
            key: "asset:" + asset.id,
            type: "received",
            name: asset.name || asset.kind || "image",
            src: previewSrc,
            downloadUrl: asset.downloadUrl
          });
        }
      }

      document.querySelector("#refresh").addEventListener("click", async () => {
        setStatus("refreshing desktop capture...");
        await requestCurrentCapture();
        window.setTimeout(refreshState, 900);
      });

      document.querySelector("#upload").addEventListener("change", async (event) => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        setStatus("uploading...");
        const reader = new FileReader();
        reader.onload = async () => {
          const extension = (file.name.split(".").pop() || "png").toLowerCase();
          const result = await fetch("/api/capture-asset", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              appId,
              kind: "still-image",
              extension,
              dataUrl: reader.result,
              displayName: file.name,
              originalName: file.name,
              mobileUpload: true,
              mobileInject: false,
              mobileBridgeSessionId: mobileSessionId
            })
          }).then((item) => item.json());
          setStatus(result.ok ? "sent to desktop" : "upload failed");
          if (result.ok && result.asset) {
            pendingUploadAssetId = result.asset.id;
            document.querySelector("#send-upload").disabled = false;
            addHistory({
              key: "upload:" + result.asset.id,
              type: "sent",
              name: file.name,
              src: "/mobile-assets/" + encodeURIComponent(result.asset.id) + "?inline=1",
              downloadUrl: "/mobile-assets/" + encodeURIComponent(result.asset.id) + "?download=1"
            });
          }
          await refreshState();
        };
        reader.readAsDataURL(file);
      });

      document.querySelector("#send-upload").addEventListener("click", async () => {
        if (!pendingUploadAssetId) return;
        setStatus("sending to open program...");
        const result = await fetch("/api/mobile-upload-request-inject", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assetId: pendingUploadAssetId })
        }).then((item) => item.json());
        setStatus(result.ok ? "queued for device" : "send failed");
        document.querySelector("#send-upload").disabled = true;
      });

      renderHistory();
      requestCurrentCapture();
      refreshState();
      window.setInterval(refreshState, 1500);
    </script>
  </body>
</html>`;
}

async function handleApi(request, response) {
  const requestUrl = getRequestUrl(request);

  if (request.method === "GET" && requestUrl.pathname === "/api/state") {
    sendJson(response, interopService.getState());
    return true;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/mobile-info") {
    const lanUrl = getMobileBaseUrl(request);
    sendJson(response, {
      ok: true,
      localUrl: `http://127.0.0.1:${port}`,
      lanUrl,
      mobileBaseUrl: lanUrl
    });
    return true;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/mobile-bridge-state") {
    const appId = requestUrl.searchParams.get("app") || "";
    const sessionId = requestUrl.searchParams.get("sid") || "";
    const appEntry = registry.apps.find((item) => item.id === appId) || null;
    const latestAsset = appEntry ? getMobileLatestAsset(appEntry.id, sessionId) : null;
    sendJson(response, {
      ok: Boolean(appEntry),
      sessionId,
      app: appEntry ? { id: appEntry.id, name: appEntry.name, icon: appEntry.icon } : null,
      latestAsset: latestAsset ? {
        id: latestAsset.id,
        name: latestAsset.name,
        kind: latestAsset.kind,
        mimeType: getContentType(latestAsset.path || ""),
        viewUrl: `/mobile-assets/${encodeURIComponent(latestAsset.id)}?inline=1`,
        downloadUrl: `/mobile-assets/${encodeURIComponent(latestAsset.id)}?download=1`
      } : null
    });
    return true;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/mobile-capture-requests") {
    sendJson(response, {
      ok: true,
      requests: mobileCaptureRequests.filter((item) => item.status === "pending")
    });
    return true;
  }

  if (request.method !== "POST") {
    return false;
  }

  const body = await readRequestBody(request);

  if (requestUrl.pathname === "/api/mobile-capture-request") {
    const appEntry = registry.apps.find((item) => item.id === body.appId);

    if (!appEntry) {
      sendJson(response, { ok: false, message: "app not found" });
      return true;
    }

    const requestEntry = {
      id: `mobile-request-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      appId: appEntry.id,
      sessionId: String(body.sessionId || ""),
      status: "pending",
      createdAt: new Date().toISOString()
    };
    mobileCaptureRequests.unshift(requestEntry);
    mobileCaptureRequests.splice(25);
    sendJson(response, { ok: true, request: requestEntry });
    return true;
  }

  if (requestUrl.pathname === "/api/mobile-capture-result") {
    const requestEntry = mobileCaptureRequests.find((item) => item.id === body.requestId);

    if (requestEntry) {
      requestEntry.status = body.ok ? "done" : "failed";
      requestEntry.assetId = body.assetId || "";
      requestEntry.message = body.message || "";
      requestEntry.updatedAt = new Date().toISOString();
    }

    sendJson(response, { ok: true, request: requestEntry || null });
    return true;
  }

  if (requestUrl.pathname === "/api/mobile-upload-request-inject") {
    const store = interopService.readStore();
    const asset = store.assets.find((item) => item.id === body.assetId);

    if (!asset) {
      sendJson(response, { ok: false, message: "asset not found" });
      return true;
    }

    asset.mobileUpload = true;
    asset.mobileInject = true;
    asset.mobileInjectedAt = "";
    asset.updatedAt = new Date().toISOString();
    interopService.writeStore(store);
    sendJson(response, { ok: true, asset, state: interopService.getState() });
    return true;
  }

  if (requestUrl.pathname === "/api/mobile-upload-injected") {
    sendJson(response, interopService.markMobileUploadInjected(body));
    return true;
  }

  if (requestUrl.pathname === "/api/create-scratch-asset") {
    sendJson(response, interopService.createScratchAsset(body));
    return true;
  }

  if (requestUrl.pathname === "/api/capture-asset") {
    sendJson(response, interopService.createCapturedAsset(body));
    return true;
  }

  if (requestUrl.pathname === "/api/asset-data") {
    sendJson(response, interopService.getAssetData(body));
    return true;
  }

  if (requestUrl.pathname === "/api/handoff-asset") {
    sendJson(response, interopService.handoffAsset(body));
    return true;
  }

  if (requestUrl.pathname === "/api/clear-workspace") {
    sendJson(response, interopService.clearWorkspace());
    return true;
  }

  if (requestUrl.pathname === "/api/launch-app") {
    sendJson(response, { ok: true, mode: "preview" });
    return true;
  }

  return false;
}

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = getRequestUrl(request);

    if (request.url.startsWith("/api/")) {
      const handled = await handleApi(request, response);

      if (!handled) {
        sendText(response, 404, "api route not found");
      }

      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/mobile-bridge") {
      sendHtml(response, renderMobileBridgePage(requestUrl.searchParams.get("app") || "", request));
      return;
    }

    const mobileAssetMatch = requestUrl.pathname.match(/^\/mobile-assets\/([^/]+)$/);

    if (request.method === "GET" && mobileAssetMatch) {
      streamMobileAsset(request, response, decodeURIComponent(mobileAssetMatch[1]));
      return;
    }

    const staticPath = getEmbeddedPath(request.url) || getStaticPath(request.url);

    if (!staticPath || !fs.existsSync(staticPath) || fs.statSync(staticPath).isDirectory()) {
      sendText(response, 404, "not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": getContentType(staticPath),
      "Cache-Control": "no-store, max-age=0",
      "Pragma": "no-cache",
      "Expires": "0"
    });
    fs.createReadStream(staticPath).pipe(response);
  } catch (error) {
    sendText(response, 500, error.message);
  }
});

server.listen(port, "0.0.0.0", () => {
  const lanUrl = `http://${getLanAddress()}:${port}`;
  const info = { url: `http://127.0.0.1:${port}`, lanUrl, mobileBaseUrl: lanUrl, userDataPath };
  fs.mkdirSync(path.join(workspaceRoot, "work"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "work", "preview-server.json"), `${JSON.stringify(info, null, 2)}\n`, "utf8");
  console.log(info.url);
});
