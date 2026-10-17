import type { ComponentProps, ReactNode } from "react";

export function Page({ children }: { children: ReactNode }) {
  return <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:py-12">{children}</main>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-border bg-card p-5 shadow-sm ${className}`}>{children}</section>;
}

export function Button({ className = "", variant = "primary", ...props }: ComponentProps<"button"> & { variant?: "primary" | "secondary" }) {
  const styles =
    variant === "primary"
      ? "bg-accent text-accent-foreground hover:opacity-90"
      : "border border-border bg-card hover:bg-background";
  return (
    <button
      className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${styles} ${className}`}
      {...props}
    />
  );
}

export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return (
    <input
      className={`w-full rounded-lg border border-border bg-background px-3 py-2 text-base outline-none focus:border-accent ${className}`}
      {...props}
    />
  );
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium">
      {children}
    </label>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {message}
    </p>
  );
}
