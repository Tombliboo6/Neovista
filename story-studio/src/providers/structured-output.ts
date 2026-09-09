import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
const validators = new Map<string, ReturnType<typeof ajv.compile>>();

export class StructuredOutputValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`返回结构未通过校验：${issues.join('；')}`);
    this.name = 'StructuredOutputValidationError';
    this.issues = issues;
  }
}

/** Validate without coercing, removing, or inventing model-authored content. */
export function validateStructuredOutput(value: unknown, schema: Record<string, unknown>): void {
  const key = JSON.stringify(schema);
  let validate = validators.get(key);
  if (!validate) {
    validate = ajv.compile(schema);
    if (validators.size >= 100) validators.clear();
    validators.set(key, validate);
  }
  if (!validate(value)) {
    throw new StructuredOutputValidationError((validate.errors ?? []).slice(0, 30).map(error =>
      `${error.instancePath || '/'}${error.keyword === 'required' ? `/${error.params.missingProperty}` : ''}: ${error.message}`
    ));
  }
}

export function executableOutputSchema<T>(schema: Record<string, unknown>) {
  return {
    validate(value: unknown): { success: true; value: T } | { success: false; error: Error } {
      try { validateStructuredOutput(value, schema); return { success: true, value: value as T }; }
      catch (error) { return { success: false, error: error instanceof Error ? error : new Error(String(error)) }; }
    },
  };
}
