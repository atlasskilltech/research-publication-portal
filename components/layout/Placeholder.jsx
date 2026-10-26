import PageHeader from "@/components/layout/PageHeader";
import EmptyState from "@/components/ui/EmptyState";

/**
 * Placeholder — used for sections whose full UI arrives in a later phase.
 * Keeps navigation working (no 404s) while being honest about scope.
 */
export default function Placeholder({ eyebrow, title, subtitle, icon = "inbox", phase = "a later phase" }) {
  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} subtitle={subtitle} />
      <EmptyState
        icon={icon}
        title={`${title} — coming in ${phase}`}
        message="This section is part of the planned build. Phase 1 delivers the shared UI foundation; this screen will be implemented in its scheduled phase."
      />
    </>
  );
}
