export const FREE_CANVAS_NODE_LIMIT = 500;
export const FREE_CANVAS_EDGE_LIMIT = 1000;
type CapacityGraph = { nodes?: unknown; edges?: unknown } | null | undefined;
const count = (value: unknown) => Array.isArray(value) ? value.length : 0;

/** Existing over-limit projects remain readable/editable; only growth is rejected. */
export function freeCanvasCapacityError(next: CapacityGraph, previous?: CapacityGraph): string | null {
  const nodes = count(next?.nodes), edges = count(next?.edges);
  const nodeLimit = Math.max(FREE_CANVAS_NODE_LIMIT, count(previous?.nodes));
  const edgeLimit = Math.max(FREE_CANVAS_EDGE_LIMIT, count(previous?.edges));
  if (nodes > nodeLimit) return `画布最多新增至 ${FREE_CANVAS_NODE_LIMIT} 个节点，当前剩余 ${Math.max(0, FREE_CANVAS_NODE_LIMIT - count(previous?.nodes))} 个位置。本次操作未加入，请减少数量或使用其他画布。`;
  if (edges > edgeLimit) return `画布最多新增至 ${FREE_CANVAS_EDGE_LIMIT} 条连线，当前剩余 ${Math.max(0, FREE_CANVAS_EDGE_LIMIT - count(previous?.edges))} 条。本次操作未加入，请减少连接数量。`;
  return null;
}

export function freeCanvasCapacityNotice(graph: CapacityGraph): string | null {
  const nodes = count(graph?.nodes), edges = count(graph?.edges);
  if (nodes > FREE_CANVAS_NODE_LIMIT || edges > FREE_CANVAS_EDGE_LIMIT) return `此画布含 ${nodes} 个节点、${edges} 条连线，已超过新增上限。原有内容完整保留，可编辑或移除。`;
  if (nodes === FREE_CANVAS_NODE_LIMIT || edges === FREE_CANVAS_EDGE_LIMIT) return `画布已达到容量上限（${nodes}/${FREE_CANVAS_NODE_LIMIT} 节点，${edges}/${FREE_CANVAS_EDGE_LIMIT} 连线）。`;
  return null;
}
