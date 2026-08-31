type ProfileRecordId = string | number;

function recordKey(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const id = (value as { id?: unknown }).id;
  if (typeof id !== "string" && typeof id !== "number") return null;
  return `${typeof id}:${id}`;
}

export function mergeProfileRecords<T>(
  stored: readonly T[],
  incoming: readonly T[],
  deletedIds: readonly ProfileRecordId[] = [],
) {
  const deletedKeys = new Set(deletedIds.map((id) => `${typeof id}:${id}`));
  const incomingKeys = new Set<string>();
  const merged: T[] = [];

  for (const item of incoming) {
    const key = recordKey(item);
    if (!key || deletedKeys.has(key) || incomingKeys.has(key)) continue;
    incomingKeys.add(key);
    merged.push(item);
  }

  for (const item of stored) {
    const key = recordKey(item);
    if (!key || deletedKeys.has(key) || incomingKeys.has(key)) continue;
    incomingKeys.add(key);
    merged.push(item);
  }

  return merged;
}
