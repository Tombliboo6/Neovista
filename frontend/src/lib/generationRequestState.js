export function clearGenerationRequestState() {
  return {
    activeGenerationController: null,
    isGenerationCancelable: false,
  };
}

export function createGenerationRequestState() {
  const controller = new AbortController();

  return {
    controller,
    signal: controller.signal,
    nextState: {
      activeGenerationController: controller,
      isGenerationCancelable: true,
    },
  };
}

export function cancelGenerationRequestState(controller) {
  controller?.abort();
  return clearGenerationRequestState();
}

export function isAbortGenerationError(error) {
  return error?.name === 'AbortError' || error?.code === 20;
}

export function buildGenerationButtonState({
  isGenerating,
  isGenerationCancelable,
  hasInput,
}) {
  if (isGenerating && isGenerationCancelable) {
    return { mode: 'cancel', disabled: false };
  }

  if (isGenerating) {
    return { mode: 'loading', disabled: true };
  }

  return { mode: 'send', disabled: !hasInput };
}
