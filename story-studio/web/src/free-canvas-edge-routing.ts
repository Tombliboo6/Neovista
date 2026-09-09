export type FreeCanvasRoutePoint = { x: number; y: number };

export type FreeCanvasEdgeRouteInput = {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourceLane?: number;
  targetLane?: number;
  lead?: number;
  radius?: number;
};

export type FreeCanvasEdgeRoute = {
  path: string;
  points: FreeCanvasRoutePoint[];
  sourceBranchX: number;
  targetMergeX: number;
  middleY: number;
  forward: boolean;
};

const nearlyEqual = (a: number, b: number) => Math.abs(a - b) < 0.75;
const distance = (a: FreeCanvasRoutePoint, b: FreeCanvasRoutePoint) => Math.hypot(b.x - a.x, b.y - a.y);

function compactOrthogonalPoints(points: FreeCanvasRoutePoint[]) {
  const deduplicated = points.filter((point, index) => index === 0 || !nearlyEqual(point.x, points[index - 1].x) || !nearlyEqual(point.y, points[index - 1].y));
  return deduplicated.filter((point, index) => {
    if (index === 0 || index === deduplicated.length - 1) return true;
    const previous = deduplicated[index - 1];
    const next = deduplicated[index + 1];
    return !((nearlyEqual(previous.x, point.x) && nearlyEqual(point.x, next.x)) || (nearlyEqual(previous.y, point.y) && nearlyEqual(point.y, next.y)));
  });
}

function moveTowards(from: FreeCanvasRoutePoint, to: FreeCanvasRoutePoint, amount: number): FreeCanvasRoutePoint {
  const length = distance(from, to);
  if (!length) return from;
  const ratio = amount / length;
  return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
}

function formatCoordinate(value: number) {
  return Number(value.toFixed(2));
}

export function roundedOrthogonalPath(rawPoints: FreeCanvasRoutePoint[], radius = 12) {
  const points = compactOrthogonalPoints(rawPoints);
  if (points.length < 2) return "";
  let path = `M ${formatCoordinate(points[0].x)} ${formatCoordinate(points[0].y)}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];
    const cornerRadius = Math.min(radius, distance(previous, corner) / 2, distance(corner, next) / 2);
    const before = moveTowards(corner, previous, cornerRadius);
    const after = moveTowards(corner, next, cornerRadius);
    path += ` L ${formatCoordinate(before.x)} ${formatCoordinate(before.y)} Q ${formatCoordinate(corner.x)} ${formatCoordinate(corner.y)} ${formatCoordinate(after.x)} ${formatCoordinate(after.y)}`;
  }
  const last = points[points.length - 1];
  return `${path} L ${formatCoordinate(last.x)} ${formatCoordinate(last.y)}`;
}

export function buildFreeCanvasEdgeRoute(input: FreeCanvasEdgeRouteInput): FreeCanvasEdgeRoute {
  const lead = Math.max(24, input.lead ?? 36);
  const forward = input.targetX - input.sourceX >= lead * 2 + 24;
  const sourceBranchX = input.sourceX + lead;
  const targetMergeX = input.targetX - lead;
  const laneOffset = (input.sourceLane ?? 0) * 16 + (input.targetLane ?? 0) * 9;
  const middleY = forward
    ? (input.sourceY + input.targetY) / 2 + laneOffset
    : Math.min(input.sourceY, input.targetY) - 144 - Math.abs(laneOffset);
  const points = [
    { x: input.sourceX, y: input.sourceY },
    { x: sourceBranchX, y: input.sourceY },
    { x: sourceBranchX, y: middleY },
    { x: targetMergeX, y: middleY },
    { x: targetMergeX, y: input.targetY },
    { x: input.targetX, y: input.targetY },
  ];
  return {
    path: roundedOrthogonalPath(points, input.radius ?? 12),
    points,
    sourceBranchX,
    targetMergeX,
    middleY,
    forward,
  };
}
