const nodeGraphZoomLimits = Object.freeze({
  max: 50,
  min: 0.1,
  buttonRatio: 1.12,
  fineRatio: 1.05,
  quarterRatio: 1.08,
  wheelRatio: 1.12,
});

function applyNodeGraphWorkspaceView() {
  const workspace = document.getElementById("nodeGraphWorkspace");
  if (!workspace) {
    return;
  }

  workspace.style.setProperty("--node-grid-height", `${nodeGraphGridHeight()}px`);
  workspace.style.setProperty("--node-grid-size", `${nodeGraphGridSize()}px`);
  workspace.style.setProperty("--node-grid-width", `${nodeGraphGridWidth()}px`);
  const view = normalizeNodeGraphPatchView(nodeGraphMvp.patch.view);
  const visibleView = view.widthGu > 0 && view.heightGu > 0
    ? clampNodeGraphWorkspaceGridSizeToViewport(view, workspace)
    : view;
  const widthCss = visibleView.widthGu > 0
    ? nodeGraphWorkspaceWidthCss(visibleView.widthGu * nodeGraphGridWidth())
    : null;
  const heightCss = visibleView.heightGu > 0
    ? nodeGraphWorkspaceHeightCss(visibleView.heightGu * nodeGraphGridHeight())
    : null;
  applyNodeGraphWorkspaceSizeCss(workspace, widthCss, heightCss);
  if (widthCss) {
    workspace.parentElement?.style.setProperty("--node-workspace-view-width", widthCss);
  } else {
    workspace.parentElement?.style.removeProperty("--node-workspace-view-width");
  }
  workspace.dataset.widthGu = String(visibleView.widthGu);
  workspace.dataset.heightGu = String(visibleView.heightGu);
  if (typeof syncNodeGraphModularViewSizeReadout === "function") {
    syncNodeGraphModularViewSizeReadout();
  }
  if (typeof syncNodeGraphWorkspaceResizeHandlePosition === "function") {
    syncNodeGraphWorkspaceResizeHandlePosition();
  }
  if (typeof applyNodeGraphPan === "function") {
    applyNodeGraphPan();
  }
  scheduleNodeGraphWorkspaceOriginSync();
}

function scheduleNodeGraphWorkspaceOriginSync() {
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
    return;
  }
  if (nodeGraphMvp.workspaceOriginSyncFrame) {
    window.cancelAnimationFrame(nodeGraphMvp.workspaceOriginSyncFrame);
  }
  nodeGraphMvp.workspaceOriginSyncFrame = window.requestAnimationFrame(() => {
    nodeGraphMvp.workspaceOriginSyncFrame = window.requestAnimationFrame(() => {
      nodeGraphMvp.workspaceOriginSyncFrame = 0;
      if (typeof applyNodeGraphPan === "function") {
        applyNodeGraphPan();
      }
    });
  });
}

function nodeGraphZoom() {
  return Number.isFinite(nodeGraphMvp.zoom) ? nodeGraphMvp.zoom : 1;
}

function nodeGraphZoomLabel() {
  return nodeGraphZoom().toFixed(2);
}

function nodeGraphRenderedPanValue(value, origin = 0) {
  const number = Number(value) || 0;
  const originNumber = Number(origin) || 0;
  const rendered = Math.round(originNumber + number) - originNumber;
  return Object.is(rendered, -0) ? 0 : rendered;
}

// Shared by nodeGraphWorkspaceCenterOffset/nodeGraphRenderedPan so
// nodeGraphRenderedOriginOffset (their only shared caller, and the hot path
// for every pan/zoom update) can measure the workspace's rect + border widths
// ONCE instead of each sub-function forcing its own separate synchronous
// layout for the exact same element on the exact same tick.
function nodeGraphWorkspaceRectMetrics(container) {
  const rect = container?.getBoundingClientRect?.();
  const style = container ? getComputedStyle(container) : null;
  return {
    rect,
    borderLeft: Number.parseFloat(style?.borderLeftWidth) || 0,
    borderTop: Number.parseFloat(style?.borderTopWidth) || 0,
    borderRight: Number.parseFloat(style?.borderRightWidth) || 0,
    borderBottom: Number.parseFloat(style?.borderBottomWidth) || 0,
  };
}

function nodeGraphWorkspaceCenterOffset(container = document.getElementById("nodeGraphWorkspace"), metrics = null) {
  const m = metrics || nodeGraphWorkspaceRectMetrics(container);
  return {
    x: m.borderLeft + Math.max(0, (Number(m.rect?.width) || 0) - m.borderLeft - m.borderRight) * 0.5,
    y: m.borderTop + Math.max(0, (Number(m.rect?.height) || 0) - m.borderTop - m.borderBottom) * 0.5,
  };
}

