import { cn } from "@/lib/cn";
import EmptyState from "@/components/ui/EmptyState";

/**
 * Table — responsive data table.
 *  - md and up: a real <table> with a sticky-styled header.
 *  - below md: each row renders as a stacked card (label: value) so
 *    nothing overflows horizontally on phones.
 *
 * columns: [{ key, header, align, className, render(row), hideOnMobile, primary }]
 * rows:    array of objects
 */
export default function Table({
  columns = [],
  rows = [],
  keyField = "id",
  empty,
  className = "",
}) {
  if (!rows.length) {
    return empty || <EmptyState title="Nothing here yet" message="No records match." />;
  }

  const primaryCol = columns.find((c) => c.primary) || columns[0];

  return (
    <div className={cn("w-full", className)}>
      {/* Desktop / tablet table */}
      <div className="hidden overflow-x-auto scroll-thin md:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted",
                    c.align === "right" && "text-right",
                    c.align === "center" && "text-center",
                    c.className,
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row[keyField]} className="border-b border-line/70 last:border-0 hover:bg-soft/60">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "px-3 py-3 align-middle text-ink",
                      c.align === "right" && "text-right",
                      c.align === "center" && "text-center",
                      c.cellClassName,
                    )}
                  >
                    {c.render ? c.render(row) : row[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile stacked cards */}
      <ul className="flex flex-col gap-3 md:hidden">
        {rows.map((row) => (
          <li key={row[keyField]} className="rounded-xl border border-line bg-white p-4">
            <div className="mb-2 text-sm font-bold text-ink">
              {primaryCol.render ? primaryCol.render(row) : row[primaryCol.key]}
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
              {columns
                .filter((c) => c.key !== primaryCol.key && !c.hideOnMobile)
                .map((c) => (
                  <div key={c.key} className="contents">
                    <dt className="pt-0.5 text-xs font-semibold uppercase tracking-wide text-muted">{c.header}</dt>
                    <dd className="min-w-0 break-words text-right text-ink">{c.render ? c.render(row) : row[c.key]}</dd>
                  </div>
                ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
