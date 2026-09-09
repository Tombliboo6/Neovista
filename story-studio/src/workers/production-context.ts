import { AsyncLocalStorage } from 'node:async_hooks';

export type ProductionEvent = {
  callId?: string; operation?: string; targetKeys?: string[];
  phase: 'queued' | 'running' | 'validating' | 'completed' | 'failed';
  externalTaskId?: string; elapsedMs?: number; usage?: unknown;
  output?: unknown; error?: string; code?: string; diagnostics?: unknown;
};
export const productionContext = new AsyncLocalStorage<{
  event: (event: ProductionEvent) => void;
  checkpoint: (result: Record<string, unknown>) => void;
}>();

export function productionCheckpoint(result: Record<string, unknown>): void {
  productionContext.getStore()?.checkpoint(result);
}
