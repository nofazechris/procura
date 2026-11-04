import { desc, eq, getTableColumns } from "drizzle-orm";
import {
  nextDocumentNumber, procurementItems, procurementRequests, recordAudit, user, withTenant,
} from "@procura/database";
import { CreateProcurementRequestSchema } from "@procura/shared";
import { handle, ok, readJson } from "@/lib/api";
import { requireAccess } from "@/lib/guard";

export const runtime = "nodejs";

export const GET = handle(async (req: Request) => {
  const access = await requireAccess(req, "procurement:read");
  const rows = await withTenant({ userId: access.userId, businessId: access.businessId }, (tx) =>
    tx
      .select({ ...getTableColumns(procurementRequests), requestedByName: user.name })
      .from(procurementRequests)
      .leftJoin(user, eq(user.id, procurementRequests.requestedBy))
      .where(eq(procurementRequests.businessId, access.businessId))
      .orderBy(desc(procurementRequests.createdAt))
      .limit(200),
  );
  return ok(rows);
});

/**
 * Creates a draft request. Both entry points (conversational and structured) end up here, so
 * both produce the same record (Design PRD s6). Starting the agent is a separate, explicit step.
 */
export const POST = handle(async (req: Request) => {
  const access = await requireAccess(req, "procurement:create");
  const input = CreateProcurementRequestSchema.parse(await readJson(req));

  const created = await withTenant({ userId: access.userId, businessId: access.businessId }, async (tx) => {
    const requestNumber = await nextDocumentNumber(tx, access.businessId, "procurement_request");
    const [request] = await tx
      .insert(procurementRequests)
      .values({
        businessId: access.businessId,
        requestNumber,
        title: input.title,
        description: input.description ?? null,
        status: "draft",
        budgetAmount: input.budgetAmount,
        currency: input.currency,
        deliveryLocation: input.deliveryLocation ?? null,
        deliveryDeadline: input.deliveryDeadline ? new Date(input.deliveryDeadline) : null,
        priority: input.priority,
        requestedBy: access.userId,
      })
      .returning();
    if (!request) throw new Error("Failed to create request");

    const items = await tx
      .insert(procurementItems)
      .values(
        input.items.map((i) => ({
          businessId: access.businessId,
          requestId: request.id,
          productName: i.productName,
          description: i.description ?? null,
          category: i.category ?? null,
          quantity: i.quantity,
          unit: i.unit,
          specifications: i.specifications,
          preferredBrand: i.preferredBrand ?? null,
        })),
      )
      .returning();

    await recordAudit(tx, {
      businessId: access.businessId, actorType: "user", actorId: access.userId,
      action: "procurement.created", resourceType: "procurement_request", resourceId: request.id,
      newState: { requestNumber, status: "draft", budget: `${input.budgetAmount} ${input.currency}`, itemCount: items.length },
    });
    return { ...request, items };
  });

  return ok(created, 201);
});
