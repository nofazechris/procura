import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { procurementItems, procurementRequests, recordAudit, suppliers, businesses } from "@procura/database";
import { CALL_PRICE } from "@procura/procurement";
import { ServiceError } from "@procura/shared";
import { handle, notFound, ok, parseId, readJson } from "@/lib/api";
import { inTenant, requireAccess } from "@/lib/guard";
import { draftCallScript } from "@/lib/server/agent";
import { limitPerHour } from "@/lib/server/rate-limit";
import { servConfigured } from "@/lib/server/serv";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ requestId: z.string().uuid().optional() });


/**
 * Drafts what the agent would say on a call to a seller. This is a rehearsal for a person to read:
 * nothing is dialled, nobody is contacted and nothing is spent. A real call is a separate step that
 * is not switched on.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = parseId((await ctx.params).id, "seller id");
  const body = Body.parse(await readJson(req).catch(() => ({})));
  const access = await requireAccess(req, "suppliers:read");
  if (!servConfigured()) throw new ServiceError("SERV_NOT_CONFIGURED", "SERV Reasoning is not connected yet.", 503);
  limitPerHour(`call-script:${access.userId}`, 20);

  const facts = await inTenant(access, async (tx) => {
    const [s] = await tx.select().from(suppliers).where(and(eq(suppliers.id, id), eq(suppliers.businessId, access.businessId)));
    if (!s) return null;
    if (s.sourceType === "demo") throw new ServiceError("SELLER_NOT_CALLABLE", "This is a fictional demo seller. There is no one to call.", 422);
    if (s.sourceType === "marketplace") throw new ServiceError("SELLER_NOT_CALLABLE", "Marketplace sellers are bought from at checkout. They are not called.", 422);
    const [b] = await tx.select({ currency: businesses.defaultCurrency }).from(businesses).where(eq(businesses.id, access.businessId));
    let wants: { name: string; quantity: string; unit: string }[] = [];
    let budget: string | null = null;
    let currency = b?.currency ?? "USD";
    if (body.requestId) {
      const [r] = await tx.select().from(procurementRequests).where(and(eq(procurementRequests.id, body.requestId), eq(procurementRequests.businessId, access.businessId)));
      if (!r) throw new ServiceError("NOT_FOUND", "Request not found.", 404);
      const items = await tx.select().from(procurementItems).where(eq(procurementItems.requestId, r.id));
      wants = items.map((i) => ({ name: i.productName, quantity: String(i.quantity), unit: i.unit ?? "" }));
      budget = r.budgetAmount ? String(r.budgetAmount) : null;
      currency = r.currency;
    }
    return { seller: s.legalName ?? s.name, place: [s.city, s.countryCode].filter(Boolean).join(", ") || null, wants, budget, currency };
  });
  if (!facts) throw notFound("Seller");

  const script = await draftCallScript({ ...facts, forPerson: access.name.split(" ")[0] ?? "the customer" });
  const { model, usage, ...draft } = script;

  await inTenant(access, (tx) => recordAudit(tx, {
    businessId: access.businessId, actorType: "agent", actorId: access.userId, action: "agent.call_script_drafted",
    resourceType: "supplier", resourceId: id, metadata: { model, usage, placed: false },
  }));

  return ok({ ...draft, model, placed: false, price: CALL_PRICE, currency: "USD" });
});
