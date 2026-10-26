"use client";

import { useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import ScopeBanner from "@/components/layout/ScopeBanner";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import PapersTable from "@/components/papers/PapersTable";
import NewPaperModal from "@/components/papers/NewPaperModal";
import { useRole } from "@/components/layout/RoleContext";
import { MOCK_PAPERS } from "@/lib/mock";

export default function PapersPage() {
  const { roleKey } = useRole();
  const [modalOpen, setModalOpen] = useState(false);
  const canCreate = roleKey === "administrator" || roleKey === "spoc";
  const showProgrammes = canCreate || roleKey === "editor";

  return (
    <>
      <PageHeader
        eyebrow="Publication pipeline"
        title="Papers"
        subtitle={`${MOCK_PAPERS.length} papers in your view`}
        action={canCreate ? <Button onClick={() => setModalOpen(true)}>+ New paper</Button> : null}
      />

      <ScopeBanner />

      {/* Filter bar */}
      <Card className="mb-5 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="relative flex-1">
            <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-[34px] text-muted" />
            <Input label="Search" placeholder="Search title, student, paper id…" className="pl-9" />
          </div>
          <Select label="School" containerClassName="lg:w-40" options={["All schools", "ISDI", "ISME", "uGDX", "LAW"]} />
          {showProgrammes && (
            <Select label="Programme" containerClassName="lg:w-44" options={["All programmes"]} />
          )}
          <Select label="Phase" containerClassName="lg:w-36" options={["All phases", "P1", "P2", "P3", "P4", "P5"]} />
          <Select label="Status" containerClassName="lg:w-36" options={["All statuses", "pending", "accepted", "rejected"]} />
          <Button variant="outline" className="lg:mb-0.5">Apply</Button>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <PapersTable rows={MOCK_PAPERS} />
      </Card>

      <NewPaperModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
