/**
 * Demo mode is a browser-side choice stored in a cookie, so the server layout can decide not to
 * require a session. Demo mode only ever shows fictional sample data from lib/demo/store.ts.
 */
export const MODE_COOKIE = "procura_mode";

export function enterDemoMode(): void {
  document.cookie = `${MODE_COOKIE}=demo; path=/; max-age=${60 * 60 * 8}; samesite=lax`;
}

export function leaveDemoMode(): void {
  document.cookie = `${MODE_COOKIE}=; path=/; max-age=0; samesite=lax`;
}
