"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icon";
import { authClient } from "@/lib/auth-client";

export default function SignupPage() {
  const router = useRouter();
  const [f, setF] = useState({ name: "", email: "", password: "", company: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verify, setVerify] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (f.name.trim().length < 2) next["name"] = "Enter your full name.";
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) next["email"] = "Enter a valid email address.";
    if (f.password.length < 10) next["password"] = "Use at least 10 characters.";
    if (f.company.trim().length < 2) next["company"] = "Enter your company name.";
    setErrors(next); setFormError(null);
    if (Object.keys(next).length) return;

    setBusy(true);
    const { error } = await authClient.signUp.email({ name: f.name.trim(), email: f.email.trim(), password: f.password });
    if (error) {
      setBusy(false);
      setFormError(error.code === "USER_ALREADY_EXISTS" || /exist/i.test(error.message ?? "") ? "An account with that email already exists. Try signing in." : (error.message ?? "We could not create your account. Please try again."));
      return;
    }
    try { sessionStorage.setItem("procura_signup_company", f.company.trim()); } catch { /* onboarding will just ask again */ }
    // If email verification is required there is no session yet.
    const session = await authClient.getSession();
    if (session.data) { router.push("/dashboard"); router.refresh(); }
    else { setBusy(false); setVerify(true); }
  }

  if (verify) {
    return (
      <div className="auth-card">
        <div className="empty-ic" style={{ width: 52, height: 52, borderRadius: 14, background: "var(--ok-bg)", color: "var(--ok)", display: "grid", placeItems: "center", marginBottom: 18 }}><Icon name="mail" /></div>
        <h1>Check your email</h1>
        <p className="sub">We sent a verification link to <b>{f.email}</b>. Open it to finish setting up your account.</p>
        <p className="auth-foot" style={{ textAlign: "left" }}>Already verified? <Link href="/login">Sign in</Link></p>
      </div>
    );
  }

  const field = (key: keyof typeof f, label: string, props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div className="fld"><label htmlFor={key}>{label}</label>
      <input id={key} className="input" value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} aria-invalid={!!errors[key]} {...props} />
      {errors[key] ? <div className="ferr" role="alert">{errors[key]}</div> : null}</div>
  );

  return (
    <div className="auth-card">
      <h1>Create your account</h1>
      <p className="sub">Set up your procurement workspace in a few minutes.</p>
      <form onSubmit={submit} noValidate>
        {field("name", "Full name", { autoComplete: "name", placeholder: "Chris Godwin" })}
        {field("email", "Work email", { type: "email", autoComplete: "email", placeholder: "you@company.com" })}
        {field("password", "Password", { type: "password", autoComplete: "new-password" })}
        {field("company", "Company name", { autoComplete: "organization", placeholder: "Northstar Kitchen" })}
        {formError ? <div className="callout err" role="alert" style={{ marginBottom: 14 }}><span>{formError}</span></div> : null}
        <button className="btn btn-pri btn-lg" style={{ width: "100%" }} type="submit" disabled={busy}>{busy ? "Creating account…" : "Create account"}</button>
      </form>
      <p className="auth-foot">Already have an account? <Link href="/login">Sign in</Link></p>
    </div>
  );
}
