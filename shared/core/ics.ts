export interface IcsEvent {
  uid: string;
  startMs: number;
  minutes: number;
  summary: string;
  description: string;
  url: string;
  /** Minutes before the start for the display alarm; 0 disables it. */
  alarmMinutes: number;
}

function pad(value: number): string {
  return value < 10 ? '0' + value : String(value);
}

function stamp(ms: number): string {
  const date = new Date(ms);
  return (
    date.getUTCFullYear() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    'T' +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z'
  );
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** RFC 5545 wants long lines folded at 75 octets; characters are close enough. */
function fold(line: string): string {
  if (line.length <= 73) {
    return line;
  }
  let rest = line;
  let out = '';
  while (rest.length > 73) {
    out = out + rest.slice(0, 73) + '\r\n ';
    rest = rest.slice(73);
  }
  return out + rest;
}

export function buildIcs(events: IcsEvent[], calendarName: string): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//bigAL//Premiere calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:' + escapeText(calendarName),
  ];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + escapeText(event.uid));
    lines.push('DTSTAMP:' + stamp(Date.now()));
    lines.push('DTSTART:' + stamp(event.startMs));
    lines.push('DTEND:' + stamp(event.startMs + event.minutes * 60 * 1000));
    lines.push('SUMMARY:' + escapeText(event.summary));
    if (event.description) {
      lines.push('DESCRIPTION:' + escapeText(event.description));
    }
    if (event.url) {
      lines.push('URL:' + escapeText(event.url));
    }
    if (event.alarmMinutes > 0) {
      lines.push('BEGIN:VALARM');
      lines.push('TRIGGER:-PT' + event.alarmMinutes + 'M');
      lines.push('ACTION:DISPLAY');
      lines.push('DESCRIPTION:' + escapeText(event.summary));
      lines.push('END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  const folded: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    folded.push(fold(lines[index]));
  }
  return folded.join('\r\n') + '\r\n';
}

export function downloadTextFile(filename: string, mime: string, text: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}
