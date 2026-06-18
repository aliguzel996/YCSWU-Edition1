const path = require("path");
const { createInteropService } = require("../src/main/interop-service.cjs");

const workspaceRoot = path.join(__dirname, "..");
const userDataPath = path.join(workspaceRoot, "work", "smoke-user-data");
const service = createInteropService({ workspaceRoot, userDataPath });
const state = service.getState();
const appIds = state.registry.apps.map((appEntry) => appEntry.id);
const failures = [];
let handoffCount = 0;

service.clearWorkspace();

for (const sourceAppId of appIds) {
  const created = service.createScratchAsset({ appId: sourceAppId });

  if (!created.ok || !created.asset) {
    failures.push(`${sourceAppId}: could not create scratch asset`);
    continue;
  }

  const routes = service.getState().assetRoutes[created.asset.id] || [];

  for (const targetAppId of appIds) {
    const expectedRoute = routes.find((route) => route.targetAppId === targetAppId);

    if (!expectedRoute?.possible) {
      continue;
    }

    const handoff = service.handoffAsset({
      assetId: created.asset.id,
      sourceAppId,
      targetAppId
    });

    if (!handoff.ok) {
      failures.push(`${sourceAppId} -> ${targetAppId}: ${handoff.message || "handoff failed"}`);
      continue;
    }

    handoffCount += 1;
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`smoke ok: ${handoffCount} handoffs across ${appIds.length} apps`);
