import { HomeSections } from "@/components/HomeSections";

/**
 * §3 — live / upcoming / recent / popular leagues. Deliberately built so
 * it always looks intentional even when nothing is live right now, which
 * — at a 100-request/day budget (docs/adr/ADR-002) — is the common case,
 * not an edge case (docs/technical-decisions.md §2). Recently completed
 * and upcoming fixtures carry the page whenever the live section is empty.
 */
export default function Home() {
  return (
    <div className="space-y-10">
      <HomeSections />
    </div>
  );
}
