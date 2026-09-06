import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { QueryProvider } from "@/lib/QueryProvider";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "LivePulse — Real-Time Sports Intelligence",
  description: "Live football scores, events and statistics from real match data.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-bg text-text">
        <QueryProvider>
          <header className="border-b border-border">
            <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
              <Link href="/" className="flex items-baseline gap-2">
                <span className="text-lg font-bold tracking-tight">
                  Live<span className="text-accent">Pulse</span>
                </span>
                <span className="hidden text-xs text-text-muted sm:inline">Real-Time Sports Intelligence</span>
              </Link>
              {/* §15/README's own stated philosophy: the ops dashboard is the point, not a bonus — kept one click away, not buried. */}
              <Link href="/ops" className="text-sm text-text-muted hover:text-text">
                Engineering Dashboard
              </Link>
            </div>
          </header>
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
          <footer className="border-t border-border py-6">
            <div className="mx-auto max-w-5xl px-4 text-xs leading-relaxed text-text-muted">
              LivePulse is a non-commercial engineering portfolio project. Match data provided by{" "}
              <a href="https://www.api-football.com/" className="underline hover:text-text">
                API-Football
              </a>
              . Team and competition names and logos are trademarks of their respective owners and are used solely
              for identification. Not affiliated with any league, club, or federation.
            </div>
          </footer>
        </QueryProvider>
      </body>
    </html>
  );
}
