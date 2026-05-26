// Tiny helper for emitting Server-Timing headers from API route handlers.
//
// Usage:
//   const t = new ServerTimer();
//   const drugs = await t.track("db_drugs", () => sb.from("drugs")....);
//   return NextResponse.json(body, { headers: t.headers() });
//
// Chrome DevTools → Network → pick request → Timing tab shows each label
// and its duration alongside TTFB. Free, no third-party SDK required.

export class ServerTimer {
  private entries: Array<{ name: string; dur: number; desc?: string }> = [];
  private startedAt = performance.now();

  async track<T>(name: string, fn: () => Promise<T>, desc?: string): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      this.entries.push({ name, dur: performance.now() - start, desc });
    }
  }

  mark(name: string, desc?: string): void {
    this.entries.push({ name, dur: performance.now() - this.startedAt, desc });
  }

  headers(): Record<string, string> {
    const total = performance.now() - this.startedAt;
    const parts = [
      ...this.entries.map((e) => {
        const dur = `dur=${e.dur.toFixed(1)}`;
        const desc = e.desc ? `;desc="${e.desc.replace(/"/g, "")}"` : "";
        return `${e.name};${dur}${desc}`;
      }),
      `total;dur=${total.toFixed(1)}`,
    ];
    return { "Server-Timing": parts.join(", ") };
  }
}
