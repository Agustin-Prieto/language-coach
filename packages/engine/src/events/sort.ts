/**
 * Deterministic timestamp ordering shared by the legacy importer and the
 * rebuild path. Sorts by parsed timestamp; the underlying sort is stable
 * (ES2019+), so events with identical timestamps keep their input order.
 * Events carry ISO 8601 timestamps, so lexical order would usually work,
 * but parsing handles mixed UTC/offset notations correctly.
 */
export function sortByTimestamp<T extends { timestamp: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}
