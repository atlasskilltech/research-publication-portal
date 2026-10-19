import Card from "@/components/ui/Card";

/**
 * KpiCard — single metric tile used on dashboards.
 */
export default function KpiCard({ label, value, note }) {
  return (
    <Card className="p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 text-3xl font-bold tabular-nums text-ink">{value}</p>
      {note ? <p className="mt-1 text-xs text-muted">{note}</p> : <p className="mt-1 text-xs">&nbsp;</p>}
    </Card>
  );
}
