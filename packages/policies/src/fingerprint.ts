import { createHash } from "node:crypto";
import { canonicalOrder, type FingerprintInput } from "./canonical";

export type { FingerprintInput };

/**
 * Stable hash of everything payable. It is recorded when the user approves, and re-computed
 * before execution. If anything payable changed in between, the hashes differ and the payment
 * is refused (Technical PRD s13.3).
 */
export function orderFingerprint(input: FingerprintInput): string {
  return createHash("sha256").update(canonicalOrder(input)).digest("hex");
}
