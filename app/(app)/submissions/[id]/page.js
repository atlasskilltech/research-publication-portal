"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import PageHeader from "@/components/layout/PageHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import Select from "@/components/ui/Select";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import Badge from "@/components/ui/Badge";
import Spinner from "@/components/ui/Spinner";

const ROLE_OPTS = [
  { value: "SPOC", label: "SPOC" },
  { value: "DESK_REVIEWER", label: "Desk Reviewer" },
  { value: "PEER_REVIEWER", label: "Peer Reviewer" },
  { value: "EDITOR", label: "Editor" },
];
const ROLE_LABEL = Object.fromEntries(ROLE_OPTS.map((r) => [r.value, r.label]));
const fmtBytes = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

export default function SubmissionDetailPage() {
  const { id } = useParams();
  const [paper, setPaper] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const res = await fetch(`/api/papers/${id}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not load the submission.");
      setPaper(data.paper);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (id) load(); }, [id]);

  if (loading) return <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted"><Spinner /> Loading…</div>;
  if (error) return (
    <Card className="px-6 py-12 text-center text-sm text-danger">{error}
      <div className="mt-3"><Button href="/submissions" variant="outline" size="sm">Back to submissions</Button></div></Card>
  );
  if (!paper) return null;

  const isAdmin = paper.viewerRole === "admin";
  const privileged = paper.viewerRole === "admin" || paper.viewerRole === "owner";

  return (
    <>
      <PageHeader
        eyebrow={`Submission · ${paper.viewerRole}`}
        title={paper.title}
        subtitle={<span className="flex items-center gap-2"><Badge>{paper.status}</Badge> <span className="text-xs text-muted">submitted {new Date(paper.createdAt).toLocaleDateString()}</span></span>}
        action={<Button href="/submissions" variant="outline" size="sm">← Back</Button>}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Abstract</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{paper.abstract || <span className="text-muted">No abstract provided.</span>}</p>
            {paper.keywords?.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {paper.keywords.map((k) => <Badge key={k} className="bg-soft-2 text-muted border-line">{k}</Badge>)}
              </div>
            )}
          </Card>

          {/* Authors — privileged only (double-blind) */}
          {privileged ? (
            <Card className="p-5">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Authors</h2>
              <ul className="mt-2 divide-y divide-line">
                {(paper.authors || []).map((a) => (
                  <li key={a.order} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      <span className="font-semibold text-ink">{a.fullName}</span>
                      {a.isCorresponding && <Badge className="ml-2 bg-brand text-white border-brand">Corresponding</Badge>}
                      <p className="text-xs text-muted">{[a.email, a.affiliation].filter(Boolean).join(" · ") || "—"}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
            <Card className="p-5">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Authors</h2>
              <p className="mt-2 flex items-center gap-2 text-sm text-muted"><Icon name="lock" size={14} /> Hidden for double-blind review.</p>
            </Card>
          )}

          {paper.canReview && <ReviewForm paperId={id} />}
          {paper.viewerRole === "admin" && <AdminReviews paperId={id} />}
          {privileged && <ActivityCard activity={paper.activity} isAdmin={isAdmin} />}
        </div>

        <aside className="space-y-5">
          <Card className="p-5">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Manuscript</h2>
            {paper.manuscript ? (
              <>
                <p className="mt-2 text-sm text-ink">{privileged && paper.manuscript.originalFilename ? paper.manuscript.originalFilename : "Manuscript file"}</p>
                <p className="text-xs text-muted">{paper.manuscript.mimeType} · {fmtBytes(paper.manuscript.byteSize)}</p>
                <a href={`/api/papers/${id}/manuscript`} download
                  className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-soft">
                  <Icon name="download" size={14} /> Download
                </a>
                {!privileged && <p className="mt-2 text-xs text-muted">Note: the manuscript may still contain identifying information; the portal does not alter the uploaded file.</p>}
              </>
            ) : <p className="mt-2 text-sm text-muted">No manuscript on file.</p>}
          </Card>

          <AssignmentsCard paper={paper} isAdmin={isAdmin} id={id} onChanged={load} />
        </aside>
      </div>
    </>
  );
}

function AssignmentsCard({ paper, isAdmin, id, onChanged }) {
  const [users, setUsers] = useState([]);
  const [role, setRole] = useState("SPOC");
  const [assignee, setAssignee] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/admin/users", { cache: "no-store" }).then((r) => r.json()).then((d) => setUsers(d.users || [])).catch(() => {});
  }, [isAdmin]);

  // Only users who already hold the chosen role (reuse the user_roles system).
  const eligible = useMemo(() => users.filter((u) => (u.roles || []).includes(role)), [users, role]);
  const nameById = useMemo(() => new Map(users.map((u) => [u.id, u.name || u.email])), [users]);
  const isReviewRole = role === "PEER_REVIEWER" || role === "DESK_REVIEWER";
  useEffect(() => { setAssignee(""); }, [role]);

  async function assign() {
    if (!assignee) { setMsg("Pick a user."); return; }
    setBusy(true); setMsg("");
    try {
      const res = await fetch(`/api/papers/${id}/assign`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignee, role, dueAt: isReviewRole && dueAt ? new Date(`${dueAt}T23:59:59`).toISOString() : null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not assign.");
      setMsg("Assigned."); setAssignee(""); setDueAt("");
      onChanged?.();
    } catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  }

  async function unassign(a) {
    setBusy(true); setMsg("");
    try {
      const res = await fetch(`/api/papers/${id}/assign`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignee: a.assignee, role: a.role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not remove.");
      setMsg("Removed.");
      onChanged?.();
    } catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Card className="p-5">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Assignments</h2>
      {paper.assignments?.length ? (
        <ul className="mt-2 space-y-1.5">
          {paper.assignments.map((a, i) => (
            <li key={i} className="flex items-center gap-2 text-sm">
              <Badge className="bg-soft-2 text-ink border-line">{ROLE_LABEL[a.role] || a.role}</Badge>
              {isAdmin && <span className="min-w-0 flex-1 truncate text-xs text-ink">{nameById.get(a.assignee) || "…"}</span>}
              {a.dueAt && <span className="text-[11px] text-muted">due {new Date(a.dueAt).toLocaleDateString()}</span>}
              {isAdmin && (
                <button type="button" disabled={busy} onClick={() => unassign(a)}
                  className="text-[11px] font-semibold text-danger hover:underline disabled:opacity-50">Remove</button>
              )}
            </li>
          ))}
        </ul>
      ) : <p className="mt-2 text-sm text-muted">No one assigned yet.</p>}

      {isAdmin && (
        <div className="mt-4 space-y-2 border-t border-line pt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Assign next responsible person</p>
          <Select options={ROLE_OPTS} value={role} onChange={(e) => setRole(e.target.value)} />
          <Select
            options={[{ value: "", label: eligible.length ? "Select a user…" : "No users hold this role" }, ...eligible.map((u) => ({ value: u.id, label: `${u.name} (${u.email})` }))]}
            value={assignee} onChange={(e) => setAssignee(e.target.value)}
          />
          {isReviewRole && (
            <Input type="date" label="Review deadline (optional)" value={dueAt}
              min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDueAt(e.target.value)} />
          )}
          <Button variant="primary" size="sm" full onClick={assign} disabled={busy || !assignee}>{busy ? "Assigning…" : "Assign"}</Button>
          {msg && <p className="text-xs text-muted">{msg}</p>}
          <p className="text-[11px] text-muted">Only users who already hold the role (People &amp; roles) can be assigned. The submitter and listed authors are blocked.</p>
        </div>
      )}
    </Card>
  );
}

const RECS = [
  { value: "", label: "Select…" },
  { value: "ACCEPT", label: "Accept" },
  { value: "MINOR_REVISION", label: "Minor Revision" },
  { value: "MAJOR_REVISION", label: "Major Revision" },
  { value: "REJECT", label: "Reject" },
];
const REC_LABEL = { ACCEPT: "Accept", MINOR_REVISION: "Minor Revision", MAJOR_REVISION: "Major Revision", REJECT: "Reject" };
const SCORE_OPTS = [{ value: "", label: "—" }, ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))];
const SCORE_ROWS = [
  ["technicalQuality", "Technical quality"],
  ["originality", "Originality"],
  ["methodology", "Methodology"],
  ["clarity", "Clarity & presentation"],
];
const emptyForm = { recommendation: "", technicalQuality: "", originality: "", methodology: "", clarity: "", strengths: "", weaknesses: "", commentsToAuthor: "", confidentialToEditor: "" };

function ReviewForm({ paperId }) {
  const [review, setReview] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [issues, setIssues] = useState({});
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/papers/${paperId}/review`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.review) {
          const r = data.review;
          setReview(r);
          setForm({
            recommendation: r.recommendation || "",
            technicalQuality: r.technical_quality ?? "", originality: r.originality ?? "",
            methodology: r.methodology ?? "", clarity: r.clarity ?? "",
            strengths: r.strengths || "", weaknesses: r.weaknesses || "",
            commentsToAuthor: r.comments_to_author || "", confidentialToEditor: r.confidential_to_editor || "",
          });
        }
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId]);

  const submitted = review?.status === "SUBMITTED";
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function save(final) {
    setBusy(true); setMsg(""); setIssues({});
    try {
      const res = await fetch(`/api/papers/${paperId}/review`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, status: final ? "SUBMITTED" : "DRAFT" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(data.error || "Could not save."); if (data.issues) setIssues(data.issues); setConfirming(false); return; }
      setReview((r) => ({ ...(r || {}), status: data.status }));
      setMsg(final ? "Review submitted." : "Draft saved."); setConfirming(false);
    } catch { setMsg("Something went wrong."); }
    finally { setBusy(false); }
  }

  if (loading) return <Card className="p-5"><p className="flex items-center gap-2 text-sm text-muted"><Spinner /> Loading your review…</p></Card>;

  if (submitted) {
    return (
      <Card className="p-5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Your review · submitted</h2>
        <p className="mt-2 text-sm text-ink">Recommendation: <Badge className="bg-brand text-white border-brand">{REC_LABEL[review.recommendation] || review.recommendation}</Badge></p>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          {SCORE_ROWS.map(([k, label]) => <div key={k}><dt className="text-xs text-muted">{label}</dt><dd className="font-semibold text-ink">{form[k] || "—"}/5</dd></div>)}
        </dl>
        <p className="mt-3 text-xs text-muted">Your review is final and can no longer be edited.</p>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Your review</h2>
      <div className="mt-3 space-y-4">
        <Select label="Overall recommendation" options={RECS} value={form.recommendation} onChange={(e) => set("recommendation", e.target.value)} error={issues.recommendation} />
        <div className="grid grid-cols-2 gap-3">
          {SCORE_ROWS.map(([k, label]) => (
            <Select key={k} label={label} options={SCORE_OPTS} value={String(form[k])} onChange={(e) => set(k, e.target.value)} error={issues[k.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase())]} />
          ))}
        </div>
        <Textarea label="Strengths" rows={3} value={form.strengths} onChange={(e) => set("strengths", e.target.value)} />
        <Textarea label="Weaknesses" rows={3} value={form.weaknesses} onChange={(e) => set("weaknesses", e.target.value)} />
        <Textarea label="Comments to the author" rows={4} value={form.commentsToAuthor} onChange={(e) => set("commentsToAuthor", e.target.value)} />
        <div>
          <Textarea label="Confidential comments to the editor" rows={3} value={form.confidentialToEditor} onChange={(e) => set("confidentialToEditor", e.target.value)} />
          <p className="mt-1 flex items-center gap-1 text-xs text-muted"><Icon name="lock" size={12} /> Never shown to the author.</p>
        </div>
        {Object.keys(issues).length > 0 && <p className="text-xs text-danger">Please complete the required fields above.</p>}
        {msg && <p className="text-xs text-muted">{msg}</p>}
        {confirming ? (
          <div className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-3 text-sm">
            Submit your review? It becomes final and cannot be edited.
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={() => save(true)} disabled={busy}>{busy ? "Submitting…" : "Submit final review"}</Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => save(false)} disabled={busy}>{busy ? "Saving…" : "Save draft"}</Button>
            <Button variant="primary" size="sm" onClick={() => setConfirming(true)} disabled={busy}>Submit review</Button>
          </div>
        )}
      </div>
    </Card>
  );
}

