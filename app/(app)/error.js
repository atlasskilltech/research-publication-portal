"use client";

import ErrorState from "@/components/ui/ErrorState";

export default function AppError({ error, reset }) {
  return (
    <div className="py-10">
      <ErrorState
        title="This page hit a snag"
        message={error?.message || "An unexpected error occurred while rendering this view."}
        onRetry={reset}
      />
    </div>
  );
}
