import type { FreeCanvasNode, FreeCanvasEdge } from "./FreeCanvas";

export type CanvasGraph = { nodes: FreeCanvasNode[]; edges: FreeCanvasEdge[] };
type Value = FreeCanvasNode | FreeCanvasEdge;
type FieldChange = { before: unknown; after: unknown };
type ItemChange = { id: string; before?: Value; after?: Value; fields?: Record<string, FieldChange> };
type GraphCommand = { group: number; nodes: ItemChange[]; edges: ItemChange[]; beforeOrder: { nodes: string[]; edges: string[] }; afterOrder: { nodes: string[]; edges: string[] } };
const clone = <T,>(value: T): T => structuredClone(value);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const order = (graph: CanvasGraph) => ({ nodes: graph.nodes.map(item => item.id), edges: graph.edges.map(item => item.id) });
function restoreOrder<T extends Value>(items: T[], ids: string[]): T[] {
  const remaining = new Map(items.map(item => [item.id, item]));
  const ordered: T[] = [];
  for (const id of ids) {
    const item = remaining.get(id);
    if (item) { ordered.push(item); remaining.delete(id); }
  }
  return [...ordered, ...remaining.values()];
}

function changes(before: Value[], after: Value[]): ItemChange[] {
  const previous = new Map(before.map((item) => [item.id, item]));
  const next = new Map(after.map((item) => [item.id, item]));
  return [...new Set([...previous.keys(), ...next.keys()])].flatMap((id): ItemChange[] => {
    const a = previous.get(id), b = next.get(id);
    if (!a || !b) return [{ id, before: clone(a), after: clone(b) }];
    if (a === b) return [];
    const fields: Record<string, FieldChange> = {};
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (key === "id") continue;
      const from = (a as unknown as Record<string, unknown>)[key];
      const to = (b as unknown as Record<string, unknown>)[key];
      if (!same(from, to)) fields[key] = { before: clone(from), after: clone(to) };
    }
    return Object.keys(fields).length ? [{ id, fields }] : [];
  });
}

function mergeChanges(first: ItemChange[], second: ItemChange[]): ItemChange[] {
  const combined = new Map(first.map((change) => [change.id, change]));
  for (const change of second) {
    const earlier = combined.get(change.id);
    if (!earlier) { combined.set(change.id, change); continue; }
    if (earlier.fields && change.fields) {
      for (const [key, field] of Object.entries(change.fields)) {
        earlier.fields[key] = { before: earlier.fields[key] ? earlier.fields[key].before : field.before, after: field.after };
        if (same(earlier.fields[key].before, earlier.fields[key].after)) delete earlier.fields[key];
      }
      if (!Object.keys(earlier.fields).length) combined.delete(change.id);
    } else if (!earlier.fields && change.fields && earlier.after) {
      for (const [key, field] of Object.entries(change.fields)) (earlier.after as unknown as Record<string, unknown>)[key] = clone(field.after);
    } else if (!earlier.fields && !change.fields) {
      earlier.after = change.after;
      if (!earlier.before && !earlier.after) combined.delete(change.id);
    } else {
      // A node edited and then removed in one transaction restores its original fields.
      const original = clone(change.before!);
      for (const [key, field] of Object.entries(earlier.fields!)) (original as unknown as Record<string, unknown>)[key] = clone(field.before);
      combined.set(change.id, { id: change.id, before: original, after: change.after });
    }
  }
  return [...combined.values()];
}

function applyItems<T extends Value>(items: T[], commands: ItemChange[], forward: boolean): T[] {
  const result = new Map(items.map((item) => [item.id, item]));
  for (const command of commands) {
    const current = result.get(command.id);
    if (command.fields) {
      if (!current) continue;
      const patched = { ...current } as unknown as Record<string, unknown>;
      for (const [key, field] of Object.entries(command.fields)) {
        const expected = forward ? field.before : field.after;
        // Later provider/async writes own their fields; an edit cannot roll them back.
        if (!same(patched[key], expected)) continue;
        const value = clone(forward ? field.after : field.before);
        if (value === undefined) delete patched[key]; else patched[key] = value;
      }
      result.set(command.id, patched as unknown as T);
      continue;
    }
    const target = forward ? command.after : command.before;
    if (!target) {
      if (current) {
        // Preserve results that arrived after creation through undo -> redo.
        if (forward) command.before = clone(current); else command.after = clone(current);
        result.delete(command.id);
      }
    } else if (!current) result.set(command.id, clone(target) as T);
  }
  return [...result.values()];
}

export class FreeCanvasHistory {
  private past: GraphCommand[] = [];
  private future: GraphCommand[] = [];
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }

  record(before: CanvasGraph, after: CanvasGraph, group: number) {
    const next = { group, nodes: changes(before.nodes, after.nodes), edges: changes(before.edges, after.edges), beforeOrder: order(before), afterOrder: order(after) };
    if (!next.nodes.length && !next.edges.length && same(next.beforeOrder, next.afterOrder)) return;
    this.future = [];
    const last = this.past.at(-1);
    if (last?.group === group) {
      last.nodes = mergeChanges(last.nodes, next.nodes);
      last.edges = mergeChanges(last.edges, next.edges);
      last.afterOrder = next.afterOrder;
      if (!last.nodes.length && !last.edges.length && same(last.beforeOrder, last.afterOrder)) this.past.pop();
    } else {
      this.past.push(next);
      if (this.past.length > 80) this.past.shift();
    }
  }

  private apply(graph: CanvasGraph, command: GraphCommand, forward: boolean): CanvasGraph {
    const targetOrder = forward ? command.afterOrder : command.beforeOrder;
    const nodes = restoreOrder(applyItems(graph.nodes, command.nodes, forward), targetOrder.nodes);
    const ids = new Set(nodes.map((node) => node.id));
    const edges = restoreOrder(applyItems(graph.edges, command.edges, forward), targetOrder.edges).filter((edge) => ids.has(edge.fromNodeId) && ids.has(edge.toNodeId));
    return { nodes, edges };
  }

  undo(graph: CanvasGraph, accept: (next: CanvasGraph) => boolean = () => true): CanvasGraph {
    const command = this.past.at(-1);
    if (!command) return graph;
    if (!accept(this.apply(graph, clone(command), false))) return graph;
    this.past.pop();
    const result = this.apply(graph, command, false);
    this.future.push(command);
    return result;
  }

  redo(graph: CanvasGraph, accept: (next: CanvasGraph) => boolean = () => true): CanvasGraph {
    const command = this.future.at(-1);
    if (!command) return graph;
    if (!accept(this.apply(graph, clone(command), true))) return graph;
    this.future.pop();
    const result = this.apply(graph, command, true);
    this.past.push(command);
    return result;
  }
}

export function applyCanvasGraphChange(current: CanvasGraph, before: CanvasGraph, after: CanvasGraph): CanvasGraph {
  const nodes = restoreOrder(applyItems(current.nodes, changes(before.nodes, after.nodes), true), order(after).nodes);
  const ids = new Set(nodes.map((node) => node.id));
  return { nodes, edges: restoreOrder(applyItems(current.edges, changes(before.edges, after.edges), true), order(after).edges).filter((edge) => ids.has(edge.fromNodeId) && ids.has(edge.toNodeId)) };
}
