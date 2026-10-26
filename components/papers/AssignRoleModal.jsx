"use client";

import { useState } from "react";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import { PEOPLE, ASSIGNABLE_ROLES } from "@/lib/mockDetail";

/**
 * AssignRoleModal — replica of the reference "Assign role" overlay, including
 * the live separation-of-duties conflict check (can't assign a paper's author).
 */
export default function AssignRoleModal({ open, onClose, paper }) {
  const [personEmail, setPersonEmail] = useState("peer2@university.edu");
  const [role, setRole] = useState("peer_r2");

  const AUTHOR = "__author__";
  const personOptions = [
    { value: AUTHOR, label: `${paper.author} · author (submitter)` },
    ...PEOPLE.map((p) => ({ value: p.email, label: `${p.name} · ${p.email}` })),
  ];
  const person = personEmail === AUTHOR ? { name: paper.author } : PEOPLE.find((p) => p.email === personEmail);
  // the paper's author (submitter) cannot hold a review/grade/edit role on it
  const conflict = personEmail === AUTHOR;

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Assign role"
      title="Assign role"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={conflict} onClick={onClose}>Assign role</Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-muted">
        Applies to this paper only. It will not change anything on the person&apos;s other papers.
      </p>

      <div className="mb-4">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Paper</p>
        <div className="rounded-lg border border-line bg-soft px-3.5 py-2.5 text-sm">
          <b>{paper.id}</b> &nbsp;{paper.title}
        </div>
      </div>

      <Select
        label="Person"
        containerClassName="mb-4"
        value={personEmail}
        onChange={(e) => setPersonEmail(e.target.value)}
        options={personOptions}
      />
      <Select
        label="Role on this paper"
        value={role}
        onChange={(e) => setRole(e.target.value)}
        options={ASSIGNABLE_ROLES}
      />

      {conflict ? (
        <div className="mt-4 rounded-lg border border-danger/40 bg-danger-soft px-4 py-3">
          <p className="text-sm font-bold text-danger">Conflict — can&apos;t assign</p>
          <p className="mt-0.5 text-xs text-muted">
            {person.name} submitted {paper.id}. A submitter can&apos;t review, grade or edit their own paper. Pick someone else.
          </p>
        </div>
      ) : (
        <p className="mt-4 rounded-lg bg-soft px-4 py-3 text-xs text-muted">
          {person?.name} will be able to open {paper.id} only. Author identity stays visible to assigned roles.
        </p>
      )}
    </Modal>
  );
}
