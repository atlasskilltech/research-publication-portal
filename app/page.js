import { redirect } from "next/navigation";

export default function Home() {
  // The portal opens at the login screen.
  redirect("/login");
}
