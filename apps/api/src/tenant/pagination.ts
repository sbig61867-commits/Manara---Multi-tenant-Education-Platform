/**
 * Opaque cursor encoding for tenant list endpoints.
 *
 * Rows are ordered by the unique stable key `(created_at, id)` (descending).
 * The cursor is the base64url encoding of `"<createdAt ISO>:" + id` of the
 * last row of the previous page; it is opaque to API consumers.
 */

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}:${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const separator = decoded.lastIndexOf(':');
  if (separator <= 0) {
    return null;
  }
  const iso = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);
  const createdAt = new Date(iso);
  if (Number.isNaN(createdAt.getTime()) || id === '') {
    return null;
  }
  return { createdAt, id };
}
