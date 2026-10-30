"use client";

import { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Modal from "@/components/ui/Modal";
import Spinner from "@/components/ui/Spinner";
import { cn } from "@/lib/cn";

const FILTERS = ["ALL", "STUDENT", "FACULTY", "ADMIN"];

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

export default function UsersAdmin({ meId, protectedEmails = [] }) {
  const protectedSet = useMemo(
    () => new Set((protectedEmails || []).map((e) => String(e).toLowerCase())),
    [protectedEmails],
  );

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [query, setQuery] = useState("");

  const [manage, setManage] = useState(null); // user being managed
  const [draftType, setDraftType] = useState("STUDENT");
  const [confirm, setConfirm] = useState(null); // { kind: 'promote'|'revoke'|'delete' }
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not load users.");
      setUsers(data.users || []);
    } catch (e) {
      setLoadError(e.message || "Could not load users.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const adminCount = useMemo(() => users.filter((u) => u.isAdmin).length, [users]);
  const shown = useMemo(
    () => users.filter((u) => matchesFilter(u, filter) && matchesSearch(u, query)),
    [users, filter, query],
  );
  const count = (f) => users.filter((u) => matchesFilter(u, f)).length;

  const isProtected = (u) => protectedSet.has((u?.email || "").toLowerCase());
  const isSelf = (u) => u?.id === meId;
  const isLastAdmin = (u) => u?.isAdmin && adminCount <= 1;

  function openManage(u) {
    setManage(u);
    setDraftType(u.baseType);
    setConfirm(null);
    setActionError("");
  }

  async function saveType() {
    if (!manage || draftType === manage.baseType) { setManage(null); return; }
    await run(() => fetch(`/api/admin/users/${manage.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseType: draftType }),
    }), (data) => setUsers((p) => p.map((u) => u.id === manage.id ? { ...u, baseType: data.baseType } : u)));
  }

  async function setAdmin(next) {
    await run(() => fetch(`/api/admin/users/${manage.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isAdmin: next }),
    }), (data) => {
      setUsers((p) => p.map((u) => u.id === manage.id ? { ...u, isAdmin: data.isAdmin } : u));
      setManage((m) => m ? { ...m, isAdmin: data.isAdmin } : m);
      setConfirm(null);
    });
  }

  async function deleteUser() {
    const id = manage.id;
    await run(() => fetch(`/api/admin/users/${id}`, { method: "DELETE" }), () => {
      setUsers((p) => p.filter((u) => u.id !== id));
      setManage(null);
      setConfirm(null);
    });
  }

  // Shared request wrapper: sets busy, surfaces server error, runs onOk(data).
  async function run(req, onOk) {
    setBusy(true);
    setActionError("");
    try {
      const res = await req();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Action failed.");
      onOk(data);
    } catch (e) {
      setActionError(e.message || "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="People & roles"
        subtitle={`${users.length} registered account${users.length === 1 ? "" : "s"} · ${adminCount} admin${adminCount === 1 ? "" : "s"} · reviewer / SPOC / editor roles are assigned per paper`}
        action={<Button variant="outline" onClick={load} disabled={loading}><Icon name="activity" size={16} /> Refresh</Button>}
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <FilterChip key={f} label={f} count={count(f)} active={filter === f} onClick={() => setFilter(f)} />
          ))}
        </div>
        <div className="w-full sm:w-72">
          <Input placeholder="Search name or email…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search users" />
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="hidden border-b border-line bg-soft px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted md:grid md:grid-cols-[1.6fr_0.7fr_1fr_auto] md:gap-3">
          <span>Person</span><span>Base type</span><span>Status</span><span className="text-right">Manage</span>
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
              <li key={u.id} className="flex flex-col gap-3 px-4 py-3.5 sm:px-5 md:grid md:grid-cols-[1.6fr_0.7fr_1fr_auto] md:items-center md:gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">
                    {u.name}
                    {u.isAdmin && <Tag className="bg-brand text-white" icon="shield">ADMIN</Tag>}
                    {isProtected(u) && <Tag className="bg-soft-2 text-muted" icon="lock">PROTECTED</Tag>}
                    {isSelf(u) && <Tag className="bg-soft-2 text-muted">YOU</Tag>}
                  </p>
                  <p className="truncate text-xs text-muted">{u.email}</p>
                </div>
                <div className="text-sm text-muted">{u.baseType}</div>
                <div>
                  {u.verified
                    ? <span className="inline-flex items-center gap-1 rounded-md border border-ok/30 bg-ok-soft px-2 py-0.5 text-xs font-semibold text-ok"><Icon name="check" size={12} /> Verified</span>
                    : <span className="inline-flex items-center gap-1 rounded-md border border-warn/30 bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn">Pending</span>}
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
        footer={
          confirm ? null : (
            <>
              <Button variant="outline" onClick={() => setManage(null)} disabled={busy}>Close</Button>
              <Button variant="primary" onClick={saveType} disabled={busy || !manage || draftType === manage.baseType}>
                {busy ? "Saving…" : "Save base type"}
              </Button>
            </>
          )
        }
      >
        {manage && !confirm && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              {manage.email} · {manage.verified ? "verified" : "email not yet verified"}
              {manage.applicationNo ? <> · app no. <b className="text-ink">{manage.applicationNo}</b></> : null}
            </p>

            <Select
              label="Base type"
              options={[{ value: "STUDENT", label: "Student" }, { value: "FACULTY", label: "Faculty" }]}
              value={draftType}
              onChange={(e) => setDraftType(e.target.value)}
            />

            <div className="rounded-lg border border-line p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Administrator access</p>
              <p className="mt-1 text-sm text-ink">{manage.isAdmin ? "This account IS an administrator." : "This account is not an administrator."}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {manage.isAdmin ? (
                  <Button variant="outline" size="sm" disabled={isSelf(manage) || isProtected(manage) || isLastAdmin(manage)} onClick={() => { setActionError(""); setConfirm({ kind: "revoke" }); }}>
                    Revoke admin
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled={isSelf(manage)} onClick={() => { setActionError(""); setConfirm({ kind: "promote" }); }}>
                    <Icon name="shield" size={14} /> Make admin
                  </Button>
                )}
                <Button variant="outline" size="sm" className="border-danger/40 text-danger hover:bg-danger-soft" disabled={isSelf(manage) || isProtected(manage) || isLastAdmin(manage)} onClick={() => { setActionError(""); setConfirm({ kind: "delete" }); }}>
                  Delete user
                </Button>
              </div>
              {(isSelf(manage) || isProtected(manage) || isLastAdmin(manage)) && (
                <p className="mt-2 text-xs text-muted">
                  {isSelf(manage) ? "You can't change or delete your own admin account here. "
                    : isProtected(manage) ? "This is a protected original admin and can't be demoted or deleted. "
                    : "This is the last administrator and can't be demoted or deleted. "}
                </p>
              )}
            </div>

            {actionError && <p className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">{actionError}</p>}
            <p className="rounded-lg bg-soft-2 px-3 py-2 text-xs text-muted">Reviewer, SPOC and Editor roles are granted per paper, never globally here.</p>
          </div>
        )}

        {manage && confirm && (
          <div className="space-y-4">
            <div className={cn("rounded-lg border px-4 py-3 text-sm",
              confirm.kind === "delete" ? "border-danger/30 bg-danger-soft text-ink" : "border-warn/30 bg-warn-soft text-ink")}>
              {confirm.kind === "promote" && <>Grant <b>full administrator</b> access to <b>{manage.email}</b>? They will be able to manage all users and roles, exactly like existing admins.</>}
              {confirm.kind === "revoke" && <>Revoke administrator access from <b>{manage.email}</b>? They will lose all admin abilities.</>}
              {confirm.kind === "delete" && <>Permanently delete <b>{manage.email}</b>? This removes their account and profile for good — they will no longer be able to log in. This cannot be undone.</>}
            </div>
            {actionError && <p className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">{actionError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setConfirm(null); setActionError(""); }} disabled={busy}>Cancel</Button>
              {confirm.kind === "promote" && <Button variant="primary" onClick={() => setAdmin(true)} disabled={busy}>{busy ? "Granting…" : "Grant admin"}</Button>}
              {confirm.kind === "revoke" && <Button variant="primary" onClick={() => setAdmin(false)} disabled={busy}>{busy ? "Revoking…" : "Revoke admin"}</Button>}
              {confirm.kind === "delete" && <Button variant="primary" className="bg-danger hover:bg-danger/90" onClick={deleteUser} disabled={busy}>{busy ? "Deleting…" : "Delete permanently"}</Button>}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function Tag({ children, className, icon }) {
  return (
    <span className={cn("ml-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold align-middle", className)}>
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
