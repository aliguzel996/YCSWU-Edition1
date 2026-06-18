import * as THREE from "./vendor/three/three.module.js";
import { GLTFLoader } from "./vendor/three/GLTFLoader.js";

const MODEL_URL = new URL("./assets/device/YCSWU_Tools-current.glb", import.meta.url).href;
const SKY_ENVIRONMENT_URL = new URL("./assets/device/VRaySky_PRG_03.jpg", import.meta.url).href;
const LEFT_BUTTON_MODEL_URL = new URL("./assets/device/left-panel-button.glb", import.meta.url).href;
const RIGHT_BUTTON_MODEL_URL = new URL("./assets/device/right-panel-button.glb", import.meta.url).href;
const MODEL_FIT_PADDING = 0.99;
const FALLBACK_DEPTH = 0.16;
const DEFAULT_LIGHT_ANGLE = 225;
const DEFAULT_LIGHT_ELEVATION = 34;
const DEFAULT_LIGHT_VIEWPORT_X = 0.475;
const DEFAULT_LIGHT_VIEWPORT_Y = 0.165;
const BUTTON_PRESS_DEPTH = 0.00205;
const SKY_ENVIRONMENT_ROTATION_X = THREE.MathUtils.degToRad(-3);
const SKY_ENVIRONMENT_ROTATION_Y = THREE.MathUtils.degToRad(128);
const SKY_REFLECTION_TILT_X = 5.2;
const SKY_REFLECTION_TILT_Y = 6.4;
const USE_PROJECTED_HTML_REGIONS = true;
const USE_DETECTED_BUTTON_ROWS = false;
const USE_LEGACY_BUTTON_PROTOTYPES = false;
const DEVICE_DEBUG_MODE = new URLSearchParams(window.location.search).get("debug") || "";
const DEBUG_DEVICE_OPACITY = DEVICE_DEBUG_MODE === "slots" || DEVICE_DEBUG_MODE === "wire";
const DEBUG_DEVICE_WIREFRAME = DEVICE_DEBUG_MODE === "wire";
const IS_ELECTRON_RUNTIME = /Electron/i.test(navigator.userAgent || "");
const SHOULD_SKIP_MODEL_FETCH = window.location.protocol === "file:" && !IS_ELECTRON_RUNTIME && !MODEL_URL.startsWith("data:");

let canvas;
let renderer;
let scene;
let camera;
let root;
let fallbackRoot;
let loadedModel;
let keyLight;
let fillLight;
let rimLight;
let keyLightTarget;
let resizeObserver;
let renderHandle = 0;
let modelReady = false;
let deviceUiRoot;
let hardwareOverlayRoot;
let leftHardwareGroup;
let rightHardwareGroup;
let leftUiPlane;
let rightUiPlane;
let leftScrollTrack;
let rightScrollTrack;
let leftScrollThumb;
let rightScrollThumb;
let viewportHardwareRoot;
let iconOverlayRoot;
let leftUiTexture;
let rightUiTexture;
let leftUiCanvas;
let rightUiCanvas;
let leftUiContext;
let rightUiContext;
let environmentRenderTarget;
let environmentSourceTexture;
let environmentTiltX = 0;
let environmentTiltY = 0;
let leftButtonMeshes = [];
let rightButtonMeshes = [];
let leftButtonGroups = [];
let rightButtonGroups = [];
let generatedButtonRoot;
let leftButtonPrototype;
let rightButtonPrototype;
let leftGeneratedButtonRows = [];
let rightGeneratedButtonRows = [];
let leftPanelMeshes = [];
let rightPanelMeshes = [];
let leftEmbossGroup;
let rightEmbossGroup;
let latestUiState = {
  apps: [],
  targets: [],
  activeAppId: "",
  selectedAppId: "",
  appScrollRatio: 0,
  targetScrollRatio: 0,
  appHasScroll: false,
  targetHasScroll: false,
  showApps: true,
  showTargets: true
};

const box = new THREE.Box3();
const center = new THREE.Vector3();
const size = new THREE.Vector3();
const meshWorldBounds = new THREE.Box3();
const meshModelBounds = new THREE.Box3();
const meshBoundsInverse = new THREE.Matrix4();
const meshBoundsCorner = new THREE.Vector3();
const embossMatrix = new THREE.Matrix4();
const embossPosition = new THREE.Vector3();
const embossRotation = new THREE.Quaternion();
const embossScale = new THREE.Vector3(1, 1, 1);
const htmlRectProjectedPoint = new THREE.Vector3();
const htmlRectProjectionPoints = [
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3()
];

