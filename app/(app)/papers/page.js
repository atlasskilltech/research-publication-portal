import { redirect } from "next/navigation";

// The Phase-0 mock "Papers" list was superseded by the real Submissions list.
export default function PapersPage() {
  redirect("/submissions");
}
