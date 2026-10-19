"use client";

import { useState } from "react";
import { useRole } from "@/components/layout/RoleContext";
import { getPaperDetail } from "@/lib/mockDetail";
import PaperHeader from "@/components/papers/PaperHeader";
import Tabs from "@/components/ui/Tabs";
import OverviewPanels from "@/components/papers/OverviewPanels";
import AccessRolesTab from "@/components/papers/AccessRolesTab";
import ReviewHistoryTab from "@/components/papers/ReviewHistoryTab";
import NoAccess from "@/components/papers/NoAccess";

/** Phase-2 demo access rule (server-enforced for real in a later phase). */
function canOpen(roleKey, user, paper) {
  if (roleKey === "administrator") return true;
  if (["spoc", "desk", "peer", "editor"].includes(roleKey)) return true; // assumed assigned in the demo
  return paper.canOpen?.includes(user.name); // submitters: only their own papers
}

export default function PaperDetail({ id }) {
  const { roleKey, user } = useRole();
  const [tab, setTab] = useState("overview");
  const paper = getPaperDetail(id);

  if (!paper) return <NoAccess paperId={id} />;
  if (!canOpen(roleKey, user, paper)) return <NoAccess paperId={id} />;

  const tabs = [{ key: "overview", label: "Overview" }];
  if (["administrator", "spoc"].includes(roleKey)) tabs.push({ key: "access", label: "Access & roles" });
  if (["administrator", "spoc", "editor"].includes(roleKey)) tabs.push({ key: "history", label: "Review history" });

  const activeTab = tabs.some((t) => t.key === tab) ? tab : "overview";

  return (
    <>
      <PaperHeader paper={paper} openSlot={roleKey === "administrator" ? paper.openSlot : null} />
      <Tabs tabs={tabs} active={activeTab} onChange={setTab} className="mb-5" />
      {activeTab === "overview" && <OverviewPanels paper={paper} roleKey={roleKey} />}
      {activeTab === "access" && <AccessRolesTab paper={paper} roleKey={roleKey} />}
      {activeTab === "history" && <ReviewHistoryTab paper={paper} />}
    </>
  );
}
