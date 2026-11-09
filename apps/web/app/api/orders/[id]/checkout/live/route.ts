import { z } from "zod";
import { handle, ok, parseId, readJson } from "@/lib/api";
import { requireAccess } from "@/lib/guard";
import { planLiveCheckout, runLiveCheckout } from "@/lib/server/checkout-live";
import { limitPerHour } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 300;

const Shipping = z.object({
  name: z.string().max(100), email: z.string().max(200), phone: z.string().max(30), line1: z.string().max(120), line2: z.string().max(120).optional(),
  city: z.string().max(80), state: z.string().max(40), postal: z.string().max(20), country: z.string().length(2),
});

const Body = z.object({
  sessionId: z.string().uuid(),
  maxTotal: z.string().regex(/^\d{1,6}(\.\d{1,2})?$/).optional(),
  shipping: Shipping.optional(),
  /** The person pressed the pay button after reading what it would hold. */
  confirmed: z.literal(true),
});

/** What paying this order for real would hold, and what is still missing. Reads only: nothing is spent. */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = parseId((await ctx.params).id, "order id");
  const access = await requireAccess(req, "passport:manage");
  return ok(await planLiveCheckout(access, id));
});

/**
 * Pays an approved Amazon order from the Passport wallet. Needs the permission to spend and an explicit
 * confirmation. Every check runs before any money moves, and Passport enforces the session's limits again.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = parseId((await ctx.params).id, "order id");
  const body = Body.parse(await readJson(req));
  const access = await requireAccess(req, "passport:manage");
  limitPerHour(`checkout:${access.userId}`, 10);
  return ok(await runLiveCheckout(access, id, {
    sessionId: body.sessionId, confirmed: body.confirmed,
    ...(body.maxTotal ? { maxTotal: body.maxTotal } : {}), ...(body.shipping ? { shipping: body.shipping } : {}),
  }));
});
