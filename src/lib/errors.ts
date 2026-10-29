/** Errors that are safe to show to the user. Anything else is logged and reported generically. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, "BAD_REQUEST", message, details);
export const validationFailed = (details: unknown, message = "Some fields are invalid.") =>
  new AppError(422, "VALIDATION_FAILED", message, details);
export const unauthenticated = () => new AppError(401, "UNAUTHENTICATED", "Your session has expired. Sign in again.");
export const forbidden = (message = "You do not have permission to do that.") => new AppError(403, "FORBIDDEN", message);
export const notFound = (what = "Record") => new AppError(404, "NOT_FOUND", `${what} not found.`);
export const conflict = (message: string, details?: unknown) => new AppError(409, "CONFLICT", message, details);
export const tooManyRequests = (retryAfterSeconds: number) =>
  new AppError(429, "RATE_LIMITED", `Too many attempts. Try again in ${Math.ceil(retryAfterSeconds / 60)} minute(s).`, {
    retryAfterSeconds,
  });

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
