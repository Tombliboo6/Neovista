export type AgentTimelineKind = "agent" | "manager" | "workflow" | "manager-command" | "manager-status";

export type AgentTimelineItem<T = unknown> = {
  id: string;
  kind: AgentTimelineKind;
  createdAt: string;
  value: T;
};

const kindOrder: Record<AgentTimelineKind, number> = {
  agent: 0,
  manager: 1,
  workflow: 2,
  "manager-command": 3,
  "manager-status": 4,
};

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function latestTimelineTimestamp(values: Array<string | undefined>, fallback = "1970-01-01T00:00:00.000Z"): string {
  return values.reduce<string>((latest, value) => value && timestamp(value) > timestamp(latest) ? value : latest, fallback);
}

export function orderAgentTimeline<T>(items: AgentTimelineItem<T>[]): AgentTimelineItem<T>[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const timeDifference = timestamp(left.item.createdAt) - timestamp(right.item.createdAt);
      if (timeDifference !== 0) return timeDifference;
      const kindDifference = kindOrder[left.item.kind] - kindOrder[right.item.kind];
      return kindDifference !== 0 ? kindDifference : left.index - right.index;
    })
    .map(({ item }) => item);
}