const PIXEL_FONT_ROWS = 7;
const PIXEL_FONT_COLUMNS = 5;
const PIXEL_FONT_SPACING = 1;
const PIXEL_FONT = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  "-": ["00000", "00000", "00000", "11110", "00000", "00000", "00000"],
  "?": ["11110", "00001", "00010", "00100", "00100", "00000", "00100"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["10010", "10010", "10010", "11111", "00010", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  a: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  b: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  c: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  d: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  e: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  f: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  g: ["01111", "10000", "10000", "10011", "10001", "10001", "01111"],
  h: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  i: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  j: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  k: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  l: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  m: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  n: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  o: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  p: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  r: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  s: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  t: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  u: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  v: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  w: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  x: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"]
};

function createBrushedMetalTexture() {
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = 256;
  textureCanvas.height = 256;
  const context = textureCanvas.getContext("2d");
  const imageData = context.createImageData(textureCanvas.width, textureCanvas.height);

  for (let y = 0; y < textureCanvas.height; y += 1) {
    const rowWave = Math.sin(y * 0.21) * 4 + Math.sin(y * 0.047) * 7;
    for (let x = 0; x < textureCanvas.width; x += 1) {
      const streak = Math.sin(x * 1.12 + rowWave) * 11 + Math.sin(x * 0.24 + y * 0.025) * 5;
      const grain = ((x * 37 + y * 17 + ((x * y) % 31)) % 17) - 8;
      const value = Math.max(112, Math.min(218, 164 + streak + grain));
      const index = (y * textureCanvas.width + x) * 4;
      imageData.data[index] = value;
      imageData.data[index + 1] = value;
      imageData.data[index + 2] = value;
      imageData.data[index + 3] = 255;
    }
  }

  context.putImageData(imageData, 0, 0);

  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(9.5, 1.05);
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

const brushedMetalTexture = createBrushedMetalTexture();

const materials = {
  metal: new THREE.MeshPhysicalMaterial({
    color: 0xc4cbcb,
    emissive: 0x050606,
    emissiveIntensity: 0.012,
    metalness: 1,
    roughness: 0.31,
    roughnessMap: brushedMetalTexture,
    bumpMap: brushedMetalTexture,
    bumpScale: 0.0025,
    clearcoat: 1,
    clearcoatRoughness: 0.14,
    envMapIntensity: 21.5,
    side: THREE.DoubleSide
  }),
  chromeShell: new THREE.MeshPhysicalMaterial({
    color: 0xd1d7d7,
    emissive: 0x050606,
    emissiveIntensity: 0.012,
    metalness: 1,
    roughness: 0.285,
    roughnessMap: brushedMetalTexture,
    bumpMap: brushedMetalTexture,
    bumpScale: 0.00235,
    clearcoat: 1,
    clearcoatRoughness: 0.13,
    envMapIntensity: 22.0,
    side: THREE.DoubleSide
  }),
  darkMetal: new THREE.MeshPhysicalMaterial({
    color: 0xaeb7b7,
    emissive: 0x030404,
    emissiveIntensity: 0.008,
    metalness: 1,
    roughness: 0.35,
    roughnessMap: brushedMetalTexture,
    bumpMap: brushedMetalTexture,
    bumpScale: 0.003,
    clearcoat: 1,
    clearcoatRoughness: 0.16,
    envMapIntensity: 18.5,
    side: THREE.DoubleSide
  }),
  glass: new THREE.MeshPhysicalMaterial({
    color: 0x020303,
    metalness: 0,
    roughness: 0.08,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    envMapIntensity: 0.55,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    side: THREE.DoubleSide
  }),
  buttonFace: new THREE.MeshPhysicalMaterial({
    color: 0xc4cbcb,
    emissive: 0x050606,
    emissiveIntensity: 0.012,
    metalness: 1,
    roughness: 0.31,
    roughnessMap: brushedMetalTexture,
    bumpMap: brushedMetalTexture,
    bumpScale: 0.0025,
    clearcoat: 1,
    clearcoatRoughness: 0.14,
    envMapIntensity: 21.5,
    side: THREE.DoubleSide
  }),
  buttonFacePressed: new THREE.MeshPhysicalMaterial({
    color: 0xaeb7b7,
    emissive: 0x030404,
    emissiveIntensity: 0.008,
    metalness: 1,
    roughness: 0.35,
    roughnessMap: brushedMetalTexture,
    bumpMap: brushedMetalTexture,
    bumpScale: 0.003,
    clearcoat: 1,
    clearcoatRoughness: 0.16,
    envMapIntensity: 18.5,
    side: THREE.DoubleSide
  }),
  embossText: new THREE.MeshPhysicalMaterial({
    color: 0x110d08,
    metalness: 0.72,
    roughness: 0.32,
    clearcoat: 0.42,
    clearcoatRoughness: 0.22,
    envMapIntensity: 1.65,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
    side: THREE.DoubleSide
  }),
  embossTextActive: new THREE.MeshPhysicalMaterial({
    color: 0xdfe5e2,
    emissive: 0xaeb7b4,
    emissiveIntensity: 0.18,
    metalness: 0.72,
    roughness: 0.22,
    clearcoat: 0.68,
    clearcoatRoughness: 0.18,
    envMapIntensity: 2.15,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    side: THREE.DoubleSide
  }),
  fallbackMetal: new THREE.MeshPhysicalMaterial({
    color: 0xc4cbcb,
    emissive: 0x050606,
    emissiveIntensity: 0.012,
    metalness: 1,
    roughness: 0.31,
    roughnessMap: brushedMetalTexture,
    bumpMap: brushedMetalTexture,
    bumpScale: 0.0025,
    clearcoat: 1,
    clearcoatRoughness: 0.14,
    envMapIntensity: 21.5,
    side: THREE.DoubleSide
  }),
  fallbackGlass: new THREE.MeshPhysicalMaterial({
    color: 0x010202,
    metalness: 0,
    roughness: 0.06,
    clearcoat: 1,
    envMapIntensity: 0.48,
    side: THREE.DoubleSide
  })
};

function applyBurntPipeGradient(material, strength = 0.86) {
  return material;
}

function applyDeviceDebugMaterial(material) {
  if (!material || !DEBUG_DEVICE_OPACITY) {
    return material;
  }

  material.transparent = true;
  material.opacity = Math.min(Number.isFinite(material.opacity) ? material.opacity : 1, DEBUG_DEVICE_WIREFRAME ? 0.9 : 0.42);
  material.depthWrite = false;

  if (DEBUG_DEVICE_WIREFRAME && "wireframe" in material) {
    material.wireframe = true;
  }

  material.needsUpdate = true;
  return material;
}

function applyDeviceDebugMaterials() {
  [...Object.values(materials), ...Object.values(hardwareOverlayMaterials || {})].forEach(applyDeviceDebugMaterial);
}

const deviceUiSlots = {
  apps: {
    xMin: -1.10466,
    xMax: -1.02467,
    yTop: 0.25856,
    yBottom: 0.00762,
    rowHeight: 0.0236,
    rowGap: 0.0015,
    iconX: -1.096,
    iconSize: 0.0118,
    textX: -1.079,
    textMaxX: -1.0305,
    z: 0.00065,
    labelZ: 0.003,
    mirrorCanvasX: true,
    canvasWidth: 1024,
    canvasHeight: 2048
  },
  targets: {
    xMin: -0.5472,
    xMax: -0.44353,
    yTop: 0.21405,
    yBottom: 0.01239,
    rowHeight: 0.022,
    rowGap: 0.0031,
    iconX: -0.538,
    iconSize: 0.0114,
    textX: -0.519,
    textMaxX: -0.448,
    z: 0.00065,
    labelZ: 0.003,
    mirrorCanvasX: false,
    canvasWidth: 1024,
    canvasHeight: 2048
  },
  leftScroll: {
    x: 9.085,
    yTop: -7.18,
    yBottom: -27.93,
    width: 0.08,
    minHeight: 2.1,
    z: 0.24
  },
  rightScroll: {
    x: 67.225,
    yTop: -13.92,
    yBottom: -34.67,
    width: 0.08,
    minHeight: 2.1,
    z: 0.24
  }
};

const GLB_COORDINATE_SCALE = 1;

function scaleSlotCoordinates(slot, factor) {
  Object.entries(slot).forEach(([key, value]) => {
    if (typeof value === "number" && key !== "canvasWidth" && key !== "canvasHeight") {
      slot[key] = value * factor;
    }
  });
}

scaleSlotCoordinates(deviceUiSlots.apps, GLB_COORDINATE_SCALE);
scaleSlotCoordinates(deviceUiSlots.targets, GLB_COORDINATE_SCALE);
scaleSlotCoordinates(deviceUiSlots.leftScroll, GLB_COORDINATE_SCALE);
scaleSlotCoordinates(deviceUiSlots.rightScroll, GLB_COORDINATE_SCALE);

function createManualRowBounds({ left, right, top, bottom, count, gap = 0, zMin = 0.0011, zMax = 0.0022 }) {
  const safeCount = Math.max(1, count);
  const totalGap = gap * Math.max(safeCount - 1, 0);
  const rowHeight = (top - bottom - totalGap) / safeCount;

  return Array.from({ length: safeCount }, (_, index) => {
    const rowTop = top - index * (rowHeight + gap);
    return {
      left,
      right,
      top: rowTop,
      bottom: rowTop - rowHeight,
      zMin,
      zMax
    };
  });
}

const MANUAL_BUTTON_ROWS = {
  apps: {
    rows: [
      { left: -1.10466, right: -1.02467, top: 0.25856, bottom: 0.23421 },
      { left: -1.10416, right: -1.02467, top: 0.23317, bottom: 0.20938 },
      { left: -1.10416, right: -1.02467, top: 0.20815, bottom: 0.1844 },
      { left: -1.10416, right: -1.02467, top: 0.18284, bottom: 0.1591 },
      { left: -1.10416, right: -1.02467, top: 0.15748, bottom: 0.13376 },
      { left: -1.10416, right: -1.02467, top: 0.13218, bottom: 0.10848 },
      { left: -1.10416, right: -1.02467, top: 0.10698, bottom: 0.08329 },
      { left: -1.10416, right: -1.02467, top: 0.08183, bottom: 0.05815 },
      { left: -1.10416, right: -1.02467, top: 0.05667, bottom: 0.033 },
      { left: -1.10416, right: -1.02467, top: 0.03129, bottom: 0.00762 }
    ],
    zMin: 0.0011,
    zMax: 0.0022
  },
  targets: {
    rows: [
      { left: -0.54722, right: -0.44355, top: 0.21405, bottom: 0.18987 },
      { left: -0.5472, right: -0.44353, top: 0.18806, bottom: 0.16388 },
      { left: -0.5472, right: -0.44353, top: 0.16249, bottom: 0.13831 },
      { left: -0.5472, right: -0.44353, top: 0.13734, bottom: 0.11316 },
      { left: -0.5472, right: -0.44353, top: 0.11225, bottom: 0.08807 },
      { left: -0.5472, right: -0.44353, top: 0.08703, bottom: 0.06285 },
      { left: -0.5472, right: -0.44353, top: 0.06192, bottom: 0.03774 },
      { left: -0.5472, right: -0.44353, top: 0.03658, bottom: 0.01239 }
    ],
    zMin: 0.0011,
    zMax: 0.0022
  }
};

function setManualButtonRows(slot, config) {
  const rows = Array.isArray(config.rows) && config.rows.length
    ? config.rows.map((row) => ({
      left: row.left,
      right: row.right,
      top: row.top,
      bottom: row.bottom,
      zMin: Number.isFinite(row.zMin) ? row.zMin : config.zMin,
      zMax: Number.isFinite(row.zMax) ? row.zMax : config.zMax
    }))
    : createManualRowBounds(config);
  slot.rowBounds = rows;

  const left = Math.min(...slot.rowBounds.map((row) => row.left));
  const right = Math.max(...slot.rowBounds.map((row) => row.right));
  const top = Math.max(...slot.rowBounds.map((row) => row.top));
  const bottom = Math.min(...slot.rowBounds.map((row) => row.bottom));

  slot.xMin = left;
  slot.xMax = right;
  slot.yTop = top;
  slot.yBottom = bottom;

  const first = slot.rowBounds[0];
  slot.rowHeight = Math.max(first.top - first.bottom, 0.0001);
  slot.rowGap = slot.rowBounds.length > 1
    ? Math.max(slot.rowBounds[0].bottom - slot.rowBounds[1].top, 0)
    : 0;
  const zMin = Math.min(...slot.rowBounds.map((row) => Number.isFinite(row.zMin) ? row.zMin : 0.0011));
  const zMax = Math.max(...slot.rowBounds.map((row) => Number.isFinite(row.zMax) ? row.zMax : 0.0022));
  slot.z = zMin - 0.00035;
  slot.labelZ = zMax + 0.00065;
}

function resetManualButtonRows() {
  setManualButtonRows(deviceUiSlots.apps, MANUAL_BUTTON_ROWS.apps);
  setManualButtonRows(deviceUiSlots.targets, MANUAL_BUTTON_ROWS.targets);
  refreshDeviceUiPlaneGeometry();
}

resetManualButtonRows();

const DEVICE_HTML_RECTS = {
  topbar: { xMin: -1.1136, xMax: -0.4344, yMin: 0.3009, yMax: 0.3183, z: 0.0012, insetX: 0.0002, insetY: 0.00045 },
  appRail: { xMin: -1.1052, xMax: -1.0238, yMin: 0.0073, yMax: 0.2942, z: 0.0012, insetX: 0.0012, insetY: 0.0012 },
  workspace: { xMin: -1.0125, xMax: -0.5564, yMin: 0.0073, yMax: 0.2942, z: 0.0012, insetX: 0.00065, insetY: 0.0010 },
  busRail: { xMin: -0.5514, xMax: -0.4398, yMin: 0.0073, yMax: 0.2942, z: 0.0012, insetX: 0.0012, insetY: 0.0012 }
};

const DEVICE_VIEW_BOUNDS = {
  xMin: -1.115,
  xMax: -0.433,
  yMin: 0.0005,
  yMax: 0.325
};

const DEVICE_HTML_REGION_FALLBACKS = {
  topbar: { left: 0.28, top: 1.647, width: 99.44, height: 5.345 },
  appRail: { left: 0.994, top: 9.309, width: 12.135, height: 89.486 },
  workspace: { left: 14.070, top: 9.309, width: 68.245, height: 89.486 },
  busRail: { left: 83.269, top: 9.309, width: 15.838, height: 89.486 }
};

const DEVICE_HTML_REGION_ADJUSTMENTS = {
  topbar: { insetX: 0.12, bleedX: 0.08, bleedY: 0.04 },
  appRail: { bleedX: 0.06, bleedY: 0.05 },
  workspace: { bleedX: 0.045, bleedY: 0.045 },
  busRail: { bleedX: 0.06, bleedY: 0.05 }
};

function toCssRegionName(name) {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function projectModelPointToCanvas(point) {
  if (!loadedModel || !camera || !canvas) {
    return null;
  }

  htmlRectProjectedPoint.copy(point).applyMatrix4(loadedModel.matrixWorld).project(camera);

  if (!Number.isFinite(htmlRectProjectedPoint.x) || !Number.isFinite(htmlRectProjectedPoint.y)) {
    return null;
  }

  return {
    x: (htmlRectProjectedPoint.x * 0.5 + 0.5) * 100,
    y: (-htmlRectProjectedPoint.y * 0.5 + 0.5) * 100
  };
}

function projectModelRectToCss(rect) {
  const left = rect.xMin + (rect.insetX || 0);
  const right = rect.xMax - (rect.insetX || 0);
  const bottom = rect.yMin + (rect.insetY || 0);
  const top = rect.yMax - (rect.insetY || 0);
  const z = rect.z || 0;

  htmlRectProjectionPoints[0].set(left, top, z);
  htmlRectProjectionPoints[1].set(right, top, z);
  htmlRectProjectionPoints[2].set(right, bottom, z);
  htmlRectProjectionPoints[3].set(left, bottom, z);

  const points = htmlRectProjectionPoints.map(projectModelPointToCanvas).filter(Boolean);
  if (points.length !== 4) {
    return null;
  }

  const xMin = Math.min(...points.map((point) => point.x));
  const xMax = Math.max(...points.map((point) => point.x));
  const yMin = Math.min(...points.map((point) => point.y));
  const yMax = Math.max(...points.map((point) => point.y));

  if (![xMin, xMax, yMin, yMax].every(Number.isFinite)) {
    return null;
  }

  return {
    left: THREE.MathUtils.clamp(xMin, -20, 120),
    top: THREE.MathUtils.clamp(yMin, -20, 120),
    width: Math.max(xMax - xMin, 0.01),
    height: Math.max(yMax - yMin, 0.01)
  };
}

function setCssRegionVars(name, rect) {
  const key = toCssRegionName(name);
  const style = document.documentElement.style;
  const adjustment = DEVICE_HTML_REGION_ADJUSTMENTS[name] || {};
  const insetX = adjustment.insetX || 0;
  const insetY = adjustment.insetY || 0;
  const bleedX = adjustment.bleedX || 0;
  const bleedY = adjustment.bleedY || 0;
  const adjustedRect = {
    ...rect,
    left: rect.left + insetX - bleedX,
    top: rect.top + insetY - bleedY,
    width: Math.max(rect.width - insetX * 2 + bleedX * 2, 0.01),
    height: Math.max(rect.height - insetY * 2 + bleedY * 2, 0.01)
  };

  style.setProperty(`--device-${key}-left`, `${adjustedRect.left.toFixed(4)}%`);
  style.setProperty(`--device-${key}-top`, `${adjustedRect.top.toFixed(4)}%`);
  style.setProperty(`--device-${key}-width`, `${adjustedRect.width.toFixed(4)}%`);
  style.setProperty(`--device-${key}-height`, `${adjustedRect.height.toFixed(4)}%`);
}

function isSaneCssRegion(rect) {
  if (!rect) {
    return false;
  }

  const { left, top, width, height } = rect;
  if (![left, top, width, height].every(Number.isFinite)) {
    return false;
  }

  return (
    left >= -1 &&
    top >= -1 &&
    width >= 3 &&
    height >= 2 &&
    left + width <= 101 &&
    top + height <= 101
  );
}

function syncDeviceCssLayout() {
  if (!USE_PROJECTED_HTML_REGIONS || !loadedModel || !camera || !canvas) {
    Object.entries(DEVICE_HTML_REGION_FALLBACKS).forEach(([name, fallback]) => {
      setCssRegionVars(name, fallback);
    });
    return;
  }

  loadedModel.updateMatrixWorld(true);

  Object.entries(DEVICE_HTML_REGION_FALLBACKS).forEach(([name, fallback]) => {
    const rect = DEVICE_HTML_RECTS[name];
    const projected = rect ? projectModelRectToCss(rect) : null;
    setCssRegionVars(name, isSaneCssRegion(projected) ? projected : fallback);
  });
}

function applyDetectedButtonRows() {
  if (!USE_DETECTED_BUTTON_ROWS) {
    setManualButtonRows(deviceUiSlots.apps, MANUAL_BUTTON_ROWS.apps);
    setManualButtonRows(deviceUiSlots.targets, MANUAL_BUTTON_ROWS.targets);
    refreshDeviceUiPlaneGeometry();
    return;
  }

  const leftRows = getButtonGroupRowBounds(leftButtonGroups);
  const rightRows = getButtonGroupRowBounds(rightButtonGroups);
  const leftApplied = applyDetectedButtonRowsToSlot(deviceUiSlots.apps, leftRows);
  const rightApplied = applyDetectedButtonRowsToSlot(deviceUiSlots.targets, rightRows);

  if (!leftApplied) {
    setManualButtonRows(deviceUiSlots.apps, MANUAL_BUTTON_ROWS.apps);
  }

  if (!rightApplied) {
    setManualButtonRows(deviceUiSlots.targets, MANUAL_BUTTON_ROWS.targets);
  }

  refreshDeviceUiPlaneGeometry();
}

function applyDetectedButtonRowsToSlot(slot, rows) {
  const validRows = rows.filter((row) => {
    const width = row.right - row.left;
    const height = row.top - row.bottom;
    return width > 0.006 && height > 0.006;
  });

  if (!validRows.length) {
    return false;
  }

  const left = Math.min(...validRows.map((row) => row.left));
  const right = Math.max(...validRows.map((row) => row.right));
  const top = Math.max(...validRows.map((row) => row.top));
  const bottom = Math.min(...validRows.map((row) => row.bottom));
  const padX = Math.max((right - left) * 0.001, 0.00005);
  const padY = Math.max((top - bottom) * 0.00035, 0.00003);

  slot.xMin = left + padX;
  slot.xMax = right - padX;
  slot.yTop = top - padY;
  slot.yBottom = bottom + padY;
  const sortedRows = [...validRows].sort((a, b) => b.top - a.top);

  slot.rowBounds = sortedRows.map((row) => ({
    left: row.left + padX,
    right: row.right - padX,
    top: row.top - padY,
    bottom: row.bottom + padY,
    zMin: row.zMin,
    zMax: row.zMax
  }));

  const first = slot.rowBounds[0];
  slot.rowHeight = Math.max(first.top - first.bottom, 0.0001);
  slot.rowGap = slot.rowBounds.length > 1
    ? Math.max(slot.rowBounds[0].bottom - slot.rowBounds[1].top, 0)
    : 0;
  const detectedZMin = Math.min(...validRows.map((row) => Number.isFinite(row.zMin) ? row.zMin : 0.0011));
  const detectedZMax = Math.max(...validRows.map((row) => Number.isFinite(row.zMax) ? row.zMax : 0.0022));
  slot.z = detectedZMin - 0.00035;
  slot.labelZ = detectedZMax + 0.00065;
  return true;
}

function refreshSlotUiPlaneGeometry(plane, slot) {
  if (!plane || !slot) {
    return;
  }

  const width = Math.max(slot.xMax - slot.xMin, 0.0001);
  const height = Math.max(slot.yTop - slot.yBottom, 0.0001);
  const nextGeometry = new THREE.PlaneGeometry(width, height);

  plane.geometry?.dispose?.();
  plane.geometry = nextGeometry;
  plane.position.set(
    (slot.xMin + slot.xMax) / 2,
    (slot.yTop + slot.yBottom) / 2,
    slot.z
  );
}

function refreshDeviceUiPlaneGeometry() {
  refreshSlotUiPlaneGeometry(leftUiPlane, deviceUiSlots.apps);
  refreshSlotUiPlaneGeometry(rightUiPlane, deviceUiSlots.targets);
}

const iconCache = new Map();

const hardwareOverlayMaterials = {
  frame: new THREE.MeshPhysicalMaterial({
    color: 0xc4cbcb,
    emissive: 0x050606,
    emissiveIntensity: 0.012,
    metalness: 1,
    roughness: 0.31,
    roughnessMap: brushedMetalTexture,
    bumpMap: brushedMetalTexture,
    bumpScale: 0.0025,
    clearcoat: 1,
    clearcoatRoughness: 0.14,
    envMapIntensity: 21.5,
    side: THREE.DoubleSide
  }),
  outerFrame: new THREE.MeshPhysicalMaterial({
    color: 0xd1d7d7,
    emissive: 0x050606,
    emissiveIntensity: 0.012,
    metalness: 1,
    roughness: 0.285,
    roughnessMap: brushedMetalTexture,
    bumpMap: brushedMetalTexture,
    bumpScale: 0.00235,
    clearcoat: 1,
    clearcoatRoughness: 0.13,
    envMapIntensity: 22.0,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide
  }),
  outerShadow: new THREE.MeshPhysicalMaterial({
    color: 0xaeb7b7,
    emissive: 0x030404,
    emissiveIntensity: 0.008,
    metalness: 1,
    roughness: 0.35,
    roughnessMap: brushedMetalTexture,
    bumpMap: brushedMetalTexture,
    bumpScale: 0.003,
    clearcoat: 1,
    clearcoatRoughness: 0.16,
    envMapIntensity: 18.5,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide
  }),
  button: new THREE.MeshPhysicalMaterial({
    color: 0xc4cbcb,
    emissive: 0x050606,
    emissiveIntensity: 0.012,
    metalness: 1,
    roughness: 0.31,
    roughnessMap: brushedMetalTexture,
    bumpMap: brushedMetalTexture,
    bumpScale: 0.0025,
    clearcoat: 1,
    clearcoatRoughness: 0.14,
    envMapIntensity: 21.5,
    side: THREE.DoubleSide
  }),
  shadow: new THREE.MeshPhysicalMaterial({
    color: 0xaeb7b7,
    emissive: 0x030404,
    emissiveIntensity: 0.008,
    metalness: 1,
    roughness: 0.35,
    roughnessMap: brushedMetalTexture,
    bumpMap: brushedMetalTexture,
    bumpScale: 0.003,
    clearcoat: 1,
    clearcoatRoughness: 0.16,
    envMapIntensity: 18.5,
    side: THREE.DoubleSide
  }),
  screenGlass: new THREE.MeshPhysicalMaterial({
    color: 0x020506,
    metalness: 0,
    roughness: 0.03,
    transmission: 0.14,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    envMapIntensity: 1.55,
    transparent: true,
    opacity: 0.18,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide
  }),
  screenGlow: new THREE.MeshBasicMaterial({
    color: 0x5de8ff,
    transparent: true,
    opacity: 0.026,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide
  })
};

applyBurntPipeGradient(materials.metal, 0.9);
applyBurntPipeGradient(materials.chromeShell, 0.92);
applyBurntPipeGradient(materials.fallbackMetal, 0.86);
applyBurntPipeGradient(materials.buttonFace, 0.64);
applyBurntPipeGradient(materials.buttonFacePressed, 0.56);
applyBurntPipeGradient(hardwareOverlayMaterials.frame, 0.86);
applyBurntPipeGradient(hardwareOverlayMaterials.outerFrame, 0.9);
applyBurntPipeGradient(hardwareOverlayMaterials.button, 0.62);

applyDeviceDebugMaterials();

function hexToRgb(hexValue = "#7f8a8f") {
  const hex = String(hexValue).replace("#", "").trim();
  const normalized = hex.length === 3 ? hex.split("").map((char) => `${char}${char}`).join("") : hex.padEnd(6, "0").slice(0, 6);
  const value = Number.parseInt(normalized, 16);

  if (!Number.isFinite(value)) {
    return { r: 127, g: 138, b: 143 };
  }

  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255
  };
}

function rgba(hexValue, alpha = 1) {
  const { r, g, b } = hexToRgb(hexValue);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const NEUTRAL_ICON_LAMP = "#e6e8e2";

function getIcon(src) {
  if (!src) {
    return null;
  }

  let resolvedSrc = src;
  try {
    resolvedSrc = new URL(src, window.location.href).href;
  } catch {
    resolvedSrc = src;
  }

  if (iconCache.has(resolvedSrc)) {
    return iconCache.get(resolvedSrc);
  }

  const image = new Image();
  image.crossOrigin = "anonymous";
  image.decoding = "async";
  image.onload = () => {
    drawDeviceUi();
    scheduleRender();
  };
  image.onerror = () => {
    drawDeviceUi();
    scheduleRender();
  };
  image.src = resolvedSrc;
  iconCache.set(resolvedSrc, image);
  return image;
}

function worldToTexture(slot, x, y) {
  return {
    x: ((x - slot.xMin) / (slot.xMax - slot.xMin)) * slot.canvasWidth,
    y: ((slot.yTop - y) / (slot.yTop - slot.yBottom)) * slot.canvasHeight
  };
}

function worldSizeToTexture(slot, width, height) {
  return {
    width: (width / (slot.xMax - slot.xMin)) * slot.canvasWidth,
    height: (height / (slot.yTop - slot.yBottom)) * slot.canvasHeight
  };
}

function fitCanvasText(context, text, maxWidth) {
  const value = String(text || "");

  if (context.measureText(value).width <= maxWidth) {
    return value;
  }

  let next = value;
  while (next.length > 1 && context.measureText(`${next}...`).width > maxWidth) {
    next = next.slice(0, -1);
  }

  return `${next.trim()}...`;
}

function drawIconScreen(context, slot, item, xWorld, yWorld, sizeWorld, active = false) {
  const pos = worldToTexture(slot, xWorld, yWorld);
  const size = worldSizeToTexture(slot, sizeWorld, sizeWorld);
  if (slot.mirrorCanvasX) {
    pos.x = slot.canvasWidth - pos.x - size.width;
  }
  const image = getIcon(item.icon);
  const inset = Math.max(size.width * 0.08, 5);

  context.save();
  context.fillStyle = "rgba(0, 0, 0, 0.92)";
  context.fillRect(pos.x, pos.y, size.width, size.height);
  context.strokeStyle = active ? rgba(NEUTRAL_ICON_LAMP, 0.9) : "rgba(0, 0, 0, 0.9)";
  context.lineWidth = Math.max(2, size.width * 0.026);
  context.strokeRect(pos.x + context.lineWidth / 2, pos.y + context.lineWidth / 2, size.width - context.lineWidth, size.height - context.lineWidth);

  if (image?.complete && image.naturalWidth) {
    context.globalAlpha = active ? 1 : 0.66;
    context.shadowColor = active ? rgba(NEUTRAL_ICON_LAMP, 0.88) : rgba(NEUTRAL_ICON_LAMP, 0.18);
    context.shadowBlur = active ? Math.max(14, size.width * 0.16) : Math.max(3, size.width * 0.035);
    if (slot.mirrorCanvasX) {
      const drawX = pos.x + inset;
      const drawY = pos.y + inset;
      const drawWidth = size.width - inset * 2;
      const drawHeight = size.height - inset * 2;
      context.save();
      context.translate(drawX + drawWidth, drawY);
      context.scale(-1, 1);
      context.drawImage(image, 0, 0, drawWidth, drawHeight);
      context.restore();
    } else {
      context.drawImage(image, pos.x + inset, pos.y + inset, size.width - inset * 2, size.height - inset * 2);
    }
  }

  context.restore();
}

function drawTextLabel(context, slot, text, xWorld, yWorld, maxXWorld, active = false, accent = "#79e7ff") {
  const pos = worldToTexture(slot, xWorld, yWorld);
  const max = worldToTexture(slot, maxXWorld, yWorld);
  const fontSize = Math.max(34, slot.canvasWidth * 0.037);
  const maxWidth = Math.max(max.x - pos.x, 24);

  context.save();
  context.font = `700 ${fontSize}px Courier New, monospace`;
  context.textBaseline = "middle";
  context.fillStyle = active ? "rgba(20, 12, 3, 0.98)" : "rgba(4, 2, 0, 0.9)";
  context.shadowColor = "rgba(255, 224, 154, 0.28)";
  context.shadowBlur = active ? 7 : 3;
  context.fillText(fitCanvasText(context, text, maxWidth), pos.x, pos.y);
  context.restore();
}

function drawRouteLabel(context, slot, text, xWorld, yWorld, maxXWorld) {
  const pos = worldToTexture(slot, xWorld, yWorld);
  const max = worldToTexture(slot, maxXWorld, yWorld);
  const fontSize = Math.max(16, slot.canvasWidth * 0.018);

  context.save();
  context.font = `500 ${fontSize}px Courier New, monospace`;
  context.textBaseline = "middle";
  context.fillStyle = "rgba(18, 14, 8, 0.62)";
  context.fillText(fitCanvasText(context, text, Math.max(max.x - pos.x, 24)), pos.x, pos.y);
  context.restore();
}

function drawIconTileCanvas(context, canvasElement, item, active = false) {
  const image = getIcon(item?.icon);
  const inset = Math.max(canvasElement.width * 0.11, 7);

  context.clearRect(0, 0, canvasElement.width, canvasElement.height);
  context.save();
  context.fillStyle = "rgba(0, 0, 0, 0.96)";
  context.fillRect(0, 0, canvasElement.width, canvasElement.height);
  context.strokeStyle = active ? rgba(NEUTRAL_ICON_LAMP, 0.95) : "rgba(255, 255, 255, 0.14)";
  context.lineWidth = Math.max(3, canvasElement.width * 0.035);
  context.strokeRect(
    context.lineWidth / 2,
    context.lineWidth / 2,
    canvasElement.width - context.lineWidth,
    canvasElement.height - context.lineWidth
  );

  if (image?.complete && image.naturalWidth) {
    context.globalAlpha = active ? 1 : 0.76;
    context.shadowColor = active ? rgba(NEUTRAL_ICON_LAMP, 0.9) : rgba(NEUTRAL_ICON_LAMP, 0.24);
    context.shadowBlur = active ? Math.max(18, canvasElement.width * 0.17) : Math.max(5, canvasElement.width * 0.05);
    context.drawImage(image, inset, inset, canvasElement.width - inset * 2, canvasElement.height - inset * 2);
  }

  context.restore();
}

function makeIconTilePlane(slot, row, bounds) {
  const metrics = getRowContentMetrics(slot, bounds);
  const canvasElement = document.createElement("canvas");
  canvasElement.width = 160;
  canvasElement.height = 160;
  const context = canvasElement.getContext("2d");
  const active = isDeviceRowLit(slot, row);
  const pressed = isDeviceRowPressed(slot, row);
  drawIconTileCanvas(context, canvasElement, row, active);

  const texture = new THREE.CanvasTexture(canvasElement);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(renderer?.capabilities?.getMaxAnisotropy?.() || 1, 4);

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide
  });
  material.userData.disposeWithObject = true;
  const geometry = new THREE.PlaneGeometry(metrics.iconSize, metrics.iconSize);
  const plane = new THREE.Mesh(geometry, material);
  plane.name = `YCSWU live icon ${row.id || "empty"}`;
  plane.position.set(
    metrics.iconX + metrics.iconSize / 2,
    metrics.centerY,
    Math.max(slot.labelZ, slot.z) + 0.0012 - (pressed ? BUTTON_PRESS_DEPTH * 0.74 : 0)
  );
  plane.renderOrder = 82;
  plane.frustumCulled = false;
  return plane;
}

function syncIconOverlayForSlot(slot, rows, scrollRatio) {
  getVisibleRowSlotsForSlot(slot, rows, scrollRatio).forEach(({ row, bounds }) => {
    if (!row?.id || !bounds) {
      return;
    }

    iconOverlayRoot.add(makeIconTilePlane(slot, row, bounds));
  });
}

function syncIconOverlay() {
  if (!loadedModel) {
    return;
  }

  if (!iconOverlayRoot) {
    iconOverlayRoot = new THREE.Group();
    iconOverlayRoot.name = "YCSWU live icon overlays";
    loadedModel.add(iconOverlayRoot);
  }

  [...iconOverlayRoot.children].forEach((child) => {
    iconOverlayRoot.remove(child);
    disposeObjectTree(child);
  });

  syncIconOverlayForSlot(deviceUiSlots.apps, latestUiState.apps, latestUiState.appScrollRatio);
  syncIconOverlayForSlot(deviceUiSlots.targets, latestUiState.targets, latestUiState.targetScrollRatio);
}

function getRowContentMetrics(slot, bounds) {
  const rowWidth = Math.max(bounds.right - bounds.left, 0.01);
  const rowHeight = Math.max(bounds.top - bounds.bottom, 0.01);
  const isTargetPanel = slot === deviceUiSlots.targets;
  const leftPad = rowWidth * (isTargetPanel ? 0.043 : 0.045);
  const rightPad = rowWidth * (isTargetPanel ? 0.06 : 0.055);
  const iconSize = Math.min(rowHeight * (isTargetPanel ? 0.54 : 0.58), rowWidth * (isTargetPanel ? 0.14 : 0.158));
  const iconX = bounds.left + leftPad;
  const textX = iconX + iconSize + rowWidth * (isTargetPanel ? 0.052 : 0.056);

  return {
    centerY: (bounds.top + bounds.bottom) / 2,
    iconSize,
    iconX,
    textX,
    textMaxX: bounds.right - rightPad,
    metaOffsetY: rowHeight * 0.255
  };
}

function isDeviceRowLit(slot, row) {
  if (!row?.id) {
    return false;
  }

  if (slot === deviceUiSlots.targets) {
    return true;
  }

  return Boolean(row.active || row.id === latestUiState.selectedAppId);
}

function isDeviceRowPressed(slot, row) {
  if (!row?.id) {
    return false;
  }

  if (slot === deviceUiSlots.targets) {
    return false;
  }

  return Boolean(row.active || row.id === latestUiState.selectedAppId);
}

function drawLedScreenBase(context, canvasElement) {
  context.save();
  context.fillStyle = "rgba(0, 0, 0, 0.96)";
  context.fillRect(0, 0, canvasElement.width, canvasElement.height);
  context.strokeStyle = "rgba(97, 230, 255, 0.045)";
  context.lineWidth = 1;

  for (let x = 0; x <= canvasElement.width; x += 16) {
    context.beginPath();
    context.moveTo(x + 0.5, 0);
    context.lineTo(x + 0.5, canvasElement.height);
    context.stroke();
  }

  for (let y = 0; y <= canvasElement.height; y += 16) {
    context.beginPath();
    context.moveTo(0, y + 0.5);
    context.lineTo(canvasElement.width, y + 0.5);
    context.stroke();
  }

  context.restore();
}

function getVisibleRowsForSlot(slot, rows, scrollRatio) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const physicalRows = Array.isArray(slot.rowBounds) ? slot.rowBounds : [];

  if (physicalRows.length) {
    const startIndex = 0;

    return physicalRows
      .map((bounds, slotIndex) => {
        const row = safeRows[startIndex + slotIndex];
        return row ? { row, bounds, index: startIndex + slotIndex, slotIndex } : null;
      })
      .filter(Boolean);
  }

  const rowStep = slot.rowHeight + slot.rowGap;
  const visibleRows = (slot.yTop - slot.yBottom) / rowStep;
  const maxOffset = Math.max(safeRows.length - visibleRows, 0) * rowStep;
  const offset = Math.max(0, Math.min(1, scrollRatio || 0)) * maxOffset;

  return safeRows
    .map((row, index) => {
      const top = slot.yTop - index * rowStep + offset;
      const bottom = top - slot.rowHeight;

      if (bottom > slot.yTop || top < slot.yBottom) {
        return null;
      }

      return {
        row,
        bounds: {
          top,
          bottom,
          left: slot.xMin,
          right: slot.xMax
        },
        index,
        slotIndex: index
      };
    })
    .filter(Boolean);
}

