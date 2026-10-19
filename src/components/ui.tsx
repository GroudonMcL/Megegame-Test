import type { ComponentProps, ReactNode } from "react";

// The shared UI kit. Colours, corners, shadows and motion all come from the
// design tokens in globals.css, so these pick up the theme and the team colour.

export function Page({ children }: { children: ReactNode }) {
  return <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:py-12">{children}</main>;
}

/** A frosted-glass panel. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`glass rounded-xl border border-border p-5 shadow-panel ${className}`}>{children}</section>;
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-foreground shadow-sm hover:brightness-110",
  secondary: "border border-border bg-raised hover:border-border-strong hover:bg-background",
  ghost: "hover:bg-raised",
  danger: "border border-danger/50 text-danger hover:bg-danger/15",
};

export function buttonClass(variant: Variant = "primary", className = "") {
  return `inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`;
}

export function Button({ className = "", variant = "primary", ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={buttonClass(variant, className)} {...props} />;
}

/** A square button holding just an icon. Always give it a label for screen readers. */
export function IconButton({ className = "", label, variant = "ghost", ...props }: ComponentProps<"button"> & { label: string; variant?: Variant }) {
  return <button type="button" aria-label={label} title={label} className={buttonClass(variant, `h-9 w-9 px-0! py-0! ${className}`)} {...props} />;
}

const FIELD = "w-full rounded-lg border border-border bg-background px-3 py-2 text-base outline-none hover:border-border-strong focus:border-accent";

export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return <input className={`${FIELD} ${className}`} {...props} />;
}

export function Select({ className = "", ...props }: ComponentProps<"select">) {
  return <select className={`${FIELD} ${className}`} {...props} />;
}

export function Textarea({ className = "", ...props }: ComponentProps<"textarea">) {
  return <textarea className={`${FIELD} ${className}`} {...props} />;
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium">
      {children}
    </label>
  );
}

/** A small pill for statuses and counts. */
export function Badge({ children, tone = "neutral", className = "" }: { children: ReactNode; tone?: "neutral" | "accent" | "ok" | "warn" | "danger"; className?: string }) {
  const tones = {
    neutral: "border-border text-muted",
    accent: "border-accent/60 text-link",
    ok: "border-ok/40 bg-ok/15 text-ok",
    warn: "border-warn/40 bg-warn/15 text-warn",
    danger: "border-danger/50 bg-danger/15 text-danger",
  };
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${tones[tone]} ${className}`}>{children}</span>;
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {message}
    </p>
  );
}
