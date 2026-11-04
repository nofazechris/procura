import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { AuthScene } from "@/components/auth-scene";
import { Icon } from "@/components/icon";
import { sceneDataOf } from "@/components/landing/scene-data";
import { buildLandingData } from "@/lib/landing/data";
import { getAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Sign in, sign up and recovery. Someone who is already signed in goes straight to the app. */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (session) redirect("/dashboard");
  // The same sample run the landing page tells, computed by the real engine.
  const scene = sceneDataOf(await buildLandingData());
  return (
    <div className="auth">
      <div className="auth-main">
        <Link href="/" className="wordmark" style={{ textDecoration: "none", alignSelf: "flex-start" }}><span className="mark"><Icon name="leaf" /></span>Procura</Link>
        {children}
      </div>
      <aside className="auth-aside" aria-hidden="true">
        <AuthScene scene={scene} />
        <h2>An AI buyer that cannot overspend.</h2>
        <p>It finds the options, checks the evidence and explains its pick. It can spend only inside a session you approve with your passkey.</p>
      </aside>
    </div>
  );
}