function getVisibleRowSlotsForSlot(slot, rows, scrollRatio) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const physicalRows = Array.isArray(slot.rowBounds) ? slot.rowBounds : [];

  if (physicalRows.length) {
    const startIndex = 0;

    return physicalRows.map((bounds, slotIndex) => ({
      row: safeRows[startIndex + slotIndex] || null,
      bounds,
      index: startIndex + slotIndex,
      slotIndex
    }));
  }

  return getVisibleRowsForSlot(slot, safeRows, scrollRatio);
}

function clearEmbossGroup(group) {
  if (!group) {
    return;
  }

  [...group.children].forEach((child) => {
    group.remove(child);
    disposeObjectTree(child);
  });
}

function normalizeEmbossText(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function measureEmbossColumns(text) {
  if (!text) {
    return 0;
  }

  return Array.from(text).reduce((total, char, index) => {
    const glyphWidth = char === " " ? 3 : PIXEL_FONT_COLUMNS;
    return total + glyphWidth + (index < text.length - 1 ? PIXEL_FONT_SPACING : 0);
  }, 0);
}

function createEmbossText(text, maxWidth, targetHeight, material) {
  const cleanText = normalizeEmbossText(text);

  if (!cleanText || maxWidth <= 0 || targetHeight <= 0) {
    return null;
  }

  const columns = Math.max(measureEmbossColumns(cleanText), 1);
  const pixelSize = Math.min(targetHeight / PIXEL_FONT_ROWS, maxWidth / columns);

  if (!Number.isFinite(pixelSize) || pixelSize <= 0.000035) {
    return null;
  }

  const cells = [];
  let cursor = 0;

  Array.from(cleanText).forEach((char, charIndex) => {
    if (char === " ") {
      cursor += 3 + (charIndex < cleanText.length - 1 ? PIXEL_FONT_SPACING : 0);
      return;
    }

    const glyph = PIXEL_FONT[char] || PIXEL_FONT["?"];

    glyph.forEach((row, rowIndex) => {
      Array.from(row).forEach((value, columnIndex) => {
        if (value !== "1") {
          return;
        }

        cells.push({
          x: cursor + columnIndex,
          y: PIXEL_FONT_ROWS / 2 - rowIndex - 0.5
        });
      });
    });

    cursor += PIXEL_FONT_COLUMNS + (charIndex < cleanText.length - 1 ? PIXEL_FONT_SPACING : 0);
  });

  if (!cells.length) {
    return null;
  }

  const cellDepth = Math.max(pixelSize * 0.2, 0.000055);
  const geometry = new THREE.BoxGeometry(pixelSize * 0.72, pixelSize * 0.72, cellDepth);
  const mesh = new THREE.InstancedMesh(geometry, material, cells.length);
  mesh.name = `emboss-label:${cleanText}`;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.renderOrder = 26;

  cells.forEach((cell, index) => {
    embossPosition.set((cell.x + 0.5) * pixelSize, cell.y * pixelSize, 0);
    embossMatrix.compose(embossPosition, embossRotation, embossScale);
    mesh.setMatrixAt(index, embossMatrix);
  });

  mesh.instanceMatrix.needsUpdate = true;

  const group = new THREE.Group();
  group.name = `YCSWU embossed ${cleanText}`;
  group.userData.width = columns * pixelSize;
  group.userData.height = PIXEL_FONT_ROWS * pixelSize;
  group.add(mesh);
  return group;
}

function ensureEmbossGroups() {
  createHardwareOverlay();

  if (leftHardwareGroup && !leftEmbossGroup) {
    leftEmbossGroup = new THREE.Group();
    leftEmbossGroup.name = "YCSWU left physical labels";
    leftHardwareGroup.add(leftEmbossGroup);
  }

  if (rightHardwareGroup && !rightEmbossGroup) {
    rightEmbossGroup = new THREE.Group();
    rightEmbossGroup.name = "YCSWU right physical labels";
    rightHardwareGroup.add(rightEmbossGroup);
  }
}

function syncEmbossLabelsForSlot(slot, rows, scrollRatio, group) {
  if (!group) {
    return;
  }

  clearEmbossGroup(group);

  getVisibleRowSlotsForSlot(slot, rows, scrollRatio).forEach(({ row, bounds }) => {
    if (!row?.id || !row?.name) {
      return;
    }

    const metrics = getRowContentMetrics(slot, bounds);
    const rowHeight = Math.max(bounds.top - bounds.bottom, 0.01);
    const maxWidth = Math.max(metrics.textMaxX - metrics.textX, 0.01);
    const isTargetPanel = slot === deviceUiSlots.targets;
    const textHeight = rowHeight * (isTargetPanel ? 0.225 : 0.17);
    const active = isDeviceRowLit(slot, row);
    const pressed = isDeviceRowPressed(slot, row);
    const material = active ? materials.embossTextActive : materials.embossText;
    const label = createEmbossText(row.name, maxWidth, textHeight, material);

    if (!label) {
      return;
    }

    label.position.set(
      metrics.textX,
      metrics.centerY + rowHeight * 0.002,
      slot.labelZ + (isTargetPanel ? 0.0012 : 0) - (pressed ? BUTTON_PRESS_DEPTH * 0.74 : 0)
    );
    group.add(label);
  });
}

function syncEmbossLabels() {
  ensureEmbossGroups();
  syncEmbossLabelsForSlot(deviceUiSlots.apps, latestUiState.apps, latestUiState.appScrollRatio, leftEmbossGroup);
  syncEmbossLabelsForSlot(deviceUiSlots.targets, latestUiState.targets, latestUiState.targetScrollRatio, rightEmbossGroup);
}

function setModelButtonGroupMaterial(group, pressed = false, options = {}) {
  const material = pressed ? materials.buttonFacePressed : materials.buttonFace;
  const zOffset = Number.isFinite(options.zOffset) ? options.zOffset : 0;

  (group || []).forEach((mesh) => {
    if (!mesh?.isMesh) {
      return;
    }

    mesh.visible = true;
    mesh.material = material;
    if (!Number.isFinite(mesh.userData.baseButtonZ)) {
      mesh.userData.baseButtonZ = mesh.position.z;
    }
    mesh.position.z = mesh.userData.baseButtonZ + zOffset - (pressed ? BUTTON_PRESS_DEPTH : 0);
    mesh.renderOrder = pressed ? 13 : 12;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
  });
}

function syncModelButtonStateForSlot(slot, rows, scrollRatio, groups) {
  if (!Array.isArray(groups) || !groups.length) {
    return;
  }

  getVisibleRowSlotsForSlot(slot, rows, scrollRatio).forEach(({ row, slotIndex }) => {
    const group = groups[slotIndex];
    if (!group) {
      return;
    }

    const pressed = slot !== deviceUiSlots.targets && Boolean(row?.id && isDeviceRowPressed(slot, row));
    setModelButtonGroupMaterial(group, pressed, {
      zOffset: slot === deviceUiSlots.targets && !row?.id ? 0.00055 : 0
    });
  });
}

function syncModelButtonStates() {
  syncModelButtonStateForSlot(deviceUiSlots.apps, latestUiState.apps, latestUiState.appScrollRatio, leftButtonGroups);
  syncModelButtonStateForSlot(deviceUiSlots.targets, latestUiState.targets, latestUiState.targetScrollRatio, rightButtonGroups);
}

function clearGeneratedButtons() {
  if (!generatedButtonRoot) {
    return;
  }

  [...generatedButtonRoot.children].forEach((child) => {
    generatedButtonRoot.remove(child);
    disposeObjectTree(child);
  });
}

function prepareButtonPrototype(model) {
  restoreExportedUnitScale(model);
  model.traverse((node) => {
    if (!node.isMesh) {
      return;
    }

    node.material = materials.buttonFace;
    node.castShadow = false;
    node.receiveShadow = true;
    node.frustumCulled = false;
    node.renderOrder = 12;
  });
  return model;
}

function prepareImportedShellMaterial(material) {
  if (!material) {
    return materials.metal;
  }

  const materialName = String(material.name || "").toLowerCase();
  if (materialName.includes("chrome")) {
    const chrome = materials.chromeShell.clone();
    chrome.name = "YCSWU reflective chrome shell";
    return applyDeviceDebugMaterial(applyBurntPipeGradient(chrome, 0.92));
  }

  const prepared = materials.metal.clone();
  prepared.name = `YCSWU reflective shell ${material.name || ""}`.trim();
  prepared.side = THREE.DoubleSide;
  prepared.needsUpdate = true;
  return applyDeviceDebugMaterial(applyBurntPipeGradient(prepared, 0.84));
}

function setButtonCloneMaterial(object, pressed = false) {
  object.traverse((node) => {
    if (!node.isMesh) {
      return;
    }

    node.material = pressed ? materials.buttonFacePressed : materials.buttonFace;
    node.renderOrder = 12;
    node.castShadow = false;
    node.receiveShadow = true;
    node.frustumCulled = false;
  });
}

function getButtonFitBounds(bounds, side = "left") {
  const width = Math.max(bounds.right - bounds.left, 0.0001);
  const height = Math.max(bounds.top - bounds.bottom, 0.0001);
  const xInset = width * (side === "left" ? 0.018 : 0.016);
  const yInset = height * 0.04;

  return {
    left: bounds.left + xInset,
    right: bounds.right - xInset,
    top: bounds.top - yInset,
    bottom: bounds.bottom + yInset
  };
}

function cloneButtonIntoBounds(prototype, bounds, pressed, name, side = "left") {
  if (!prototype || !bounds) {
    return null;
  }

  const holder = new THREE.Group();
  const scaled = new THREE.Group();
  const clone = prototype.clone(true);
  setButtonCloneMaterial(clone, pressed);
  clone.updateMatrixWorld(true);

  const cloneBounds = new THREE.Box3().setFromObject(clone);
  if (cloneBounds.isEmpty()) {
    return null;
  }

  const cloneCenter = new THREE.Vector3();
  const cloneSize = new THREE.Vector3();
  cloneBounds.getCenter(cloneCenter);
  cloneBounds.getSize(cloneSize);
  clone.position.sub(cloneCenter);

  const fitBounds = getButtonFitBounds(bounds, side);
  const targetWidth = Math.max(fitBounds.right - fitBounds.left, 0.0001);
  const targetHeight = Math.max(fitBounds.top - fitBounds.bottom, 0.0001);
  const scale = Math.min(
    targetWidth / Math.max(cloneSize.x, 0.0001),
    targetHeight / Math.max(cloneSize.y, 0.0001)
  ) * 0.99;
  scaled.scale.setScalar(Number.isFinite(scale) ? scale : 1);

  const faceZ = Number.isFinite(bounds.zMax) ? bounds.zMax : 0.0022;
  holder.name = name;
  holder.userData.bounds = bounds;
  holder.userData.fitBounds = fitBounds;
  holder.userData.pressed = pressed;
  holder.position.set(
    (fitBounds.left + fitBounds.right) / 2,
    (fitBounds.top + fitBounds.bottom) / 2,
    faceZ + (pressed ? -BUTTON_PRESS_DEPTH : 0.00030)
  );
  scaled.add(clone);
  holder.add(scaled);
  return holder;
}

function createGeneratedButtonSurface(bounds, pressed, name, side = "left", options = {}) {
  if (!bounds) {
    return null;
  }

  const fitBounds = getButtonFitBounds(bounds, side);
  const width = Math.max(fitBounds.right - fitBounds.left, 0.0001);
  const height = Math.max(fitBounds.top - fitBounds.bottom, 0.0001);
  const inert = Boolean(options.inert);
  const depth = Math.max(Math.min(height * 0.085, 0.0018), 0.0007);
  const geometry = inert
    ? new THREE.PlaneGeometry(width, height)
    : new THREE.BoxGeometry(width, height, depth);
  const material = (pressed && !inert ? materials.buttonFacePressed : materials.buttonFace).clone();
  material.depthTest = false;
  material.depthWrite = false;
  material.userData.disposeWithObject = true;
  const mesh = new THREE.Mesh(geometry, material);
  const faceZ = Number.isFinite(bounds.zMax) ? bounds.zMax : 0.0022;

  mesh.name = name;
  mesh.position.set(
    (fitBounds.left + fitBounds.right) / 2,
    (fitBounds.top + fitBounds.bottom) / 2,
    inert
      ? faceZ + 0.00115
      : faceZ + depth * 0.48 - (pressed ? BUTTON_PRESS_DEPTH : 0)
  );
  mesh.renderOrder = inert ? 20 : pressed ? 19 : 18;
  mesh.castShadow = false;
  mesh.receiveShadow = !inert;
  mesh.frustumCulled = false;
  mesh.userData.bounds = bounds;
  mesh.userData.fitBounds = fitBounds;
  mesh.userData.pressed = !inert && pressed;
  mesh.userData.inert = inert;

  return mesh;
}

function rebuildGeneratedButtons() {
  if (!loadedModel || !hardwareOverlayRoot) {
    return;
  }

  if (!generatedButtonRoot) {
    generatedButtonRoot = new THREE.Group();
    generatedButtonRoot.name = "YCSWU generated physical buttons";
    hardwareOverlayRoot.add(generatedButtonRoot);
  }

  clearGeneratedButtons();
  leftGeneratedButtonRows = [];
  rightGeneratedButtonRows = [];

  const leftPrototype = leftButtonPrototype || rightButtonPrototype;
  const rightPrototype = rightButtonPrototype || leftButtonPrototype;

  getVisibleRowSlotsForSlot(deviceUiSlots.apps, latestUiState.apps, latestUiState.appScrollRatio).forEach(({ row, bounds, slotIndex }) => {
    const pressed = Boolean(row?.id && isDeviceRowPressed(deviceUiSlots.apps, row));
    const button = USE_LEGACY_BUTTON_PROTOTYPES && leftPrototype
      ? cloneButtonIntoBounds(leftPrototype, bounds, pressed, `left-panel-button-${slotIndex}`, "left")
      : createGeneratedButtonSurface(bounds, pressed, `left-panel-button-${slotIndex}`, "left");
    if (!button) {
      return;
    }

    generatedButtonRoot.add(button);
    leftGeneratedButtonRows.push({ holder: button, row, bounds });
  });

  getVisibleRowSlotsForSlot(deviceUiSlots.targets, latestUiState.targets, latestUiState.targetScrollRatio).forEach(({ row, bounds, slotIndex }) => {
    const isBlankTargetSlot = !row?.id;
    const pressed = false;

    const button = USE_LEGACY_BUTTON_PROTOTYPES && rightPrototype
      ? cloneButtonIntoBounds(rightPrototype, bounds, pressed, `right-panel-button-${slotIndex}`, "right")
      : createGeneratedButtonSurface(bounds, pressed, `right-panel-button-${slotIndex}`, "right", {
        inert: isBlankTargetSlot
      });
    if (!button) {
      return;
    }

    generatedButtonRoot.add(button);
    rightGeneratedButtonRows.push({ holder: button, row, bounds });
  });
}

function loadButtonPrototype(loader, url) {
  return new Promise((resolve) => {
    loader.load(
      url,
      (gltf) => resolve(prepareButtonPrototype(gltf.scene)),
      undefined,
      () => resolve(null)
    );
  });
}

function loadButtonModels() {
  if (!USE_LEGACY_BUTTON_PROTOTYPES) {
    return;
  }

  const loader = new GLTFLoader();
  Promise.all([
    loadButtonPrototype(loader, LEFT_BUTTON_MODEL_URL),
    loadButtonPrototype(loader, RIGHT_BUTTON_MODEL_URL)
  ]).then(([leftPrototype, rightPrototype]) => {
    leftButtonPrototype = leftPrototype || leftButtonPrototype;
    rightButtonPrototype = rightPrototype || rightButtonPrototype || leftButtonPrototype;
    rebuildGeneratedButtons();
    if (loadedModel) {
      fitObject(loadedModel);
      syncDeviceCssLayout();
    }
    scheduleRender();
  });
}

function drawDeviceRows(canvas, context, slot, rows, scrollRatio, emptyText = "") {
  if (!canvas || !context) {
    return;
  }

  context.clearRect(0, 0, canvas.width, canvas.height);

  if (!rows.length && emptyText) {
    return;
  }

  getVisibleRowSlotsForSlot(slot, rows, scrollRatio).forEach(({ row, bounds }) => {
    if (!row?.id) {
      return;
    }

    const isActive = isDeviceRowLit(slot, row);
    const metrics = getRowContentMetrics(slot, bounds);
    const iconY = metrics.centerY + metrics.iconSize / 2;
    drawIconScreen(context, slot, row, metrics.iconX, iconY, metrics.iconSize, isActive);
  });
}

function createUiPlane(slot) {
  const canvasElement = document.createElement("canvas");
  canvasElement.width = slot.canvasWidth;
  canvasElement.height = slot.canvasHeight;
  const context = canvasElement.getContext("2d");
  const texture = new THREE.CanvasTexture(canvasElement);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(renderer?.capabilities?.getMaxAnisotropy?.() || 1, 4);

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide
  });
  const geometry = new THREE.PlaneGeometry(slot.xMax - slot.xMin, slot.yTop - slot.yBottom);
  const plane = new THREE.Mesh(geometry, material);
  plane.position.set((slot.xMin + slot.xMax) / 2, (slot.yTop + slot.yBottom) / 2, slot.z);
  plane.renderOrder = 24;
  plane.frustumCulled = false;

  return { plane, canvasElement, context, texture };
}

