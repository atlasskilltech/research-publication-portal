import Link from "next/link";
import Table from "@/components/ui/Table";
import { StatusBadge, PhaseBadge, SchoolChip } from "@/components/ui/Badge";
import Icon from "@/components/ui/Icon";

const columns = [
  {
    key: "id",
    header: "ID",
    primary: true,
    render: (r) => (
      <Link href={`/papers/${encodeURIComponent(r.id)}`} className="font-semibold text-brand hover:underline">
        {r.id}
      </Link>
    ),
  },
  {
    key: "title",
    header: "Title / Student",
    render: (r) => (
      <div className="min-w-0">
        <Link href={`/papers/${encodeURIComponent(r.id)}`} className="font-medium text-ink hover:text-brand md:truncate">
          {r.title}
        </Link>
        <p className="text-xs text-muted md:truncate">{r.student}</p>
      </div>
    ),
  },
  { key: "school", header: "School", render: (r) => <SchoolChip school={r.school} /> },
  { key: "grade", header: "Grade", render: (r) => <span className="font-semibold tabular-nums">{r.grade}</span> },
  { key: "phase", header: "Phase", render: (r) => <PhaseBadge phase={r.phase} /> },
  { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
  {
    key: "drive",
    header: "Drive",
    align: "right",
    render: (r) =>
      r.drive ? (
        <a href="#" className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline" onClick={(e) => e.preventDefault()}>
          Open <Icon name="external" size={14} />
        </a>
      ) : (
        <span className="text-muted">—</span>
      ),
  },
];

export default function PapersTable({ rows, empty }) {
  return <Table columns={columns} rows={rows} keyField="id" empty={empty} />;
}
