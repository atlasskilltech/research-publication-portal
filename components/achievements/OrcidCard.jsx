"use client";

import { useState } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

/** The signed-in user's ORCID iD, with an inline edit. */
export default function OrcidCard({ initial }) {
  const [orcid, setOrcid] = useState(initial || "");
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initial || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save(e) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/achievements/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orcid: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save.");
      setOrcid(data.orcid || "");
      setValue(data.orcid || "");
      setEditing(false);
    } catch (e2) { setErr(e2.message); }
    finally { setBusy(false); }
  }

  return (
    <Card className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">ORCID iD</p>
        {!editing && (
          orcid
            ? <a href={`https://orcid.org/${orcid}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand hover:underline">{orcid}</a>
            : <p className="text-sm text-muted">Not added yet.</p>
        )}
        {editing && (
          <form onSubmit={save} className="mt-1 flex flex-wrap items-center gap-2">
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="0000-0002-1825-0097 or your ORCID link"
              aria-label="ORCID iD"
              className="w-72 max-w-full rounded-lg border border-line bg-white px-3 py-1.5 text-sm text-ink"
            />
            <Button type="submit" size="sm" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
            <Button size="sm" variant="outline" onClick={() => { setEditing(false); setValue(orcid); setErr(""); }} disabled={busy}>Cancel</Button>
          </form>
        )}
        {err && <p className="mt-1 text-xs text-danger">{err}</p>}
      </div>
      {!editing && <Button size="sm" variant="outline" onClick={() => setEditing(true)}>{orcid ? "Change" : "Add ORCID iD"}</Button>}
    </Card>
  );
}
