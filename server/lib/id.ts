import { randomUUID } from 'node:crypto';

/** Server-side UUID v4. */
export function newId(): string {
  return randomUUID();
}
