import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGenerationButtonState,
  cancelGenerationRequestState,
  clearGenerationRequestState,
  createGenerationRequestState,
  isAbortGenerationError,
} from './generationRequestState.js';

test('createGenerationRequestState returns a cancelable request with an AbortController signal', () => {
  const requestState = createGenerationRequestState();

  assert.equal(requestState.nextState.isGenerationCancelable, true);
  assert.equal(requestState.nextState.activeGenerationController, requestState.controller);
  assert.equal(requestState.signal, requestState.controller.signal);
});

test('cancelGenerationRequestState aborts the in-flight request and clears store state', () => {
  const requestState = createGenerationRequestState();
  const nextState = cancelGenerationRequestState(requestState.controller);

  assert.equal(requestState.controller.signal.aborted, true);
  assert.deepEqual(nextState, clearGenerationRequestState());
});

test('buildGenerationButtonState shows cancel only while the upstream request is still cancelable', () => {
  assert.deepEqual(
    buildGenerationButtonState({ isGenerating: true, isGenerationCancelable: true, hasInput: true }),
    { mode: 'cancel', disabled: false },
  );
  assert.deepEqual(
    buildGenerationButtonState({ isGenerating: true, isGenerationCancelable: false, hasInput: true }),
    { mode: 'loading', disabled: true },
  );
  assert.deepEqual(
    buildGenerationButtonState({ isGenerating: false, isGenerationCancelable: false, hasInput: false }),
    { mode: 'send', disabled: true },
  );
});

test('isAbortGenerationError only matches abort-like failures', () => {
  assert.equal(isAbortGenerationError({ name: 'AbortError' }), true);
  assert.equal(isAbortGenerationError({ code: 20 }), true);
  assert.equal(isAbortGenerationError(new Error('network failed')), false);
});
