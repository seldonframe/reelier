export function inertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must be a closed plain object`);
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<PropertyKey, PropertyDescriptor>;
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== "string")) throw new TypeError(`${label} is closed and inert`);
  const result: Record<string, unknown> = {};
  for (const key of keys as string[]) {
    const descriptor = descriptors[key]!;
    if (!descriptor.enumerable || descriptor.get || descriptor.set || !("value" in descriptor)) throw new TypeError(`${label} is closed and inert`);
    result[key] = descriptor.value;
  }
  return result;
}

export function inertArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError(`${label} must be an inert array`);
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<PropertyKey, PropertyDescriptor>;
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key === "symbol")) throw new TypeError(`${label} must be an inert array`);
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 0) throw new TypeError(`${label} must be an inert array`);
  const expected = new Set(["length", ...Array.from({ length }, (_, index) => String(index))]);
  if (keys.length !== expected.size || keys.some(key => !expected.has(key as string))) throw new TypeError(`${label} must be dense and inert`);
  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)]!;
    if (!descriptor.enumerable || descriptor.get || descriptor.set || !("value" in descriptor)) throw new TypeError(`${label} must be dense and inert`);
    result.push(descriptor.value);
  }
  return result;
}
