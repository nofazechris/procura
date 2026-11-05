/**
 * The three things a buyer needs before it can pay: a connected wallet, funds in its Passport
 * wallet, and an approved spending session. They open as dialogs from anywhere in the app (Home,
 * the top bar, a blocked screen), so there is no settings page to hunt for.
 */
export type BuyerPanel = "wallet" | "fund" | "session";

const EVENT = "procura:buyer";

export function openBuyerPanel(panel: BuyerPanel): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<BuyerPanel>(EVENT, { detail: panel }));
}

export function onBuyerPanel(handler: (panel: BuyerPanel) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<BuyerPanel>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
