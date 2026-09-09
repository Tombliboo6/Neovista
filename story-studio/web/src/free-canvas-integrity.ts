import type { FreeCanvasNode } from './FreeCanvas';

export function hasActiveCanvasGeneration(graph: { nodes: FreeCanvasNode[] }): boolean {
  return graph.nodes.some(node => ['submitting', 'queued', 'running'].includes(node.generation?.status || ''));
}

export function canvasRemovalError(before: { nodes: FreeCanvasNode[] }, after: { nodes: FreeCanvasNode[] }): string | null {
  const retained = new Set(after.nodes.map(node => node.id));
  return before.nodes.some(node => !retained.has(node.id) && hasActiveCanvasGeneration({ nodes: [node] }))
    ? '节点任务正在执行，请等待结果返回后再删除或撤销移除。' : null;
}