function nodeGraphRenderedPan(pan = nodeGraphMvp.pan || { x: 0, y: 0 }, container = document.getElementById("nodeGraphWorkspace"), metrics = null) {
  const m = metrics || nodeGraphWorkspaceRectMetrics(container);
  return {
    x: nodeGraphRenderedPanValue(pan.x, (m.rect?.left || 0) + m.borderLeft),
    y: nodeGraphRenderedPanValue(pan.y, (m.rect?.top || 0) + m.borderTop),
  };
}

function nodeGraphRenderedOriginOffset(
  pan = nodeGraphMvp.pan || { x: 0, y: 0 },
  container = document.getElementById("nodeGraphWorkspace"),
) {
  const metrics = nodeGraphWorkspaceRectMetrics(container);
  const center = nodeGraphWorkspaceCenterOffset(container, metrics);
  const renderedPan = nodeGraphRenderedPan(pan, container, metrics);
  return {
    x: center.x + renderedPan.x,
    y: center.y + renderedPan.y,
  };
}

function nodeGraphZoomSurface() {
  return document.getElementById("nodeGraphZoomSurface");
}

function nodeGraphGraphRect() {
  const surface = nodeGraphZoomSurface();
  const graphElement = surface || document.getElementById("nodeGraphWorkspace");
  return {
    height: graphElement?.offsetHeight || graphElement?.getBoundingClientRect?.().height || 0,
    width: graphElement?.offsetWidth || graphElement?.getBoundingClientRect?.().width || 0,
  };
}

function nodeGraphZoomSurfaceClientScale(surface = nodeGraphZoomSurface()) {
  const rect = surface?.getBoundingClientRect?.();
  const width = Number(surface?.offsetWidth) || 0;
  const height = Number(surface?.offsetHeight) || 0;
  const fallback = Math.max(0.0001, nodeGraphZoom());
  const scaleX = rect && width > 0 ? rect.width / width : fallback;
  const scaleY = rect && height > 0 ? rect.height / height : fallback;
  return {
    x: Number.isFinite(scaleX) && scaleX > 0 ? scaleX : fallback,
    y: Number.isFinite(scaleY) && scaleY > 0 ? scaleY : fallback,
  };
}

function nodeGraphClientToZoomSurfacePoint(clientX, clientY, surface = nodeGraphZoomSurface()) {
  const rect = surface?.getBoundingClientRect?.();
  if (!rect) {
    return { x: 0, y: 0 };
  }
  const scale = nodeGraphZoomSurfaceClientScale(surface);
  return {
    x: (clientX - rect.left) / scale.x,
    y: (clientY - rect.top) / scale.y,
  };
}

function nodeGraphClientPoint(event) {
  return nodeGraphClientToZoomSurfacePoint(event.clientX, event.clientY);
}

function positionNodeGraphNode(node, point, options = {}) {
  const graphRect = nodeGraphGraphRect();
  const maxX = Math.max(0, graphRect.width - node.offsetWidth - 10);
  const maxY = Math.max(0, graphRect.height - node.offsetHeight - 10);
  const snapOptions = { halfGrid: options.halfGrid === true };
  const positionedPoint = options.snap === false ? point : snapNodeGraphPointToGrid(point, snapOptions);
  const x = options.clamp === false
    ? positionedPoint.x
    : Math.max(0, Math.min(maxX, positionedPoint.x));
  const y = options.clamp === false
    ? positionedPoint.y
    : Math.max(0, Math.min(maxY, positionedPoint.y));
  node.style.setProperty("--node-x", `${x}px`);
  node.style.setProperty("--node-y", `${y}px`);
}

function nodeGraphRectFromPoints(a, b) {
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const right = Math.max(a.x, b.x);
  const bottom = Math.max(a.y, b.y);
  return {
    bottom,
    height: bottom - top,
    left,
    right,
    top,
    width: right - left,
  };
}

function nodeGraphNodeBounds(node) {
  const x = Number.parseFloat(node.style.getPropertyValue("--node-x")) || 0;
  const y = Number.parseFloat(node.style.getPropertyValue("--node-y")) || 0;
  return {
    bottom: y + node.offsetHeight,
    left: x,
    right: x + node.offsetWidth,
    top: y,
  };
}

function nodeGraphWorkspaceFloatProperty(element, property, fallback = 0) {
  const value = Number.parseFloat(getComputedStyle(element).getPropertyValue(property));
  return Number.isFinite(value) ? value : fallback;
}

