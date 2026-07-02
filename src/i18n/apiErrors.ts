/**
 * Client-side translation of API error envelopes by their **stable machine
 * code** (INTERNATIONALIZATION-STANDARD §3 — never display server prose).
 *
 * The server sends `{ error: <code>, message }`; `message` is only an English
 * fallback for API consumers. UI surfaces call `apiErrorMessage(intl, err)`,
 * which maps the code to a localized react-intl message with a generic fallback
 * for any unknown/new code. The English `defaultMessage`s are extracted into the
 * catalog by `formatjs extract`; Spanish values are added by a translator
 * (structure-only until then — es falls back to English at runtime).
 */
import { defineMessages, type IntlShape } from 'react-intl';

// `defineMessages` keys are arbitrary; the extractor keys the catalog off `id`.
// Ids are namespaced `apiError.<code>` so the catalog groups them together.
const messages = defineMessages({
  validation_error: {
    id: 'apiError.validation_error',
    defaultMessage: 'Please check the details and try again.',
  },
  outside_davis: {
    id: 'apiError.outside_davis',
    defaultMessage: 'That location is outside Davis. Move it inside the map area.',
  },
  not_found: {
    id: 'apiError.not_found',
    defaultMessage: "We couldn't find that. It may have been removed.",
  },
  unauthorized: {
    id: 'apiError.unauthorized',
    defaultMessage: 'Please sign in and try again.',
  },
  too_many_attempts: {
    id: 'apiError.too_many_attempts',
    defaultMessage: 'Too many attempts. Please wait a bit and try again.',
  },
  disabled: {
    id: 'apiError.disabled',
    defaultMessage: 'That feature is not available right now.',
  },
  internal_error: {
    id: 'apiError.internal_error',
    defaultMessage: 'Something went wrong on our end. Please try again.',
  },
  unknown: {
    id: 'apiError.unknown',
    defaultMessage: 'Something went wrong. Please try again.',
  },
});

/** Map a stable error code to its message descriptor. */
const BY_CODE: Record<string, (typeof messages)[keyof typeof messages]> = {
  validation_error: messages.validation_error,
  outside_davis: messages.outside_davis,
  not_found: messages.not_found,
  unauthorized: messages.unauthorized,
  invalid_credentials: messages.unauthorized,
  too_many_attempts: messages.too_many_attempts,
  disabled: messages.disabled,
  internal_error: messages.internal_error,
};

/**
 * Read the stable machine code off a thrown value. Duck-typed on `.code` (an
 * `ApiRequestError` getter) rather than an `instanceof` check so this helper
 * never has to import — and thus stays decoupled from — the api module (which
 * tests routinely `vi.mock`).
 */
function errorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

/**
 * Translate any thrown value into a user-facing message. Prefers the API error
 * code; falls back to a generic localized message for unknown codes, non-API
 * errors (e.g. a network failure), and non-JSON error bodies.
 */
export function apiErrorMessage(intl: IntlShape, err: unknown): string {
  const code = errorCode(err);
  const descriptor = (code && BY_CODE[code]) || messages.unknown;
  return intl.formatMessage(descriptor);
}
