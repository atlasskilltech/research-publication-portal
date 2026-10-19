"use client";

import { useState } from "react";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";
import Button from "@/components/ui/Button";
import Badge, { StatusBadge } from "@/components/ui/Badge";
import Icon from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

/* ---- small helpers ---- */
function Panel({ eyebrow, tag, children, className = "" }) {
  return (
    <Card className={cn("flex flex-col p-4 sm:p-5", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{eyebrow}</p>
        {tag}
      </div>
      {children}
    </Card>
  );
}
function Field({ label, children }) {
  return (
    <div className="mb-3 last:mb-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <div className="mt-0.5 text-sm text-ink">{children}</div>
    </div>
  );
}

/* roles that can see each block */
const seeDesk = (r) => ["administrator", "spoc", "editor", "desk"].includes(r);
const seePeer = (r) => ["administrator", "spoc", "editor"].includes(r);
const seeEditor = (r) => ["administrator", "spoc", "editor"].includes(r);
const canAssign = (r) => ["administrator", "spoc"].includes(r);
const spocActions = (r) => ["administrator", "spoc"].includes(r);

/* ---- metadata ---- */
function MetadataCard({ paper, roleKey }) {
  const [grade, setGrade] = useState(paper.grade);
  const [shortlisted, setShortlisted] = useState(paper.shortlisted === "Yes");
  return (
    <Panel eyebrow="Metadata">
      <Field label="Specialisation">{paper.specialisation}</Field>
      <Field label="Grade">{grade}</Field>
      <Field label="Themes">{paper.themes}</Field>
      <Field label="SPOC">{paper.spoc}</Field>
      <Field label="Shortlisted (Phase 1)">{shortlisted ? "Yes" : "No"}</Field>
      {spocActions(roleKey) && (
        <div className="mt-2 border-t border-line pt-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-accent">SPOC actions</p>
          <Button
            variant="primary"
            size="sm"
            className="mb-3"
            disabled={shortlisted}
            onClick={() => setShortlisted(true)}
          >
            {shortlisted ? "Shortlisted ✓" : "Shortlist to Phase 2"}
          </Button>
          <Input label="Grade" value={grade} onChange={(e) => setGrade(e.target.value)} />
        </div>
      )}
    </Panel>
  );
}

/* ---- reviewer assignments ---- */
function AssignmentsCard({ paper, roleKey }) {
  if (roleKey === "desk" || roleKey === "peer") {
    const mine = roleKey === "desk" ? paper.assignments.desk : paper.assignments.r1;
    return (
      <Panel eyebrow="Your assignment">
        <Field label={roleKey === "desk" ? "Desk Reviewer" : "Peer Reviewer R1"}>You</Field>
        <p className="text-xs text-muted">{mine}</p>
      </Panel>
    );
  }
  const editable = canAssign(roleKey);
  const rows = [
    ["Desk Reviewer", paper.assignments.desk],
    ["Peer Reviewer R1", paper.assignments.r1],
    ["Peer Reviewer R2", paper.assignments.r2],
  ];
  return (
    <Panel eyebrow="Reviewer assignments">
      {rows.map(([label, val]) => (
        <div key={label} className="mb-3 last:mb-0">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</p>
          {editable ? (
            <Select options={[{ value: val, label: val }, { value: "unassigned", label: "— Unassigned —" }]} defaultValue={val} />
          ) : (
            <p className="text-sm text-ink">{val}</p>
          )}
        </div>
      ))}
    </Panel>
  );
}

/* ---- desk review ---- */
function DeskReviewCard({ paper, roleKey }) {
  const isDesk = roleKey === "desk";
  const [status, setStatus] = useState(paper.desk.status);
  const [recorded, setRecorded] = useState(paper.desk.similarity != null);

  return (
    <Panel eyebrow="Desk Review · Phase 2" tag={<Badge className="bg-ink text-white border-ink">TURNITIN</Badge>}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Similarity</p>
          <p className="text-2xl font-bold text-ink">{paper.desk.similarity != null ? `${paper.desk.similarity}%` : "—"}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">AI Writing</p>
          <p className="text-2xl font-bold text-ink">{paper.desk.ai != null ? `${paper.desk.ai}%` : "—"}</p>
        </div>
      </div>
      {paper.desk.checkedBy && (
        <p className="mt-2 text-xs text-muted">Checked by <b className="text-ink">{paper.desk.checkedBy}</b> · {paper.desk.checkedAt}</p>
      )}
      <div className="mt-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Desk status</p>
        <div className="mt-1"><StatusBadge status={status} /></div>
      </div>

      {isDesk && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-accent">
            <Icon name="external" size={14} /> Run Turnitin check
          </p>
          <p className="mb-3 text-xs text-muted">
            Copy the manuscript link, open Turnitin, submit the paper, then paste the AI&nbsp;% and Similarity&nbsp;% below with the report URLs.
          </p>
          <div className="mb-3 flex flex-wrap gap-2">
            <Button variant="subtle" size="sm">Copy drive link</Button>
            <Button variant="subtle" size="sm">Open Turnitin ↗</Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Similarity %" defaultValue={paper.desk.similarity ?? ""} placeholder="0.0" />
            <Input label="AI Writing %" defaultValue={paper.desk.ai ?? ""} placeholder="0.0" />
          </div>
          <Input containerClassName="mt-3" label="Similarity report URL" placeholder="https://turnitin.com/report/sim/…" />
          <Input containerClassName="mt-3" label="AI report URL" placeholder="https://turnitin.com/report/ai/…" />
          <Textarea containerClassName="mt-3" label="Notes" placeholder="e.g. 3 minor citation matches, no verbatim." />
          <Button variant="primary" size="sm" className="mt-3" onClick={() => setRecorded(true)}>
            {recorded ? "Results recorded ✓" : "Record Turnitin results"}
          </Button>

          <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
            <Button variant="primary" size="sm" onClick={() => setStatus("pass")}>Pass → Phase 3</Button>
            <Button variant="danger" size="sm" onClick={() => setStatus("fail")}>Fail</Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

/* ---- blind peer review (read-only for spoc/editor/admin) ---- */
function PeerReadCard({ round, data }) {
  return (
    <Panel eyebrow={`Blind Peer Review · ${round}`}>
      <Field label="Decision">{data.decision ? <StatusBadge status={data.decision} /> : <span className="text-muted">—</span>}</Field>
      <Field label="Comments">{data.comments || <span className="text-muted">—</span>}</Field>
    </Panel>
  );
}

/* ---- peer review FORM (for the assigned peer reviewer) ---- */
function PeerReviewForm({ paper }) {
  const [decision, setDecision] = useState(null);
  return (
    <Panel eyebrow="Blind Peer Review · R1 — your review">
      <Textarea label="Comments" defaultValue={paper.r1.comments} rows={4} />
      <Input containerClassName="mt-3" label="Revision received link (optional)" placeholder="https://…" />
      {decision && (
        <p className="mt-3 rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">Submitted: <b>{decision}</b> (demo — not saved)</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={() => setDecision("Accept")}>Accept</Button>
        <Button variant="subtle" size="sm" onClick={() => setDecision("Revise")}>Revise</Button>
        <Button variant="danger" size="sm" onClick={() => setDecision("Reject")}>Reject</Button>
      </div>
    </Panel>
  );
}

/* ---- editor final decision ---- */
function EditorDecisionCard({ paper, roleKey }) {
  const isEditor = roleKey === "editor";
  const [status, setStatus] = useState(paper.editor.finalStatus);
  return (
    <Panel eyebrow="Editor · final decision & volume">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Current final status"><StatusBadge status={status} /></Field>
        <Field label="Volume">{paper.editor.volume || "—"}</Field>
        <Field label="Phase">{paper.editor.phase}</Field>
      </div>
      {isEditor && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
          <Button variant="primary" size="sm" onClick={() => setStatus("accepted")}>Accept</Button>
          <Button variant="subtle" size="sm" onClick={() => setStatus("revision")}>Request revision</Button>
          <Button variant="danger" size="sm" onClick={() => setStatus("rejected")}>Reject</Button>
        </div>
      )}
    </Panel>
  );
}

function ConfidentialityNote({ roleKey }) {
  if (roleKey === "desk") {
    return (
      <p className="mt-2 rounded-lg bg-soft px-4 py-3 text-xs text-muted">
        Hidden from reviewers: peer-review reports and the editor&apos;s decision. The author is shown to every assigned role.
      </p>
    );
  }
  if (roleKey === "peer") {
    return (
      <p className="mt-2 rounded-lg bg-soft px-4 py-3 text-xs text-muted">
        Hidden from reviewers: the desk review, the other reviewer&apos;s report and the editor&apos;s decision. The author is shown to every assigned role.
      </p>
    );
  }
  return null;
}

/* ---- composed Overview ---- */
export default function OverviewPanels({ paper, roleKey }) {
  const isSubmitter = roleKey === "student" || roleKey === "faculty";

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <MetadataCard paper={paper} roleKey={roleKey} />
        {!isSubmitter && <AssignmentsCard paper={paper} roleKey={roleKey} />}
        {seeDesk(roleKey) && <DeskReviewCard paper={paper} roleKey={roleKey} />}
      </div>

      {roleKey === "peer" && <PeerReviewForm paper={paper} />}

      {seePeer(roleKey) && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <PeerReadCard round="R1" data={paper.r1} />
          <PeerReadCard round="R2" data={paper.r2} />
        </div>
      )}

      {seeEditor(roleKey) && <EditorDecisionCard paper={paper} roleKey={roleKey} />}

      {isSubmitter && (
        <Panel eyebrow="Status">
          <Field label="Current status"><StatusBadge status={paper.status} /></Field>
          <Field label="Phase">{paper.editor.phase}</Field>
          <p className="text-xs text-muted">
            Your paper is visible only to its assigned SPOC, reviewers, editor and the Administrator.
          </p>
        </Panel>
      )}

      <ConfidentialityNote roleKey={roleKey} />
    </div>
  );
}
