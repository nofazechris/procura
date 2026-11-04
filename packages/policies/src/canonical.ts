export interface FingerprintInput {
  supplierId: string;
  currency: string;
  paymentAsset: string;
  recipientAddress: string;
  subtotal: string;
  deliveryCost: string;
  totalAmount: string;
  items: { description: string; quantity: string; unitPrice: string; totalPrice: string }[];
}

/**
 * The exact text that is hashed to fingerprint an order: everything that determines what gets
 * paid and to whom, in a stable order. Pure (no Node imports), so the server hashes it with
 * Node's crypto and the browser with WebCrypto and both get the same digest.
 */
export function canonicalOrder(input: FingerprintInput): string {
  return JSON.stringify({
    s: input.supplierId,
    c: input.currency,
    a: input.paymentAsset,
    r: input.recipientAddress.toLowerCase(),
    sub: input.subtotal,
    del: input.deliveryCost,
    tot: input.totalAmount,
    items: [...input.items]
      .map((i) => [i.description, i.quantity, i.unitPrice, i.totalPrice])
      .sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))),
  });
}
