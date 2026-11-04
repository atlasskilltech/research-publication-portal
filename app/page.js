import { redirect } from "next/navigation";
import { parseVerificationParams } from "@/lib/authFlow";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }) {
  // Safety net: if a setup link ever arrives at the bare site URL as
  // /?token_hash=…&type=… (e.g. a mis-built link), forward ONLY those two
  // validated parameters to the verification page (nothing is verified here; no
  // other input is forwarded).
  const sp = (await searchParams) || {};
  const parsed = parseVerificationParams(sp);
  if (parsed.ok) {
    redirect(`/auth/confirm?token_hash=${encodeURIComponent(parsed.tokenHash)}&type=${encodeURIComponent(parsed.type)}`);
  }
  // The portal opens at the login screen.
  redirect("/login");
}
