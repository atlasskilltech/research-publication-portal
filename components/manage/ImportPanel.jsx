"use client";

import { useRef, useState } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Icon from "@/components/ui/Icon";
import { SchoolChip } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { IMPORT_COLUMNS, IMPORT_SAMPLE_RESULT, IMPORT_ACTION_META } from "@/lib/mockManage";

/**
 * ImportPanel — bulk CSV/Excel import (Admin + SPOC).
 * UI-only: picking a file and clicking "Upload & import" shows a mock dry-run report.
 */
export default function ImportPanel() {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState(null);

  const pick = (f) => {
    if (!f) return;
    setFile(f);
    setResult(null);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files?.[0]);
  };

  const runImport = () => setResult({ ...IMPORT_SAMPLE_RESULT, fileName: file?.name || IMPORT_SAMPLE_RESULT.fileName });

  return (
    <div className="max-w-3xl space-y-6">
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors",
          dragging ? "border-brand bg-brand-50" : "border-line bg-soft",
        )}
      >
        <Icon name="upload" size={34} className="text-muted" />
        <p className="mt-3 text-lg font-bold text-ink">Drop CSV or Excel here</p>
        <p className="my-2 text-sm text-muted">or</p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
        <Button variant="outline" onClick={() => inputRef.current?.click()}>Choose a file</Button>
        {file && (
          <p className="mt-3 text-sm text-ink">
            Selected: <b>{file.name}</b>
            <button type="button" onClick={() => { setFile(null); setResult(null); }} className="ml-2 text-xs font-semibold text-muted hover:text-ink">remove</button>
          </p>
        )}
        <Button variant="primary" className="mt-4" disabled={!file} onClick={runImport}>
          <Icon name="import" size={16} /> Upload &amp; import
        </Button>
      </div>

      {/* Dry-run result (mock) */}
      {result && (
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-2 border-b border-line px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Dry-run preview</p>
              <p className="text-sm font-semibold text-ink">{result.fileName} · {result.rows} rows</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className={IMPORT_ACTION_META.insert}>{result.inserted} insert</Badge>
              <Badge className={IMPORT_ACTION_META.update}>{result.updated} update</Badge>
              <Badge className={IMPORT_ACTION_META.skip}>{result.skipped} skip</Badge>
            </div>
          </div>
          <ul className="divide-y divide-line">
            {result.preview.map((row, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm sm:px-5">
                <span className="w-20 shrink-0 font-semibold text-brand">{row.paper_id}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{row.title}</span>
                {row.school !== "—" && <SchoolChip school={row.school} />}
                <Badge className={cn("shrink-0", IMPORT_ACTION_META[row.action])}>{row.action}</Badge>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3.5 sm:px-5">
            <p className="text-xs text-muted">Preview only — this mock build does not write to a database yet.</p>
            <Button variant="primary" size="sm" disabled>Confirm import</Button>
          </div>
        </Card>
      )}

      {/* Expected columns */}
      <Card className="overflow-hidden">
        <div className="border-b border-line px-4 py-3.5 sm:px-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Expected columns</p>
        </div>
        <div className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-2 sm:p-5">
          {IMPORT_COLUMNS.map((c) => (
            <div key={c.name} className="flex items-center justify-between rounded-lg border border-line bg-soft px-3 py-2">
              <code className="font-mono text-sm text-ink">{c.name}</code>
              {c.req && <span className="text-[10px] font-semibold uppercase tracking-wide text-accent">required</span>}
            </div>
          ))}
        </div>
        <p className="border-t border-line px-4 py-3 text-xs text-muted sm:px-5">
          If <code className="font-mono">school</code> is missing, we infer it from the paper ID prefix (ISDI / ISME / UGDX / LAW). Add a <code className="font-mono">programme</code> column to place the paper in its programme.
        </p>
      </Card>
    </div>
  );
}
