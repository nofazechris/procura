import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ServiceError, type ApiResponse } from "@procura/shared";

/** An expected failure with a stable machine-readable code. Message is safe to show to users. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const unauthorized = () => new ApiError(401, "UNAUTHENTICATED", "Sign in to continue.");
export const forbidden = (msg = "You do not have permission to do that.") => new ApiError(403, "FORBIDDEN", msg);
export const notFound = (what = "Resource") => new ApiError(404, "NOT_FOUND", `${what} not found.`);
export const badRequest = (code: string, msg: string, details?: unknown) => new ApiError(400, code, msg, details);

export function ok<T>(data: T, status = 200): NextResponse<ApiResponse<T>> {
  return NextResponse.json({ success: true, data }, { status });
}

export function fail(status: number, code: string, message: string, details?: unknown): NextResponse<ApiResponse<never>> {
  return NextResponse.json({ success: false, error: { code, message, ...(details ? { details } : {}) } }, { status });
}

/**
 * Wrap a handler so every route returns the same envelope. Unexpected errors are logged in full
 * on the server and reported to the client as a generic 500, so internals never leak.
 */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof ApiError) return fail(err.status, err.code, err.message, err.details);
      if (err instanceof ServiceError) return fail(err.status, err.code, err.message, err.details);
      if (err instanceof ZodError) {
        return fail(400, "VALIDATION_ERROR", "The request was not valid.", err.issues.map((i) => ({
          path: i.path.join("."), message: i.message,
        })));
      }
      console.error("[api] unhandled error", err);
      return fail(500, "INTERNAL", "Something went wrong on our side. Please try again.");
    }
  };
}

/** Route params arrive as strings; reject anything that is not a UUID before it reaches a query. */
export function parseId(value: string, what = "id"): string {
  if (!z.string().uuid().safeParse(value).success) throw badRequest("INVALID_ID", `Invalid ${what}.`);
  return value;
}

/** Parse a JSON body, turning malformed JSON into a clean 400 instead of a 500. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw badRequest("INVALID_JSON", "Request body must be valid JSON.");
  }
}
