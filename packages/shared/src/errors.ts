/**
 * A domain failure with a stable code and the HTTP status the API should use. Services throw
 * these; the API layer turns them into the standard error envelope. Messages are safe to show.
 */
export class ServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 422,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}
