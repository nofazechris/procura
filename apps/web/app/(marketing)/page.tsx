import Link from "next/link";
import { Experience } from "@/components/landing/experience";
import { LandingNav } from "@/components/landing/nav";
import { AgentSection } from "@/components/landing/sections/agent";
import { CloseSection } from "@/components/landing/sections/close";
import { CompareSection } from "@/components/landing/sections/compare";
import { FindSection } from "@/components/landing/sections/find";
import { LanesSection } from "@/components/landing/sections/lanes";
import { LimitsSection } from "@/components/landing/sections/limits";
import { ProveSection } from "@/components/landing/sections/prove";
import { buildLandingData } from "@/lib/landing/data";

export const metadata = { title: "Procura: an AI buyer that cannot overspend" };

export default async function Landing() {
  // Computed by the real engine; the page ships real logic on a fictional sample scenario, not copy.
  const data = await buildLandingData();
  return (
    <main>
      <LandingNav />
      <Experience data={data} />
      <AgentSection data={data} />
      <FindSection data={data} />
      <ProveSection data={data} />
      <CompareSection data={data} />
      <LimitsSection data={data} />
      <LanesSection />
      <CloseSection />
      <footer className="lx-foot">
        <div className="lx-foot-in">
          <div className="lx-foot-brand">
            <Link href="/" className="lx-brand">Procura</Link>
            <p>An AI buyer that finds the options, checks the evidence and cannot spend a cent you have not approved.</p>
          </div>
          <nav className="lx-foot-col" aria-label="Product">
            <h3>Product</h3>
            <a href="#story">How it works</a>
            <a href="#find">Try it</a>
            <a href="#limits">Limits</a>
            <a href="#lanes">Lanes</a>
          </nav>
          <nav className="lx-foot-col" aria-label="Account">
            <h3>Account</h3>
            <Link href="/signup">Start free</Link>
            <Link href="/login">Sign in</Link>
          </nav>
        </div>
        <div className="lx-foot-base">
          <span>In active development. The examples on this page run on sample data through the real engine, and real purchases need a funded Kite Passport wallet.</span>
          <span>Built with Kite Passport and SERV</span>
        </div>
      </footer>
    </main>
  );
}
