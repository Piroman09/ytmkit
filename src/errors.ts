export type YtmkitErrorCode =
  | 'BAD_INPUT'
  | 'NOT_FOUND'
  | 'UNAVAILABLE'
  | 'AUTH'
  | 'UPSTREAM';

/**
 * The only error class thrown by ytmkit's public methods.
 * The original error, when there is one, is available as `cause`.
 */
export class YtmkitError extends Error {
  readonly code: YtmkitErrorCode;

  constructor(code: YtmkitErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'YtmkitError';
    this.code = code;
  }
}

export function badInput(message: string): YtmkitError {
  return new YtmkitError('BAD_INPUT', message);
}

export function unavailable(message: string, cause?: unknown): YtmkitError {
  return new YtmkitError('UNAVAILABLE', message, cause === undefined ? undefined : { cause });
}

export function upstream(message: string, cause?: unknown): YtmkitError {
  return new YtmkitError('UPSTREAM', message, cause === undefined ? undefined : { cause });
}

/** Wrap an unknown error from youtubei.js without losing it. */
export function wrapUpstream(error: unknown, context: string): YtmkitError {
  if (error instanceof YtmkitError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return upstream(`${context}: ${detail}`, error);
}
