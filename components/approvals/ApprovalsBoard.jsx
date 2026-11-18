"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Icon from "@/components/ui/Icon";
import Spinner from "@/components/ui/Spinner";
import Textarea from "@/components/ui/Textarea";
import EmptyState from "@/components/ui/EmptyState";
import { DecisionBadge } from "@/components/decisions/DecisionBadge";
import RefId from "@/components/ui/RefId";

const REC_LABEL = { ACCEPT: "Accept", MINOR_REVISION: "Minor revision", MAJOR_REVISION: "Major revision", REJECT: "Reject" };
const fmt = (d) => (d ? new Date(d).toLocaleString() : "—");
const fmtDay = (d) => (d ? new Date(d).toLocaleDateString() : "—");
const STATUS = {
  APPROVED: { label: "Approved", cls: "bg-ok-soft text-ok border-ok/30" },
  RETURNED: { label: "Sent back", cls: "bg-danger-soft text-danger border-danger/30" },
};

/**
 * Program Chair "Final Approvals": every Accept / Minor / Major revision
 * decision waits here before it reaches the author. The approver can read the
 * paper (with author names), the editor's decision and the reviews, then
 * Approve (sent to the author unchanged) or Send back (to the editor, with a
 * comment). The decision itself can't be changed here. Server-enforced.
 */
