import { HttpsError } from 'firebase-functions/v2/https';

export const cancellationNoteMax = 500;

export function parseCancellationNote(value: unknown): string {
  if (typeof value !== 'string')
    throw new HttpsError('invalid-argument', 'A cancellation note is required.');
  const note = value.trim();
  if (!note || note.length > cancellationNoteMax)
    throw new HttpsError('invalid-argument', 'A cancellation note is required.');
  return note;
}
