import Link from "next/link";
import { cn } from "@/lib/cn";

const VARIANTS = {
  primary: "bg-brand text-white hover:bg-brand-dark border border-transparent",
  accent: "bg-accent text-white hover:brightness-95 border border-transparent",
  outline: "bg-white text-ink hover:bg-soft border border-line",
  ghost: "bg-transparent text-brand hover:bg-brand-50 border border-transparent",
  danger: "bg-white text-danger hover:bg-danger-soft border border-danger/40",
  subtle: "bg-soft-2 text-ink hover:bg-line border border-transparent",
};

const SIZES = {
  sm: "text-xs px-3 py-1.5 gap-1.5",
  md: "text-sm px-4 py-2.5 gap-2",
  lg: "text-base px-5 py-3 gap-2",
};

/**
 * Button — renders a <button> or, when `href` is given, a Next <Link>
 * styled identically. Fully keyboard-accessible with min 44px touch target at md+.
 */
export default function Button({
  children,
  variant = "primary",
  size = "md",
  href,
  className = "",
  type = "button",
  disabled = false,
  full = false,
  ...rest
}) {
  const classes = cn(
    "inline-flex items-center justify-center font-semibold rounded-lg transition-colors select-none",
    "focus-visible:outline-2 focus-visible:outline-brand-light",
    VARIANTS[variant] || VARIANTS.primary,
    SIZES[size] || SIZES.md,
    full && "w-full",
    disabled && "opacity-50 pointer-events-none",
    className,
  );

  if (href && !disabled) {
    return (
      <Link href={href} className={classes} {...rest}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} className={classes} disabled={disabled} aria-disabled={disabled} {...rest}>
      {children}
    </button>
  );
}
