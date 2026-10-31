import PageHeader from "@/components/layout/PageHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

// The Phase-0 bulk-import screen was a mock with no backend. Rather than show
// fake functionality, say plainly that it isn't available.
export default function ImportPage() {
  return (
    <>
      <PageHeader eyebrow="Import" title="Bulk import" />
      <Card className="px-6 py-10 text-center">
        <p className="text-sm text-ink">Bulk import of papers is not available in this version of the portal.</p>
        <p className="mt-1 text-sm text-muted">Papers are submitted individually by their authors.</p>
        <div className="mt-4"><Button href="/submissions" variant="outline" size="sm">Go to submissions</Button></div>
      </Card>
    </>
  );
}
