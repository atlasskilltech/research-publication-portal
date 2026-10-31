import { redirect } from "next/navigation";

// The Phase-0 mock paper detail was superseded by the real submission page
// (which authorizes and shapes the data per viewer).
export default async function PaperDetailPage({ params }) {
  const { id } = await params;
  redirect(`/submissions/${encodeURIComponent(id)}`);
}
