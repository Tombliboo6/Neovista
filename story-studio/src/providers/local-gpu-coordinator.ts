export type LocalGpuTaskKind = 'h3-submit' | 'ace-music' | 'image-upscale';

export interface LocalGpuTaskState {
  kind: LocalGpuTaskKind;
  taskId: string;
  label: string;
  startedAt: string;
}

export class LocalGpuBusyError extends Error {
  readonly code = 'local_gpu_busy';
  readonly active: LocalGpuTaskState;

  constructor(active: LocalGpuTaskState) {
    super(`本机GPU正在执行${active.label}，请等待当前任务结束。`);
    this.name = 'LocalGpuBusyError';
    this.active = { ...active };
  }
}

export class LocalGpuCoordinator {
  #active: LocalGpuTaskState | undefined;

  status(): { busy: boolean; active?: LocalGpuTaskState } {
    return this.#active ? { busy: true, active: { ...this.#active } } : { busy: false };
  }

  async runExclusive<T>(input: { kind: LocalGpuTaskKind; taskId: string; label: string }, task: () => Promise<T>): Promise<T> {
    if (this.#active) throw new LocalGpuBusyError(this.#active);
    const active = { ...input, startedAt: new Date().toISOString() };
    this.#active = active;
    try {
      return await task();
    } finally {
      if (this.#active === active) this.#active = undefined;
    }
  }
}
