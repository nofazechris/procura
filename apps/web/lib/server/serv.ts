import { z } from "zod";
import { ServiceError } from "@procura/shared";
import { serverEnv } from "../env";

/**
 * SERV Reasoning client (https://docs.openserv.ai/serv-reasoning/api): OpenAI-format chat
 * completions with strict JSON-schema output. The model is never trusted: its output must parse
 * against a schema here, and callers re-validate the values against real data before using them.
 * Errors never include the API key, the prompt or the upstream response body.
 */

export interface ServUsage { promptTokens: number; completionTokens: number; totalTokens: number }
export interface ServResult<T> { data: T; model: string; usage: ServUsage }

export function servConfigured(): boolean {
  return Boolean(serverEnv().SERV_API_KEY);
}

export function servModel(): string {
  return serverEnv().SERV_MODEL;
}

const Completion = z.object({
  model: z.string().optional(),
  choices: z.array(z.object({
    finish_reason: z.string().nullable().optional(),
    message: z.object({ content: z.string().nullable().optional(), refusal: z.string().nullable().optional() }),
  })).min(1),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number(), total_tokens: z.number() }).partial().optional(),
});

/** JSON Schema for strict structured output, from a zod schema. */
export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

export interface ServJsonRequest<S extends z.ZodType> {
  /** SERV requires a system prompt. */
  system: string;
  user: string;
  name: string;
  schema: S;
  timeoutMs?: number;
}

export async function servJson<S extends z.ZodType>(req: ServJsonRequest<S>): Promise<ServResult<z.infer<S>>> {
  const env = serverEnv();
  if (!env.SERV_API_KEY) {
    throw new ServiceError("SERV_NOT_CONFIGURED", "SERV Reasoning is not connected. Add SERV_API_KEY to enable the agent.", 503);
  }

  const send = () => fetch(`${env.SERV_BASE_URL.replace(/\/+$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.SERV_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: env.SERV_MODEL,
      messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }],
      response_format: { type: "json_schema", json_schema: { name: req.name, strict: true, schema: jsonSchemaOf(req.schema) } },
    }),
    signal: AbortSignal.timeout(req.timeoutMs ?? 45_000),
  });

  let res: Response;
  try {
    try {
      res = await send();
    } catch (e) {
      // A network-level failure (a TypeError from fetch) means the request never reached SERV, so one
      // retry cannot double-charge. A timeout is not retried: the call may be running upstream.
      if (!(e instanceof TypeError)) throw e;
      await new Promise((r) => setTimeout(r, 400));
      res = await send();
    }
  } catch (e) {
    console.error("[serv] request failed:", e instanceof Error ? e.name : "unknown");
    throw new ServiceError("SERV_UNAVAILABLE", "The agent could not be reached. Try again in a moment.", 502);
  }

  if (!res.ok) {
    console.error("[serv] upstream status", res.status);
    if (res.status === 429) throw new ServiceError("SERV_RATE_LIMITED", "The agent is busy right now. Try again shortly.", 429);
    if (res.status === 401) throw new ServiceError("SERV_AUTH", "SERV rejected the configured API key.", 502);
    if (res.status === 404) throw new ServiceError("SERV_MODEL", "SERV does not know the configured model.", 502);
    throw new ServiceError("SERV_UNAVAILABLE", "The agent is unavailable right now. Try again in a moment.", 502);
  }

  const body = Completion.safeParse(await res.json().catch(() => null));
  if (!body.success) throw new ServiceError("SERV_BAD_OUTPUT", "The agent returned an unreadable answer.", 502);
  const choice = body.data.choices[0]!;
  if (choice.message.refusal) throw new ServiceError("SERV_REFUSED", "The agent declined to process that request.", 422);
  if (choice.finish_reason === "length") throw new ServiceError("SERV_BAD_OUTPUT", "The agent's answer was cut off. Try a shorter request.", 502);

  let raw: unknown;
  try {
    raw = JSON.parse(choice.message.content ?? "");
  } catch {
    throw new ServiceError("SERV_BAD_OUTPUT", "The agent returned an answer that was not valid JSON.", 502);
  }
  const parsed = req.schema.safeParse(raw);
  if (!parsed.success) throw new ServiceError("SERV_BAD_OUTPUT", "The agent's answer did not match the expected format.", 502);

  const u = body.data.usage ?? {};
  return {
    data: parsed.data,
    model: body.data.model ?? env.SERV_MODEL,
    usage: { promptTokens: u.prompt_tokens ?? 0, completionTokens: u.completion_tokens ?? 0, totalTokens: u.total_tokens ?? 0 },
  };
}
