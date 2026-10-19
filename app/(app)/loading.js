import { LoadingBlock } from "@/components/ui/Spinner";

export default function Loading() {
  return (
    <div className="py-10">
      <LoadingBlock message="Loading your workspace…" />
    </div>
  );
}
