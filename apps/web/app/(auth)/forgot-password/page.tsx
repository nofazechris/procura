"use client";

import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError("Enter a valid email address."); return; }
    setBusy(true); setError(null);
    await authClient.requestPasswordReset({ email: email.trim(), redirectTo: "/reset-password" });
    // Always show the same message so the form cannot be used to discover which emails have accounts.
    setBusy(false); setSent(true);
  }

  return (
    <div className="auth-card">
      <h1>Reset your password</h1>
      {sent ? (
        <p className="sub">If an account exists for <b>{email}</b>, we have sent a link to reset the password.</p>
      ) : (
        <>
          <p className="sub">Enter your email and we will send a reset link.</p>
          <form onSubmit={submit} noValidate>
            <div className="fld"><label htmlFor="email">Work email</label><input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            {error ? <div className="callout err" role="alert" style={{ marginBottom: 14 }}><span>{error}</span></div> : null}
            <button className="btn btn-pri btn-lg" style={{ width: "100%" }} type="submit" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
          </form>
        </>
      )}
      <p className="auth-foot"><Link href="/login">Back to sign in</Link></p>
    </div>
  );
}
