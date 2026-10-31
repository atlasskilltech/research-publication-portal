import { redirect } from "next/navigation";

// The Phase-0 mock volumes board was superseded by real volume / issue /
// publication management.
export default function VolumesPage() {
  redirect("/publications/manage");
}
