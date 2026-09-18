export type MonitorErrorCode =
  "INVALID_USERNAME" | "OFFLINE" | "CONNECTION_FAILED" | "CONNECTION_CANCELLED";

export interface MonitorErrorOptions {
  cause?: unknown;
}

export class MonitorError extends Error {
  readonly code: MonitorErrorCode;

  constructor(code: MonitorErrorCode, message: string, options?: MonitorErrorOptions) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "MonitorError";
    this.code = code;
  }
}

export function normalizeMonitorError(
  error: unknown,
  fallbackCode: MonitorErrorCode = "CONNECTION_FAILED",
): MonitorError {
  if (error instanceof MonitorError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  return new MonitorError(fallbackCode, message || "The monitoring connection failed.", {
    cause: error,
  });
}