function makeScrollThumb(config) {
  const geometry = new THREE.BoxGeometry(config.width * 1.32, config.minHeight, 0.12);
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xf4dfb2,
    metalness: 0.92,
    roughness: 0.11,
    clearcoat: 0.95,
    clearcoatRoughness: 0.06,
    envMapIntensity: 5.2,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const thumb = new THREE.Mesh(geometry, material);
  thumb.renderOrder = 90;
  thumb.frustumCulled = false;
  thumb.position.z = config.z;
  return thumb;
}

function makeScrollTrack(config) {
  const geometry = new THREE.BoxGeometry(config.width * 2.25, config.yTop - config.yBottom, 0.045);
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x070403,
    metalness: 0.84,
    roughness: 0.28,
    clearcoat: 0.54,
    clearcoatRoughness: 0.18,
    envMapIntensity: 1.95,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const track = new THREE.Mesh(geometry, material);
  track.renderOrder = 88;
  track.frustumCulled = false;
  track.position.set(config.x, (config.yTop + config.yBottom) / 2, config.z - 0.025);
  return track;
}

function addHardwarePlane(group, xMin, xMax, yBottom, yTop, z, material, renderOrder = 28) {
  const width = Math.max(xMax - xMin, 0.001);
  const height = Math.max(yTop - yBottom, 0.001);
  const geometry = new THREE.PlaneGeometry(width, height);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set((xMin + xMax) / 2, (yBottom + yTop) / 2, z);
  mesh.renderOrder = renderOrder;
  mesh.frustumCulled = false;
  group.add(mesh);
  return mesh;
}

