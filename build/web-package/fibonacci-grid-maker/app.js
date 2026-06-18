const canvas = document.querySelector("#stage");
const ctx = canvas.getContext("2d");

const controls = {
  aspectSelect: document.querySelector("#aspectSelect"),
  customAspect: document.querySelector("#customAspect"),
  customW: document.querySelector("#customW"),
  customH: document.querySelector("#customH"),
  verticalSegmentInput: document.querySelector("#verticalSegmentInput"),
  horizontalSegmentInput: document.querySelector("#horizontalSegmentInput"),
  exportSvg: document.querySelector("#exportSvg"),
  exportPng: document.querySelector("#exportPng")
};

const state = {
  aspect: "1:1",
  customW: 1,
  customH: 1,
  verticalSegments: 7,
  horizontalSegments: 7,
  showCenterVertical: true,
  showCenterHorizontal: true
};

const CUSTOM_DIMENSION_MAX = 99999;

const markerHitAreas = {
  vertical: null,
  horizontal: null
};

const preview = {
  background: "#a3a3a0",
  frameFill: "#4f504d",
  guide: "#f3f3ef"
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function positiveNumber(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : fallback;
}

function readPositiveControl(control, current, min, max, normalize) {
  if (control.value.trim() === "") {
    return normalize ? min : current;
  }

  return clamp(positiveNumber(control.value, current), min, max);
}

function clampCustomDimensionInput(control) {
  if (control !== controls.customW && control !== controls.customH) {
    return;
  }

  if (control.value.trim() === "") {
    return;
  }

  const value = Math.floor(positiveNumber(control.value, CUSTOM_DIMENSION_MAX));

  if (value > CUSTOM_DIMENSION_MAX) {
    control.value = CUSTOM_DIMENSION_MAX;
  }
}

function readSegmentControl(control, current, normalize) {
  if (control.value.trim() === "") {
    return normalize ? 2 : current;
  }

  const fallback = normalize ? 2 : current;
  return clamp(Math.round(positiveNumber(control.value, fallback)), 2, 9);
}

function fibonacci(count) {
  const list = [];
  for (let index = 0; index < count; index += 1) {
    list.push(index < 2 ? 1 : list[index - 1] + list[index - 2]);
  }
  return list;
}

function aspectRatio() {
  if (state.aspect === "custom") {
    return state.customW / state.customH;
  }

  const [w, h] = state.aspect.split(":").map(Number);
  return w / h;
}

function cumulativeCuts(units, size) {
  const total = units.reduce((sum, unit) => sum + unit, 0);
  const cuts = [0];
  let cursor = 0;

  for (const unit of units) {
    cursor += unit;
    cuts.push((cursor / total) * size);
  }

  return cuts;
}

function guideCuts(units, size, includeCenter) {
  const cuts = cumulativeCuts(units, size);
  const mirrored = cuts.map((cut) => size - cut);
  const center = includeCenter ? [size / 2] : [];
  const centerCut = Math.round((size / 2) * 1000) / 1000;

  return [...new Set([...cuts, ...mirrored, ...center].map((cut) => Math.round(cut * 1000) / 1000))]
    .filter((cut) => includeCenter || Math.abs(cut - centerCut) > 0.001)
    .sort((a, b) => a - b);
}

function computePreviewLayout(width, height) {
  const ratio = aspectRatio();
  const mobile = width < 760;
  const sidePad = mobile ? 36 : 96;
  const topPad = mobile ? 82 : 78;
  const bottomPad = mobile ? 170 : 126;
  const availableW = Math.max(260, width - sidePad * 2);
  const availableH = Math.max(260, height - topPad - bottomPad);

  let frameW = availableW;
  let frameH = frameW / ratio;

  if (frameH > availableH) {
    frameH = availableH;
    frameW = frameH * ratio;
  }

  return {
    frame: {
      x: Math.round((width - frameW) / 2),
      y: Math.round(topPad + (availableH - frameH) / 2),
      w: Math.round(frameW),
      h: Math.round(frameH)
    }
  };
}

function drawPreview(context, width, height) {
  const layout = computePreviewLayout(width, height);
  const { frame } = layout;
  const verticalLineUnits = fibonacci(state.verticalSegments);
  const horizontalLineUnits = fibonacci(state.horizontalSegments);
  const xGuides = guideCuts(verticalLineUnits, frame.w, state.showCenterVertical);
  const yGuides = guideCuts(horizontalLineUnits, frame.h, state.showCenterHorizontal);

  context.clearRect(0, 0, width, height);
  context.fillStyle = preview.background;
  context.fillRect(0, 0, width, height);

  context.fillStyle = frameFill();
  context.fillRect(frame.x, frame.y, frame.w, frame.h);

  drawPreviewGuideLines(context, frame, xGuides, yGuides);
  drawCenterMarkers(context, frame);
}

function drawPreviewGuideLines(context, frame, xGuides, yGuides) {
  context.save();
  context.fillStyle = preview.guide;
  context.strokeStyle = preview.guide;
  context.globalAlpha = 0.95;

  for (const cut of xGuides) {
    if (cut <= 0 || cut >= frame.w) continue;

    const x = Math.round(frame.x + cut);
    context.fillRect(x, frame.y, 1, frame.h);
  }

  for (const cut of yGuides) {
    if (cut <= 0 || cut >= frame.h) continue;

    const y = Math.round(frame.y + cut);
    context.fillRect(frame.x, y, frame.w, 1);
  }

  context.lineWidth = 1;
  context.strokeRect(frame.x, frame.y, frame.w, frame.h);
  context.restore();
}

function drawCenterMarkers(context, frame) {
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  const topY = frame.y - 24;
  const sideX = frame.x + frame.w + 28;
  const hitSize = 42;

  markerHitAreas.vertical = {
    x: cx - hitSize / 2,
    y: topY - hitSize / 2,
    w: hitSize,
    h: hitSize
  };
  markerHitAreas.horizontal = {
    x: sideX - hitSize / 2,
    y: cy - hitSize / 2,
    w: hitSize,
    h: hitSize
  };

  context.save();
  context.strokeStyle = preview.guide;
  context.fillStyle = preview.guide;
  context.lineWidth = 2;
  context.globalAlpha = state.showCenterVertical ? 0.95 : 0.34;

  context.beginPath();
  context.moveTo(cx, topY - 15);
  context.lineTo(cx, topY + 18);
  context.stroke();
  context.beginPath();
  context.arc(cx, topY, 7, 0, Math.PI * 2);
  context.fill();

  context.globalAlpha = state.showCenterHorizontal ? 0.95 : 0.34;
  context.beginPath();
  context.moveTo(sideX - 18, cy);
  context.lineTo(sideX + 15, cy);
  context.stroke();
  context.beginPath();
  context.arc(sideX, cy, 7, 0, Math.PI * 2);
  context.fill();

  context.restore();
}

function pointInRect(point, rect) {
  return rect
    && point.x >= rect.x
    && point.x <= rect.x + rect.w
    && point.y >= rect.y
    && point.y <= rect.y + rect.h;
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function setCanvasCursor(event) {
  const point = canvasPoint(event);
  const overMarker = pointInRect(point, markerHitAreas.vertical) || pointInRect(point, markerHitAreas.horizontal);
  canvas.style.cursor = overMarker ? "pointer" : "default";
}

function handleCanvasClick(event) {
  const point = canvasPoint(event);

  if (pointInRect(point, markerHitAreas.vertical)) {
    state.showCenterVertical = !state.showCenterVertical;
    redraw();
    return;
  }

  if (pointInRect(point, markerHitAreas.horizontal)) {
    state.showCenterHorizontal = !state.showCenterHorizontal;
    redraw();
  }
}

function frameFill() {
  return preview.frameFill;
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawPreview(ctx, rect.width, rect.height);
}

function redraw() {
  const rect = canvas.getBoundingClientRect();
  drawPreview(ctx, rect.width, rect.height);
}

function syncState({ normalize = false } = {}) {
  state.aspect = controls.aspectSelect.value;
  state.customW = readPositiveControl(controls.customW, state.customW, 1, CUSTOM_DIMENSION_MAX, normalize);
  state.customH = readPositiveControl(controls.customH, state.customH, 1, CUSTOM_DIMENSION_MAX, normalize);
  state.verticalSegments = readSegmentControl(controls.verticalSegmentInput, state.verticalSegments, normalize);
  state.horizontalSegments = readSegmentControl(controls.horizontalSegmentInput, state.horizontalSegments, normalize);

  if (normalize) {
    controls.customW.value = state.customW;
    controls.customH.value = state.customH;
    controls.verticalSegmentInput.value = state.verticalSegments;
    controls.horizontalSegmentInput.value = state.horizontalSegments;
  }

  controls.customAspect.classList.toggle("is-hidden", state.aspect !== "custom");
}

function exportSvg() {
  const ratio = aspectRatio();
  const base = 1000;
  const width = ratio >= 1 ? Math.round(base * ratio) : base;
  const height = ratio >= 1 ? base : Math.round(base / ratio);
  const verticalLineUnits = fibonacci(state.verticalSegments);
  const horizontalLineUnits = fibonacci(state.horizontalSegments);
  const xGuides = guideCuts(verticalLineUnits, width, state.showCenterVertical);
  const yGuides = guideCuts(horizontalLineUnits, height, state.showCenterHorizontal);
  const fileAspect = state.aspect === "custom" ? `${state.customW}x${state.customH}` : state.aspect.replace(":", "x");
  const stroke = "#000000";
  const parts = [];

  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">`);
  parts.push(`<title>Fibonacci guide frame ${fileAspect}, vertical ${state.verticalSegments}, horizontal ${state.horizontalSegments}</title>`);
  parts.push(`<g id="fibonacci-guide-frame" stroke="${stroke}" stroke-width="0.5" vector-effect="non-scaling-stroke" opacity="0.85">`);
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}"/>`);

  for (const x of xGuides) {
    if (x !== 0 && x !== width) {
      parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${height}"/>`);
    }
  }

  for (const y of yGuides) {
    if (y !== 0 && y !== height) {
      parts.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}"/>`);
    }
  }

  parts.push("</g>");
  parts.push("</svg>");

  const blob = new Blob([parts.join("\n")], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `fibonacci-guide-${fileAspect}-v${state.verticalSegments}-h${state.horizontalSegments}.svg`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function drawGuideExport(context, width, height, scale = 1) {
  const verticalLineUnits = fibonacci(state.verticalSegments);
  const horizontalLineUnits = fibonacci(state.horizontalSegments);
  const xGuides = guideCuts(verticalLineUnits, width, state.showCenterVertical);
  const yGuides = guideCuts(horizontalLineUnits, height, state.showCenterHorizontal);

  context.clearRect(0, 0, width, height);
  context.save();
  context.strokeStyle = "rgba(0, 0, 0, 0.85)";
  context.lineWidth = 1 / scale;

  context.strokeRect(0, 0, width, height);

  for (const x of xGuides) {
    if (x !== 0 && x !== width) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
  }

  for (const y of yGuides) {
    if (y !== 0 && y !== height) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
  }

  context.restore();
}

function exportPng() {
  const ratio = aspectRatio();
  const base = 1000;
  const width = ratio >= 1 ? Math.round(base * ratio) : base;
  const height = ratio >= 1 ? base : Math.round(base / ratio);
  const scale = 2;
  const fileAspect = state.aspect === "custom" ? `${state.customW}x${state.customH}` : state.aspect.replace(":", "x");
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = width * scale;
  outputCanvas.height = height * scale;
  const outputContext = outputCanvas.getContext("2d");
  outputContext.scale(scale, scale);
  drawGuideExport(outputContext, width, height, scale);

  outputCanvas.toBlob((blob) => {
    if (!blob) return;

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `fibonacci-guide-${fileAspect}-v${state.verticalSegments}-h${state.horizontalSegments}.png`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, "image/png");
}

function bindControls() {
  const liveControls = [
    controls.aspectSelect,
    controls.customW,
    controls.customH,
    controls.verticalSegmentInput,
    controls.horizontalSegmentInput
  ];

  for (const control of liveControls) {
    control.addEventListener("input", () => {
      clampCustomDimensionInput(control);
      syncState();
      redraw();
    });
    control.addEventListener("change", () => {
      syncState({ normalize: true });
      redraw();
    });
    control.addEventListener("blur", () => {
      syncState({ normalize: true });
      redraw();
    });
  }

  controls.exportSvg.addEventListener("click", exportSvg);
  controls.exportPng.addEventListener("click", exportPng);
  canvas.addEventListener("click", handleCanvasClick);
  canvas.addEventListener("mousemove", setCanvasCursor);
  canvas.addEventListener("mouseleave", () => {
    canvas.style.cursor = "default";
  });
}

bindControls();
syncState();
window.addEventListener("resize", resize);
resize();
