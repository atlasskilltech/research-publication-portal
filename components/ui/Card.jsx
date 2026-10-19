import { cn } from "@/lib/cn";

/**
 * Card — white surface container used across dashboards and panels.
 */
export default function Card({ children, className = "", as: Tag = "div", ...rest }) {
  return (
    <Tag className={cn("rounded-xl border border-line bg-white", className)} {...rest}>
      {children}
    </Tag>
  );
}

export function CardHeader({ eyebrow, title, action, className = "" }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 px-4 pt-4 sm:px-5 sm:pt-5", className)}>
      <div>
        {eyebrow && (
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{eyebrow}</p>
        )}
        {title && <h2 className="mt-0.5 text-base font-bold text-ink sm:text-lg">{title}</h2>}
      </div>
      {action}
    </div>
  );
}
