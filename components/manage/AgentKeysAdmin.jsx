"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import Spinner from "@/components/ui/Spinner";
import { cn } from "@/lib/cn";

const PRESET_ORDER = ["read_only", "read_write"];
const STATE_CLS = {
  active: "bg-ok-soft text-ok border-ok/30",
  expired: "bg-warn-soft text-warn border-warn/30",
  revoked: "bg-soft-2 text-muted border-line",
};

const fmt = (v) => (v ? new Date(v).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "Never");
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * IntelligenceOS keys — create (name, permissions, presets, optional expiry),
 * show the key ONCE, list with last-used time, revoke. Every action is
 * re-checked server-side in /api/admin/agent-keys*.
 */
export default function AgentKeysAdmin({ apiUrl }) {
  const [keys, setKeys] = useState([]);
  const [scopes, setScopes] = useState([]);
  const [presets, setPresets] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState(["research.read"]);
  const [expiresAt, setExpiresAt] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  const [created, setCreated] = useState(null); // { key, record } — shown once
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState(null);
  const [revokeError, setRevokeError] = useState("");

  async function load() {
    setLoading(true); setLoadError("");
    try {
      const res = await fetch("/api/admin/agent-keys", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not load keys.");
      setKeys(data.keys || []);
      setScopes(data.scopes || []);
      setPresets(data.presets || {});
    } catch (e) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  function openCreate() {
    setName(""); setSelected(presets.read_only?.scopes || ["research.read"]); setExpiresAt(""); setFormError("");
    setCreateOpen(true);
  }
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function create(e) {
    e?.preventDefault();
    setBusy(true); setFormError("");
    try {
      const res = await fetch("/api/admin/agent-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, scopes: selected, expiresAt: expiresAt || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not create the key.");
      setCreateOpen(false);
      setCopied(false);
      setCreated(data);
      load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!revoking) return;
    setBusy(true); setRevokeError("");
    try {
      const res = await fetch(`/api/admin/agent-keys/${revoking.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not revoke the key.");
      setRevoking(null);
      load();
    } catch (err) {
      setRevokeError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { /* select manually */ }
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader
        eyebrow="Administration"
        title="IntelligenceOS keys"
        subtitle="API keys that let ATLAS IntelligenceOS agents read portal data and, if allowed, add notes or change status. Each key is shown only once."
        action={<Button onClick={openCreate} disabled={loading}>Create key</Button>}
      />

      <Card className="mb-6 p-4 sm:p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Connect in IntelligenceOS</p>
        <p className="mt-1 text-sm text-ink">
          In IntelligenceOS go to <strong>Connectors → Connect project</strong> and enter the project name, this Agent API URL and a key:
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="break-all rounded-lg bg-soft-2 px-3 py-1.5 text-sm text-ink">{apiUrl}</code>
          <Button size="sm" variant="outline" onClick={() => copy(apiUrl)}>Copy URL</Button>
        </div>
        <p className="mt-3 text-sm text-ink">
          Tick <strong>“This project acts as the signed-in user”</strong> so each person only gets what their portal role allows
          (their own papers, papers assigned to them, or everything for an administrator). Their IntelligenceOS email must match their portal email.
        </p>
        <p className="mt-1 text-xs text-muted">
          With this on, the key can act as any portal user, so keep it only in IntelligenceOS, give it an expiry and revoke it if in doubt.
        </p>
      </Card>

      <Card>
        {loading ? (
          <div className="flex justify-center p-10"><Spinner /></div>
        ) : loadError ? (
          <p className="p-6 text-sm text-danger">{loadError}</p>
        ) : !keys.length ? (
          <div className="p-8 text-center">
            <p className="text-sm text-muted">No keys yet. Create one to connect IntelligenceOS.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-line text-[11px] uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-4 py-3 font-semibold">Access</th>
                  <th className="px-4 py-3 font-semibold">Expires</th>
                  <th className="px-4 py-3 font-semibold">Last used</th>
                  <th className="px-4 py-3 font-semibold">Created</th>
                  <th className="px-4 py-3 font-semibold">State</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {keys.map((k) => (
                  <tr key={k.id} className={cn(k.state !== "active" && "text-muted")}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-ink">{k.name}</p>
                      <p className="font-mono text-xs text-muted">atl_…{k.last4}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p>{k.access}</p>
                      <p className="text-xs text-muted">{k.scopes.join(", ")}</p>
                    </td>
                    <td className="px-4 py-3">{fmtDate(k.expiresAt)}</td>
                    <td className="px-4 py-3">{k.lastUsedAt ? fmt(k.lastUsedAt) : "Never"}</td>
                    <td className="px-4 py-3">
                      <p>{fmt(k.createdAt)}</p>
                      {k.createdBy && <p className="text-xs text-muted">by {k.createdBy}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold capitalize", STATE_CLS[k.state])}>{k.state}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {k.state !== "revoked" && (
                        <Button size="sm" variant="danger" onClick={() => { setRevokeError(""); setRevoking(k); }}>Revoke</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Create */}
      <Modal
        open={createOpen}
        onClose={() => !busy && setCreateOpen(false)}
        eyebrow="IntelligenceOS"
        title="Create API key"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={create} disabled={busy || !name.trim() || !selected.length}>{busy ? "Creating…" : "Create key"}</Button>
          </>
        }
      >
        <form onSubmit={create} className="flex flex-col gap-5">
          <Input label="Name" required value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="e.g. IntelligenceOS production" hint="Shown in IntelligenceOS and in this list." />

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Permissions</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {PRESET_ORDER.filter((p) => presets[p]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setSelected(presets[p].scopes)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                    sameSet(selected, presets[p].scopes) ? "border-brand bg-brand text-white" : "border-line bg-white text-ink hover:bg-soft",
                  )}
                >
                  {presets[p].label}{p === "read_only" ? " (default)" : ""}
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {scopes.map((s) => (
                <label key={s.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 hover:bg-soft">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} />
                  <span>
                    <span className="block text-sm font-semibold text-ink">{s.label} <span className="font-mono text-xs font-normal text-muted">{s.id}</span></span>
                    <span className="block text-xs text-muted">{s.description}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">Keys can never delete records, change passwords or export data in bulk.</p>
          </div>

          <Input label="Expiry date (optional)" type="date" min={today} value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} hint="Leave empty for a key that does not expire. Valid through the end of the chosen day (UTC)." />

          {formError && <p className="text-sm text-danger">{formError}</p>}
          <button type="submit" className="hidden" />
        </form>
      </Modal>

      {/* Show once */}
      <Modal
        open={!!created}
        onClose={() => setCreated(null)}
        eyebrow="Copy it now"
        title="Your new API key"
        footer={<Button onClick={() => setCreated(null)}>I have saved the key</Button>}
      >
        {created && (
          <div className="flex flex-col gap-4">
            <p className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn">
              This is the only time the key is shown. Only a fingerprint is stored — if you lose it, revoke it and create a new one.
            </p>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">{created.record.name} · {created.record.access}</p>
              <code className="mt-2 block break-all rounded-lg bg-soft-2 px-3 py-2 font-mono text-sm text-ink select-all">{created.key}</code>
              <div className="mt-2 flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => copy(created.key)}>Copy key</Button>
                {copied && <span className="text-xs text-ok">Copied</span>}
              </div>
            </div>
            <p className="text-sm text-muted">Agent API URL: <code className="break-all text-ink">{apiUrl}</code></p>
          </div>
        )}
      </Modal>

      {/* Revoke */}
      <Modal
        open={!!revoking}
        onClose={() => !busy && setRevoking(null)}
        eyebrow="Revoke key"
        title={revoking ? `Revoke “${revoking.name}”?` : ""}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setRevoking(null)} disabled={busy}>Cancel</Button>
            <Button variant="danger" onClick={revoke} disabled={busy}>{busy ? "Revoking…" : "Revoke key"}</Button>
          </>
        }
      >
        <p className="text-sm text-ink">IntelligenceOS will get “401 Unauthorized” on its next request and its agents will stop using this connection. This cannot be undone.</p>
        {revokeError && <p className="mt-3 text-sm text-danger">{revokeError}</p>}
      </Modal>
    </div>
  );
}
