/** Human-friendly gap to a timestamp, e.g. "3d 2h". */
export function formatCountdown(epochMs: number, now: number = Date.now()): string {
  const diff = epochMs - now;
  if (diff <= 0) {
    return 'any moment now';
  }
  const totalMinutes = Math.ceil(diff / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) {
    parts.push(days + 'd');
  }
  if (hours > 0) {
    parts.push(hours + 'h');
  }
  if (days === 0 && minutes > 0) {
    parts.push(minutes + 'm');
  }
  return parts.join(' ') || 'less than a minute';
}
