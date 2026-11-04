import Link from "next/link";
import { Experience } from "@/components/landing/experience";
import { Authority } from "@/components/landing/authority";
import { LandingNav } from "@/components/landing/nav";
import { Playground } from "@/components/landing/playground";
import { buildLandingData } from "@/lib/landing/data";

export const metadata = { title: "Procura: procurement, on autopilot" };

export default async function Landing() {
  // Computed by the real engine at build time; the page ships real numbers, not copy.
  const data = await buildLandingData();
  return (
    <main>
      <LandingNav />
      <Experience data={data} />
      <Playground data={data} />
      <Authority data={data} />
      <section className="lx-sec lx-close" aria-label="Get started">
        <div className="lx-sec-in">
          <h2 className="lx-h">Give it the next purchase.</h2>
          <p className="lx-body">Describe what you need. Procura sources, proves and compares it, builds the order, and waits for you to turn the key.</p>
          <div className="lx-cta"><Link href="/signup" className="lx-btn pri">Start free</Link><Link href="/login" className="lx-btn">Sign in</Link></div>
        </div>
      </section>
      <footer className="lx-foot">
        <Link href="/" className="lx-brand">Procura</Link>
        <p>Procura is in active development. Supplier data on this page is a fictional sample scenario computed by the real engine.</p>
      </footer>
    </main>
  );
}
