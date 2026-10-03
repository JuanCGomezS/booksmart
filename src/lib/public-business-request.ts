import { FunctionsError, type Functions } from 'firebase/functions';
import type {
  PublicBookingProduct,
  PublicBookingService,
  PublicBookingStaff,
  PublicCatalogItem,
} from './types.ts';

export type PublicBusinessCallableResponse = {
  business: Record<string, unknown> & { id: string; bookingEnabledUntil?: string };
  products: PublicBookingProduct[];
  catalog?: PublicCatalogItem[];
  services: PublicBookingService[];
  staff: PublicBookingStaff[];
};

const ERROR_CODES = {
  INVALID_ARGUMENT: 'invalid-argument',
  NOT_FOUND: 'not-found',
  PERMISSION_DENIED: 'permission-denied',
  UNAUTHENTICATED: 'unauthenticated',
  RESOURCE_EXHAUSTED: 'resource-exhausted',
  DEADLINE_EXCEEDED: 'deadline-exceeded',
  UNAVAILABLE: 'unavailable',
  INTERNAL: 'internal',
} as const;

export async function requestPublicBusinessData(
  functions: Functions,
  slug: string,
): Promise<PublicBusinessCallableResponse> {
  const origin =
    functions.customDomain?.replace(/\/$/, '') ||
    `https://${functions.region}-${functions.app.options.projectId}.cloudfunctions.net`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    // This endpoint authorizes anonymous public DTOs; protected callables must keep the SDK path.
    const response = await fetch(`${origin}/getPublicBusinessBySlug`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { slug } }),
      credentials: 'omit',
      signal: controller.signal,
    });
    const envelope = await response.json().catch(() => {
      if (controller.signal.aborted) {
        throw new FunctionsError('deadline-exceeded', 'Public business request timed out.');
      }
      throw new FunctionsError(
        response.status >= 500 ? 'unavailable' : 'internal',
        'Invalid public business response.',
      );
    });
    if (!envelope || typeof envelope !== 'object') {
      throw new FunctionsError('internal', 'Invalid public business response.');
    }
    if (envelope.error) {
      const status = envelope.error.status;
      const code = Object.hasOwn(ERROR_CODES, status)
        ? ERROR_CODES[status as keyof typeof ERROR_CODES]
        : 'internal';
      throw new FunctionsError(code, 'Public business request failed.');
    }
    if (!response.ok) {
      throw new FunctionsError(
        response.status >= 500 ? 'unavailable' : 'internal',
        'Public business request failed.',
      );
    }
    const data = envelope.data ?? envelope.result;
    if (!data || typeof data !== 'object' || typeof data.business?.id !== 'string') {
      throw new FunctionsError('internal', 'Invalid public business response.');
    }
    return data as PublicBusinessCallableResponse;
  } catch (cause) {
    if (cause instanceof FunctionsError) throw cause;
    if (controller.signal.aborted) {
      throw new FunctionsError('deadline-exceeded', 'Public business request timed out.');
    }
    throw new FunctionsError(
      cause instanceof SyntaxError ? 'internal' : 'unavailable',
      'Could not load the public business.',
    );
  } finally {
    clearTimeout(timeout);
  }
}
