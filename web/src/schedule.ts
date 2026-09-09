// Auto-sync schedules are stored in UTC (an hour 0-23 and weekdays 0=Sunday..6=
// Saturday), but the user picks them in their own local time. These helpers convert
// a local (hour, days) selection to UTC and back, shifting the weekdays when the
// hour conversion crosses midnight so "every weekday at 01:00" stays correct far
// from UTC. The offset is taken from the browser at call time (fixed at save, so a
// later DST change can drift the fire time by an hour — acceptable for a sync).

const DAY = 7;

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** Local (hour, weekdays) → UTC (hour, weekdays). */
export function localScheduleToUtc(hour: number, days: number[]): { hour: number; days: number[] } {
  // getTimezoneOffset() is (UTC - local) in minutes, so UTC = local + offset.
  const offsetMin = new Date().getTimezoneOffset();
  const utcTotal = hour * 60 + offsetMin;
  const utcHour = mod(Math.floor(utcTotal / 60), 24);
  const dayDelta = Math.floor(utcTotal / (24 * 60)); // -1, 0, or +1
  return {
    hour: utcHour,
    days: days.map((d) => mod(d + dayDelta, DAY)).sort((a, b) => a - b),
  };
}

/** UTC (hour, weekdays) → local (hour, weekdays). */
export function utcScheduleToLocal(hour: number, days: number[]): { hour: number; days: number[] } {
  const offsetMin = new Date().getTimezoneOffset();
  const localTotal = hour * 60 - offsetMin;
  const localHour = mod(Math.floor(localTotal / 60), 24);
  const dayDelta = Math.floor(localTotal / (24 * 60));
  return {
    hour: localHour,
    days: days.map((d) => mod(d + dayDelta, DAY)).sort((a, b) => a - b),
  };
}