const DEADLINE_BADGE = {
  overdue: { label: "Overdue", cls: "bg-danger-soft text-danger border-danger/30" },
  due_soon: { label: "Due soon", cls: "bg-warn-soft text-warn border-warn/30" },
};

function AdminReviews({ paperId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/papers/${paperId}/reviews`, { cache: "no-store" });
        const d = await res.json().catch(() => ({}));
        if (res.ok) setData(d);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId]);

  if (loading) return <Card className="p-5"><p className="flex items-center gap-2 text-sm text-muted"><Spinner /> Loading reviews…</p></Card>;
  if (!data) return null;

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Review progress</h2>
        <span className="text-xs text-muted">
          {data.summary.submitted}/{data.summary.assigned} submitted · {data.summary.draft} in draft · {data.summary.pending} not started
          {data.summary.overdue > 0 && <span className="text-danger"> · {data.summary.overdue} overdue</span>}
        </span>
      </div>
      {data.reviewers.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No reviewers assigned yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {data.reviewers.map((rv) => (
            <li key={`${rv.reviewer}:${rv.role}`} className="py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{rv.reviewerName || rv.reviewer}</p>
                  <p className="truncate text-xs text-muted">
                    {[rv.reviewerEmail, ROLE_LABEL[rv.role], rv.dueAt && `due ${new Date(rv.dueAt).toLocaleDateString()}`].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {DEADLINE_BADGE[rv.deadline] && <Badge className={DEADLINE_BADGE[rv.deadline].cls}>{DEADLINE_BADGE[rv.deadline].label}</Badge>}
                  {rv.review?.recommendation && <Badge className="bg-soft-2 text-ink border-line">{REC_LABEL[rv.review.recommendation]}</Badge>}
                  <Badge className={rv.reviewStatus === "SUBMITTED" ? "bg-ok-soft text-ok border-ok/30" : rv.reviewStatus === "DRAFT" ? "bg-warn-soft text-warn border-warn/30" : "bg-soft-2 text-muted border-line"}>{rv.reviewStatus}</Badge>
                  {rv.review && <button type="button" className="text-xs font-semibold text-accent hover:underline" onClick={() => setOpen(open === rv.reviewer ? null : rv.reviewer)}>{open === rv.reviewer ? "Hide" : "View"}</button>}
                </div>
              </div>
              {open === rv.reviewer && rv.review && (
                <div className="mt-2 space-y-2 rounded-lg bg-soft px-3 py-2 text-sm">
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    {SCORE_ROWS.map(([k, label]) => <div key={k}>{label}: <b>{rv.review[k.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase())] ?? "—"}</b></div>)}
                  </div>
                  {rv.review.strengths && <p><span className="text-xs font-semibold text-muted">Strengths:</span> {rv.review.strengths}</p>}
                  {rv.review.weaknesses && <p><span className="text-xs font-semibold text-muted">Weaknesses:</span> {rv.review.weaknesses}</p>}
                  {rv.review.comments_to_author && <p><span className="text-xs font-semibold text-muted">To author:</span> {rv.review.comments_to_author}</p>}
                  {rv.review.confidential_to_editor && (
                    <p className="rounded bg-warn-soft px-2 py-1"><span className="inline-flex items-center gap-1 text-xs font-semibold text-warn"><Icon name="lock" size={11} /> Confidential to editor:</span> {rv.review.confidential_to_editor}</p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-muted">Editorial decisions are handled in a later phase.</p>
    </Card>
  );
}

const ACTION_LABEL = {
  SUBMITTED: "Paper submitted",
  ASSIGNED: "Assignment added",
  UNASSIGNED: "Assignment removed",
  REVIEW_STARTED: "Review started",
  REVIEW_SUBMITTED: "Review submitted",
  MANUSCRIPT_DOWNLOADED: "Manuscript downloaded by reviewer",
};

function ActivityCard({ activity, isAdmin }) {
  const items = activity || [];
  return (
    <Card className="p-5">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Activity</h2>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No activity yet.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {items.map((a, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-ink">
                {ACTION_LABEL[a.action] || a.action}
                {isAdmin && a.detail?.role && <span className="text-xs text-muted"> · {ROLE_LABEL[a.detail.role] || a.detail.role}</span>}
                {isAdmin && a.detail?.recommendation && <span className="text-xs text-muted"> · {REC_LABEL[a.detail.recommendation] || a.detail.recommendation}</span>}
              </span>
              <time className="shrink-0 text-xs text-muted">{new Date(a.created_at).toLocaleString()}</time>
            </li>
          ))}
        </ul>
      )}
      {!isAdmin && <p className="mt-3 text-[11px] text-muted">Reviewer activity is hidden to keep the review blind.</p>}
    </Card>
  );
}
