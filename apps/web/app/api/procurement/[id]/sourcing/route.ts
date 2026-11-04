import { eq } from "drizzle-orm";
import { z } from "zod";
import { procurementItems } from "@procura/database";
import { DemoSupplierProvider, runSourcing, type SupplierProvider } from "@procura/procurement";
import { badRequest, handle, ok, parseId, readJson } from "@/lib/api";
import { serverEnv } from "@/lib/env";
import { inTenant, requireAccess } from "@/lib/guard";
import { assertPassportEnabled } from "@/lib/server/passport";
import { limitPerHour } from "@/lib/server/rate-limit";
import { AmazonShopProvider } from "@/lib/server/shop-provider";

export const runtime = "nodejs";

const Body = z.object({ provider: z.enum(["demo", "amazon"]).default("demo") });

/**
 * Discover suppliers and collect quotations. "demo" is the fictional supplier set. "amazon" searches
 * Amazon through Kite Passport (free, buys nothing) and needs Passport enabled for the business.
 * Until the background worker (Phase 7) takes over, this runs the discovery and quotation stages inline.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = parseId((await ctx.params).id, "request id");
  const body = Body.safeParse(await readJson(req).catch(() => ({})));
  if (!body.success) throw badRequest("PROVIDER_UNAVAILABLE", "That supplier source is not available.");

  const access = await requireAccess(req, "procurement:control");
  let provider: SupplierProvider;
  if (body.data.provider === "amazon") {
    assertPassportEnabled(access.businessId);
    limitPerHour(`shop-search:${access.userId}`, 20);
    const shop = new AmazonShopProvider();
    // Search first, outside the transaction, so a slow network call never holds a database connection.
    const items = await inTenant(access, (tx) => tx.select({ name: procurementItems.productName }).from(procurementItems).where(eq(procurementItems.requestId, id)));
    await shop.prefetch(items);
    provider = shop;
  } else {
    const recipient = serverEnv().DEMO_RECIPIENT_ADDRESS;
    provider = new DemoSupplierProvider(recipient ? { recipientOverride: recipient } : {});
  }
  const summary = await inTenant(access, (tx, c) => runSourcing(tx, c, id, provider));
  return ok(summary);
});
