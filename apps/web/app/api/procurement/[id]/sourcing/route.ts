import { z } from "zod";
import { DemoSupplierProvider, runSourcing } from "@procura/procurement";
import { badRequest, handle, ok, parseId, readJson } from "@/lib/api";
import { serverEnv } from "@/lib/env";
import { inTenant, requireAccess } from "@/lib/guard";

export const runtime = "nodejs";

const Body = z.object({ provider: z.literal("demo").default("demo") });

/**
 * Discover suppliers and collect quotations. Only the demo provider exists today. Until the
 * background worker (Phase 7) takes over, this runs the discovery and quotation stages inline.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = parseId((await ctx.params).id, "request id");
  const body = Body.safeParse(await readJson(req).catch(() => ({})));
  if (!body.success) throw badRequest("PROVIDER_UNAVAILABLE", "Only the demo supplier provider is available.");

  const access = await requireAccess(req, "procurement:control");
  const recipient = serverEnv().DEMO_RECIPIENT_ADDRESS;
  const provider = new DemoSupplierProvider(recipient ? { recipientOverride: recipient } : {});
  const summary = await inTenant(access, (tx, c) => runSourcing(tx, c, id, provider));
  return ok(summary);
});
