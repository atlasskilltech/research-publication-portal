import { redirect } from "next/navigation";

// The Phase-0 mock archive was superseded by the real public catalogue of
// published papers.
export default function ArchivePage() {
  redirect("/publications");
}
