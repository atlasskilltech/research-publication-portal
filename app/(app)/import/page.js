"use client";

import PageHeader from "@/components/layout/PageHeader";
import RoleGuard from "@/components/layout/RoleGuard";
import ImportPanel from "@/components/manage/ImportPanel";

export default function ImportPage() {
  return (
    <RoleGuard allow={["administrator", "spoc"]} section="Import">
      <PageHeader
        eyebrow="Bulk import"
        title="Import papers"
        subtitle="Upload the master CSV/Excel — matching by Paper ID (inserts new, updates existing)."
      />
      <ImportPanel />
    </RoleGuard>
  );
}
