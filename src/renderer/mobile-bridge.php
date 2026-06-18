<?php
declare(strict_types=1);

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$root = __DIR__ . DIRECTORY_SEPARATOR . 'bridge-data';
$sessionsRoot = $root . DIRECTORY_SEPARATOR . 'sessions';
$assetsRoot = $root . DIRECTORY_SEPARATOR . 'assets';

function ensure_bridge_dirs(): void {
    global $root, $sessionsRoot, $assetsRoot;
    foreach ([$root, $sessionsRoot, $assetsRoot] as $dir) {
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
    }
}

function send_json(array $value, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, max-age=0');
    echo json_encode($value, JSON_UNESCAPED_SLASHES);
    exit;
}

function send_text(string $value, int $status = 200, string $type = 'text/plain; charset=utf-8'): void {
    http_response_code($status);
    header('Content-Type: ' . $type);
    header('Cache-Control: no-store, max-age=0');
    echo $value;
    exit;
}

function safe_id(string $value, string $fallback = 'default'): string {
    $safe = preg_replace('/[^a-zA-Z0-9._-]/', '-', $value);
    $safe = trim((string) $safe, '-');
    return $safe !== '' ? substr($safe, 0, 96) : $fallback;
}

function read_payload(): array {
    $raw = file_get_contents('php://input') ?: '';
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function bridge_base_url(): string {
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['SERVER_PORT'] ?? '') === '443');
    $scheme = $https ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $scriptDir = str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/'));
    $scriptDir = $scriptDir === '/' ? '' : rtrim($scriptDir, '/');
    return $scheme . '://' . $host . $scriptDir;
}

function session_path(string $sessionId): string {
    global $sessionsRoot;
    return $sessionsRoot . DIRECTORY_SEPARATOR . safe_id($sessionId) . '.json';
}

function load_session(string $sessionId): array {
    ensure_bridge_dirs();
    $path = session_path($sessionId);
    if (!is_file($path)) {
        return ['assets' => [], 'requests' => []];
    }
    $data = json_decode((string) file_get_contents($path), true);
    return is_array($data) ? array_merge(['assets' => [], 'requests' => []], $data) : ['assets' => [], 'requests' => []];
}

