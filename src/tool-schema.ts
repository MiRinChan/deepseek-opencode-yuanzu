/**
 * Preserve the AI SDK schema wrapper used by OpenCode while replacing its
 * provider-visible JSON Schema. Plain test doubles receive the JSON directly.
 */
export function compatibleInputSchema(nativeSchema: unknown, jsonSchema: object): unknown {
  if (!nativeSchema || typeof nativeSchema !== "object") return jsonSchema
  const schema = Object.create(nativeSchema) as Record<string, unknown>
  Object.defineProperty(schema, "jsonSchema", {
    configurable: true,
    enumerable: true,
    get: () => jsonSchema,
  })
  return schema
}
