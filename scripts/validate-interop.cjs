const path = require("path");
const { loadRegistry } = require("../src/main/interop-service.cjs");

const workspaceRoot = path.join(__dirname, "..");
const registry = loadRegistry(workspaceRoot);
const launcherIds = new Set(["ycswu-tools-launcher", "ycswu-tools"]);
const failures = [];

for (const appEntry of registry.apps) {
  if (launcherIds.has(appEntry.id)) {
    failures.push(`Launcher app must stay excluded: ${appEntry.id}`);
  }

  if (!appEntry.producesKinds.length) {
    failures.push(`${appEntry.id} has no produced asset kinds`);
  }
}

for (const row of registry.matrix) {
  for (const route of row.routes) {
    if (route.possible && !route.routeKinds.length) {
      failures.push(`${route.sourceAppId} -> ${route.targetAppId} route is missing kinds`);
    }
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

const routes = registry.matrix.flatMap((row) => row.routes);
const direct = routes.filter((route) => route.mode === "direct").length;
const routed = routes.filter((route) => route.possible && route.mode !== "direct").length;
const unavailable = routes.filter((route) => !route.possible).length;

console.log(`interop ok: ${registry.apps.length} apps, ${direct} direct routes, ${routed} routed handoffs, ${unavailable} unavailable routes`);
