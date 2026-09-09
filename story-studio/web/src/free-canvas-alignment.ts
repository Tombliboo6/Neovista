import { organizeFreeCanvas, type FreeCanvasLayoutNode, type FreeCanvasLayoutEdge } from "./free-canvas-layout.ts";
export type CanvasArrangement = "left" | "center" | "right" | "top" | "middle" | "bottom" | "horizontal" | "vertical" | "organize";
export function arrangeCanvasSelection(nodes: FreeCanvasLayoutNode[], edges: FreeCanvasLayoutEdge[], selected: Set<string>, action: CanvasArrangement) {
  const items = nodes.filter(n => selected.has(n.id)).map(n => ({ ...n, width: n.width ?? 300, height: n.height ?? 220 }));
  const result = new Map<string, { x: number; y: number }>();
  if (items.length < 2) return result;
  const left = Math.min(...items.map(n => n.x)), right = Math.max(...items.map(n => n.x + n.width));
  const top = Math.min(...items.map(n => n.y)), bottom = Math.max(...items.map(n => n.y + n.height));
  if (action === "organize") {
    const positions = organizeFreeCanvas(items, edges);
    const originX = Math.min(...[...positions.values()].map(p => p.x)), originY = Math.min(...[...positions.values()].map(p => p.y));
    positions.forEach((p, id) => result.set(id, { x: left + p.x - originX, y: top + p.y - originY }));
    return result;
  }
  if (action === "horizontal" || action === "vertical") {
    if (items.length < 3) return result;
    const horizontal = action === "horizontal";
    items.sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y) || a.id.localeCompare(b.id));
    const totalSize = items.reduce((sum, n) => sum + (horizontal ? n.width : n.height), 0);
    const gap = Math.max(24, ((horizontal ? right - left : bottom - top) - totalSize) / (items.length - 1));
    let cursor = horizontal ? left : top;
    items.forEach(n => { result.set(n.id, { x: horizontal ? cursor : n.x, y: horizontal ? n.y : cursor }); cursor += (horizontal ? n.width : n.height) + gap; });
    return result;
  }
  items.forEach(n => result.set(n.id, {
    x: action === "left" ? left : action === "center" ? (left + right - n.width) / 2 : action === "right" ? right - n.width : n.x,
    y: action === "top" ? top : action === "middle" ? (top + bottom - n.height) / 2 : action === "bottom" ? bottom - n.height : n.y,
  }));
  return result;
}
