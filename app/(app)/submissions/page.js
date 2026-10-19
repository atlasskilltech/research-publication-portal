"use client";

import { useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import PapersTable from "@/components/papers/PapersTable";
import EmptyState from "@/components/ui/EmptyState";
import NewPaperModal from "@/components/papers/NewPaperModal";

export default function SubmissionsPage() {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <PageHeader
        eyebrow="Your submissions"
        title="My papers"
        subtitle="0 papers in your view"
        action={<Button onClick={() => setModalOpen(true)}>+ Submit new paper</Button>}
      />

      <Card className="mb-5 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="relative flex-1">
            <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-[34px] text-muted" />
            <Input label="Search" placeholder="Search title, student, paper id…" className="pl-9" />
          </div>
          <Select label="School" containerClassName="lg:w-40" options={["All schools", "ISDI", "ISME", "uGDX", "LAW"]} />
          <Select label="Phase" containerClassName="lg:w-36" options={["All phases", "P1", "P2", "P3", "P4", "P5"]} />
          <Select label="Status" containerClassName="lg:w-36" options={["All statuses", "pending", "accepted"]} />
          <Button variant="outline" className="lg:mb-0.5">Apply</Button>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <PapersTable
          rows={[]}
          empty={
            <EmptyState
              icon="submissions"
              title="No papers match"
              message="Your submitted papers will appear here. Start your first submission for the 2025–26 cycle."
              action={<Button size="sm" onClick={() => setModalOpen(true)}>+ Submit new paper</Button>}
            />
          }
        />
      </Card>

      <NewPaperModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
