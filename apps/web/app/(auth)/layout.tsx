import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { Icon } from "@/components/icon";
import { getAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Sign in, sign up and recovery. Someone who is already signed in goes straight to the app. */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (session) redirect("/dashboard");
  return (
    <div className="auth">
      <div className="auth-main">
        <Link href="/" className="wordmark" style={{ textDecoration: "none", alignSelf: "flex-start" }}><span className="mark"><Icon name="leaf" /></span>Procura</Link>
        {children}
      </div>
      <aside className="auth-aside" aria-hidden="true">
        <h2>Your procurement department, powered by autonomous AI.</h2>
        <ul>
          <li><Icon name="check" strokeWidth={3} />Finds suppliers, compares delivered prices and explains why.</li>
          <li><Icon name="check" strokeWidth={3} />Evidence first: unknown is never shown as verified.</li>
          <li><Icon name="check" strokeWidth={3} />Nothing is paid without your approval, within limits you set.</li>
          <li><Icon name="check" strokeWidth={3} />Every action recorded in an audit trail you can read.</li>
        </ul>
      </aside>
    </div>
  );
}
