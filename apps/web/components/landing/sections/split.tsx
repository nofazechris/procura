import type { ReactNode } from "react";

/**
 * One landing section: words on one side, something to play with on the other.
 *
 * `side` is where the visual lives. A 3D scene goes in `bg`: it fills the whole section behind the words
 * and fades out towards them, so there is no box around it. A flat visual goes in `visual` and sits
 * inline in its column. Pointer events pass through the empty visual side, so the scene stays playable.
 */
export function Split({ id, side, kicker, title, children, visual, bg, caption }: {
  id?: string; side: "left" | "right"; kicker: string; title: ReactNode; children: ReactNode;
  visual?: ReactNode; bg?: ReactNode; caption?: string;
}) {
  return (
    <section id={id} className={`lx-sec ${bg ? "lx-bgsec" : ""}`} data-side={side}>
      {bg ? <div className="lx-bg3d" data-side={side}>{bg}</div> : null}
      <div className={`lx-sec-in lx-sp ${side === "left" ? "vl" : "vr"}`}>
        <div className="lx-sp-text">
          <div className="lx-kicker">{kicker}</div>
          <h2 className="lx-h">{title}</h2>
          {children}
        </div>
        <div className="lx-sp-vis">
          {visual}
          {caption ? <div className="lx-cap">{caption}</div> : null}
        </div>
      </div>
    </section>
  );
}
