"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CreateSupplierSchema } from "@procura/shared";
import { Modal, useToast } from "@/components/overlays";
import { errorMessage, useAddSupplier } from "@/lib/queries";

const EMPTY = { name: "", legalName: "", countryCode: "", city: "", email: "", phone: "", website: "", categories: "" };

/** Add a supplier by hand. What is typed here is "supplier provided"; only a verification check can make it verified. */
export function AddSupplierModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f, setF] = useState(EMPTY);
  const [err, setErr] = useState<Record<string, string>>({});
  const add = useAddSupplier();
  const router = useRouter();
  const { show } = useToast();
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const blank = (v: string) => (v.trim() ? v.trim() : undefined);
    const parsed = CreateSupplierSchema.safeParse({
      name: f.name, legalName: blank(f.legalName), countryCode: blank(f.countryCode), city: blank(f.city), email: blank(f.email),
      phone: blank(f.phone), website: blank(f.website), categories: f.categories.split(",").map((c) => c.trim()).filter(Boolean),
    });
    if (!parsed.success) {
      const out: Record<string, string> = {};
      for (const i of parsed.error.issues) out[String(i.path[0])] ??= i.message;
      setErr(out); return;
    }
    setErr({});
    try {
      const created = await add.mutateAsync(parsed.data);
      show("Seller added");
      setF(EMPTY); onClose();
      router.push(`/sellers/${created.id}`);
    } catch (x) { show(errorMessage(x), "err"); }
  }

  const field = (k: keyof typeof EMPTY, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: string) => (
    <div className="fld"><label htmlFor={`sup-${k}`}>{label}</label>
      <input id={`sup-${k}`} className="input" value={f[k]} onChange={set(k)} aria-invalid={!!err[k]} {...props} />
      {err[k] ? <div className="ferr">{err[k]}</div> : hint ? <div className="hint">{hint}</div> : null}
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} label="Add seller" wide>
      <form onSubmit={submit} noValidate>
        <h3 style={{ margin: "0 0 4px" }}>Add a seller</h3>
        <p className="mut" style={{ fontSize: 13, margin: "0 0 16px" }}>
          Everything you enter here counts as seller provided. A seller is only verified after a check says so.
        </p>
        {field("name", "Name", { placeholder: "Ikeja Office Supply", autoComplete: "off", maxLength: 120 })}
        {field("legalName", "Registered legal name", { placeholder: "Ikeja Office Supply Limited" }, "Used for the sanctions and registry checks. Leave blank to use the name.")}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {field("countryCode", "Country", { placeholder: "NG", maxLength: 2, style: { textTransform: "uppercase" } }, "Two letters. Needed for the registry check.")}
          {field("city", "City", { placeholder: "Lagos" })}
        </div>
        {field("email", "Contact email", { type: "email", placeholder: "sales@example.com" }, "Needed for the email check.")}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {field("phone", "Phone", { placeholder: "+234 …" })}
          {field("website", "Website", { placeholder: "https://example.com" })}
        </div>
        {field("categories", "What they sell", { placeholder: "stationery, printing" }, "Separate with commas.")}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
          <button type="button" className="btn btn-sec" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-pri" disabled={add.isPending}>{add.isPending ? "Adding…" : "Add seller"}</button>
        </div>
      </form>
    </Modal>
  );
}