function makePixelRect(left, top, width, height) {
  return {
    left,
    top,
    width: Math.max(width, 0),
    height: Math.max(height, 0)
  };
}

function addViewportPlane(group, rect, material, z = 0.34, renderOrder = 110) {
  const world = rectToWorld(rect);
  const geometry = new THREE.PlaneGeometry(Math.max(world.width, 0.01), Math.max(world.height, 0.01));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(world.x, world.y, z);
  mesh.renderOrder = renderOrder;
  mesh.frustumCulled = false;
  group.add(mesh);
  return mesh;
}

function disposeObjectTree(object) {
  if (!object) {
    return;
  }

  object.traverse((node) => {
    if (node.geometry) {
      node.geometry.dispose();
    }

    const nodeMaterials = Array.isArray(node.material) ? node.material : [node.material].filter(Boolean);
    nodeMaterials.forEach((material) => {
      if (!material.userData?.disposeWithObject) {
        return;
      }
      if (material.map) {
        material.map.dispose();
      }
      material.dispose?.();
    });
  });
}

function addViewportFrame(group, rect, thickness = 6, material = hardwareOverlayMaterials.outerFrame, z = 0.34, renderOrder = 110) {
  if (!rect?.width || !rect?.height) {
    return;
  }

  addViewportPlane(group, makePixelRect(rect.left, rect.top, rect.width, thickness), material, z, renderOrder);
  addViewportPlane(group, makePixelRect(rect.left, rect.top + rect.height - thickness, rect.width, thickness), material, z, renderOrder);
  addViewportPlane(group, makePixelRect(rect.left, rect.top, thickness, rect.height), material, z, renderOrder);
  addViewportPlane(group, makePixelRect(rect.left + rect.width - thickness, rect.top, thickness, rect.height), material, z, renderOrder);
}

function expandRect(rect, amount) {
  return makePixelRect(rect.left - amount, rect.top - amount, rect.width + amount * 2, rect.height + amount * 2);
}

function isVisibleRect(rect) {
  return Boolean(rect && rect.width > 8 && rect.height > 8);
}

function getVisibleElementRect(selector) {
  const element = document.querySelector(selector);

  if (!element) {
    return null;
  }

  const style = window.getComputedStyle(element);

  if (style.display === "none" || style.visibility === "hidden" || Number.parseFloat(style.opacity || "1") <= 0.01) {
    return null;
  }

  const rect = element.getBoundingClientRect();
  return isVisibleRect(rect) ? rect : null;
}

function rebuildViewportHardwareOverlay() {
  if (!canvas || !root) {
    return;
  }

  if (viewportHardwareRoot) {
    root.remove(viewportHardwareRoot);
    disposeObjectTree(viewportHardwareRoot);
    viewportHardwareRoot = null;
  }
}

function addHardwareFrame(group, outer, inner, z = 0.13) {
  addHardwarePlane(group, outer.x0, outer.x1, inner.yTop, outer.yTop, z, hardwareOverlayMaterials.frame);
  addHardwarePlane(group, outer.x0, outer.x1, outer.yBottom, inner.yBottom, z, hardwareOverlayMaterials.shadow, 27);
  addHardwarePlane(group, outer.x0, inner.x0, inner.yBottom, inner.yTop, z, hardwareOverlayMaterials.frame);
  addHardwarePlane(group, inner.x1, outer.x1, inner.yBottom, inner.yTop, z, hardwareOverlayMaterials.frame);
}

function createHardwareOverlay() {
  if (!loadedModel || hardwareOverlayRoot) {
    return;
  }

  hardwareOverlayRoot = new THREE.Group();
  hardwareOverlayRoot.name = "YCSWU hardware chrome overlay";
  leftHardwareGroup = new THREE.Group();
  leftHardwareGroup.name = "YCSWU app hardware buttons";
  rightHardwareGroup = new THREE.Group();
  rightHardwareGroup.name = "YCSWU target hardware buttons";
  generatedButtonRoot = new THREE.Group();
  generatedButtonRoot.name = "YCSWU generated physical buttons";

  hardwareOverlayRoot.add(leftHardwareGroup, rightHardwareGroup, generatedButtonRoot);
  loadedModel.add(hardwareOverlayRoot);
}

function updateHardwareVisibility() {
  const showApps = true;
  const showTargets = true;

  if (leftUiPlane) {
    leftUiPlane.visible = false;
  }

  if (rightUiPlane) {
    rightUiPlane.visible = false;
  }

  if (leftHardwareGroup) {
    leftHardwareGroup.visible = showApps;
  }

  if (rightHardwareGroup) {
    rightHardwareGroup.visible = showTargets;
  }

  leftPanelMeshes.forEach((mesh) => {
    mesh.visible = showApps;
  });

  rightPanelMeshes.forEach((mesh) => {
    mesh.visible = showTargets;
  });
}

function updateButtonFaceVisibility() {
  if (generatedButtonRoot) {
    generatedButtonRoot.visible = false;
  }
}

function updateScrollThumb(track, thumb) {
  if (track) {
    track.visible = false;
  }

  if (thumb) {
    thumb.visible = false;
  }
}

function ensureDeviceUiRoot() {
  if (!loadedModel) {
    return;
  }

  createHardwareOverlay();

  if (deviceUiRoot) {
    return;
  }

  deviceUiRoot = new THREE.Group();
  deviceUiRoot.name = "YCSWU live UI";

  const left = createUiPlane(deviceUiSlots.apps);
  const right = createUiPlane(deviceUiSlots.targets);
  leftUiPlane = left.plane;
  leftUiCanvas = left.canvasElement;
  leftUiContext = left.context;
  leftUiTexture = left.texture;
  rightUiPlane = right.plane;
  rightUiCanvas = right.canvasElement;
  rightUiContext = right.context;
  rightUiTexture = right.texture;

  leftScrollTrack = null;
  rightScrollTrack = null;
  leftScrollThumb = null;
  rightScrollThumb = null;

  deviceUiRoot.add(leftUiPlane, rightUiPlane);
  loadedModel.add(deviceUiRoot);
}

function drawDeviceUi() {
  ensureDeviceUiRoot();

  if (!deviceUiRoot) {
    return;
  }

  updateHardwareVisibility();

  drawDeviceRows(
    leftUiCanvas,
    leftUiContext,
    deviceUiSlots.apps,
    latestUiState.apps,
    latestUiState.appScrollRatio,
    ""
  );
  drawDeviceRows(
    rightUiCanvas,
    rightUiContext,
    deviceUiSlots.targets,
    latestUiState.targets,
    latestUiState.targetScrollRatio,
    ""
  );

  if (leftUiTexture) {
    leftUiTexture.needsUpdate = true;
  }

  if (rightUiTexture) {
    rightUiTexture.needsUpdate = true;
  }

  rebuildGeneratedButtons();
  syncModelButtonStates();
  syncIconOverlay();
  syncEmbossLabels();

  updateButtonFaceVisibility();
  updateHardwareVisibility();
}

function createRenderer() {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
    premultipliedAlpha: true
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setClearAlpha(0);
  const pixelRatioLimit = window.specialEdition?.isElectron ? 1.75 : 2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioLimit));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.66;
}

function applyEnvironmentTarget(target) {
  if (!target) {
    return;
  }

  if (environmentRenderTarget && environmentRenderTarget !== target) {
    environmentRenderTarget.dispose();
  }

  environmentRenderTarget = target;
  scene.environment = target.texture;
  applyEnvironmentReflectionPose();
  scheduleRender();
}

function applyEnvironmentReflectionPose() {
  if (!scene?.environmentRotation) {
    return;
  }

  scene.environmentRotation.set(
    SKY_ENVIRONMENT_ROTATION_X + THREE.MathUtils.degToRad(environmentTiltX * SKY_REFLECTION_TILT_X),
    SKY_ENVIRONMENT_ROTATION_Y + THREE.MathUtils.degToRad(environmentTiltY * SKY_REFLECTION_TILT_Y),
    THREE.MathUtils.degToRad(environmentTiltY * 0.08)
  );

}

