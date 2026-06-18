const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

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

function sendSvg(response, value) {
  response.writeHead(200, {
    "Content-Type": "image/svg+xml; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
    "Content-Length": Buffer.byteLength(value)
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

function createQrSvg(value = "") {
  const version = 5;
  const size = 17 + version * 4;
  const dataCodewords = 108;
  const ecCodewords = 26;
  const bytes = Array.from(Buffer.from(String(value), "utf8"));

  if (bytes.length > 102) {
    throw new Error("qr payload too long");
  }

  const matrix = Array.from({ length: size }, () => Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => Array(size).fill(false));

  function set(row, col, dark, reserve = true) {
    if (row < 0 || col < 0 || row >= size || col >= size) {
      return;
    }

    matrix[row][col] = Boolean(dark);
    if (reserve) {
      reserved[row][col] = true;
    }
  }

  function drawFinder(row, col) {
    for (let y = -1; y <= 7; y += 1) {
      for (let x = -1; x <= 7; x += 1) {
        const rr = row + y;
        const cc = col + x;
        const inside = x >= 0 && x <= 6 && y >= 0 && y <= 6;
        const dark = inside && (x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4));
        set(rr, cc, dark);
      }
    }
  }

  function drawAlignment(row, col) {
    for (let y = -2; y <= 2; y += 1) {
      for (let x = -2; x <= 2; x += 1) {
        const dark = Math.max(Math.abs(x), Math.abs(y)) !== 1;
        set(row + y, col + x, dark);
      }
    }
  }

  function appendBits(bits, valueToAppend, length) {
    for (let i = length - 1; i >= 0; i -= 1) {
      bits.push((valueToAppend >>> i) & 1);
    }
  }

  const bits = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, bytes.length, 8);
  bytes.forEach((byte) => appendBits(bits, byte, 8));
  appendBits(bits, 0, Math.min(4, dataCodewords * 8 - bits.length));
  while (bits.length % 8) {
    bits.push(0);
  }

  const data = [];
  for (let index = 0; index < bits.length; index += 8) {
    data.push(bits.slice(index, index + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }
  for (let pad = 0; data.length < dataCodewords; pad += 1) {
    data.push(pad % 2 ? 0x11 : 0xec);
  }

  function gfMultiply(a, b) {
    let result = 0;
    let x = a;
    let y = b;
    while (y > 0) {
      if (y & 1) {
        result ^= x;
      }
      x <<= 1;
      if (x & 0x100) {
        x ^= 0x11d;
      }
      y >>>= 1;
    }
    return result;
  }

  const exp = [1];
  for (let i = 1; i < 255; i += 1) {
    exp[i] = gfMultiply(exp[i - 1], 2);
  }

  function gfPow(power) {
    return exp[power % 255];
  }

  let generator = [1];
  for (let i = 0; i < ecCodewords; i += 1) {
    const next = Array(generator.length + 1).fill(0);
    generator.forEach((coefficient, index) => {
      next[index] ^= coefficient;
      next[index + 1] ^= gfMultiply(coefficient, gfPow(i));
    });
    generator = next;
  }

  const remainder = Array(ecCodewords).fill(0);
  data.forEach((byte) => {
    const factor = byte ^ remainder.shift();
    remainder.push(0);
    generator.slice(1).forEach((coefficient, index) => {
      remainder[index] ^= gfMultiply(coefficient, factor);
    });
  });

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);
  drawAlignment(30, 30);
  for (let i = 8; i < size - 8; i += 1) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (let i = 0; i < 9; i += 1) {
    if (i !== 6) {
      reserved[8][i] = true;
      reserved[i][8] = true;
    }
  }
  for (let i = 0; i < 8; i += 1) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }
  set(4 * version + 9, 8, true);

  const codewords = data.concat(remainder);
  const dataBits = [];
  codewords.forEach((byte) => appendBits(dataBits, byte, 8));

  let bitIndex = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) {
      col -= 1;
    }
    for (let rowStep = 0; rowStep < size; rowStep += 1) {
      const row = upward ? size - 1 - rowStep : rowStep;
      for (let offset = 0; offset < 2; offset += 1) {
        const cc = col - offset;
        if (reserved[row][cc]) {
          continue;
        }
        const mask = (row + cc) % 2 === 0;
        set(row, cc, Boolean((dataBits[bitIndex] || 0) ^ mask), false);
        bitIndex += 1;
      }
    }
    upward = !upward;
  }

  function formatBits(errorCorrectionBits = 1, mask = 0) {
    let dataValue = (errorCorrectionBits << 3) | mask;
    let valueToDivide = dataValue << 10;
    const generatorValue = 0x537;
    for (let i = 14; i >= 10; i -= 1) {
      if ((valueToDivide >>> i) & 1) {
        valueToDivide ^= generatorValue << (i - 10);
      }
    }
    return ((dataValue << 10) | valueToDivide) ^ 0x5412;
  }

  const format = formatBits();
  const getFormatBit = (index) => (format >>> index) & 1;
  for (let i = 0; i <= 5; i += 1) set(8, i, getFormatBit(i));
  set(8, 7, getFormatBit(6));
  set(8, 8, getFormatBit(7));
  set(7, 8, getFormatBit(8));
  for (let i = 9; i < 15; i += 1) set(14 - i, 8, getFormatBit(i));
  for (let i = 0; i < 8; i += 1) set(size - 1 - i, 8, getFormatBit(i));
  for (let i = 8; i < 15; i += 1) set(8, size - 15 + i, getFormatBit(i));

  const quiet = 4;
  const rects = [];
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (matrix[row][col]) {
        rects.push(`<rect x="${col + quiet}" y="${row + quiet}" width="1" height="1"/>`);
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size + quiet * 2} ${size + quiet * 2}" shape-rendering="crispEdges"><g fill="#fff">${rects.join("")}</g></svg>`;
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

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
    request.on("error", reject);
  });
}

