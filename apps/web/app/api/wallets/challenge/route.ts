import { WalletChallengeRequestSchema } from "@procura/shared";
import { handle, ok, readJson } from "@/lib/api";
import { serverEnv } from "@/lib/env";
import { requireAccess } from "@/lib/guard";
import { issueChallenge } from "@/lib/server/wallet";

export const runtime = "nodejs";

/** Step 1 of linking: a challenge bound to this user, business, address, network and time. */
export const POST = handle(async (req: Request) => {
  const body = WalletChallengeRequestSchema.parse(await readJson(req));
  const access = await requireAccess(req, "wallet:manage");
  return ok(issueChallenge({
    domain: new URL(serverEnv().NEXT_PUBLIC_APP_URL).host, address: body.address, chainId: body.chainId,
    businessId: access.businessId, userId: access.userId,
  }));
});
