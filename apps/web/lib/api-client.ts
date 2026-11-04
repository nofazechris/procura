export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

let activeBusinessId: string | undefined;

/** With several memberships the API needs to know which business a request is for. */
export function setActiveBusiness(id: string | undefined): void {
  activeBusinessId = id;
}

interface Options {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
}

/** Call the Procura API and unwrap its { success, data, error } envelope. */
export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? "GET",
      credentials: "same-origin",
      headers: {
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(activeBusinessId ? { "x-business-id": activeBusinessId } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
  } catch {
    throw new ApiClientError("NETWORK", "Could not reach Procura. Check your connection and try again.", 0);
  }
  const json = (await res.json().catch(() => null)) as
    | { success: boolean; data?: T; error?: { code: string; message: string; details?: unknown } }
    | null;
  if (!res.ok || !json?.success) {
    throw new ApiClientError(
      json?.error?.code ?? "UNKNOWN", json?.error?.message ?? "Something went wrong. Please try again.",
      res.status, json?.error?.details,
    );
  }
  return json.data as T;
}
