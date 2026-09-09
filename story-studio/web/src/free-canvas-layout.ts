export type FreeCanvasLayoutNode = { id: string; x: number; y: number; width?: number; height?: number };
export type FreeCanvasLayoutEdge = { fromNodeId: string; toNodeId: string };

export type FreeCanvasLayoutOptions = {
  gridSize?: number;
  columnGap?: number;
  rowGap?: number;
};

const stableNodeOrder = (a: FreeCanvasLayoutNode, b: FreeCanvasLayoutNode) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id);

/**
 * Builds a stable left-to-right graph layout. Strongly connected nodes share a
 * column, so cycles cannot make the layer calculation diverge.
 */
export function organizeFreeCanvas(
  nodes: FreeCanvasLayoutNode[],
  edges: FreeCanvasLayoutEdge[],
  options: FreeCanvasLayoutOptions = {},
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  if (!nodes.length) return result;

  const gridSize = Math.max(1, Math.round(options.gridSize ?? 22));
  const columnGap = Math.max(gridSize, Math.round((options.columnGap ?? 462) / gridSize) * gridSize);
  const rowGap = Math.max(gridSize, Math.round((options.rowGap ?? 330) / gridSize) * gridSize);
  const sortedNodes = [...nodes].sort(stableNodeOrder);
  const nodeById = new Map(sortedNodes.map((node) => [node.id, node]));
  const adjacency = new Map(sortedNodes.map((node) => [node.id, [] as string[]]));
  edges.forEach((edge) => {
    if (edge.fromNodeId === edge.toNodeId || !nodeById.has(edge.fromNodeId) || !nodeById.has(edge.toNodeId)) return;
    const targets = adjacency.get(edge.fromNodeId)!;
    if (!targets.includes(edge.toNodeId)) targets.push(edge.toNodeId);
  });
  adjacency.forEach((targets) => targets.sort((a, b) => stableNodeOrder(nodeById.get(a)!, nodeById.get(b)!)));

  let nextIndex = 0;
  const indexById = new Map<string, number>();
  const lowLinkById = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const visit = (nodeId: string) => {
    indexById.set(nodeId, nextIndex);
    lowLinkById.set(nodeId, nextIndex);
    nextIndex += 1;
    stack.push(nodeId);
    onStack.add(nodeId);

    adjacency.get(nodeId)!.forEach((targetId) => {
      if (!indexById.has(targetId)) {
        visit(targetId);
        lowLinkById.set(nodeId, Math.min(lowLinkById.get(nodeId)!, lowLinkById.get(targetId)!));
      } else if (onStack.has(targetId)) {
        lowLinkById.set(nodeId, Math.min(lowLinkById.get(nodeId)!, indexById.get(targetId)!));
      }
    });

    if (lowLinkById.get(nodeId) !== indexById.get(nodeId)) return;
    const component: string[] = [];
    while (stack.length) {
      const member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
      if (member === nodeId) break;
    }
    component.sort((a, b) => stableNodeOrder(nodeById.get(a)!, nodeById.get(b)!));
    components.push(component);
  };
  sortedNodes.forEach((node) => { if (!indexById.has(node.id)) visit(node.id); });

  const componentByNode = new Map<string, number>();
  components.forEach((component, componentId) => component.forEach((nodeId) => componentByNode.set(nodeId, componentId)));
  const componentOrder = (componentId: number) => Math.min(...components[componentId].map((nodeId) => sortedNodes.findIndex((node) => node.id === nodeId)));
  const outgoing = new Map(components.map((_component, componentId) => [componentId, new Set<number>()]));
  const indegree = new Map(components.map((_component, componentId) => [componentId, 0]));
  edges.forEach((edge) => {
    const from = componentByNode.get(edge.fromNodeId);
    const to = componentByNode.get(edge.toNodeId);
    if (from === undefined || to === undefined || from === to || outgoing.get(from)!.has(to)) return;
    outgoing.get(from)!.add(to);
    indegree.set(to, indegree.get(to)! + 1);
  });

  const layers = new Map(components.map((_component, componentId) => [componentId, 0]));
  const queue = [...indegree.entries()].filter(([, count]) => count === 0).map(([componentId]) => componentId).sort((a, b) => componentOrder(a) - componentOrder(b));
  while (queue.length) {
    const componentId = queue.shift()!;
    [...outgoing.get(componentId)!].sort((a, b) => componentOrder(a) - componentOrder(b)).forEach((targetId) => {
      layers.set(targetId, Math.max(layers.get(targetId)!, layers.get(componentId)! + 1));
      indegree.set(targetId, indegree.get(targetId)! - 1);
      if (indegree.get(targetId) === 0) {
        queue.push(targetId);
        queue.sort((a, b) => componentOrder(a) - componentOrder(b));
      }
    });
  }

  const nodesByLayer = new Map<number, FreeCanvasLayoutNode[]>();
  components.forEach((component, componentId) => {
    const layer = layers.get(componentId)!;
    const layerNodes = nodesByLayer.get(layer) ?? [];
    layerNodes.push(...component.map((nodeId) => nodeById.get(nodeId)!));
    nodesByLayer.set(layer, layerNodes);
  });
  nodesByLayer.forEach((layerNodes) => layerNodes.sort(stableNodeOrder));

  const originX = Math.floor(Math.min(...nodes.map((node) => node.x)) / gridSize) * gridSize;
  const originY = Math.floor(Math.min(...nodes.map((node) => node.y)) / gridSize) * gridSize;
  const roundedUp = (value: number) => Math.ceil(value / gridSize) * gridSize;
  const width = (node: FreeCanvasLayoutNode) => Number.isFinite(node.width) && node.width! > 0 ? node.width! : 300;
  const height = (node: FreeCanvasLayoutNode) => Number.isFinite(node.height) && node.height! > 0 ? node.height! : 220;
  const rowStep = (node: FreeCanvasLayoutNode) => Math.max(rowGap, roundedUp(height(node) + 88));
  const layerHeight = (list: FreeCanvasLayoutNode[]) => list.reduce((total, node, index) => total + (index === list.length - 1 ? height(node) : rowStep(node)), 0);
  const maxHeight = Math.max(...[...nodesByLayer.values()].map(layerHeight));
  let x = originX;
  [...nodesByLayer.entries()].sort(([a], [b]) => a - b).forEach(([, layerNodes]) => {
    let y = originY + Math.round((maxHeight - layerHeight(layerNodes)) / (2 * gridSize)) * gridSize;
    layerNodes.forEach((node) => { result.set(node.id, { x, y }); y += rowStep(node); });
    x += Math.max(columnGap, roundedUp(Math.max(...layerNodes.map(width)) + 162));
  });
  return result;
}
