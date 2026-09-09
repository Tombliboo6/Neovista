export interface RecoverableVideoPrompt {
  segmentKey: string;
  prompt: string;
  status: string;
  stale?: boolean;
  approval?: 'draft' | 'approved' | 'rejected';
  error?: string;
  validationCodes?: string[];
  validationIssues?: string[];
  manualReview?: { reviewedAt: string; previousPrompt: string; validationCodes: string[]; validationIssues: string[]; error?: string };
}

export function isReadyVideoPrompt(item: RecoverableVideoPrompt | undefined): boolean {
  return Boolean(item?.status === 'complete' && !item.stale && item.prompt?.trim());
}

export function confirmVideoPromptDraft<T extends RecoverableVideoPrompt>(item: T, prompt: string, reviewedAt = new Date().toISOString()): T {
  if (!prompt.trim() || item.status === 'running') return item;
  return {
    ...item, prompt: prompt.trim(), status: 'complete', approval: 'approved', stale: false,
    error: undefined, validationCodes: undefined, validationIssues: undefined,
    manualReview: {
      reviewedAt, previousPrompt: item.prompt,
      validationCodes: [...(item.validationCodes || item.manualReview?.validationCodes || [])],
      validationIssues: [...(item.validationIssues || item.manualReview?.validationIssues || [])], error: item.error || item.manualReview?.error,
    },
  };
}

export function approveReadyVideoPrompts<T extends RecoverableVideoPrompt>(items: T[], segmentKeys: string[]): T[] {
  const keys = new Set(segmentKeys);
  return items.map(item => keys.has(item.segmentKey) && isReadyVideoPrompt(item) ? { ...item, approval: 'approved' } : item);
}
