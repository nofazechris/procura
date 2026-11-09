import { z } from "zod";
import { CALL_MAX_MINUTES, CALL_PRICE, toE164 } from "@procura/procurement";
import { suppliers } from "@procura/database";
import { and, eq } from "drizzle-orm";
import { handle, notFound, ok, parseId, readJson } from "@/lib/api";
import { inTenant, requireAccess } from "@/lib/guard";
import { listCalls, placeSellerCall, readCallStatus } from "@/lib/server/calls";
import { assertPassportEnabled, passportEnabledFor } from "@/lib/server/passport";
import { limitPerHour } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 120;

const line = z.string().trim().min(1).max(300);
const Body = z.object({
  sessionId: z.string().uuid(),
  script: z.object({ opening: line, questions: z.array(line).min(1).max(6), mustConfirm: z.array(line).max(4), closing: line }),
  /** The person read the script and confirmed that a real person will be phoned. */
  confirmed: z.literal(true),
});

/**
 * Whether a call can be placed (the saved number, the price) and the calls already made. With
 * `callId` and `sessionId` it reads where one call stands. Reads only: nobody is called.
 */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = parseId((await ctx.params).id, "seller id");
  const access = await requireAccess(req, "suppliers:read");
  const url = new URL(req.url);
  const callId = url.searchParams.get("callId");
  if (callId) {
    assertPassportEnabled(access.businessId);
    const sessionId = z.string().uuid().parse(url.searchParams.get("sessionId"));
    return ok({ status: await readCallStatus(access, id, callId, sessionId) });
  }
  const [s] = await inTenant(access, (tx) => tx.select().from(suppliers).where(and(eq(suppliers.id, id), eq(suppliers.businessId, access.businessId))));
  if (!s) throw notFound("Seller");
  const phone = toE164(s.phone);
  return ok({
    enabled: passportEnabledFor(access.businessId), callable: s.sourceType !== "demo" && s.sourceType !== "marketplace",
    phoneHint: phone ? `ending ${phone.slice(-4)}` : null, hasPhone: phone !== null, price: CALL_PRICE, maxMinutes: CALL_MAX_MINUTES, calls: await listCalls(access, id),
  });
});

/** Phones the seller. Needs the permission to spend and an explicit confirmation of the script. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = parseId((await ctx.params).id, "seller id");
  const body = Body.parse(await readJson(req));
  const access = await requireAccess(req, "passport:manage");
  assertPassportEnabled(access.businessId);
  limitPerHour(`call:${access.userId}`, 5);
  limitPerHour(`call-seller:${id}`, 2);
  return ok(await placeSellerCall(access, id, body));
});
