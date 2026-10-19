import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { THEME_SCRIPT } from "@/components/theme/themeScript";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Megagame",
  description: "Run a megagame: orders, map, economy and combat.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0a1322" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Dark by default; THEME_SCRIPT switches to light before paint if the player chose it.
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