export default function ApprovalsBoard({ asChair = false }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/approvals", { cache: "no-store" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not load approvals.");
      setData(d);
    } catch (e) { setError(e.message || "Could not load approvals."); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const pending = data?.pending || [];
  const recent = data?.recent || [];

  return (
    <div>
      <PageHeader
        eyebrow={asChair ? "Program Chair" : "Administrator · Program Chair backup"}
        title="Final Approvals"
        subtitle="Accept and revision decisions reach the author only after final approval. Approve a decision as the editor wrote it, or send it back to the editor with a comment. Reject decisions don't come here."
      />

      {flash && <p className="mb-4 rounded-lg border border-ok/30 bg-ok-soft px-3 py-2 text-sm text-ok" role="status">{flash}</p>}

      {loading ? (
        <Card className="p-5"><p className="flex items-center gap-2 text-sm text-muted"><Spinner /> Loading approvals…</p></Card>
      ) : error ? (
        <Card className="p-5">
          <p className="text-sm text-danger" role="alert">{error}</p>
          <button type="button" onClick={load} className="mt-2 text-xs font-semibold text-accent hover:underline">Try again</button>
        </Card>
      ) : (
        <>
          <section className="mb-8">
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted">Waiting for approval ({pending.length})</h2>
            {pending.length === 0 ? (
              <EmptyState icon="checks" title="Nothing to approve" message="When an editor sends an Accept or Revision decision for final approval, it will appear here." />
            ) : (
              <div className="space-y-4">
                {pending.map((item) => (
                  <ApprovalCard key={item.id} item={item} onDone={(msg) => { setFlash(msg); load(); }} />
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted">Recent approvals</h2>
            {recent.length === 0 ? <p className="text-sm text-muted">No approvals yet.</p> : (
              <Card className="divide-y divide-line">
                {recent.map((r) => (
                  <div key={r.id} className="flex flex-col gap-1 p-4 text-sm sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-semibold text-ink"><RefId value={r.refId} />{r.title}</p>
                      <p className="mt-0.5 text-xs text-muted">Round {r.round + 1} · requested by {r.requestedBy || "—"} · {fmtDay(r.requestedAt)}</p>
                      {r.comment && <p className="mt-1 whitespace-pre-wrap text-xs text-ink">“{r.comment}”</p>}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                      <DecisionBadge decision={r.decision} />
                      <Badge className={STATUS[r.status]?.cls}>{STATUS[r.status]?.label || r.status}</Badge>
                      <span className="text-xs text-muted">{r.actedBy || "—"} · {fmt(r.actedAt)}</span>
                    </div>
                  </div>
                ))}
              </Card>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function ApprovalCard({ item, onDone }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(null); // "approve" | "return"
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const { paper, decision } = item;

  async function act() {
    setBusy(true); setMsg("");
    try {
      const res = await fetch(`/api/approvals/${item.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: mode, comment }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Action failed.");
      onDone(mode === "approve"
        ? `Approved: “${paper.title}”. The decision has been sent to the author.`
        : `Sent back to the editor: “${paper.title}”.`);
    } catch (e) { setMsg(e.message || "Action failed."); }
    finally { setBusy(false); }
  }

  return (
    <Card className="p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <RefId value={paper.refId} />
          <p className="text-lg font-bold text-ink">{paper.title}</p>
          <p className="mt-0.5 text-xs text-muted">
            Round {decision.round + 1}{decision.round > 0 ? ` (revision ${decision.round})` : ""} · sent by {item.requestedBy || "—"} · {fmt(item.requestedAt)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-muted">Editor&apos;s decision</span>
          <DecisionBadge decision={decision.decision} />
        </div>
      </div>

      {/* Authors (visible to the Program Chair) */}
      <div className="mt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Authors</p>
        {item.authors.length ? (
          <ul className="mt-1 space-y-0.5 text-sm">
            {item.authors.map((a, i) => (
              <li key={i} className="text-ink">
                {a.name}{a.corresponding && <span className="ml-1 text-xs text-muted">(corresponding)</span>}
                {a.affiliation && <span className="text-muted"> · {a.affiliation}</span>}
                {a.email && <span className="text-muted"> · {a.email}</span>}
              </li>
            ))}
          </ul>
        ) : <p className="mt-1 text-sm text-ink">{item.submittedBy ? `${item.submittedBy.name} · ${item.submittedBy.email}` : "—"}</p>}
        {item.authors.length > 0 && item.submittedBy && <p className="mt-1 text-xs text-muted">Submitted by {item.submittedBy.name} ({item.submittedBy.email})</p>}
      </div>

      {/* Editor's decision (read-only) */}
      <div className="mt-4 rounded-lg border border-line bg-soft/50 p-3 text-sm">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Editor&apos;s message to the author{decision.decidedBy ? ` · ${decision.decidedBy}` : ""}</p>
        <p className="mt-1 whitespace-pre-wrap text-ink">{decision.summary}</p>
        {decision.revisionDueAt && <p className="mt-2 text-xs text-muted">Revision deadline: {fmtDay(decision.revisionDueAt)}</p>}
        {decision.confidentialNote && (
          <p className="mt-2 rounded bg-warn-soft px-2 py-1 text-xs"><span className="inline-flex items-center gap-1 font-semibold text-warn"><Icon name="lock" size={11} /> Confidential note:</span> {decision.confidentialNote}</p>
        )}
      </div>

      {item.previous.length > 0 && (
        <div className="mt-3 text-xs">
          <p className="font-semibold text-muted">Earlier on this decision</p>
          <ul className="mt-1 space-y-1">
            {item.previous.map((p) => (
              <li key={p.id} className="text-muted">
                <span className={p.status === "RETURNED" ? "font-semibold text-danger" : "font-semibold text-ok"}>{p.label}</span>
                {" · "}{p.actedBy || "—"}, {fmt(p.actedAt)}
                {p.comment && <span className="block whitespace-pre-wrap text-ink">“{p.comment}”</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        <button type="button" onClick={() => setOpen((v) => !v)} className="font-semibold text-accent hover:underline">
          {open ? "Hide paper and reviews" : `Show abstract and ${item.reviews.length} review${item.reviews.length === 1 ? "" : "s"}`}
        </button>
        <a href={paper.manuscriptUrl} className="inline-flex items-center gap-1 font-semibold text-accent hover:underline"><Icon name="download" size={14} /> Download manuscript</a>
      </div>

      {open && (
        <div className="mt-3 space-y-3 border-t border-line pt-3 text-sm">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Abstract</p>
            <p className="mt-1 whitespace-pre-wrap text-ink">{paper.abstract}</p>
            {paper.keywords.length > 0 && <p className="mt-1 text-xs text-muted">Keywords: {paper.keywords.join(", ")}</p>}
          </div>
          {item.reviews.map((r) => (
            <div key={r.id} className="rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-ink">{r.reviewer}</span>
                <Badge className="bg-soft-2 text-ink border-line">recommends {REC_LABEL[r.recommendation] || r.recommendation || "—"}</Badge>
                {r.sharedWithAuthor && <Badge className="bg-ok-soft text-ok border-ok/30">shared with author</Badge>}
              </div>
              <p className="mt-1 text-xs text-muted">
                Scores — technical quality {r.scores.technicalQuality ?? "—"}, originality {r.scores.originality ?? "—"}, methodology {r.scores.methodology ?? "—"}, clarity {r.scores.clarity ?? "—"}
              </p>
              {r.strengths && <p className="mt-2 whitespace-pre-wrap"><span className="font-semibold">Strengths: </span>{r.strengths}</p>}
              {r.weaknesses && <p className="mt-1 whitespace-pre-wrap"><span className="font-semibold">Weaknesses: </span>{r.weaknesses}</p>}
              {r.commentsToAuthor && <p className="mt-1 whitespace-pre-wrap"><span className="font-semibold">Comments to author: </span>{r.commentsToAuthor}</p>}
              {r.confidentialToEditor && <p className="mt-1 whitespace-pre-wrap text-xs"><span className="font-semibold text-warn">Confidential to editor: </span>{r.confidentialToEditor}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 border-t border-line pt-3">
        {!item.canAct ? (
          <p className="text-xs text-muted">You are an author of this paper, so another approver must handle it.</p>
        ) : mode ? (
          <div className={mode === "approve" ? "rounded-lg border border-ok/30 bg-ok-soft p-3 text-sm" : "rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm"}>
            <p className="font-semibold text-ink">
              {mode === "approve"
                ? `Approve this ${decision.label.toLowerCase()} decision? It will be sent to the author exactly as written.`
                : "Send this decision back to the editor? Nothing will be sent to the author."}
            </p>
            <div className="mt-2">
              <Textarea
                label={mode === "approve" ? "Comment (optional, for the editor)" : "Comment for the editor (required)"}
                rows={3} value={comment} onChange={(e) => setComment(e.target.value)}
              />
            </div>
            {msg && <p className="mt-1 text-xs text-danger" role="alert">{msg}</p>}
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setMode(null); setMsg(""); }} disabled={busy}>Cancel</Button>
              <Button variant={mode === "approve" ? "primary" : "danger"} size="sm" onClick={act}
                disabled={busy || (mode === "return" && !comment.trim())}>
                {busy ? "Saving…" : mode === "approve" ? "Approve and send to author" : "Send back to editor"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="danger" size="sm" onClick={() => setMode("return")}>Send back</Button>
            <Button variant="primary" size="sm" onClick={() => setMode("approve")}>Approve</Button>
          </div>
        )}
      </div>
    </Card>
  );
}
