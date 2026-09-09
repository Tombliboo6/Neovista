import type {
  ApprovalState,
  ReviewDecision,
  VersionedEntity
} from '../domain/contracts.js';

export function applyReviewDecision<T extends VersionedEntity>(
  entity: T,
  decision: ReviewDecision
): T {
  if (decision.entityId !== entity.id || decision.entityVersion !== entity.version) {
    throw new Error('Review decision does not match the entity version under review.');
  }

  const approval: ApprovalState =
    decision.action === 'approve' ? 'approved' : 'rejected';

  return {
    ...entity,
    approval,
    updatedAt: decision.createdAt
  };
}

export function requireApprovedVersion(
  entity: VersionedEntity,
  decisions: readonly ReviewDecision[]
): ReviewDecision {
  const approval = decisions.find(
    (decision) =>
      decision.entityId === entity.id &&
      decision.entityVersion === entity.version &&
      decision.action === 'approve'
  );

  if (entity.approval !== 'approved' || !approval) {
    throw new Error(`Entity ${entity.id} version ${entity.version} is not approved.`);
  }

  return approval;
}