function save_session(string $sessionId, array $state): void {
    ensure_bridge_dirs();
    file_put_contents(session_path($sessionId), json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
}

function data_url_parts(string $dataUrl): ?array {
    if (!preg_match('/^data:([^;,]+)?(;base64)?,(.*)$/s', $dataUrl, $matches)) {
        return null;
    }
    $mime = $matches[1] !== '' ? $matches[1] : 'application/octet-stream';
    $isBase64 = ($matches[2] ?? '') === ';base64';
    $payload = $matches[3] ?? '';
    $bytes = $isBase64 ? base64_decode($payload, true) : urldecode($payload);
    if ($bytes === false) {
        return null;
    }
    return ['mimeType' => $mime, 'bytes' => $bytes];
}

function extension_for_mime(string $mime, string $fallback = 'png'): string {
    $map = [
        'image/png' => 'png',
        'image/jpeg' => 'jpg',
        'image/jpg' => 'jpg',
        'image/gif' => 'gif',
        'image/webp' => 'webp',
        'image/svg+xml' => 'svg',
        'video/mp4' => 'mp4',
        'model/gltf-binary' => 'glb',
        'model/gltf+json' => 'gltf',
        'text/plain' => 'txt'
    ];
    return $map[strtolower($mime)] ?? safe_id($fallback, 'bin');
}

function kind_for_mime(string $mime, string $extension, string $fallback = 'still-image'): string {
    if (substr($mime, 0, 6) === 'video/') {
        return 'video';
    }
    if (strtolower($extension) === 'gif') {
        return 'animation';
    }
    if (in_array(strtolower($extension), ['glb', 'gltf', 'obj', 'fbx'], true)) {
        return 'model3d';
    }
    if (strtolower($extension) === 'svg' || $mime === 'image/svg+xml') {
        return 'vector';
    }
    return $fallback;
}

function make_asset(array $payload, string $sessionId): array {
    global $assetsRoot;
    ensure_bridge_dirs();
    $parts = data_url_parts((string) ($payload['dataUrl'] ?? ''));
    if (!$parts) {
        throw new RuntimeException('invalid data url');
    }
    $requestedExtension = safe_id((string) ($payload['extension'] ?? ''), '');
    $extension = $requestedExtension !== '' ? $requestedExtension : extension_for_mime($parts['mimeType']);
    $id = 'mobile-' . date('Ymd-His') . '-' . bin2hex(random_bytes(4));
    $filePath = $assetsRoot . DIRECTORY_SEPARATOR . $id . '.' . $extension;
    file_put_contents($filePath, $parts['bytes']);
    $displayName = (string) ($payload['displayName'] ?? $payload['originalName'] ?? ($id . '.' . $extension));
    $kind = (string) ($payload['kind'] ?? kind_for_mime($parts['mimeType'], $extension));

    return [
        'id' => $id,
        'name' => $displayName,
        'kind' => $kind,
        'extension' => $extension,
        'mimeType' => $parts['mimeType'],
        'path' => $filePath,
        'appId' => safe_id((string) ($payload['appId'] ?? '')),
        'currentAppId' => safe_id((string) ($payload['appId'] ?? '')),
        'sourceAppId' => safe_id((string) ($payload['appId'] ?? '')),
        'mobileBridgeSessionId' => $sessionId,
        'mobileUpload' => !empty($payload['mobileUpload']),
        'mobileInject' => !empty($payload['mobileInject']),
        'mobileInjectedAt' => '',
        'requestId' => (string) ($payload['requestId'] ?? ''),
        'createdAt' => gmdate('c'),
        'updatedAt' => gmdate('c')
    ];
}

function public_asset(array $asset, string $sessionId, bool $includeData = false): array {
    $viewUrl = 'mobile-bridge.php?api=asset&sid=' . rawurlencode($sessionId) . '&asset=' . rawurlencode((string) $asset['id']);
    $result = [
        'id' => $asset['id'],
        'name' => $asset['name'] ?? '',
        'kind' => $asset['kind'] ?? '',
        'extension' => $asset['extension'] ?? '',
        'mimeType' => $asset['mimeType'] ?? 'application/octet-stream',
        'appId' => $asset['appId'] ?? '',
        'currentAppId' => $asset['currentAppId'] ?? '',
        'sourceAppId' => $asset['sourceAppId'] ?? '',
        'mobileBridgeSessionId' => $sessionId,
        'mobileUpload' => !empty($asset['mobileUpload']),
        'mobileInject' => !empty($asset['mobileInject']),
        'mobileInjectedAt' => $asset['mobileInjectedAt'] ?? '',
        'viewUrl' => $viewUrl,
        'downloadUrl' => $viewUrl . '&download=1'
    ];
    if ($includeData && is_file((string) ($asset['path'] ?? ''))) {
        $result['dataUrl'] = 'data:' . $result['mimeType'] . ';base64,' . base64_encode((string) file_get_contents((string) $asset['path']));
    }
    return $result;
}

function get_session_id(array $payload = []): string {
    return safe_id((string) ($_GET['sid'] ?? $_GET['sessionId'] ?? $payload['sessionId'] ?? $payload['mobileBridgeSessionId'] ?? 'default'));
}

function render_mobile_bridge_page(string $appId, string $sessionId): string {
    $safeApp = htmlspecialchars($appId !== '' ? $appId : 'ycswu', ENT_QUOTES, 'UTF-8');
    $safeSession = htmlspecialchars($sessionId, ENT_QUOTES, 'UTF-8');
    return '<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>' . $safeApp . ' mobile bridge</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: #000; color: #f4fbff; font-family: "Courier New", Courier, monospace; }
    main { width: min(520px, 100%); margin: 0 auto; padding: 18px; display: grid; gap: 14px; }
    header, section { border: 1px solid #f4fbff; background: #050607; }
    header { padding: 12px; text-shadow: 0 0 8px rgba(112,232,255,.55); }
    h1 { margin: 0; font-size: 18px; line-height: 1.1; text-transform: lowercase; }
    p { margin: 6px 0 0; color: rgba(244,251,255,.72); font-size: 12px; line-height: 1.35; }
    .preview { min-height: 260px; display: grid; place-items: center; padding: 12px; background: #000; }
    .preview img, .preview video { max-width: 100%; max-height: 62vh; background: #000; }
    .empty { color: rgba(244,251,255,.58); font-size: 12px; text-align: center; }
    .controls { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 12px; }
    button, a.button, label.button { display: grid; place-items: center; min-height: 42px; padding: 10px; border: 1px solid #f4fbff; background: #fff; color: #000; font: inherit; font-weight: 700; text-align: center; text-decoration: none; }
    input[type=file] { position: absolute; opacity: 0; pointer-events: none; }
    .status { grid-column: 1 / -1; min-height: 18px; color: rgba(244,251,255,.72); font-size: 12px; }
    .history { padding: 12px; }
    .history h2 { margin: 0 0 10px; font-size: 13px; line-height: 1; text-transform: lowercase; }
    .history-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .history-item { min-width: 0; display: grid; gap: 5px; color: #f4fbff; text-decoration: none; }
    .history-item img { width: 100%; aspect-ratio: 1; object-fit: cover; border: 1px solid rgba(244,251,255,.72); background: #000; }
    .history-item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; color: rgba(244,251,255,.72); }
  </style>
</head>
<body>
  <main>
    <header><h1>' . $safeApp . '</h1><p>load and download through this session</p></header>
    <section class="preview" id="preview"><div class="empty">waiting for current image</div></section>
    <section class="controls">
      <button id="refresh" type="button">refresh</button>
      <a id="download" class="button" href="#" download hidden>download</a>
      <label class="button" for="upload">upload image</label>
      <button id="send-upload" type="button" disabled>send to device</button>
      <input id="upload" type="file" accept="image/*,image/gif,video/*" />
      <div id="status" class="status"></div>
    </section>
    <section class="history"><h2>session images</h2><div id="history" class="history-grid"></div></section>
  </main>
  <script>
    const bridgeUrl = "mobile-bridge.php";
    const appId = ' . json_encode($appId) . ';
    const mobileSessionId = ' . json_encode($sessionId) . ';
    const preview = document.querySelector("#preview");
    const statusEl = document.querySelector("#status");
    const download = document.querySelector("#download");
    const historyEl = document.querySelector("#history");
    let latestAssetId = "";
    let pendingUploadAssetId = "";
    let historyItems = [];
    function apiUrl(api, params = {}) {
      const url = new URL(bridgeUrl, window.location.href);
      url.searchParams.set("api", api);
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
      });
      return url.toString();
    }
    async function requestApi(api, payload, params = {}) {
      const options = payload ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) } : { cache: "no-store" };
      const response = await fetch(apiUrl(api, params), options);
      return response.json();
    }
    function setStatus(text) { statusEl.textContent = text || ""; }
    function renderHistory() {
      if (!historyItems.length) { historyEl.innerHTML = "<div class=\"empty\">no session images yet</div>"; return; }
      historyEl.innerHTML = historyItems.map((item) => "<a class=\"history-item\" href=\"" + item.downloadUrl + "\" download><img alt=\"\" src=\"" + item.src + "\" /><span>" + item.type + " / " + item.name + "</span></a>").join("");
    }
    function renderPreviewAsset(asset) {
      const source = asset.viewUrl + "&t=" + Date.now();
      if ((asset.mimeType || "").startsWith("video/")) {
        preview.innerHTML = "<video src=\"" + source + "\" muted playsinline controls loop></video>";
      } else {
        preview.innerHTML = "<img alt=\"\" src=\"" + source + "\" />";
      }
      return source;
    }
    function addHistory(item) {
      if (!item || !item.key) return;
      historyItems = [item, ...historyItems.filter((entry) => entry.key !== item.key)].slice(0, 18);
      renderHistory();
    }
    async function requestCurrentCapture() {
      try { await requestApi("mobile-capture-request", { appId, sessionId: mobileSessionId }); }
      catch { setStatus("desktop capture request failed"); }
    }
    async function refreshState() {
      const data = await requestApi("mobile-bridge-state", null, { app: appId, sid: mobileSessionId });
      const asset = data.latestAsset;
      if (!asset) {
        preview.innerHTML = "<div class=\"empty\">open this QR while the desktop app has an image output</div>";
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
        const result = await requestApi("capture-asset", {
          appId,
          kind: file.type.startsWith("video/") ? "video" : (extension === "gif" ? "animation" : "still-image"),
          extension,
          dataUrl: reader.result,
          displayName: file.name,
          originalName: file.name,
          mobileUpload: true,
          mobileInject: false,
          mobileBridgeSessionId: mobileSessionId,
          sessionId: mobileSessionId
        });
        setStatus(result.ok ? "uploaded" : "upload failed");
        if (result.ok && result.asset) {
          pendingUploadAssetId = result.asset.id;
          document.querySelector("#send-upload").disabled = false;
          addHistory({ key: "upload:" + result.asset.id, type: "sent", name: file.name, src: result.asset.viewUrl, downloadUrl: result.asset.downloadUrl });
        }
        await refreshState();
      };
      reader.readAsDataURL(file);
    });
    document.querySelector("#send-upload").addEventListener("click", async () => {
      if (!pendingUploadAssetId) return;
      setStatus("sending to open program...");
      const result = await requestApi("mobile-upload-request-inject", { assetId: pendingUploadAssetId, sessionId: mobileSessionId });
      setStatus(result.ok ? "queued for device" : "send failed");
      document.querySelector("#send-upload").disabled = true;
    });
    renderHistory();
    requestCurrentCapture();
    refreshState();
    window.setInterval(refreshState, 1500);
  </script>
</body>
</html>';
}

ensure_bridge_dirs();
$api = (string) ($_GET['api'] ?? '');
$payload = $_SERVER['REQUEST_METHOD'] === 'POST' ? read_payload() : [];
$sessionId = get_session_id($payload);

if ($api === '') {
    $appId = safe_id((string) ($_GET['app'] ?? 'ycswu'), 'ycswu');
    send_text(render_mobile_bridge_page($appId, $sessionId), 200, 'text/html; charset=utf-8');
}

if ($api === 'mobile-info') {
    $base = bridge_base_url();
    send_json([
        'ok' => true,
        'localUrl' => $base,
        'lanUrl' => $base,
        'mobileBaseUrl' => $base . '/mobile-bridge.php',
        'mobileBridgeUrl' => $base . '/mobile-bridge.php',
        'phpBridge' => true
    ]);
}

if ($api === 'mobile-bridge-state') {
    $state = load_session($sessionId);
    $appId = safe_id((string) ($_GET['app'] ?? ''));
    $latest = null;
    foreach ($state['assets'] as $asset) {
        if (($asset['appId'] ?? '') === $appId && empty($asset['mobileUpload'])) {
            $latest = $asset;
            break;
        }
    }
    send_json([
        'ok' => true,
        'sessionId' => $sessionId,
        'latestAsset' => $latest ? public_asset($latest, $sessionId) : null
    ]);
}

if ($api === 'asset') {
    $state = load_session($sessionId);
    $assetId = safe_id((string) ($_GET['asset'] ?? ''));
    foreach ($state['assets'] as $asset) {
        if (($asset['id'] ?? '') === $assetId && is_file((string) ($asset['path'] ?? ''))) {
            header('Content-Type: ' . ($asset['mimeType'] ?? 'application/octet-stream'));
            header('Cache-Control: no-store, max-age=0');
            if (!empty($_GET['download'])) {
                header('Content-Disposition: attachment; filename="' . preg_replace('/[^a-zA-Z0-9._-]/', '-', (string) ($asset['name'] ?? ($assetId . '.bin'))) . '"');
            }
            readfile((string) $asset['path']);
            exit;
        }
    }
    send_text('asset not found', 404);
}

if ($api === 'mobile-capture-requests') {
    $state = load_session($sessionId);
    $requests = [];
    foreach ($state['requests'] as $item) {
        if (($item['status'] ?? '') === 'pending') {
            $requests[] = $item;
        }
    }
    send_json(['ok' => true, 'requests' => $requests]);
}

if ($api === 'mobile-capture-request') {
    $appId = safe_id((string) ($payload['appId'] ?? ''));
    $state = load_session($sessionId);
    $request = [
        'id' => 'mobile-request-' . date('Ymd-His') . '-' . bin2hex(random_bytes(4)),
        'appId' => $appId,
        'sessionId' => $sessionId,
        'status' => 'pending',
        'createdAt' => gmdate('c')
    ];
    array_unshift($state['requests'], $request);
    $state['requests'] = array_slice($state['requests'], 0, 50);
    save_session($sessionId, $state);
    send_json(['ok' => true, 'request' => $request]);
}

if ($api === 'mobile-capture-result') {
    $state = load_session($sessionId);
    foreach ($state['requests'] as &$request) {
        if (($request['id'] ?? '') === (string) ($payload['requestId'] ?? '')) {
            $request['status'] = !empty($payload['ok']) ? 'done' : 'failed';
            $request['assetId'] = (string) ($payload['assetId'] ?? '');
            $request['message'] = (string) ($payload['message'] ?? '');
            $request['updatedAt'] = gmdate('c');
            break;
        }
    }
    save_session($sessionId, $state);
    send_json(['ok' => true]);
}

if ($api === 'capture-asset') {
    try {
        $state = load_session($sessionId);
        $asset = make_asset($payload, $sessionId);
        array_unshift($state['assets'], $asset);
        $state['assets'] = array_slice($state['assets'], 0, 100);
        save_session($sessionId, $state);
        send_json(['ok' => true, 'asset' => public_asset($asset, $sessionId)]);
    } catch (Throwable $error) {
        send_json(['ok' => false, 'message' => $error->getMessage()], 400);
    }
}

if ($api === 'asset-data') {
    $state = load_session($sessionId);
    $assetId = safe_id((string) ($payload['assetId'] ?? $_GET['assetId'] ?? ''));
    foreach ($state['assets'] as $asset) {
        if (($asset['id'] ?? '') === $assetId && is_file((string) ($asset['path'] ?? ''))) {
            $public = public_asset($asset, $sessionId, true);
            send_json(['ok' => true] + $public + ['asset' => $public]);
        }
    }
    send_json(['ok' => false, 'message' => 'asset not found'], 404);
}

if ($api === 'mobile-upload-request-inject') {
    $state = load_session($sessionId);
    $assetId = safe_id((string) ($payload['assetId'] ?? ''));
    foreach ($state['assets'] as &$asset) {
        if (($asset['id'] ?? '') === $assetId) {
            $asset['mobileUpload'] = true;
            $asset['mobileInject'] = true;
            $asset['mobileInjectedAt'] = '';
            $asset['updatedAt'] = gmdate('c');
            save_session($sessionId, $state);
            send_json(['ok' => true, 'asset' => public_asset($asset, $sessionId)]);
        }
    }
    send_json(['ok' => false, 'message' => 'asset not found'], 404);
}

if ($api === 'mobile-uploads') {
    $state = load_session($sessionId);
    $appId = safe_id((string) ($_GET['appId'] ?? ''));
    $uploads = [];
    foreach ($state['assets'] as $asset) {
        if (!empty($asset['mobileUpload']) && !empty($asset['mobileInject']) && empty($asset['mobileInjectedAt'])
            && (($asset['currentAppId'] ?? '') === $appId || ($asset['sourceAppId'] ?? '') === $appId || ($asset['appId'] ?? '') === $appId)) {
            $uploads[] = public_asset($asset, $sessionId, true);
        }
    }
    send_json(['ok' => true, 'uploads' => $uploads]);
}

if ($api === 'mobile-upload-injected') {
    $state = load_session($sessionId);
    $assetId = safe_id((string) ($payload['assetId'] ?? ''));
    foreach ($state['assets'] as &$asset) {
        if (($asset['id'] ?? '') === $assetId) {
            $asset['mobileInjectedAt'] = gmdate('c');
            $asset['updatedAt'] = gmdate('c');
            save_session($sessionId, $state);
            send_json(['ok' => true]);
        }
    }
    send_json(['ok' => false, 'message' => 'asset not found'], 404);
}

send_json(['ok' => false, 'message' => 'api route not found'], 404);
