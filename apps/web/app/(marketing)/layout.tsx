import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource-variable/jetbrains-mono";
import type { ReactNode } from "react";
import "./landing.css";

/** The public landing experience: a dark, cinematic surface that is deliberately separate from the light product UI. */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="lx">
      {children}
      {/* Window scroll must drive the story, so undo the app shell's fixed-height body on this route only. */}
      <style>{"html,body{height:auto!important;background:#050806;overflow-x:clip}"}</style>
    </div>
  );
}