function createProceduralEnvironment() {
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x080d12);

  const room = new THREE.Group();
  const bright = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const warm = new THREE.MeshBasicMaterial({ color: 0xffd59c });
  const cool = new THREE.MeshBasicMaterial({ color: 0x8fc7ff });
  const dark = new THREE.MeshBasicMaterial({ color: 0x11151a });

  const panel = new THREE.PlaneGeometry(8, 3);
  const top = new THREE.Mesh(panel, bright);
  top.position.set(0, 5, -3);
  top.rotation.x = Math.PI / 2;
  room.add(top);

  const left = new THREE.Mesh(panel, cool);
  left.position.set(-5, 0, -2);
  left.rotation.y = Math.PI / 2;
  room.add(left);

  const right = new THREE.Mesh(panel, warm);
  right.position.set(5, 0, -2);
  right.rotation.y = -Math.PI / 2;
  room.add(right);

  const back = new THREE.Mesh(new THREE.PlaneGeometry(12, 8), dark);
  back.position.set(0, 0, -6);
  room.add(back);

  envScene.add(room);

  const pmrem = new THREE.PMREMGenerator(renderer);
  applyEnvironmentTarget(pmrem.fromScene(envScene, 0.04));
  pmrem.dispose();
}

function addReflectionPanel(envScene, {
  color,
  intensity = 1,
  opacity = 1,
  width = 10,
  height = 4,
  position = [0, 0, 8],
  rotation = [0, 0, 0]
} = {}) {
  const panelColor = new THREE.Color(color || 0xffffff).multiplyScalar(intensity);
  const geometry = new THREE.PlaneGeometry(width, height);
  const material = new THREE.MeshBasicMaterial({
    color: panelColor,
    transparent: opacity < 1,
    opacity,
    side: THREE.DoubleSide,
    toneMapped: false
  });
  const panel = new THREE.Mesh(geometry, material);
  panel.position.set(position[0], position[1], position[2]);
  panel.rotation.set(rotation[0], rotation[1], rotation[2]);
  envScene.add(panel);
  return panel;
}

function addDeviceReflectionRig(envScene) {
  const panels = [];

  const add = (settings) => {
    panels.push(addReflectionPanel(envScene, settings));
  };

  add({
    color: 0xf3eee0,
    intensity: 4.15,
    width: 28,
    height: 2.9,
    position: [0, 5.85, 8.2]
  });
  add({
    color: 0x5f8fd8,
    intensity: 3.35,
    opacity: 1,
    width: 28,
    height: 3.8,
    position: [0, 1.0, 8.4]
  });
  add({
    color: 0xcf9b67,
    intensity: 1.95,
    opacity: 0.86,
    width: 28,
    height: 3.2,
    position: [0, -4.45, 8.1]
  });
  add({
    color: 0xffffff,
    intensity: 5.2,
    width: 22,
    height: 1.8,
    position: [0, 7.1, 0],
    rotation: [Math.PI / 2, 0, 0]
  });
  add({
    color: 0x9ec4ff,
    intensity: 2.55,
    opacity: 0.84,
    width: 8,
    height: 8,
    position: [-8.4, 0.35, 3.4],
    rotation: [0, Math.PI / 2, 0]
  });
  add({
    color: 0xffc47d,
    intensity: 1.7,
    opacity: 0.7,
    width: 8,
    height: 8,
    position: [8.4, -0.9, 3.2],
    rotation: [0, -Math.PI / 2, 0]
  });

  return panels;
}

function createSkyEnvironment(texture) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;

  const envScene = new THREE.Scene();
  const domeGeometry = new THREE.SphereGeometry(12, 64, 32);
  domeGeometry.scale(-1, 1, 1);
  const domeMaterial = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.BackSide
  });
  const dome = new THREE.Mesh(domeGeometry, domeMaterial);
  dome.rotation.y = SKY_ENVIRONMENT_ROTATION_Y;
  dome.rotation.x = SKY_ENVIRONMENT_ROTATION_X;
  envScene.add(dome);
  const reflectionPanels = addDeviceReflectionRig(envScene);

  const pmrem = new THREE.PMREMGenerator(renderer);
  applyEnvironmentTarget(pmrem.fromScene(envScene, 0.012));
  pmrem.dispose();
  reflectionPanels.forEach((panel) => {
    panel.geometry?.dispose?.();
    panel.material?.dispose?.();
  });
  domeGeometry.dispose();
  domeMaterial.dispose();
}

function createEnvironment() {
  createProceduralEnvironment();

  const loader = new THREE.TextureLoader();
  loader.load(
    SKY_ENVIRONMENT_URL,
    (texture) => {
      if (environmentSourceTexture) {
        environmentSourceTexture.dispose();
      }

      environmentSourceTexture = texture;
      createSkyEnvironment(texture);
    },
    undefined,
    () => {
      scheduleRender();
    }
  );
}

function createScene() {
  scene = new THREE.Scene();
  if ("environmentIntensity" in scene) {
    scene.environmentIntensity = 4.15;
  }
  root = new THREE.Group();
  scene.add(root);

  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
  camera.position.set(0, 0, 12);
  camera.lookAt(0, 0, 0);

  keyLight = new THREE.DirectionalLight(0xffe0b7, 5.35);
  fillLight = new THREE.DirectionalLight(0xb5c7dc, 1.15);
  rimLight = new THREE.DirectionalLight(0xffffff, 1.55);
  keyLightTarget = new THREE.Object3D();
  keyLightTarget.position.set(0, 0, 0.1);
  keyLight.target = keyLightTarget;
  scene.add(keyLightTarget, keyLight, fillLight, rimLight, new THREE.AmbientLight(0xffffff, 0.42));
  setDeviceLightFromViewportPoint(
    window.innerWidth * DEFAULT_LIGHT_VIEWPORT_X,
    window.innerHeight * DEFAULT_LIGHT_VIEWPORT_Y,
    window.innerWidth,
    window.innerHeight
  );

  createEnvironment();
}

function restoreExportedUnitScale(model) {
  const modelBounds = new THREE.Box3().setFromObject(model);
  const modelSize = modelBounds.getSize(new THREE.Vector3());
  const largestDimension = Math.max(modelSize.x, modelSize.y, modelSize.z);

  if (largestDimension > 0.01 && largestDimension < 1.5) {
    return false;
  }

  let restored = false;

  model.traverse((node) => {
    if (!node.isMesh) {
      return;
    }

    const usesCentimeterScale =
      Math.abs(node.scale.x - 0.01) < 0.0001 &&
      Math.abs(node.scale.y - 0.01) < 0.0001 &&
      Math.abs(node.scale.z - 0.01) < 0.0001;

    if (!usesCentimeterScale) {
      return;
    }

    node.scale.multiplyScalar(100);
    node.updateMatrix();
    node.updateMatrixWorld(true);
    restored = true;
  });

  return restored;
}

function isNormalizedModelBounds(bounds) {
  if (!bounds) {
    return false;
  }

  return Math.max(
    Math.abs(bounds.min.x),
    Math.abs(bounds.max.x),
    Math.abs(bounds.min.y),
    Math.abs(bounds.max.y)
  ) < 1;
}

function normalizeModel(model) {
  leftButtonMeshes = [];
  rightButtonMeshes = [];
  leftButtonGroups = [];
  rightButtonGroups = [];
  leftPanelMeshes = [];
  rightPanelMeshes = [];
  resetManualButtonRows();
  const restoredScale = restoreExportedUnitScale(model);
  box.setFromObject(model);
  box.getSize(size);
  const largestDimension = Math.max(size.x, size.y, size.z);
  const keepAuthoredDeviceSpace = !restoredScale && largestDimension > 0.01 && largestDimension < 1.5;

  if (keepAuthoredDeviceSpace) {
    model.position.set(0, 0, 0);
  } else {
    box.getCenter(center);
    model.position.sub(center);
  }

  model.userData.normalizedPosition = model.position.clone();
  box.setFromObject(model);
  box.getSize(size);

  model.traverse((node) => {
    if (!node.isMesh) {
      return;
    }

    const sourceMaterial = Array.isArray(node.material) ? node.material[0] : node.material;
    const bounds = getMeshBounds(node);
    const boundsWidth = bounds ? bounds.max.x - bounds.min.x : 0;
    const boundsHeight = bounds ? bounds.max.y - bounds.min.y : 0;
    const nodeName = node.name || "";
    const modelIsNormalized = isNormalizedModelBounds(bounds);
    const narrowTallScrollMesh =
      bounds &&
      (
        modelIsNormalized
          ? boundsWidth <= 0.004 && boundsHeight > 0.08 && (bounds.min.x < -0.245 || bounds.max.x > 0.224)
          : boundsWidth <= 0.22 &&
            boundsHeight > 8 &&
            (
              (bounds.min.x > 8.85 && bounds.max.x < 9.25) ||
              (bounds.min.x > 67.0 && bounds.max.x < 67.35)
            )
      );
    const sideRailScrollMesh =
      bounds &&
      modelIsNormalized &&
      boundsWidth <= 0.011 &&
      boundsHeight > 0.08 &&
      (
        (bounds.min.x > -0.2525 && bounds.max.x < -0.246) ||
        (bounds.min.x > -0.348 && bounds.max.x < -0.337) ||
        (bounds.min.x > 0.214 && bounds.max.x < 0.224) ||
        (bounds.min.x > 0.33 && bounds.max.x < 0.342)
      );
    const isStaticScrollThumb =
      /left[_-]?scroll|right[_-]?scroll|scroll[_-]?(bar|line|track|thumb|back)|leftscroll|rightscroll|bar[_-]?back/i.test(nodeName) ||
      narrowTallScrollMesh ||
      sideRailScrollMesh;
    const isBackingPanel = bounds ? isFullBackingPanel(bounds, node.name || "") : false;
    const isScreen = isModelScreenPanel(bounds, `${node.name} ${sourceMaterial?.name || ""}`);
    const isStaticIconScreen = bounds ? isModelStaticIconScreen(bounds, `${node.name} ${sourceMaterial?.name || ""}`) : false;
    const isHeaderControlPlate = bounds ? isModelHeaderControlPlate(bounds, node.name || "") : false;
    const buttonSide = bounds ? getDeviceButtonSide(bounds, nodeName) : "";
    const isButtonFace = Boolean(buttonSide);
    const panelSide = bounds ? getDevicePanelSide(bounds) : "";

    if (isStaticScrollThumb || isHeaderControlPlate) {
      node.visible = false;
      return;
    }

    if (isScreen || isStaticIconScreen) {
      node.visible = false;
      return;
    }

    if (isButtonFace) {
      if (buttonSide === "left") {
        leftButtonMeshes.push(node);
      } else if (buttonSide === "right") {
        rightButtonMeshes.push(node);
      }
      node.userData.deviceButtonSide = buttonSide;
      node.visible = true;
      node.material = materials.buttonFace;
      node.renderOrder = 12;
      node.castShadow = false;
      node.receiveShadow = true;
      node.frustumCulled = false;
      return;
    }

    node.material = prepareImportedShellMaterial(sourceMaterial);
    node.renderOrder = 6;
    node.castShadow = false;
    node.receiveShadow = true;
    node.frustumCulled = false;

    if (panelSide === "left") {
      leftPanelMeshes.push(node);
    } else if (panelSide === "right") {
      rightPanelMeshes.push(node);
    }
  });

  leftButtonMeshes.sort((a, b) => getMeshRowTop(b) - getMeshRowTop(a));
  rightButtonMeshes.sort((a, b) => getMeshRowTop(b) - getMeshRowTop(a));
  leftButtonGroups = groupButtonMeshesByRow(leftButtonMeshes);
  rightButtonGroups = groupButtonMeshesByRow(rightButtonMeshes);
  applyDetectedButtonRows();
}

function getDevicePanelSide(bounds) {
  const centerX = (bounds.min.x + bounds.max.x) / 2;
  const centerY = (bounds.min.y + bounds.max.y) / 2;

  if (isNormalizedModelBounds(bounds)) {
    const isSidePanelBand = centerY < 0.11 && centerY > -0.17;

    if (!isSidePanelBand) {
      return "";
    }

    if (centerX < -0.22) {
      return "left";
    }

    if (centerX > 0.2) {
      return "right";
    }

    return "";
  }

  const isSidePanelBand = centerY < -5.45 && bounds.max.y > -36.0;

  if (!isSidePanelBand) {
    return "";
  }

  if (centerX < 9.25) {
    return "left";
  }

  if (centerX > 55.75) {
    return "right";
  }

  return "";
}

function groupButtonMeshesByRow(meshes) {
  const groups = [];
  const maxAbsRowTop = meshes.reduce((maxValue, mesh) => Math.max(maxValue, Math.abs(getMeshRowTop(mesh))), 0);
  const rowMergeThreshold = maxAbsRowTop < 1 ? 0.006 : 0.08;

  meshes.forEach((mesh) => {
    const rowTop = getMeshRowTop(mesh);
    const current = groups[groups.length - 1];

    if (current && Math.abs(current.rowTop - rowTop) < rowMergeThreshold) {
      current.meshes.push(mesh);
      return;
    }

    groups.push({
      rowTop,
      meshes: [mesh]
    });
  });

  return groups.map((group) => group.meshes);
}

