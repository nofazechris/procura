import { getAuthTables } from "better-auth/db";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "@procura/database/schema";

/**
 * Better Auth reads and writes its own tables. If our Drizzle definitions drift from the model
 * it expects (for example after a version bump), signup breaks at runtime. Catch that here.
 */
describe("Better Auth schema compatibility", () => {
  const expected = getAuthTables({ emailAndPassword: { enabled: true } });
  const ours = { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification };

  for (const [model, def] of Object.entries(expected)) {
    it(`${model} table has every field Better Auth expects`, () => {
      const table = ours[model as keyof typeof ours];
      expect(table, `missing table for ${model}`).toBeDefined();
      const columns = Object.keys(getTableColumns(table));
      expect(columns).toContain("id");
      for (const field of Object.keys(def.fields)) {
        expect(columns, `${model}.${field}`).toContain(field);
      }
    });
  }
});
