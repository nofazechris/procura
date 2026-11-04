import { handle, ok } from "@/lib/api";
import { requireAccess } from "@/lib/guard";
import { servConfigured, servModel } from "@/lib/server/serv";

export const runtime = "nodejs";

/** Whether the agent can run. Reveals only a yes/no and the model name, never the key. */
export const GET = handle(async (req: Request) => {
  await requireAccess(req, "business:read");
  const configured = servConfigured();
  return ok({ configured, model: configured ? servModel() : null });
});
