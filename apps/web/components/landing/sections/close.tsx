import Link from "next/link";

/** The closing call to action, over a slow field of drifting cubes made from CSS. */
export function CloseSection() {
  return (
    <section className="lx-sec lx-close" aria-label="Get started">
      <div className="cubes" aria-hidden="true">
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} className="cube" style={{ ["--i" as string]: i }}>
            <i /><i /><i /><i /><i /><i />
          </div>
        ))}
      </div>
      <div className="lx-sec-in">
        <div className="lx-kicker" style={{ justifyContent: "center" }}>Start with one purchase</div>
        <h2 className="lx-h">Give it the next thing you need to buy.</h2>
        <p className="lx-body">Describe it in plain words. Procura finds options, checks them, compares them, and waits for your key before a cent can move.</p>
        <div className="lx-cta"><Link href="/signup" className="lx-btn pri">Start free</Link><Link href="/login" className="lx-btn">Sign in</Link></div>
      </div>
    </section>
  );
}
