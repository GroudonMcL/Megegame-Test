"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({ links, className = "" }: { links: { href: string; label: string; exact?: boolean }[]; className?: string }) {
  const path = usePathname();
  return (
    <nav className={`flex flex-wrap gap-1 ${className}`}>
      {links.map((l) => {
        const active = l.exact ? path === l.href : path === l.href || path.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-medium sm:px-3 ${active ? "bg-accent text-accent-foreground shadow-sm" : "text-muted hover:bg-raised hover:text-foreground"}`}
            aria-current={active ? "page" : undefined}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
