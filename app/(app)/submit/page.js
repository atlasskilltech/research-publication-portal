"use client";

import { useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import { useRole } from "@/components/layout/RoleContext";

const SCHOOLS = [
  { value: "ISDI", label: "ISDI · School of Design & Innovation" },
  { value: "ISME", label: "ISME · BBA" },
  { value: "uGDX", label: "uGDX · B.Tech" },
  { value: "LAW", label: "LAW · LLB" },
];

export default function SubmitPage() {
  const { user } = useRole();
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <>
        <PageHeader eyebrow="Create paper" title="Submission received" />
        <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-ok-soft text-ok">
            <Icon name="check" size={26} />
          </span>
          <h2 className="text-lg font-bold text-ink">Your paper entered Phase 1</h2>
          <p className="max-w-md text-sm text-muted">
            An administrator will assign its SPOC and reviewers. You can track its status from your dashboard.
            <span className="mt-1 block text-xs">(Phase-1 demo — nothing was saved to a server.)</span>
          </p>
          <div className="mt-2 flex gap-2">
            <Button href="/dashboard" variant="outline">Go to dashboard</Button>
            <Button onClick={() => setDone(false)}>Submit another</Button>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Create paper"
        title="Submit your paper"
        subtitle="Upload once. Track your paper through Desk Review → Blind Peer Review → Volume categorisation."
      />
      <Card className="p-5 sm:p-6">
        <form
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            setDone(true);
          }}
        >
          <Input label="Paper ID" placeholder="e.g. ISDI-12" required />
          <Select label="School" options={SCHOOLS} />
          <Select
            label="Programme"
            containerClassName="sm:col-span-2"
            options={[{ value: "", label: "Programme — select a programme in this school" }]}
          />
          <Input label="Title" containerClassName="sm:col-span-2" placeholder="Paper title" required />
          <Input label="Author" defaultValue={user.name} />
          <Input label="Batch" placeholder="year of passing out (e.g. 2029)" />
          <Input label="Guide" placeholder="Guide name" />
          <Input label="Themes" placeholder="comma-separated" />
          <Input
            label="Google Drive link to manuscript"
            containerClassName="sm:col-span-2"
            placeholder="https://drive.google.com/…"
            hint="You can update the Drive link and themes until shortlisting begins — after that, edits are locked."
          />
          <div className="sm:col-span-2 mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button href="/dashboard" variant="outline">Cancel</Button>
            <Button type="submit" variant="primary">Create paper →</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
