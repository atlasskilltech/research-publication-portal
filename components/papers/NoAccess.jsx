import Icon from "@/components/ui/Icon";
import Button from "@/components/ui/Button";

/**
 * NoAccess — mirrors the reference "You don't have access to this paper" screen.
 */
export default function NoAccess({ paperId }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-line bg-white px-6 py-16 text-center">
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-soft text-muted">
        <Icon name="lock" size={26} />
      </span>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Access restricted</p>
      <h1 className="mt-1 text-xl font-bold text-ink">You don&apos;t have access to this paper</h1>
      <p className="mt-2 max-w-md text-sm text-muted">
        {paperId ? <><b>{paperId}</b> isn&apos;t assigned to you. </> : null}
        A paper is visible only to its submitter, the SPOC, reviewers and editor assigned to it, and the Administrator.
      </p>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <Button href="/papers" variant="primary">Back to your papers</Button>
        <Button href="/activity" variant="outline">Ask the Administrator</Button>
      </div>
    </div>
  );
}
