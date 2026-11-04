"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) { setError("Enter your email and password."); return; }
    setBusy(true); setError(null);
    const { error: err } = await authClient.signIn.email({ email: email.trim(), password });
    if (err) {
      setBusy(false);
      setError(err.status === 403 ? "Verify your email first. Check your inbox for the link we sent." : "That email and password do not match.");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="auth-card">
      <h1>Welcome back</h1>
      <p className="sub">Sign in to your buyer.</p>
      <form onSubmit={submit} noValidate>
        <div className="fld"><label htmlFor="email">Email</label><input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></div>
        <div className="fld">
          <label htmlFor="password" style={{ display: "flex", justifyContent: "space-between" }}>Password<Link href="/forgot-password" className="linkbtn" style={{ fontSize: 12 }}>Forgot password?</Link></label>
          <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error ? <div className="callout err" role="alert" style={{ marginBottom: 14 }}><span>{error}</span></div> : null}
        <button className="btn btn-pri btn-lg" style={{ width: "100%" }} type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      <p className="auth-foot">New to Procura? <Link href="/signup">Create an account</Link></p>
    </div>
  );
}
