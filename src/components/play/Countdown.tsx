"use client";

import { useEffect, useState } from "react";

function left(ms: number) {
  if (ms <= 0) return "Deadline passed";
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const min = m % 60;
  return [d ? `${d}d` : "", d || h ? `${h}h` : "", `${min}m`].filter(Boolean).join(" ") + " left";
}

/** Time left until a deadline, updated every minute. */
export function Countdown({ deadline }: { deadline: string }) {
  const end = new Date(deadline).getTime();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <span title={new Date(deadline).toLocaleString()}>
      {now === null ? new Date(deadline).toLocaleString() : left(end - now)}
    </span>
  );
}
