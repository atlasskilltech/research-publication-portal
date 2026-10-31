"use client";

import { useFormStatus } from "react-dom";
import Button from "@/components/ui/Button";

/** Submit button that disables while pending, so the single-use link isn't submitted twice. */
export default function ConfirmSubmit({ label = "Continue to create your password →" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="lg" full disabled={pending}>
      {pending ? "Verifying…" : label}
    </Button>
  );
}