function updateNodeGraphGridHeatmap() {
  const heatmap = document.getElementById("nodeGridHeatmap");
  const surface = nodeGraphZoomSurface();
  const workspace = document.getElementById("nodeGraphWorkspace");
  if (!heatmap || !surface || !workspace) {
    return;
  }

  const glowLayers = [];
  const maskLayers = [];
  const visibleNodes = [...surface.querySelectorAll(".dsp-node:not(.removed):not([hidden])")];
  const zoom = nodeGraphZoom();
  const origin = nodeGraphRenderedOriginOffset();
  heatmap.style.setProperty("--node-grid-heatmap-grid-position", `${origin.x}px ${origin.y}px`);
  heatmap.style.setProperty(
    "--node-grid-heatmap-grid-size",
    `${(nodeGraphGridWidth() * zoom).toFixed(2)}px ${(nodeGraphGridHeight() * zoom).toFixed(2)}px`,
  );
  const spread = Math.max(
    0.4,
    Math.min(
      2.2,
      (Number.parseFloat(getComputedStyle(workspace).getPropertyValue("--node-module-light-spread")) || 1),
    ),
  );
  for (const node of visibleNodes) {
    const bounds = nodeGraphNodeBounds(node);
    const centerX = (bounds.left + (bounds.right - bounds.left) / 2) * zoom + (Number(origin.x) || 0);
    const centerY = (bounds.top + (bounds.bottom - bounds.top) / 2) * zoom + (Number(origin.y) || 0);
    const radiusX = Math.max(nodeGraphGridWidth() * 5, (bounds.right - bounds.left) * 1.18) * spread * zoom;
    const radiusY = Math.max(nodeGraphGridHeight() * 5, (bounds.bottom - bounds.top) * 1.35) * spread * zoom;
    glowLayers.push(
      `radial-gradient(ellipse ${radiusX.toFixed(2)}px ${radiusY.toFixed(2)}px at ${centerX.toFixed(2)}px ${centerY.toFixed(2)}px, rgba(127, 199, 217, 0.18) 0%, rgba(127, 199, 217, 0.15) 18%, rgba(226, 168, 109, 0.1) 38%, rgba(226, 168, 109, 0.045) 62%, transparent 92%)`,
    );
    maskLayers.push(
      `radial-gradient(ellipse ${radiusX.toFixed(2)}px ${radiusY.toFixed(2)}px at ${centerX.toFixed(2)}px ${centerY.toFixed(2)}px, black 0%, rgb(0 0 0 / 0.95) 22%, rgb(0 0 0 / 0.72) 48%, rgb(0 0 0 / 0.28) 74%, transparent 94%)`,
    );
  }
  const mouseAmount = Math.max(0, Math.min(2, nodeGraphWorkspaceFloatProperty(workspace, "--node-mouse-light-amount")));
  const mouseSpread = Math.max(0, Math.min(2, nodeGraphWorkspaceFloatProperty(workspace, "--node-mouse-light-spread")));
  const mousePoint = nodeGraphMvp.mouseLightPoint;
  if (mouseAmount > 0 && mouseSpread > 0 && mousePoint) {
    const radius = Math.max(nodeGraphGridWidth(), nodeGraphGridHeight()) * (3 + 10.5 * mouseSpread) * zoom;
    maskLayers.push(
      `radial-gradient(circle ${radius.toFixed(2)}px at ${mousePoint.x.toFixed(2)}px ${mousePoint.y.toFixed(2)}px, rgb(0 0 0 / ${(0.92 * mouseAmount).toFixed(3)}) 0%, rgb(0 0 0 / ${(0.68 * mouseAmount).toFixed(3)}) 32%, rgb(0 0 0 / ${(0.24 * mouseAmount).toFixed(3)}) 72%, transparent 96%)`,
    );
  }
  heatmap.style.setProperty("--node-grid-heatmap", glowLayers.length ? glowLayers.join(", ") : "none");
  heatmap.style.setProperty(
    "--node-grid-heatmap-mask",
    maskLayers.length ? maskLayers.join(", ") : "linear-gradient(transparent, transparent)",
  );
}

function scheduleNodeGraphGridHeatmapUpdate() {
  if (nodeGraphMvp.mouseLightFrame) {
    return;
  }
  nodeGraphMvp.mouseLightFrame = window.requestAnimationFrame(() => {
    nodeGraphMvp.mouseLightFrame = 0;
    updateNodeGraphGridHeatmap();
  });
}

function updateNodeGraphMouseLight(event) {
  const workspace = document.getElementById("nodeGraphWorkspace");
  if (!workspace) {
    return;
  }
  const rect = workspace.getBoundingClientRect();
  nodeGraphMvp.mouseLightPoint = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
  scheduleNodeGraphGridHeatmapUpdate();
}

function clearNodeGraphMouseLight() {
  nodeGraphMvp.mouseLightPoint = null;
  updateNodeGraphGridHeatmap();
}

function nodeGraphRectsIntersect(a, b) {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}
