import Icon from "@/components/ui/Icon";

/**
 * Warning shown to a faculty member whose imported achievements still have
 * their proof only as a Google Drive link.
 */
export default function ProofNotice({ count, action }) {
  return (
    <div role="status" className="flex flex-col gap-3 rounded-xl border border-warn/40 bg-warn-soft px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex gap-3">
        <Icon name="alert" size={22} className="mt-0.5 shrink-0 text-warn" />
        <div className="text-sm text-ink">
          <p className="font-bold">
            {count === 1
              ? "1 of your achievements still has its proof only as a Google Drive link."
              : `${count} of your achievements still have their proof only as a Google Drive link.`}
          </p>
          <p className="mt-0.5 text-muted">
            These entries came from the old Google Forms. Open each one, download the file from its Drive link (or use your own copy)
            and upload it, so your proof is stored safely in the portal.
          </p>
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
