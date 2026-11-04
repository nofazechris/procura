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
        <Link href="/" className="lx-brand">Procura</Link>
        <p>Procura is in active development. Everything on this page runs on a fictional sample scenario, computed by the real engine. Checkout through Kite Passport is the next step to go live.</p>
      </footer>
    </main>
  );
}
