// The loginex expireTime field is a 14-digit yyyyMMddHHmmss string whose timezone was never
// verified. Parse it under both the UTC and the local reading and only report "expired" once
// even the later reading has passed: wrongly claiming an expired login is worse than a late
// hint, because it pushes the user into an unnecessary re-scan.
export function musicExpiryBound(value) {
  if (typeof value !== 'string' || !/^\d{14}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const hour = Number(value.slice(8, 10));
  const minute = Number(value.slice(10, 12));
  const second = Number(value.slice(12, 14));
  // Parsers roll impossible dates over (April 31st becomes May 1st); a rebuild round-trip is
  // the only reliable validity check, so do not trust Date.parse on this input.
  const utc = Date.UTC(year, month - 1, day, hour, minute, second);
  const probe = new Date(utc);
  const matches = probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1
    && probe.getUTCDate() === day && probe.getUTCHours() === hour
    && probe.getUTCMinutes() === minute && probe.getUTCSeconds() === second;
  if (!matches) return null;
  const local = new Date(year, month - 1, day, hour, minute, second).getTime();
  return Math.max(utc, local);
}

export function musicSessionExpired(value, now = Date.now()) {
  const bound = musicExpiryBound(value);
  return bound !== null && now > bound;
}
