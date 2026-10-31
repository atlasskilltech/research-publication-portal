"use client";

import { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import Spinner from "@/components/ui/Spinner";
import { cn } from "@/lib/cn";

const FILTERS = ["ALL", "STUDENT", "FACULTY", "ADMIN"];
// Additional assignable roles (base type Student/Faculty is separate).
const ROLE_DEFS = [
  { value: "ADMINISTRATOR", label: "Administrator", note: "Full admin access (syncs with is_admin)" },
  { value: "SPOC", label: "SPOC" },
  { value: "DESK_REVIEWER", label: "Desk Reviewer" },
  { value: "PEER_REVIEWER", label: "Peer Reviewer" },
  { value: "EDITOR", label: "Editor" },
];
const ROLE_LABEL = Object.fromEntries(ROLE_DEFS.map((r) => [r.value, r.label]));

function matchesFilter(u, filter) {
  if (filter === "ALL") return true;
  if (filter === "ADMIN") return u.isAdmin;
  return u.baseType === filter;
}
function matchesSearch(u, q) {
  if (!q) return true;
  const s = q.toLowerCase();
  return (u.name || "").toLowerCase().includes(s) || (u.email || "").toLowerCase().includes(s);
}
const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

export default function UsersAdmin({ meId, protectedEmails = [] }) {
  const protectedSet = useMemo(() => new Set((protectedEmails || []).map((e) => String(e).toLowerCase())), [protectedEmails]);

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [query, setQuery] = useState("");

  const [manage, setManage] = useState(null);
  const [draftRoles, setDraftRoles] = useState(new Set());
  const [confirm, setConfirm] = useState(null); // {kind:'promote'|'revoke'|'delete'}
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  async function load() {
    setLoading(true); setLoadError("");
    try {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not load users.");
      setUsers(data.users || []);
    } catch (e) { setLoadError(e.message || "Could not load users."); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const adminCount = useMemo(() => users.filter((u) => u.isAdmin).length, [users]);
  const shown = useMemo(() => users.filter((u) => matchesFilter(u, filter) && matchesSearch(u, query)), [users, filter, query]);
  const count = (f) => users.filter((u) => matchesFilter(u, f)).length;

  const isProtected = (u) => protectedSet.has((u?.email || "").toLowerCase());
  const isSelf = (u) => u?.id === meId;
  const isLastAdmin = (u) => u?.isAdmin && adminCount <= 1;

  function openManage(u) {
    setManage(u);
    setDraftRoles(new Set(u.roles || []));
    setConfirm(null); setActionError("");
  }

  const adminDraft = draftRoles.has("ADMINISTRATOR");
  const adminChanged = manage ? adminDraft !== manage.isAdmin : false;
  const rolesChanged = manage ? !sameSet([...draftRoles], manage.roles || []) : false;
  const dirty = rolesChanged;

  // Administrator checkbox availability (server still authoritative).
  const adminBoxDisabled = manage ? (isSelf(manage) || (manage.isAdmin && (isProtected(manage) || isLastAdmin(manage)))) : true;
  const rolesLockedForSelf = manage ? isSelf(manage) : false;

  function toggleRole(role) {
    if (rolesLockedForSelf) return;
    if (role === "ADMINISTRATOR" && adminBoxDisabled) return;
    setDraftRoles((prev) => { const n = new Set(prev); n.has(role) ? n.delete(role) : n.add(role); return n; });
  }

  function onSave() {
    setActionError("");
    if (adminChanged) setConfirm({ kind: adminDraft ? "promote" : "revoke" });
    else doSave();
  }

  async function doSave() {
    const payload = {};
    if (rolesChanged) payload.roles = [...draftRoles];
    if (Object.keys(payload).length === 0) { setManage(null); return; }
    await run(() => fetch(`/api/admin/users/${manage.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    }), (data) => {
      setUsers((p) => p.map((u) => u.id === manage.id ? { ...u, baseType: data.baseType, isAdmin: data.isAdmin, roles: data.roles } : u));
      setManage(null); setConfirm(null);
    });
  }

  async function deleteUser() {
    const id = manage.id;
    await run(() => fetch(`/api/admin/users/${id}`, { method: "DELETE" }), () => {
      setUsers((p) => p.filter((u) => u.id !== id)); setManage(null); setConfirm(null);
    });
  }

  async function run(req, onOk) {
    setBusy(true); setActionError("");
    try {
      const res = await req();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Action failed.");
      onOk(data);
    } catch (e) { setActionError(e.message || "Action failed."); }
    finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="People & roles"
        subtitle={`${users.length} account${users.length === 1 ? "" : "s"} · ${adminCount} admin${adminCount === 1 ? "" : "s"} · base type and roles are managed separately`}
        action={<Button variant="outline" onClick={load} disabled={loading}><Icon name="activity" size={16} /> Refresh</Button>}
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => <FilterChip key={f} label={f} count={count(f)} active={filter === f} onClick={() => setFilter(f)} />)}
        </div>
        <div className="w-full sm:w-72">
          <Input placeholder="Search name or email…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search users" />
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="hidden border-b border-line bg-soft px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted md:grid md:grid-cols-[1.5fr_0.6fr_1.2fr_auto] md:gap-3">
          <span>Person</span><span>Base type</span><span>Roles</span><span className="text-right">Manage</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-muted"><Spinner /> Loading users…</div>
        ) : loadError ? (
          <div className="px-5 py-10 text-center text-sm text-danger">{loadError}<div className="mt-3"><Button variant="outline" size="sm" onClick={load}>Retry</Button></div></div>
        ) : shown.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted">No accounts match this view.</div>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((u) => (
              <li key={u.id} className="flex flex-col gap-3 px-4 py-3.5 sm:px-5 md:grid md:grid-cols-[1.5fr_0.6fr_1.2fr_auto] md:items-center md:gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">
                    {u.name}
                    {isProtected(u) && <Tag className="bg-soft-2 text-muted" icon="lock">PROTECTED</Tag>}
                    {isSelf(u) && <Tag className="bg-soft-2 text-muted">YOU</Tag>}
                    {!u.verified && <Tag className="bg-warn-soft text-warn">PENDING</Tag>}
                  </p>
                  <p className="truncate text-xs text-muted">{u.email}</p>
                </div>
                <div className="text-sm text-muted">{u.baseType}</div>
                <div className="flex flex-wrap gap-1">
                  {u.roles?.length
                    ? u.roles.map((r) => <Tag key={r} className={r === "ADMINISTRATOR" ? "bg-brand text-white" : "bg-soft-2 text-ink"} icon={r === "ADMINISTRATOR" ? "shield" : undefined}>{ROLE_LABEL[r] || r}</Tag>)
                    : <span className="text-xs text-muted">—</span>}
                </div>
                <div className="md:text-right"><Button variant="outline" size="sm" onClick={() => openManage(u)}>Manage</Button></div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={!!manage}
        onClose={() => !busy && setManage(null)}
        eyebrow="Manage person"
        title={manage?.name}
        size="lg"
        footer={confirm ? null : (
          <>
            <Button variant="outline" onClick={() => setManage(null)} disabled={busy}>Close</Button>
            <Button variant="primary" onClick={onSave} disabled={busy || !dirty}>{busy ? "Saving…" : "Save changes"}</Button>
          </>
        )}
      >
        {manage && !confirm && (
          <div className="space-y-5">
            <p className="text-sm text-muted">
              {manage.email} · {manage.verified ? "verified" : "email not yet verified"}
              {manage.applicationNo ? <> · app no. <b className="text-ink">{manage.applicationNo}</b></> : null}
            </p>

            {/* Base Type — read-only; set at registration and immutable */}
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Base type</p>
              <span className="inline-flex items-center gap-2 rounded-lg border border-line bg-soft-2 px-3 py-2 text-sm font-semibold text-ink">
                <Icon name="lock" size={14} /> BASE TYPE: {manage.baseType}
              </span>
              <p className="mt-1 text-xs text-muted">Set at registration and cannot be changed.</p>
            </div>

            {/* Additional roles — multi-select */}
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Additional roles</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {ROLE_DEFS.map((r) => {
                  const checked = draftRoles.has(r.value);
                  const disabled = rolesLockedForSelf || (r.value === "ADMINISTRATOR" && adminBoxDisabled);
                  return (
                    <label key={r.value} className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
                      disabled ? "border-line bg-soft-2/50 opacity-60" : "border-line hover:bg-soft cursor-pointer",
                      checked && !disabled && "border-brand bg-brand/5")}>
                      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--brand,#1a1a2e)]" checked={checked} disabled={disabled} onChange={() => toggleRole(r.value)} />
                      <span>
                        <span className="font-semibold text-ink">{r.label}</span>
                        {r.note && <span className="block text-xs text-muted">{r.note}</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
              {rolesLockedForSelf && <p className="mt-2 text-xs text-muted">You can&apos;t modify your own roles.</p>}
              {!rolesLockedForSelf && manage.isAdmin && (isProtected(manage) || isLastAdmin(manage)) && (
                <p className="mt-2 text-xs text-muted">{isProtected(manage) ? "Administrator can't be removed from a protected original admin." : "Administrator can't be removed from the last administrator."}</p>
              )}
            </div>

            {/* Delete */}
            <div className="rounded-lg border border-danger/20 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Danger zone</p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-xs text-muted">Permanently delete this account and all its roles.</span>
                <Button variant="outline" size="sm" className="border-danger/40 text-danger hover:bg-danger-soft"
                  disabled={isSelf(manage) || isProtected(manage) || isLastAdmin(manage)}
                  onClick={() => { setActionError(""); setConfirm({ kind: "delete" }); }}>Delete user</Button>
              </div>
            </div>

            {actionError && <p className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">{actionError}</p>}
            <p className="rounded-lg bg-soft-2 px-3 py-2 text-xs text-muted">Assigning SPOC / reviewer / editor stores and displays the role; per-paper permissions are unchanged in this build.</p>
          </div>
        )}

        {manage && confirm && (
          <div className="space-y-4">
            <div className={cn("rounded-lg border px-4 py-3 text-sm", confirm.kind === "delete" ? "border-danger/30 bg-danger-soft text-ink" : "border-warn/30 bg-warn-soft text-ink")}>
              {confirm.kind === "promote" && <>Grant <b>full administrator</b> access to <b>{manage.email}</b>? They will manage all users and roles, exactly like existing admins.</>}
              {confirm.kind === "revoke" && <>Revoke administrator access from <b>{manage.email}</b>? They will lose all admin abilities.</>}
              {confirm.kind === "delete" && <>Permanently delete <b>{manage.email}</b>? This removes the account, its profile and all roles for good — they can no longer log in. This cannot be undone.</>}
            </div>
            {actionError && <p className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">{actionError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setConfirm(null); setActionError(""); }} disabled={busy}>Cancel</Button>
              {confirm.kind === "delete"
                ? <Button variant="primary" className="bg-danger hover:bg-danger/90" onClick={deleteUser} disabled={busy}>{busy ? "Deleting…" : "Delete permanently"}</Button>
                : <Button variant="primary" onClick={doSave} disabled={busy}>{busy ? "Saving…" : "Confirm & save"}</Button>}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function Tag({ children, className, icon }) {
  return (
    <span className={cn("ml-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold align-middle", className)}>
      {icon && <Icon name={icon} size={11} />}{children}
    </span>
  );
}
function FilterChip({ label, count, active, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className={cn("inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
        active ? "border-brand bg-brand text-white" : "border-line bg-white text-ink hover:bg-soft")}>
      {label}<span className={cn(active ? "text-white/80" : "text-muted")}>· {count}</span>
    </button>
  );
}
