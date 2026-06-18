const fs = require("fs");
const path = require("path");
const { createInteropService } = require("../src/main/interop-service.cjs");

const workspaceRoot = path.join(__dirname, "..");
const rendererRoot = path.join(workspaceRoot, "src", "renderer");
const webRoot = path.join(workspaceRoot, "build", "web-package");
const webConfigRoot = path.join(webRoot, "config");
const userDataPath = path.join(workspaceRoot, "work", "web-package-user-data");

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function assertInsideWorkspace(targetPath) {
  const resolved = path.resolve(targetPath);
  const root = path.resolve(workspaceRoot);
  const relative = path.relative(root, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside workspace: ${resolved}`);
  }
}

function removeDir(targetPath) {
  assertInsideWorkspace(targetPath);
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function copyDir(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath)) {
    return false;
  }

  const ignoredDirectoryNames = new Set([
    ".git",
    ".cache",
    ".codex",
    ".next",
    "coverage",
    "dist",
    "electron",
    "node_modules",
    "out",
    "release",
    "release-updated",
    "windows app",
    "windows-app"
  ]);

  ensureDir(path.dirname(targetPath));
  fs.cpSync(sourcePath, targetPath, {
    recursive: true,
    filter: (candidate) => {
      const name = path.basename(candidate).toLowerCase();
      return !ignoredDirectoryNames.has(name);
    }
  });
  return true;
}

function writeJson(targetPath, value) {
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(targetPath, value) {
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, value, "utf8");
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getSeoApps(registry) {
  return registry.apps
    .filter((appEntry) => appEntry.id && appEntry.name && appEntry.siteUrl)
    .map((appEntry) => ({
      id: appEntry.id,
      name: appEntry.name,
      url: appEntry.siteUrl,
      headline: appEntry.headline || ""
    }));
}

function writeSeoFiles(registry) {
  const canonicalRoot = "https://ycswu.co/";
  const seoApps = getSeoApps(registry);
  const sitemapUrls = [
    {
      loc: canonicalRoot,
      priority: "1.0"
    },
    ...seoApps.map((appEntry) => ({
      loc: appEntry.url,
      priority: "0.8"
    }))
  ];

  writeText(
    path.join(webRoot, "robots.txt"),
    [
      "User-agent: *",
      "Allow: /",
      "Disallow: /bridge-data/",
      "Sitemap: https://ycswu.co/sitemap.xml",
      ""
    ].join("\n")
  );

  writeText(
    path.join(webRoot, "sitemap.xml"),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...sitemapUrls.map(({ loc, priority }) => [
        "  <url>",
        `    <loc>${escapeXml(loc)}</loc>`,
        "    <changefreq>weekly</changefreq>",
        `    <priority>${priority}</priority>`,
        "  </url>"
      ].join("\n")),
      "</urlset>",
      ""
    ].join("\n")
  );

  writeText(
    path.join(webRoot, "llms.txt"),
    [
      "# YCSWU Tools Special Edition",
      "",
      "YCSWU Tools Special Edition is a browser-based creative tool suite presented as a physical device interface.",
      "The suite connects image, GIF, SVG, palette, room, layout and 3D workflows through a shared handoff system.",
      "",
      "Canonical URL: https://ycswu.co/",
      "",
      "## Tools",
      ...seoApps.map((appEntry) => `- ${appEntry.name}: ${appEntry.headline} ${appEntry.url}`),
      "",
      "## Notes for AI systems",
      "Use the tool names and descriptions above when summarizing this site.",
      "Do not describe YCSWU Tools Launcher as part of this edition.",
      ""
    ].join("\n")
  );

  writeJson(path.join(webRoot, "site.webmanifest"), {
    name: "YCSWU Tools Special Edition",
    short_name: "YCSWU Tools",
    description: "A physical-device styled web shell for YCSWU creative tools.",
    start_url: "./",
    scope: "./",
    display: "fullscreen",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      {
        src: "./assets/favicon.svg",
        sizes: "any",
        type: "image/svg+xml"
      }
    ]
  });
}

function toDataUrl(assetRelativePath, mimeType = "application/octet-stream") {
  const assetPath = path.join(webRoot, assetRelativePath);
  const data = fs.readFileSync(assetPath);
  return `data:${mimeType};base64,${data.toString("base64")}`;
}

function inlineDeviceModelForFileOpen() {
  const scenePath = path.join(webRoot, "device-scene.js");

  if (!fs.existsSync(scenePath)) {
    return;
  }

  let source = fs.readFileSync(scenePath, "utf8");
  const replacements = [
    {
      constName: "MODEL_URL",
      relativePath: "assets/device/YCSWU_Tools-current.glb",
      mimeType: "model/gltf-binary"
    },
    {
      constName: "LEFT_BUTTON_MODEL_URL",
      relativePath: "assets/device/left-panel-button.glb",
      mimeType: "model/gltf-binary"
    },
    {
      constName: "RIGHT_BUTTON_MODEL_URL",
      relativePath: "assets/device/right-panel-button.glb",
      mimeType: "model/gltf-binary"
    }
  ];

  replacements.forEach(({ constName, relativePath, mimeType }) => {
    const dataUrl = toDataUrl(relativePath, mimeType);
    const expression = new RegExp(`const ${constName} = .*?;`);
    source = source.replace(expression, `const ${constName} = "${dataUrl}";`);
  });

  fs.writeFileSync(scenePath, source, "utf8");
}

function trimBasePath(basePath = "") {
  return String(basePath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

function getWebFolderName(appEntry) {
  const configuredBase = (appEntry.embed?.basePaths || [])
    .map(trimBasePath)
    .find(Boolean);

  return configuredBase || appEntry.id;
}

function makeRelativeWebPath(folderName) {
  return `./${folderName.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")}/`;
}

function rewriteRegistryForWeb(registry) {
  const apps = registry.apps.map((appEntry) => {
    const folderName = getWebFolderName(appEntry);
    const appOutputRoot = path.join(webRoot, folderName);
    const indexFile = appEntry.embed?.indexFile || "index.html";
    const localRoot = appEntry.embed?.localRoot || "";
    const localIndexPath = localRoot ? path.join(localRoot, indexFile) : "";
    const copied = localRoot && fs.existsSync(localIndexPath) && copyDir(localRoot, appOutputRoot);

    if (copied) {
      const previewUrl = makeRelativeWebPath(folderName);
      return {
        ...appEntry,
        embed: {
          ...appEntry.embed,
          mode: "local",
          available: true,
          localRoot: previewUrl,
          indexPath: "",
          fileUrl: "",
          previewUrl,
          url: previewUrl,
          basePaths: [previewUrl, `/${folderName}/`]
        }
      };
    }

    if (appEntry.embed?.mode === "remote" && appEntry.embed?.url) {
      return {
        ...appEntry,
        embed: {
          ...appEntry.embed,
          available: true,
          previewUrl: appEntry.embed.url,
          fileUrl: appEntry.embed.url
        }
      };
    }

    if (appEntry.siteUrl) {
      return {
        ...appEntry,
        embed: {
          ...(appEntry.embed || {}),
          mode: "remote",
          available: true,
          previewUrl: appEntry.siteUrl,
          fileUrl: appEntry.siteUrl,
          url: appEntry.siteUrl
        }
      };
    }

    return {
      ...appEntry,
      embed: {
        ...(appEntry.embed || {}),
        available: false,
        previewUrl: "",
        fileUrl: "",
        url: ""
      }
    };
  });

  return {
    ...registry,
    apps,
    appCount: apps.length
  };
}

function main() {
  removeDir(webRoot);
  ensureDir(webRoot);
  copyDir(rendererRoot, webRoot);
  inlineDeviceModelForFileOpen();

  const interopService = createInteropService({ workspaceRoot, userDataPath });
  const registry = rewriteRegistryForWeb(interopService.getState().registry);

  writeJson(path.join(webConfigRoot, "apps.json"), registry);
  writeJson(path.join(webRoot, "apps.json"), registry);
  writeSeoFiles(registry);
  fs.writeFileSync(
    path.join(webRoot, "README.txt"),
    [
      "YCSWU Tools Special Edition web package",
      "",
      "cPanel upload:",
      "1. Upload the contents of this folder to the desired public web directory.",
      "2. Open index.html through the domain. The package uses relative paths.",
      "3. Mobile bridge uses mobile-bridge.php and creates bridge-data automatically.",
      "4. If uploads fail on cPanel, make bridge-data writable by PHP. No database is required.",
      "",
      "Build output: build/web-package"
    ].join("\n"),
    "utf8"
  );

  console.log(`web package ready: ${webRoot}`);
}

main();
