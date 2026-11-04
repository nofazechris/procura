"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { authClient } from "@/lib/auth-client";

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!token) {
    return <><h1>Link expired</h1><p className="sub">This reset link is missing or has expired. Request a new one.</p><p className="auth-foot"><Link href="/forgot-password">Send a new link</Link></p></>;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 10) { setError("Use at least 10 characters."); return; }
    setBusy(true); setError(null);
    const { error: err } = await authClient.resetPassword({ newPassword: password, token: token! });
    setBusy(false);
    if (err) { setError("This link is invalid or has expired. Request a new one."); return; }
    router.push("/login");
  }

  return (
    <>
      <h1>Choose a new password</h1>
      <p className="sub">Use at least 10 characters.</p>
      <form onSubmit={submit} noValidate>
        <div className="fld"><label htmlFor="pw">New password</label><input id="pw" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        {error ? <div className="callout err" role="alert" style={{ marginBottom: 14 }}><span>{error}</span></div> : null}
        <button className="btn btn-pri btn-lg" style={{ width: "100%" }} type="submit" disabled={busy}>{busy ? "Saving…" : "Save new password"}</button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return <div className="auth-card"><Suspense fallback={null}><ResetForm /></Suspense></div>;
}
