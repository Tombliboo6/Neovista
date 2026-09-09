import type { FreeCanvasNode, FreeCanvasEdge } from "./FreeCanvas";
export type CanvasClipboard = { nodes: FreeCanvasNode[]; edges: FreeCanvasEdge[] };

export function copyCanvasSelection(nodes: FreeCanvasNode[], edges: FreeCanvasEdge[], ids: Set<string>): CanvasClipboard {
  return structuredClone({ nodes: nodes.filter((node) => ids.has(node.id)), edges: edges.filter((edge) => ids.has(edge.fromNodeId) && ids.has(edge.toNodeId)) });
}

export function pasteCanvasSelection(source: CanvasClipboard, at: { x: number; y: number }, makeId: (kind: string) => string, createdAt: string): CanvasClipboard {
  if (!source.nodes.length) return { nodes: [], edges: [] };
  const idMap = new Map(source.nodes.map((node) => [node.id, makeId("node")]));
  const origin = { x: Math.min(...source.nodes.map((node) => node.x)), y: Math.min(...source.nodes.map((node) => node.y)) };
  const nodes = source.nodes.map((node) => ({
    ...structuredClone(node), id: idMap.get(node.id)!, title: `${node.title} · 副本`.slice(0, 160), createdAt,
    x: node.x - origin.x + Math.round(at.x), y: node.y - origin.y + Math.round(at.y),
    generation: node.generation && ["complete", "partial"].includes(node.generation.status) ? structuredClone(node.generation) : undefined,
    candidateSource: node.candidateSource ? { ...node.candidateSource, nodeId: idMap.get(node.candidateSource.nodeId) ?? node.candidateSource.nodeId } : undefined,
  }));
  const edges = source.edges.filter((edge) => idMap.has(edge.fromNodeId) && idMap.has(edge.toNodeId)).map((edge) => ({ ...structuredClone(edge), id: makeId("edge"), fromNodeId: idMap.get(edge.fromNodeId)!, toNodeId: idMap.get(edge.toNodeId)! }));
  return { nodes, edges };
}