function getButtonGroupRowBounds(groups) {
  return groups
    .map((group) => {
      const bounds = new THREE.Box3();

      group.forEach((mesh) => {
        const meshBounds = getMeshBounds(mesh);

        if (!meshBounds) {
          return;
        }

        bounds.expandByPoint(meshBounds.min);
        bounds.expandByPoint(meshBounds.max);
      });

      if (bounds.isEmpty()) {
        return null;
      }

      return {
        top: bounds.max.y,
        bottom: bounds.min.y,
        left: bounds.min.x,
        right: bounds.max.x,
        zMin: bounds.min.z,
        zMax: bounds.max.z
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.top - a.top);
}

function isFullBackingPanel(bounds, name = "") {
  if (/^Shape3$/i.test(name)) {
    return true;
  }

  if (/solPanelButon|sagPanel-?Buton/i.test(name)) {
    return false;
  }

  const width = bounds.max.x - bounds.min.x;
  const height = bounds.max.y - bounds.min.y;

  if (isNormalizedModelBounds(bounds)) {
    const depth = Math.abs(bounds.max.z - bounds.min.z);
    const flatFullShellMask =
      width > 0.62 &&
      height > 0.28 &&
      bounds.min.x < -0.33 &&
      bounds.max.x > 0.33 &&
      bounds.min.y < -0.16 &&
      bounds.max.y > 0.13 &&
      depth < 0.002;
    const leftPanelScreen =
      width > 0.075 &&
      height > 0.24 &&
      bounds.max.x < -0.24 &&
      bounds.min.y < -0.15 &&
      bounds.max.y > 0.08 &&
      depth < 0.002;
    const rightPanelScreen =
      width > 0.095 &&
      height > 0.19 &&
      bounds.min.x > 0.22 &&
      bounds.min.y < -0.15 &&
      bounds.max.y > 0.04 &&
      depth < 0.002;

    return flatFullShellMask || leftPanelScreen || rightPanelScreen;
  }

  const flatFullShellMask =
    width > 66 &&
    height > 30 &&
    bounds.min.x < 0.1 &&
    bounds.max.x > 67 &&
    bounds.min.y < -35 &&
    bounds.max.y > -3.2 &&
    Math.abs(bounds.max.z - bounds.min.z) < 0.01;
  const leftPanelScreen =
    width > 8.5 &&
    height > 28 &&
    bounds.min.x < 0.5 &&
    bounds.max.x < 9.4 &&
    bounds.min.y < -34.5 &&
    bounds.max.y > -5.8 &&
    Math.abs(bounds.max.z - bounds.min.z) < 0.01;
  const rightPanelScreen =
    width > 11 &&
    height > 28 &&
    bounds.min.x > 55.8 &&
    bounds.max.x > 67 &&
    bounds.min.y < -34.5 &&
    bounds.max.y > -5.8 &&
    Math.abs(bounds.max.z - bounds.min.z) < 0.01;
  const rightTargetEndCap =
    bounds.min.x >= 56.25 &&
    bounds.max.x <= 67.12 &&
    bounds.min.y <= -34.7 &&
    bounds.max.y <= -33.6 &&
    height <= 1.2;

  return flatFullShellMask || leftPanelScreen || rightPanelScreen || rightTargetEndCap;
}

function isModelHeaderControlPlate(bounds, name = "") {
  if (/^(Shape1|Shape2|Shape78|Shape79)$/i.test(name)) {
    return true;
  }

  const width = bounds.max.x - bounds.min.x;
  const height = bounds.max.y - bounds.min.y;

  if (isNormalizedModelBounds(bounds)) {
    const inLeftHeader =
      bounds.min.x >= -0.33 &&
      bounds.max.x <= -0.25 &&
      bounds.min.y >= 0.096 &&
      bounds.max.y <= 0.104;
    const inRightHeader =
      bounds.min.x >= 0.227 &&
      bounds.max.x <= 0.331 &&
      bounds.min.y >= 0.050 &&
      bounds.max.y <= 0.058;

    return width >= 0.006 && width <= 0.018 && height >= 0.002 && height <= 0.007 && (inLeftHeader || inRightHeader);
  }

  const inLeftHeader =
    bounds.min.x >= 5.8 &&
    bounds.max.x <= 9.0 &&
    bounds.min.y >= -6.95 &&
    bounds.max.y <= -5.95;
  const inRightHeader =
    bounds.min.x >= 63.9 &&
    bounds.max.x <= 67.2 &&
    bounds.min.y >= -6.95 &&
    bounds.max.y <= -5.95;

  return width >= 0.85 && width <= 1.55 && height >= 0.5 && height <= 0.9 && (inLeftHeader || inRightHeader);
}

function within(value, min, max) {
  return value >= min && value <= max;
}

function isModelScreenPanel(bounds, name = "") {
  if (!bounds) {
    return false;
  }

  if (/screen|glass|display|Object00[2-7]/i.test(name)) {
    return true;
  }

  const width = bounds.max.x - bounds.min.x;
  const height = bounds.max.y - bounds.min.y;
  const depth = Math.abs(bounds.max.z - bounds.min.z);
  const usesAuthoredDeviceSpace =
    bounds.min.x >= -0.36 &&
    bounds.max.x <= 0.36 &&
    bounds.min.y >= -0.01 &&
    bounds.max.y <= 0.34;

  if (usesAuthoredDeviceSpace) {
    const isFlat = depth < 0.0025;
    const isTopBannerScreen =
      isFlat &&
      width > 0.60 &&
      height > 0.012 &&
      height < 0.035 &&
      bounds.min.x < -0.30 &&
      bounds.max.x > 0.30 &&
      bounds.min.y > 0.275;
    const isMainViewportScreen =
      isFlat &&
      width > 0.42 &&
      height > 0.22 &&
      bounds.min.x > -0.245 &&
      bounds.max.x < 0.225 &&
      bounds.min.y < 0.02 &&
      bounds.max.y > 0.25;
    const isLeftHeaderScreen =
      isFlat &&
      width > 0.074 &&
      width < 0.092 &&
      height > 0.006 &&
      height < 0.02 &&
      bounds.max.x < -0.245 &&
      bounds.min.y > 0.255;
    const isRightTitleScreen =
      isFlat &&
      width > 0.096 &&
      width < 0.116 &&
      height > 0.006 &&
      height < 0.02 &&
      bounds.min.x > 0.22 &&
      bounds.min.y > 0.25;
    const isRightFocusScreen =
      isFlat &&
      width > 0.096 &&
      width < 0.116 &&
      height > 0.05 &&
      height < 0.09 &&
      bounds.min.x > 0.22 &&
      bounds.min.y > 0.18 &&
      bounds.max.y < 0.25;
    const isRightSendScreen =
      isFlat &&
      width > 0.096 &&
      width < 0.116 &&
      height > 0.006 &&
      height < 0.02 &&
      bounds.min.x > 0.22 &&
      bounds.min.y > 0.16 &&
      bounds.max.y < 0.19;

    return isTopBannerScreen || isMainViewportScreen || isLeftHeaderScreen || isRightTitleScreen || isRightFocusScreen || isRightSendScreen;
  }

  if (isNormalizedModelBounds(bounds)) {
    const isFlat = depth < 0.0025;
    const isTopBannerScreen =
      isFlat &&
      width > 0.60 &&
      height > 0.015 &&
      height < 0.04 &&
      bounds.min.x < -0.30 &&
      bounds.max.x > 0.30 &&
      bounds.min.y > 0.105 &&
      bounds.max.y < 0.16;
    const isMainViewportScreen =
      isFlat &&
      width > 0.42 &&
      height > 0.22 &&
      bounds.min.x > -0.245 &&
      bounds.max.x < 0.225 &&
      bounds.min.y < -0.13 &&
      bounds.max.y > 0.075;
    const isLeftHeaderScreen =
      isFlat &&
      width > 0.074 &&
      width < 0.09 &&
      height > 0.006 &&
      height < 0.018 &&
      bounds.max.x < -0.245 &&
      bounds.min.y > 0.096 &&
      bounds.max.y < 0.108;
    const isRightTitleScreen =
      isFlat &&
      width > 0.096 &&
      width < 0.112 &&
      height > 0.006 &&
      height < 0.018 &&
      bounds.min.x > 0.22 &&
      bounds.max.y < 0.058 &&
      bounds.min.y > 0.047;
    const isRightFocusScreen =
      isFlat &&
      width > 0.096 &&
      width < 0.112 &&
      height > 0.05 &&
      height < 0.08 &&
      bounds.min.x > 0.22 &&
      bounds.max.y < 0.048 &&
      bounds.min.y > -0.02;
    const isRightSendScreen =
      isFlat &&
      width > 0.096 &&
      width < 0.112 &&
      height > 0.006 &&
      height < 0.018 &&
      bounds.min.x > 0.22 &&
      bounds.max.y < -0.015 &&
      bounds.min.y > -0.04;

    return isTopBannerScreen || isMainViewportScreen || isLeftHeaderScreen || isRightTitleScreen || isRightFocusScreen || isRightSendScreen;
  }

  const isTopBannerScreen = bounds.min.x <= 0.6 && bounds.max.x >= 67 && within(bounds.min.y, -5.6, -5.2) && within(bounds.max.y, -3.5, -3.2);
  const isMainViewportScreen = within(bounds.min.x, 9.3, 9.8) && within(bounds.max.x, 55.4, 55.9) && bounds.min.y <= -34.5 && bounds.max.y >= -5.8;
  const isLeftHeaderScreen = within(bounds.min.x, 0.55, 0.85) && within(bounds.max.x, 8.6, 9.0) && within(bounds.min.y, -7.05, -6.75) && within(bounds.max.y, -6.1, -5.8);
  const isRightHeaderScreen = bounds.min.x >= 56.2 && bounds.max.x >= 66.8 && (
    (within(bounds.min.y, -7.05, -6.75) && within(bounds.max.y, -6.1, -5.8)) ||
    (within(bounds.min.y, -13.8, -13.45) && within(bounds.max.y, -12.9, -12.55))
  );
  const isRightFocusScreen = bounds.min.x >= 56.2 && bounds.max.x >= 66.8 && within(bounds.min.y, -12.5, -12.1) && within(bounds.max.y, -7.4, -7.0);
  const isRightFocusIconScreen = within(bounds.min.x, 56.55, 56.8) && within(bounds.max.x, 58.6, 58.85) && within(bounds.min.y, -12.15, -11.85) && within(bounds.max.y, -7.65, -7.35);

  return isTopBannerScreen || isMainViewportScreen || isLeftHeaderScreen || isRightHeaderScreen || isRightFocusScreen || isRightFocusIconScreen || (width > 40 && height > 25 && bounds.min.x > 9);
}

function isModelStaticIconScreen(bounds, name = "") {
  if (!bounds) {
    return false;
  }

  const width = bounds.max.x - bounds.min.x;
  const height = bounds.max.y - bounds.min.y;
  const depth = Math.abs(bounds.max.z - bounds.min.z);
  const centerX = (bounds.min.x + bounds.max.x) / 2;

  if (depth > 0.00008) {
    return false;
  }

  const isCurrentDeviceIcon =
    width > 0.010 &&
    width < 0.018 &&
    height > 0.010 &&
    height < 0.018 &&
    (
      (centerX > -1.11 && centerX < -1.02) ||
      (centerX > -0.55 && centerX < -0.43)
    );

  if (isCurrentDeviceIcon) {
    return true;
  }

  return /Object0(15|17|19|21|23|25|27|29|31|33|39|41|42|51|53|55|57|59)/i.test(name);
}

function getMeshBounds(node) {
  if (!node.geometry) {
    return null;
  }

  const model = loadedModel || node.parent;

  if (model) {
    model.updateWorldMatrix(true, true);
  } else {
    node.updateWorldMatrix(true, false);
  }

  meshWorldBounds.setFromObject(node);

  if (meshWorldBounds.isEmpty()) {
    return null;
  }

  if (!loadedModel) {
    return meshWorldBounds.clone();
  }

  meshBoundsInverse.copy(loadedModel.matrixWorld).invert();
  meshModelBounds.makeEmpty();

  for (const x of [meshWorldBounds.min.x, meshWorldBounds.max.x]) {
    for (const y of [meshWorldBounds.min.y, meshWorldBounds.max.y]) {
      for (const z of [meshWorldBounds.min.z, meshWorldBounds.max.z]) {
        meshBoundsCorner.set(x, y, z).applyMatrix4(meshBoundsInverse);
        meshModelBounds.expandByPoint(meshBoundsCorner);
      }
    }
  }

  return meshModelBounds.clone();
}

function getDeviceButtonSide(bounds, name = "") {
  if (!bounds) {
    if (/sagPanel-?Buton/i.test(name)) {
      return "right";
    }

    if (/solPanelButon/i.test(name)) {
      return "left";
    }

    return "";
  }

  const width = Math.max(bounds.max.x - bounds.min.x, 0);
  const height = Math.max(bounds.max.y - bounds.min.y, 0);
  const depth = Math.max(bounds.max.z - bounds.min.z, 0);
  const centerX = (bounds.min.x + bounds.max.x) / 2;

  if (isNormalizedModelBounds(bounds)) {
    const looksLikeButton = width > 0.045 && width < 0.13 && height > 0.012 && height < 0.05 && depth > 0.0001;
    if (looksLikeButton && centerX < -0.8) {
      return "left";
    }
    if (looksLikeButton && ((centerX > -0.7 && centerX < -0.35) || centerX > 0.2)) {
      return "right";
    }
  } else {
    const looksLikeButton = width > 4 && width < 14 && height > 1 && height < 6 && depth > 0.01;
    if (looksLikeButton && bounds.max.x < 12) {
      return "left";
    }
    if (looksLikeButton && bounds.min.x > 52) {
      return "right";
    }
  }

  if (/sagPanel-?Buton/i.test(name)) {
    return "right";
  }

  if (/solPanelButon/i.test(name)) {
    return "left";
  }

  return "";
}

function getMeshRowTop(mesh) {
  const bounds = getMeshBounds(mesh);
  return bounds?.max.y ?? 0;
}

function fitObject(object) {
  if (!renderer || !camera || !object) {
    return;
  }

  const viewport = getCanvasViewportSize();
  const aspect = Math.max(viewport.width / Math.max(viewport.height, 1), 0.1);
  const viewHeight = 10;
  const viewWidth = viewHeight * aspect;

  camera.left = -viewWidth / 2;
  camera.right = viewWidth / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.updateProjectionMatrix();

  object.scale.setScalar(1);
  object.position.copy(object.userData.normalizedPosition || new THREE.Vector3());

  if (object === loadedModel) {
    fitLoadedDeviceObject(object, viewWidth, viewHeight);
    syncDeviceCssLayout();
    return;
  }

  box.setFromObject(object);
  box.getSize(size);

  const scaleX = (viewWidth * MODEL_FIT_PADDING) / size.x;
  const scaleY = (viewHeight * MODEL_FIT_PADDING) / size.y;
  const scaleZ = Math.min(scaleX, scaleY);
  object.scale.setScalar(Number.isFinite(scaleZ) ? scaleZ : 1);

  box.setFromObject(object);
  box.getCenter(center);
  object.position.sub(center);

  if (object === loadedModel) {
    syncDeviceCssLayout();
  }
}

function fitLoadedDeviceObject(object, viewWidth, viewHeight) {
  const deviceWidth = Math.max(DEVICE_VIEW_BOUNDS.xMax - DEVICE_VIEW_BOUNDS.xMin, 0.0001);
  const deviceHeight = Math.max(DEVICE_VIEW_BOUNDS.yMax - DEVICE_VIEW_BOUNDS.yMin, 0.0001);
  const scaleX = (viewWidth * MODEL_FIT_PADDING) / deviceWidth;
  const scaleY = (viewHeight * MODEL_FIT_PADDING) / deviceHeight;
  const scalar = Math.min(scaleX, scaleY);
  const safeScalar = Number.isFinite(scalar) ? scalar : 1;
  const centerX = (DEVICE_VIEW_BOUNDS.xMin + DEVICE_VIEW_BOUNDS.xMax) / 2;
  const centerY = (DEVICE_VIEW_BOUNDS.yMin + DEVICE_VIEW_BOUNDS.yMax) / 2;

  object.scale.setScalar(safeScalar);
  object.position.set(-centerX * safeScalar, -centerY * safeScalar, 0);
  object.updateMatrixWorld(true);
}

function getCanvasViewportSize() {
  if (!canvas) {
    return { width: 1, height: 1 };
  }

  const rect = canvas.getBoundingClientRect();

  return {
    width: Math.max(Math.floor(canvas.clientWidth || rect.width || 1), 1),
    height: Math.max(Math.floor(canvas.clientHeight || rect.height || 1), 1)
  };
}

function loadDeviceModel() {
  const loader = new GLTFLoader();

  loader.load(
    MODEL_URL,
    (gltf) => {
      loadedModel = gltf.scene;
      loadedModel.visible = false;
      normalizeModel(loadedModel);
      root.add(loadedModel);
      modelReady = true;
      ensureDeviceUiRoot();
      drawDeviceUi();
      loadButtonModels();
      fitObject(loadedModel);
      rebuildViewportHardwareOverlay();
      syncDeviceCssLayout();
      requestAnimationFrame(() => {
        fitObject(loadedModel);
        syncDeviceCssLayout();
        requestAnimationFrame(() => {
          loadedModel.visible = true;
          clearFallback();
          if (canvas) {
            canvas.dataset.deviceSceneState = "model";
          }
          fitObject(loadedModel);
          drawDeviceUi();
          rebuildGeneratedButtons();
          rebuildViewportHardwareOverlay();
          syncDeviceCssLayout();
          scheduleRender();
        });
      });
      scheduleRender();
    },
    undefined,
    () => {
      if (canvas) {
        canvas.dataset.deviceSceneState = "fallback";
      }
      modelReady = false;
      buildFallbackFromLayout();
      scheduleRender();
    }
  );
}

function clearFallback() {
  if (!fallbackRoot) {
    return;
  }

  root.remove(fallbackRoot);
  fallbackRoot.traverse((node) => {
    if (node.geometry) {
      node.geometry.dispose();
    }
  });
  fallbackRoot = null;
}

function rectToWorld(rect) {
  const canvasRect = canvas.getBoundingClientRect();
  const aspect = Math.max(canvasRect.width / Math.max(canvasRect.height, 1), 0.1);
  const viewHeight = 10;
  const viewWidth = viewHeight * aspect;

  return {
    x: ((rect.left + rect.width / 2 - canvasRect.left) / canvasRect.width - 0.5) * viewWidth,
    y: (0.5 - (rect.top + rect.height / 2 - canvasRect.top) / canvasRect.height) * viewHeight,
    width: (rect.width / canvasRect.width) * viewWidth,
    height: (rect.height / canvasRect.height) * viewHeight
  };
}

function addBoxFromRect(group, rect, depth, material, z = 0, inset = 0) {
  const world = rectToWorld(rect);
  const geometry = new THREE.BoxGeometry(Math.max(world.width - inset, 0.02), Math.max(world.height - inset, 0.02), depth);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(world.x, world.y, z);
  group.add(mesh);
  return mesh;
}

function buildFallbackFromLayout() {
  if (modelReady || !canvas) {
    return;
  }

  clearFallback();
  fallbackRoot = new THREE.Group();

  const chromeElements = [document.querySelector(".app-shell"), ...document.querySelectorAll(".app-rail, .bus-rail, .app-viewport")].filter(Boolean);
  const glassRects = [...document.querySelectorAll(".topbar, .rail-title, .surface-header, .viewport-host")];

  chromeElements.forEach((el) => addBoxFromRect(fallbackRoot, el.getBoundingClientRect(), FALLBACK_DEPTH, materials.fallbackMetal, -0.18));
  glassRects.forEach((el) => addBoxFromRect(fallbackRoot, el.getBoundingClientRect(), 0.04, materials.fallbackGlass, 0.02, 0.12));

  root.add(fallbackRoot);
  scheduleRender();
}

function resizeRenderer() {
  if (!renderer || !canvas) {
    return;
  }

  const { width, height } = getCanvasViewportSize();
  renderer.setSize(width, height, false);

  if (loadedModel) {
    fitObject(loadedModel);
    syncDeviceCssLayout();
  } else {
    buildFallbackFromLayout();
  }

  rebuildViewportHardwareOverlay();
  scheduleRender();
}

export function setDeviceLightAngle(angleDegrees = DEFAULT_LIGHT_ANGLE, elevationDegrees = DEFAULT_LIGHT_ELEVATION) {
  const angle = THREE.MathUtils.degToRad(angleDegrees);
  const elevation = THREE.MathUtils.degToRad(elevationDegrees);
  const radius = 7;
  const y = Math.sin(elevation) * radius;
  const planar = Math.cos(elevation) * radius;

  if (keyLight) {
    keyLight.position.set(Math.cos(angle) * planar, y, Math.sin(angle) * planar + 4);
    keyLight.target = keyLightTarget || keyLight.target;
    keyLight.target.position.set(0, 0, 0.1);
    keyLight.target.updateMatrixWorld();
  }

  if (fillLight) {
    fillLight.position.set(Math.cos(angle + Math.PI) * 5, 2.6, Math.sin(angle + Math.PI) * 5 + 2);
  }

  if (rimLight) {
    rimLight.position.set(Math.cos(angle + Math.PI * 0.55) * 4, 5, Math.sin(angle + Math.PI * 0.55) * 4 - 2);
  }

  scheduleRender();
}

export function setDeviceLightFromViewportPoint(clientX, clientY, viewportWidth = window.innerWidth, viewportHeight = window.innerHeight) {
  const safeWidth = Math.max(Number(viewportWidth) || 1, 1);
  const safeHeight = Math.max(Number(viewportHeight) || 1, 1);
  const x = THREE.MathUtils.clamp(Number(clientX) || safeWidth / 2, 0, safeWidth);
  const y = THREE.MathUtils.clamp(Number(clientY) || safeHeight / 2, 0, safeHeight);
  const nx = (x / safeWidth - 0.5) * 2;
  const ny = (y / safeHeight - 0.5) * 2;

  const distance = THREE.MathUtils.clamp(Math.hypot(nx, ny), 0, 1.45);
  const sourceX = nx * 8.8;
  const sourceY = -ny * 5.8;
  const sourceZ = 7.4 + Math.max(0, 1.1 - distance) * 0.9;

  if (keyLight) {
    keyLight.position.set(sourceX, sourceY, sourceZ);
    keyLight.intensity = 6.35;
    keyLight.target = keyLightTarget || keyLight.target;
    keyLight.target.position.set(0, 0, 0.1);
    keyLight.target.updateMatrixWorld();
  }

  if (fillLight) {
    fillLight.position.set(-sourceX * 0.38, -sourceY * 0.16 + 2.2, 4.2);
    fillLight.intensity = 0.72;
  }

  if (rimLight) {
    rimLight.position.set(sourceX * -0.22, 4.8, -3.6);
    rimLight.intensity = 1.05;
  }

  scheduleRender();
}

function renderScene() {
  renderHandle = 0;
  if (!renderer || !scene || !camera) {
    return;
  }
  renderer.render(scene, camera);
}

function scheduleRender() {
  if (renderHandle) {
    return;
  }
  renderHandle = requestAnimationFrame(renderScene);
}

export function refreshDeviceScene() {
  if (!canvas) {
    return;
  }

  resizeRenderer();
  drawDeviceUi();
  rebuildViewportHardwareOverlay();
  scheduleRender();
}

export function updateDeviceReflectionTilt(tiltX = 0, tiltY = 0) {
  environmentTiltX = Number.isFinite(tiltX) ? tiltX : 0;
  environmentTiltY = Number.isFinite(tiltY) ? tiltY : 0;
  applyEnvironmentReflectionPose();
  scheduleRender();
}

export function updateDeviceUi(nextUiState = {}) {
  latestUiState = {
    ...latestUiState,
    ...nextUiState
  };
  drawDeviceUi();
  rebuildViewportHardwareOverlay();
  scheduleRender();
}

function collectVisibleMeshDebug(predicate) {
  if (!loadedModel) {
    return [];
  }

  const rows = [];

  loadedModel.traverse((node) => {
    if (!node.isMesh || node.visible === false) {
      return;
    }

    const bounds = getMeshBounds(node);

    if (!bounds || (predicate && !predicate(bounds))) {
      return;
    }

    rows.push({
      name: node.name || "",
      x: [Number(bounds.min.x.toFixed(2)), Number(bounds.max.x.toFixed(2))],
      y: [Number(bounds.min.y.toFixed(2)), Number(bounds.max.y.toFixed(2))]
    });
  });

  return rows;
}

function summarizeRowBounds(rows = []) {
  return rows.map((row) => ({
    x: [Number(row.left.toFixed(5)), Number(row.right.toFixed(5))],
    y: [Number(row.bottom.toFixed(5)), Number(row.top.toFixed(5))],
    z: [
      Number((Number.isFinite(row.zMin) ? row.zMin : 0).toFixed(5)),
      Number((Number.isFinite(row.zMax) ? row.zMax : 0).toFixed(5))
    ]
  }));
}

function summarizeSlotBounds(slot) {
  return {
    x: [Number(slot.xMin.toFixed(5)), Number(slot.xMax.toFixed(5))],
    y: [Number(slot.yBottom.toFixed(5)), Number(slot.yTop.toFixed(5))],
    z: Number((Number.isFinite(slot.z) ? slot.z : 0).toFixed(5)),
    labelZ: Number((Number.isFinite(slot.labelZ) ? slot.labelZ : 0).toFixed(5)),
    rows: slot.rowBounds?.length || 0
  };
}

export function initDeviceScene() {
  canvas = document.querySelector("#device-scene");

  if (!canvas) {
    return;
  }

  canvas.dataset.deviceSceneState = "initializing";
  createRenderer();
  createScene();
  resizeRenderer();
  buildFallbackFromLayout();
  if (SHOULD_SKIP_MODEL_FETCH) {
    canvas.dataset.deviceSceneState = "fallback";
    modelReady = false;
    scheduleRender();
  } else {
    loadDeviceModel();
  }

  resizeObserver = new ResizeObserver(() => refreshDeviceScene());
  resizeObserver.observe(document.documentElement);

  window.addEventListener("resize", refreshDeviceScene);
  window.ycswuDeviceScene = {
    refresh: refreshDeviceScene,
    setLight: setDeviceLightAngle,
    setLightFromViewportPoint: setDeviceLightFromViewportPoint,
    updateUi: updateDeviceUi,
    debug: () => ({
      apps: latestUiState.apps.length,
      targets: latestUiState.targets.length,
      showApps: latestUiState.showApps,
      showTargets: latestUiState.showTargets,
      panelMeshes: {
        leftTotal: leftPanelMeshes.length,
        leftVisible: leftPanelMeshes.filter((mesh) => mesh.visible).length,
        rightTotal: rightPanelMeshes.length,
        rightVisible: rightPanelMeshes.filter((mesh) => mesh.visible).length
      },
      leftButtonGroups: leftButtonGroups.map((group) => group.map((mesh) => ({ name: mesh.name, visible: mesh.visible }))),
      rightButtonGroups: rightButtonGroups.map((group) => group.map((mesh) => ({ name: mesh.name, visible: mesh.visible }))),
      rowBounds: {
        apps: summarizeRowBounds(deviceUiSlots.apps.rowBounds),
        targets: summarizeRowBounds(deviceUiSlots.targets.rowBounds)
      },
      slotBounds: {
        apps: summarizeSlotBounds(deviceUiSlots.apps),
        targets: summarizeSlotBounds(deviceUiSlots.targets)
      },
      visibleRightMeshes: collectVisibleMeshDebug((bounds) => bounds.min.x > 55 && bounds.min.y < -6),
      visibleLeftMeshes: collectVisibleMeshDebug((bounds) => bounds.max.x < 10 && bounds.min.y < -6),
      scroll: {
        leftTrack: Boolean(leftScrollTrack?.visible),
        leftThumb: Boolean(leftScrollThumb?.visible),
        rightTrack: Boolean(rightScrollTrack?.visible),
        rightThumb: Boolean(rightScrollThumb?.visible)
      }
    }),
    setDebugPartVisible: (part, visible) => {
      const targets = {
        leftUiPlane,
        rightUiPlane,
        leftScrollTrack,
        leftScrollThumb,
        rightScrollTrack,
        rightScrollThumb
      };
      if (targets[part]) {
        targets[part].visible = Boolean(visible);
        scheduleRender();
      }
    }
  };
}
