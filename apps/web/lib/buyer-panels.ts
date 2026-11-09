/**
 * The three things a buyer needs before it can pay: a connected wallet, funds in its Passport
 * wallet, and an approved spending session. They open as dialogs from anywhere in the app (Home,
 * the top bar, a blocked screen), so there is no settings page to hunt for.
 */
export type BuyerPanel = "wallet" | "fund" | "session";
export interface BuyerPanelOptions {
  /** For a session: the amount it should cover, so the form starts with enough. */
  amount?: string;
}

const EVENT = "procura:buyer";

export function openBuyerPanel(panel: BuyerPanel, options: BuyerPanelOptions = {}): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT, { detail: { panel, ...options } }));
}

export function onBuyerPanel(handler: (panel: BuyerPanel, options: BuyerPanelOptions) => void): () => void {
  const listener = (e: Event) => {
    const d = (e as CustomEvent<{ panel: BuyerPanel } & BuyerPanelOptions>).detail;
    handler(d.panel, d.amount ? { amount: d.amount } : {});
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
