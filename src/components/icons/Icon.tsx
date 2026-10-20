import type { SVGProps } from "react";

// Interface icons: thin outlines on a 24×24 grid that take the text colour.
// Add new ones to ICONS; the components that draw them don't need to change.

const ICONS = {
  sun: "M12 4V2 M12 22v-2 M4 12H2 M22 12h-2 M5.6 5.6 4.2 4.2 M19.8 19.8l-1.4-1.4 M5.6 18.4l-1.4 1.4 M19.8 4.2l-1.4 1.4 M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
  moon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z",
  logout: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3 M10 17l-5-5 5-5 M5 12h11",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
  back: "M15 18l-6-6 6-6",
  close: "M18 6 6 18 M6 6l12 12",
  check: "M5 12.5l4.5 4.5L19 7",
  maximize: "M8 3H5a2 2 0 0 0-2 2v3 M21 8V5a2 2 0 0 0-2-2h-3 M3 16v3a2 2 0 0 0 2 2h3 M16 21h3a2 2 0 0 0 2-2v-3",
  restore: "M8 3v3a2 2 0 0 1-2 2H3 M21 8h-3a2 2 0 0 1-2-2V3 M3 16h3a2 2 0 0 1 2 2v3 M16 21v-3a2 2 0 0 1 2-2h3",
  grip: "M9 6h.01 M15 6h.01 M9 12h.01 M15 12h.01 M9 18h.01 M15 18h.01",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M12 16v-5 M12 8h.01",
  // Tools
  overview: "M3 3h7v9H3z M14 3h7v5h-7z M14 12h7v9h-7z M3 16h7v5H3z",
  orders: "M9 3h6v3H9z M9 4.5H6a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5.5a1 1 0 0 0-1-1h-3 M9 11h6 M9 15h6",
  results: "M5 21V4 M5 4h12l-2.5 4.5L17 13H5",
  units: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1 M16 3.5a4 4 0 0 1 0 7 M22 21v-1a6 6 0 0 0-4-5.6",
  regions: "M12 22s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12Z M12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
  inventory: "M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z M3 7.5l9 4.5 9-4.5 M12 12v9",
  trades: "M7 4 3 8l4 4 M3 8h14 M17 12l4 4-4 4 M21 16H7",
  rules: "M2 5h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z M22 5h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z",
  help: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3 M12 17h.01",
  resolve: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z M8 8h.01 M16 8h.01 M12 12h.01 M8 16h.01 M16 16h.01",
  diplomacy: "M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12Z",
  map: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z M9 4v14 M15 6v14",
  edit: "M4 20h4L19 9l-4-4L4 16z M14 6l4 4",
  history: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M12 7v5l3 2",
  messages: "M3 6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z M3.5 6l8.5 7 8.5-7",
  undo: "M9 14 4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
  settings: "M4 6h10 M18 6h2 M16 4v4 M4 12h4 M12 12h8 M10 10v4 M4 18h12 M18 16v4",
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 18, className = "", ...props }: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`shrink-0 ${className}`}
      {...props}
    >
      <path d={ICONS[name]} />
    </svg>
  );
}
