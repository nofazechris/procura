import Link from "next/link";
import { Icon } from "@/components/icon";

export function LandingNav() {
  return (
    <nav className="lx-nav" aria-label="Main">
      <Link href="/" className="lx-brand"><i><Icon name="leaf" /></i>Procura</Link>
      <div className="lx-links">
        <a href="#story">How it works</a>
        <a href="#playground">Break it</a>
        <a href="#authority">Authority</a>
      </div>
      <div className="lx-nav-r">
        <Link href="/login" className="link">Sign in</Link>
        <Link href="/signup" className="lx-btn pri sm">Start free</Link>
      </div>
    </nav>
  );
}
