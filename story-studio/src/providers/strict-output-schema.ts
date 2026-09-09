type Schema = Record<string, unknown>;

const isRecord = (value: unknown): value is Schema => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const schemaMaps = new Set(['properties', '$defs', 'definitions', 'patternProperties', 'dependentSchemas']);
const schemaLists = new Set(['anyOf', 'oneOf', 'allOf', 'prefixItems']);
const schemaValues = new Set(['items', 'additionalProperties', 'not', 'if', 'then', 'else', 'contains', 'propertyNames']);

/** Remove transport-only unsupported constraints, preserving property names and the domain schema. */
export function normalizeStrictOutputSchema(schema: Schema): Schema {
  function normalize(value: unknown): unknown {
    if (!isRecord(value)) return structuredClone(value);
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'uniqueItems').map(([key, child]) => {
      if (schemaMaps.has(key) && isRecord(child)) return [key, Object.fromEntries(Object.entries(child).map(([name, item]) => [name, normalize(item)]))];
      if (schemaLists.has(key) && Array.isArray(child)) return [key, child.map(normalize)];
      if (schemaValues.has(key)) return [key, Array.isArray(child) ? child.map(normalize) : normalize(child)];
      return [key, structuredClone(child)];
    }));
  }
  return normalize(schema) as Schema;
}

/** Inspect the strict request contract before any network request; do not rewrite required fields. */
export function strictOutputSchemaIssues(schema: Schema): string[] {
  const issues: string[] = [];
  if (schema.type !== 'object' || schema.anyOf !== undefined) issues.push('$: 根结构必须为 object，不能使用根级 anyOf');
  function inspect(value: unknown, path: string): void {
    if (!isRecord(value)) return;
    const types = Array.isArray(value.type) ? value.type : [value.type];
    if (types.includes('object') || isRecord(value.properties)) {
      if (!isRecord(value.properties)) issues.push(`${path}: object 缺少 properties`);
      const keys = Object.keys(isRecord(value.properties) ? value.properties : {});
      const required = Array.isArray(value.required) ? value.required : [];
      if (!Array.isArray(value.required)) issues.push(`${path}: object 缺少 required`);
      const missing = keys.filter(key => !required.includes(key));
      const extra = required.filter(key => typeof key !== 'string' || !keys.includes(key));
      if (missing.length) issues.push(`${path}.required: 缺少 ${missing.join(', ')}`);
      if (extra.length) issues.push(`${path}.required: 包含未声明字段 ${extra.join(', ')}`);
      if (new Set(required).size !== required.length) issues.push(`${path}.required: 字段重复`);
      if (value.additionalProperties !== false) issues.push(`${path}: additionalProperties 必须为 false`);
    }
    if (types.includes('array') && !isRecord(value.items)) issues.push(`${path}: array 缺少有效 items`);
    if (Array.isArray(value.enum) && value.enum.length === 0) issues.push(`${path}: enum 不能为空`);
    for (const [key, child] of Object.entries(value)) {
      if (schemaMaps.has(key) && isRecord(child)) for (const [name, item] of Object.entries(child)) inspect(item, `${path}.${key}.${name}`);
      else if (schemaLists.has(key) && Array.isArray(child)) child.forEach((item, index) => inspect(item, `${path}.${key}[${index}]`));
      else if (schemaValues.has(key)) inspect(child, `${path}.${key}`);
    }
  }
  inspect(schema, '$');
  return issues;
}
