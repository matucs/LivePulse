/**
 * A Prometheus counter (events_published_total) is exactly right for
 * scraping into a real Prometheus/Grafana stack, but it can't answer
 * "events/sec right now" on its own — that needs a query engine's rate()
 * function, which this project doesn't run (docs/adr/ADR-008: no hosted
 * Prometheus in Portfolio Mode). For the ops dashboard's own summary
 * endpoint, a small in-process sliding window is the pragmatic
 * alternative — not a replacement for the counter, a companion to it.
 */
export class SlidingRateCounter {
  private timestamps: number[] = [];

  constructor(private readonly windowMs: number = 60_000) {}

  record(): void {
    this.timestamps.push(Date.now());
    this.prune();
  }

  ratePerSecond(): number {
    this.prune();
    return this.timestamps.length / (this.windowMs / 1000);
  }

  private prune(): void {
    const cutoff = Date.now() - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0]! < cutoff) {
      this.timestamps.shift();
    }
  }
}

export const eventsPublishedRate = new SlidingRateCounter();
