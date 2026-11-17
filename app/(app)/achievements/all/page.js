"use client";

import PageHeader from "@/components/layout/PageHeader";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import AchievementList from "@/components/achievements/AchievementList";
import { useRole } from "@/components/layout/RoleContext";
import NoAccessMessage from "@/components/achievements/NoAccessMessage";

export default function AllAchievementsPage() {
  const { realRole } = useRole();
  if (realRole !== "administrator") return <NoAccessMessage />;
  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="All achievements"
        subtitle="Open an entry to check its proof, then verify or reject it. Export filtered lists for NAAC / NIRF reporting."
        action={
          <div className="flex flex-wrap gap-2">
            <Button href="/achievements" variant="outline">My achievements</Button>
            <Button href="/achievements/import"><Icon name="import" size={16} /> Import from Google Forms</Button>
          </div>
        }
      />
      <AchievementList admin />
    </>
  );
}
