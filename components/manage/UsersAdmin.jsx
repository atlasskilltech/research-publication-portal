"use client";

import { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import Select from "@/components/ui/Select";
import Modal from "@/components/ui/Modal";
import Spinner from "@/components/ui/Spinner";
import { cn } from "@/lib/cn";

const FILTERS = ["ALL", "STUDENT", "FACULTY", "ADMIN"];

function matches(user, filter) {
  if (filter === "ALL") return true;
  if (filter === "ADMIN") return user.isAdmin;
  return user.baseType === filter;
}

export default function UsersAdmin() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [manage, setManage] = useState(null); // user being managed
  const [draftType, setDraftType] = useState("STUDENT");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

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

  useEffect(() => {
    load();
  }, []);

  const shown = useMemo(() => users.filter((u) => matches(u, filter)), [users, filter]);
  const count = (f) => users.filter((u) => matches(u, f)).length;

  function openManage(u) {
    setManage(u);
    setDraftType(u.baseType);
    setSaveError("");
  }

  async function saveType() {
    if (!manage || draftType === manage.baseType) {
      setManage(null);
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch(`/api/admin/users/${manage.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseType: draftType }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not update the user.");
      setUsers((prev) => prev.map((u) => (u.id === manage.id ? { ...u, baseType: data.baseType } : u)));
      setManage(null);
    } catch (e) {
      setSaveError(e.message || "Could not update the user.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="People & roles"
        subtitle={`${users.length} registered account${users.length === 1 ? "" : "s"} · everyone starts as Submitter · reviewer / SPOC / editor roles are assigned per paper`}
        action={
          <Button variant="outline" onClick={load} disabled={loading}>
            <Icon name="activity" size={16} /> Refresh
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <FilterChip key={f} label={f} count={count(f)} active={filter === f} onClick={() => setFilter(f)} />
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="hidden border-b border-line bg-soft px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted md:grid md:grid-cols-[1.6fr_0.7fr_1fr_auto] md:gap-3">
          <span>Person</span><span>Base type</span><span>Status</span><span className="text-right">Manage</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-muted">
            <Spinner /> Loading users…
          </div>
        ) : loadError ? (
          <div className="px-5 py-10 text-center text-sm text-danger">
            {loadError}
            <div className="mt-3"><Button variant="outline" size="sm" onClick={load}>Retry</Button></div>
          </div>
        ) : shown.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted">No accounts in this view yet.</div>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((u) => (
              <li key={u.id} className="flex flex-col gap-3 px-4 py-3.5 sm:px-5 md:grid md:grid-cols-[1.6fr_0.7fr_1fr_auto] md:items-center md:gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">
                    {u.name}
                    {u.isAdmin && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-md bg-brand px-1.5 py-0.5 text-[10px] font-semibold text-white align-middle">
                        <Icon name="shield" size={11} /> ADMIN
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted">{u.email}</p>
                </div>
                <div className="text-sm text-muted">{u.baseType}</div>
                <div>
                  {u.verified ? (
                    <span className="inline-flex items-center gap-1 rounded-md border border-ok/30 bg-ok-soft px-2 py-0.5 text-xs font-semibold text-ok">
                      <Icon name="check" size={12} /> Verified
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-md border border-warn/30 bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn">
                      Pending
                    </span>
                  )}
                </div>
                <div className="md:text-right">
                  <Button variant="outline" size="sm" onClick={() => openManage(u)}>Manage</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={!!manage}
        onClose={() => setManage(null)}
        eyebrow="Manage person"
        title={manage?.name}
        footer={
          <>
            <Button variant="outline" onClick={() => setManage(null)} disabled={saving}>Cancel</Button>
            <Button variant="primary" onClick={saveType} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </>
        }
      >
        {manage && (
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

            {saveError && (
              <p className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">{saveError}</p>
            )}

            <p className="rounded-lg bg-soft-2 px-3 py-2 text-xs text-muted">
              {manage.isAdmin ? (
                <>This account is an <b className="text-ink">Administrator</b>. Admin rights are managed only by the server-side provisioning script and can&apos;t be changed here.</>
              ) : (
                <>Reviewer, SPOC and Editor roles are granted per paper from a paper&apos;s <b className="text-ink">Access &amp; roles</b> tab, never globally here.</>
              )}
            </p>
          </div>
        )}
      </Modal>
    </>
  );
}

function FilterChip({ label, count, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
        active ? "border-brand bg-brand text-white" : "border-line bg-white text-ink hover:bg-soft",
      )}
    >
      {label}
      <span className={cn(active ? "text-white/80" : "text-muted")}>· {count}</span>
    </button>
  );
}