function createMobileBridgeServer({ interopService, preferredPort = 5174 } = {}) {
  if (!interopService) {
    throw new Error("interopService is required");
  }

  let server = null;
  let port = 0;
  const mobileCaptureRequests = [];

  function getState() {
    return interopService.getState();
  }

  function getRegistry() {
    return getState().registry || { apps: [] };
  }

  function getRequestUrl(request) {
    return new URL(request.url || "/", `http://${request.headers.host || `127.0.0.1:${port || preferredPort}`}`);
  }

  function getMobileBaseUrl(request = null) {
    const host = request?.headers?.host || `127.0.0.1:${port || preferredPort}`;
    const hostPort = host.includes(":") ? host.split(":").pop() : String(port || preferredPort);
    return `http://${getLanAddress()}:${hostPort}`;
  }

  function getInfo() {
    const lanUrl = `http://${getLanAddress()}:${port || preferredPort}`;
    return {
      ok: true,
      localUrl: `http://127.0.0.1:${port || preferredPort}`,
      lanUrl,
      mobileBaseUrl: lanUrl
    };
  }

  function findApp(appId) {
    return getRegistry().apps.find((item) => item.id === appId) || null;
  }

  function getAssetById(assetId) {
    return (getState().store?.assets || []).find((asset) => asset.id === assetId) || null;
  }

  function getMobileAssetCandidates(appId, sessionId = "") {
    const imageKinds = new Set(["still-image", "vector", "animation", "video"]);
    return (getState().store?.assets || []).filter((asset) => (
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

  function streamMobileAsset(request, response, assetId) {
    const asset = getAssetById(assetId);

    if (!asset?.path || !fs.existsSync(asset.path)) {
      sendText(response, 404, "asset not found");
      return;
    }

    const requestUrl = getRequestUrl(request);
    const disposition = requestUrl.searchParams.get("download")
      ? `attachment; filename="${path.basename(asset.path).replaceAll('"', "")}"`
      : "inline";

    response.writeHead(200, {
      "Content-Type": getContentType(asset.path),
      "Content-Disposition": disposition,
      "Cache-Control": "no-store, max-age=0",
      "Pragma": "no-cache",
      "Expires": "0"
    });
    fs.createReadStream(asset.path).pipe(response);
  }

  function renderMobileBridgePage(appId, request) {
    const requestUrl = getRequestUrl(request);
    const appEntry = findApp(appId) || getRegistry().apps[0] || null;
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
      body { margin: 0; min-height: 100vh; background: #000; color: #f4fbff; font-family: "Courier New", Courier, monospace; }
      main { width: min(520px, 100%); margin: 0 auto; padding: 18px; display: grid; gap: 14px; }
      header, section { border: 1px solid #f4fbff; background: #050607; }
      header { padding: 12px; text-shadow: 0 0 8px rgba(112, 232, 255, 0.55); }
      h1 { margin: 0; font-size: 18px; line-height: 1.1; text-transform: lowercase; }
      p { margin: 6px 0 0; color: rgba(244, 251, 255, 0.72); font-size: 12px; line-height: 1.35; }
      .preview { min-height: 260px; display: grid; place-items: center; padding: 12px; background: linear-gradient(rgba(102, 231, 255, 0.06), rgba(102, 231, 255, 0.02)), #000; }
      .preview img, .preview video { max-width: 100%; max-height: 62vh; background: #000; }
      .empty { color: rgba(244, 251, 255, 0.58); font-size: 12px; text-align: center; }
      .controls { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 12px; }
      button, a.button, label.button { display: grid; place-items: center; min-height: 42px; padding: 10px; border: 1px solid #f4fbff; background: #fff; color: #000; font: inherit; font-weight: 700; text-align: center; text-decoration: none; }
      input[type="file"] { position: absolute; opacity: 0; pointer-events: none; }
      .status { grid-column: 1 / -1; min-height: 18px; color: rgba(244, 251, 255, 0.72); font-size: 12px; }
      .history { padding: 12px; }
      .history h2 { margin: 0 0 10px; font-size: 13px; line-height: 1; text-transform: lowercase; text-shadow: 0 0 8px rgba(112, 232, 255, 0.46); }
      .history-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
      .history-item { min-width: 0; display: grid; gap: 5px; color: #f4fbff; text-decoration: none; }
      .history-item img { width: 100%; aspect-ratio: 1; object-fit: cover; border: 1px solid rgba(244, 251, 255, 0.72); background: #000; }
      .history-item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; color: rgba(244, 251, 255, 0.72); }
      .bridge-error { grid-column: 1 / -1; border: 1px solid #fff; padding: 10px; color: #fff; background: #210000; font-size: 12px; }
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
        <input id="upload" type="file" accept="image/*,image/gif,video/*" />
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
      let latestAssetId = "";
      let pendingUploadAssetId = "";
      let historyItems = [];

      function setStatus(text) { statusEl.textContent = text || ""; }
      function showBridgeError(text) {
        setStatus("bridge error: " + text);
        const errorBox = document.createElement("div");
        errorBox.className = "bridge-error";
        errorBox.textContent = "bridge error: " + text;
        document.querySelector(".controls").appendChild(errorBox);
      }
      window.addEventListener("error", (event) => showBridgeError(event.message || "script failed"));
      window.addEventListener("unhandledrejection", (event) => showBridgeError((event.reason && event.reason.message) || "request failed"));
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
          addHistory({ key: "asset:" + asset.id, type: "received", name: asset.name || asset.kind || "image", src: previewSrc, downloadUrl: asset.downloadUrl });
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
              kind: file.type.startsWith("video/") ? "video" : (extension === "gif" ? "animation" : "still-image"),
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
            addHistory({ key: "upload:" + result.asset.id, type: "sent", name: file.name, src: "/mobile-assets/" + encodeURIComponent(result.asset.id) + "?inline=1", downloadUrl: "/mobile-assets/" + encodeURIComponent(result.asset.id) + "?download=1" });
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

  function renderMobileBridgeLandingPage(request) {
    const baseUrl = getMobileBaseUrl(request);
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>YCSWU mobile bridge</title>
    <style>
      :root { color-scheme: dark; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #000; color: #f4fbff; font-family: "Courier New", Courier, monospace; }
      main { width: min(520px, calc(100% - 32px)); border: 1px solid #f4fbff; padding: 18px; background: #050607; }
      h1 { margin: 0 0 10px; font-size: 18px; text-transform: lowercase; text-shadow: 0 0 8px rgba(112, 232, 255, 0.55); }
      p { margin: 8px 0 0; color: rgba(244, 251, 255, 0.72); font-size: 12px; line-height: 1.45; }
      code { color: #fff; }
    </style>
  </head>
  <body>
    <main>
      <h1>mobile bridge online</h1>
      <p>Scan the QR inside the desktop device. Direct IP is only the bridge health page.</p>
      <p><code>${escapeHtml(baseUrl)}</code></p>
    </main>
  </body>
</html>`;
  }

  async function handleApi(request, response) {
    const requestUrl = getRequestUrl(request);

    if (request.method === "GET" && requestUrl.pathname === "/api/qr") {
      const data = requestUrl.searchParams.get("data") || "";

      if (!data) {
        sendText(response, 400, "missing qr data");
        return true;
      }

      const svg = createQrSvg(data);
      sendSvg(response, svg);
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
      const appEntry = findApp(appId);
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
      const appEntry = findApp(body.appId);

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
      sendJson(response, markMobileCaptureRequest(body));
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
      sendJson(response, { ok: true, asset, state: getState() });
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

    return false;
  }

  function markMobileCaptureRequest(payload = {}) {
    const requestEntry = mobileCaptureRequests.find((item) => item.id === payload.requestId);

    if (requestEntry) {
      requestEntry.status = payload.ok ? "done" : "failed";
      requestEntry.assetId = payload.assetId || "";
      requestEntry.message = payload.message || "";
      requestEntry.updatedAt = new Date().toISOString();
    }

    return { ok: true, request: requestEntry || null };
  }

  function getPendingCaptureRequests() {
    return {
      ok: true,
      requests: mobileCaptureRequests.filter((item) => item.status === "pending")
    };
  }

  async function handleRequest(request, response) {
    try {
      const requestUrl = getRequestUrl(request);

      if ((request.url || "").startsWith("/api/")) {
        const handled = await handleApi(request, response);
        if (!handled) {
          sendText(response, 404, "api route not found");
        }
        return;
      }

      if (request.method === "GET" && (requestUrl.pathname === "/mobile-bridge" || requestUrl.pathname === "/mobile-bridge/")) {
        sendHtml(response, renderMobileBridgePage(requestUrl.searchParams.get("app") || "", request));
        return;
      }

      if (request.method === "GET" && (requestUrl.pathname === "/" || requestUrl.pathname === "")) {
        if (requestUrl.searchParams.get("app")) {
          sendHtml(response, renderMobileBridgePage(requestUrl.searchParams.get("app") || "", request));
          return;
        }

        sendHtml(response, renderMobileBridgeLandingPage(request));
        return;
      }

      const mobileAssetMatch = requestUrl.pathname.match(/^\/mobile-assets\/([^/]+)$/);
      if (request.method === "GET" && mobileAssetMatch) {
        streamMobileAsset(request, response, decodeURIComponent(mobileAssetMatch[1]));
        return;
      }

      sendText(response, 404, "not found");
    } catch (error) {
      sendText(response, 500, error.message);
    }
  }

  function listenOn(candidatePort) {
    return new Promise((resolve, reject) => {
      const nextServer = http.createServer(handleRequest);

      function cleanup() {
        nextServer.removeListener("listening", onListening);
        nextServer.removeListener("error", onError);
      }

      function onListening() {
        cleanup();
        server = nextServer;
        port = nextServer.address().port;
        resolve();
      }

      function onError(error) {
        cleanup();
        nextServer.close();
        reject(error);
      }

      nextServer.once("listening", onListening);
      nextServer.once("error", onError);
      nextServer.listen(candidatePort, "0.0.0.0");
    });
  }

  async function start() {
    if (server) {
      return getInfo();
    }

    const ports = preferredPort === 0
      ? [0]
      : Array.from({ length: 25 }, (_value, index) => preferredPort + index);

    let lastError = null;
    for (const candidatePort of ports) {
      try {
        await listenOn(candidatePort);
        return getInfo();
      } catch (error) {
        lastError = error;
        if (error.code !== "EADDRINUSE") {
          break;
        }
      }
    }

    throw lastError || new Error("mobile bridge server failed to start");
  }

  function close() {
    if (!server) {
      return;
    }

    server.close();
    server = null;
  }

  return {
    start,
    close,
    getInfo,
    getPendingCaptureRequests,
    markMobileCaptureRequest
  };
}

module.exports = { createMobileBridgeServer };
