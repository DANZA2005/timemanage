export type Sched = { starts_at: string; ends_at: string; enabled: boolean; label: string };

function toMin(t: string) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function minutesOfDay(d = new Date()) {
  return d.getHours() * 60 + d.getMinutes();
}

export type ScheduleStatus = {
  restricted: boolean; // there are enabled windows that limit usage
  allowed: boolean; // usage is allowed right now
  currentLabel?: string; // label of the active window (when allowed)
  nextLabel?: string; // next window label (when blocked)
  nextStart?: string; // next window start HH:MM (when blocked)
};

// Schedules are the ALLOWED usage windows. If there are enabled windows and
// "now" is outside all of them, usage is restricted (device should lock).
export function scheduleStatus(schedules: Sched[], now = new Date()): ScheduleStatus {
  const enabled = schedules.filter((s) => s.enabled);
  if (!enabled.length) return { restricted: false, allowed: true };
  const cur = minutesOfDay(now);

  let currentLabel: string | undefined;
  const within = enabled.some((s) => {
    const a = toMin(s.starts_at);
    const b = toMin(s.ends_at);
    const hit = a <= b ? cur >= a && cur < b : cur >= a || cur < b; // supports overnight
    if (hit) currentLabel = s.label;
    return hit;
  });

  if (within) return { restricted: true, allowed: true, currentLabel };

  // find the next upcoming window start
  let nextLabel: string | undefined;
  let nextStart: string | undefined;
  let best = Infinity;
  enabled.forEach((s) => {
    const a = toMin(s.starts_at);
    let diff = a - cur;
    if (diff <= 0) diff += 1440;
    if (diff < best) { best = diff; nextLabel = s.label; nextStart = s.starts_at.slice(0, 5); }
  });
  return { restricted: true, allowed: false, nextLabel, nextStart };
}
