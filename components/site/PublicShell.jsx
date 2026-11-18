import SiteHeader from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";

/** Common public page frame: shared header, page content, shared footer. */
export default function PublicShell({ children, mainClassName = "" }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <SiteHeader />
      <main className={`relative flex-1 overflow-hidden ${mainClassName}`}>{children}</main>
      <SiteFooter />
    </div>
  );
}
