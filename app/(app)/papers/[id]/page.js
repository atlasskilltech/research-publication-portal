"use client";

import { useParams } from "next/navigation";
import PaperDetail from "@/components/papers/PaperDetail";

export default function PaperDetailPage() {
  const params = useParams();
  const id = decodeURIComponent(params.id);
  return <PaperDetail id={id} />;
}
