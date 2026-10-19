"use client";

import { useState } from "react";
import Modal from "@/components/ui/Modal";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";

const SCHOOL_OPTIONS = [
  { value: "ISDI", label: "ISDI · School of Design & Innovation" },
  { value: "ISME", label: "ISME · BBA" },
  { value: "uGDX", label: "uGDX · B.Tech" },
  { value: "LAW", label: "LAW · LLB" },
];

/**
 * NewPaperModal — UI replica of the reference "New submission" overlay.
 * Phase-1: no persistence; submitting just closes the dialog.
 */
export default function NewPaperModal({ open, onClose }) {
  const [submitting, setSubmitting] = useState(false);

  const handleCreate = () => {
    setSubmitting(true);
    // Phase-1 mock: no backend. Pretend-save then close.
    setTimeout(() => {
      setSubmitting(false);
      onClose?.();
    }, 500);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Create paper"
      title="New submission"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleCreate} disabled={submitting}>
            {submitting ? "Creating…" : "Create paper"}
          </Button>
        </>
      }
    >
      <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={(e) => e.preventDefault()}>
        <Input label="Paper ID" placeholder="e.g. ISDI-12" />
        <Select label="School" options={SCHOOL_OPTIONS} />
        <Select
          label="Programme"
          containerClassName="sm:col-span-2"
          options={[{ value: "", label: "Programme — select a programme in this school" }]}
        />
        <Input label="Title" containerClassName="sm:col-span-2" placeholder="Paper title" />
        <Input label="Submitter (name or email)" placeholder="you@university.edu" />
        <Input label="Batch" placeholder="year of passing out (e.g. 2029)" />
        <Input label="Guide" placeholder="Guide name" />
        <Input label="Grade" placeholder="O, A+, A…" />
        <Input label="Themes" containerClassName="sm:col-span-2" placeholder="comma-separated" />
        <Input label="Google Drive link to manuscript" containerClassName="sm:col-span-2" placeholder="https://drive.google.com/…" />
      </form>
      <p className="mt-4 rounded-lg bg-soft px-3 py-2.5 text-xs text-muted">
        Your paper enters Phase 1 automatically. An administrator assigns its SPOC and reviewers, and only
        they can see it. You can update the Drive link and themes until shortlisting begins.
      </p>
    </Modal>
  );
}
