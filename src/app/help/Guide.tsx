import Link from "next/link";
import type { ReactNode } from "react";

// Shared layout for the in-app guides: a contents list and readable sections.

export function Guide({ title, intro, sections, other }: { title: string; intro: ReactNode; sections: { id: string; title: string; body: ReactNode }[]; other: { href: string; label: string } }) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:py-12">
      <p className="text-sm">
        <Link href="/" className="text-link underline">
          ← Home
        </Link>{" "}
        ·{" "}
        <Link href={other.href} className="text-link underline">
          {other.label}
        </Link>
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">{title}</h1>
      <div className="guide mt-3 text-muted">{intro}</div>
      <nav aria-label="Contents" className="mt-6 glass rounded-xl border border-border shadow-panel p-4">
        <p className="text-sm font-medium">Contents</p>
        <ol className="mt-2 list-inside list-decimal space-y-0.5 text-sm">
          {sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="text-link underline">
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {sections.map((s) => (
        <section key={s.id} id={s.id} className="guide mt-10 scroll-mt-4">
          <h2 className="text-xl font-semibold">{s.title}</h2>
          {s.body}
        </section>
      ))}
    </main>
  );
}

/** A key the reader presses, or a button they click. */
export function K({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-border bg-card px-1 font-mono text-[0.85em]">{children}</kbd>;
}

export function B({ children }: { children: ReactNode }) {
  return <strong className="font-semibold">{children}</strong>;
}
