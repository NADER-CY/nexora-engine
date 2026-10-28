/**
 * Structured NEXORA errors. Every failure carries a stable machine code, a
 * human message with an actionable hint, and optional bounded details. Raw
 * inputs are never embedded in errors.
 */
export class NexoraError extends Error {
  /**
   * @param {string} code stable identifier, e.g. "limit_exceeded"
   * @param {string} message human-readable description
   * @param {{hint?: string, details?: Record<string, unknown>, cause?: unknown, retryable?: boolean}} [extra]
   */
  constructor(code, message, extra = {}) {
    super(message, extra.cause === undefined ? undefined : { cause: extra.cause });
    this.name = "NexoraError";
    this.code = code;
    this.hint = extra.hint;
    this.details = extra.details;
    this.retryable = extra.retryable ?? false;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.hint ? { hint: this.hint } : {}),
      ...(this.details ? { details: this.details } : {}),
      retryable: this.retryable,
    };
  }
}

export const ErrorCodes = Object.freeze({
  INVALID_ARGUMENT: "invalid_argument",
  LIMIT_EXCEEDED: "limit_exceeded",
  TIMEOUT: "timeout",
  CANCELLED: "cancelled",
  NOT_FOUND: "not_found",
  OUT_OF_SCOPE: "out_of_scope",
  PATH_REJECTED: "path_rejected",
  CDP_UNAVAILABLE: "cdp_unavailable",
  CDP_PROTOCOL: "cdp_protocol_error",
  STATE: "invalid_state",
  INTERNAL: "internal_error",
});

/** Convert any thrown value into a bounded, serializable error object. */
export function toErrorObject(error) {
  if (error instanceof NexoraError) return error.toJSON();
  const message = error instanceof Error ? error.message : String(error);
  const code =
    error && typeof error === "object" && typeof error.code === "string" && /^[A-Z_]{2,40}$/.test(error.code)
      ? `system_${error.code.toLowerCase()}`
      : ErrorCodes.INTERNAL;
  return { code, message: message.slice(0, 500), retryable: false };
}
