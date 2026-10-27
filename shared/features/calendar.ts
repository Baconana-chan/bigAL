import type { CalendarEntry } from '../api/anilist';
import { fetchCalendarRange, fetchViewer } from '../api/anilist';
import { el } from '../core/dom';
import type { IcsEvent } from '../core/ics';
import { buildIcs, downloadTextFile } from '../core/ics';
import { setCalendarHash } from '../core/router';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const EXPORT_MINUTES = 30;
const ALARM_MINUTES = 10;

interface MonthState {
  year: number;
  month: number;
}

function monthKey(state: MonthState): string {
  const month = state.month + 1;
  return state.year + '-' + (month < 10 ? '0' + month : String(month));
}

function parseMonth(value: string | null): MonthState {
  if (value) {
    const match = /^(\d{4})-(\d{2})$/.exec(value);
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1;
      if (month >= 0 && month <= 11) {
        return { year: year, month: month };
      }
    }
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

function monthStart(state: MonthState): number {
  return new Date(state.year, state.month, 1).getTime();
}

function monthEnd(state: MonthState): number {
  return new Date(state.year, state.month + 1, 1).getTime();
}

function dayKey(date: Date): string {
  return date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate();
}

function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function titleOf(entry: CalendarEntry): string {
  return entry.title.romaji || entry.title.english || entry.title.native || 'Unknown title';
}

function plural(count: number, one: string, many: string): string {
  return count + ' ' + (count === 1 ? one : many);
}

function button(label: string, className: string, title: string): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  node.textContent = label;
  node.title = title;
  node.setAttribute('aria-label', title);
  return node;
}

function renderEntry(entry: CalendarEntry): HTMLElement {
  const card = document.createElement('a');
  card.className = 'alx-cal-ep' + (entry.premiere ? ' alx-cal-ep-premiere' : '');
  card.href = '/anime/' + entry.mediaId;
  card.title =
    titleOf(entry) +
    ' \u2014 episode ' +
    entry.episode +
    ' \u00b7 ' +
    new Date(entry.airsAt).toLocaleString() +
    (entry.premiere ? ' (premiere)' : '');
  card.appendChild(el('span', 'alx-cal-time', timeLabel(entry.airsAt)));
  card.appendChild(el('span', 'alx-cal-epname', titleOf(entry)));
  const meta = el('span', 'alx-cal-epmeta', 'Ep ' + entry.episode + (entry.premiere ? ' \u00b7 premiere' : ''));
  card.appendChild(meta);
  card.onclick = () => {
    // Leave the calendar view; AniList's own link handling continues to the title.
    setCalendarHash(null, false);
  };
  return card;
}

function renderGrid(host: HTMLElement, entries: CalendarEntry[], state: MonthState): void {
  host.textContent = '';
  const first = new Date(state.year, state.month, 1);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(state.year, state.month + 1, 0).getDate();
  const cells = Math.ceil((offset + days) / 7) * 7;

  const byDay: Record<string, CalendarEntry[]> = {};
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const key = dayKey(new Date(entry.airsAt));
    if (!byDay[key]) {
      byDay[key] = [];
    }
    byDay[key].push(entry);
  }

  const weekdays = el('div', 'alx-cal-weekdays');
  for (let index = 0; index < WEEKDAYS.length; index += 1) {
    weekdays.appendChild(el('span', 'alx-cal-weekday', WEEKDAYS[index]));
  }
  host.appendChild(weekdays);

  const grid = el('div', 'alx-cal-grid');
  const todayKey = dayKey(new Date());
  for (let index = 0; index < cells; index += 1) {
    const dayNumber = index - offset + 1;
    const cell = el('div', 'alx-cal-day');
    if (dayNumber < 1 || dayNumber > days) {
      cell.className = 'alx-cal-day alx-cal-day-blank';
      cell.setAttribute('aria-hidden', 'true');
      grid.appendChild(cell);
      continue;
    }
    const date = new Date(state.year, state.month, dayNumber);
    const key = dayKey(date);
    if (key === todayKey) {
      cell.className = 'alx-cal-day alx-cal-day-today';
    }
    const dayEntries = byDay[key] || [];

    const head = el('div', 'alx-cal-dayhead');
    head.appendChild(el('span', 'alx-cal-daynum', String(dayNumber)));
    if (dayEntries.length > 0) {
      const count = el('span', 'alx-cal-count', String(dayEntries.length));
      count.title = plural(dayEntries.length, 'episode', 'episodes');
      head.appendChild(count);
    }
    cell.appendChild(head);

    for (let entryIndex = 0; entryIndex < dayEntries.length; entryIndex += 1) {
      cell.appendChild(renderEntry(dayEntries[entryIndex]));
    }
    grid.appendChild(cell);
  }
  host.appendChild(grid);
}

/**
 * Full-screen month view of everything the viewer tracks that airs in a range:
 * next episodes of watching/rewatching titles plus planned premieres. Rendered
 * on top of whatever page is open and addressed through `#alx/calendar/YYYY-MM`,
 * so it is deep-linkable, reload-safe and closed by Escape or the back button.
 */
export function mountCalendar(initialMonth: string | null): () => void {
  let active = true;
  let state = parseMonth(initialMonth);
  let entries: CalendarEntry[] = [];
  let signedOut = false;
  let loading = true;
  let error: string | null = null;

  const previousFocus = document.activeElement as HTMLElement | null;
  const previousOverflow = document.body.style.overflow;

  const overlay = el('div', 'alx-cal-overlay');
  const sheet = el('div', 'alx-cal');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', 'Premiere calendar');

  const head = el('div', 'alx-cal-head');
  const headingWrap = el('div', 'alx-cal-heading');
  headingWrap.appendChild(el('h2', 'alx-cal-title', 'Premiere calendar'));
  headingWrap.appendChild(el('div', 'alx-cal-sub', 'Watching and planned titles, grouped by your local time'));
  head.appendChild(headingWrap);

  const actions = el('div', 'alx-cal-actions');
  const closeButton = button('\u00d7', 'alx-cal-close', 'Close calendar');
  actions.appendChild(closeButton);
  head.appendChild(actions);
  sheet.appendChild(head);

  const toolbar = el('div', 'alx-cal-toolbar');
  const prevButton = button('\u2039', 'alx-cal-nav', 'Previous month');
  const todayButton = button('Today', 'alx-cal-nav alx-cal-today', 'Jump to the current month');
  const nextButton = button('\u203a', 'alx-cal-nav', 'Next month');
  const monthLabel = el('h3', 'alx-cal-month');
  const exportButton = button('Export .ics', 'alx-btn alx-btn-small alx-cal-export', 'Download this month as a calendar file');
  toolbar.appendChild(prevButton);
  toolbar.appendChild(todayButton);
  toolbar.appendChild(nextButton);
  toolbar.appendChild(monthLabel);
  toolbar.appendChild(exportButton);
  sheet.appendChild(toolbar);

  const summary = el('div', 'alx-cal-summary');
  sheet.appendChild(summary);

  const body = el('div', 'alx-cal-body');
  sheet.appendChild(body);

  const status = el('div', 'alx-cal-status');
  sheet.appendChild(status);

  const legend = el('div', 'alx-cal-legend');
  legend.appendChild(el('span', 'alx-cal-legend-item alx-cal-legend-premiere', 'Premiere'));
  legend.appendChild(el('span', 'alx-cal-legend-item', 'Next episode of a title you watch'));
  sheet.appendChild(legend);

  const inMonth = (): CalendarEntry[] => {
    const from = monthStart(state);
    const to = monthEnd(state);
    const result: CalendarEntry[] = [];
    for (let index = 0; index < entries.length; index += 1) {
      if (entries[index].airsAt >= from && entries[index].airsAt < to) {
        result.push(entries[index]);
      }
    }
    return result;
  };

  const render = (): void => {
    body.textContent = '';
    status.textContent = '';
    summary.textContent = '';
    monthLabel.textContent = new Date(state.year, state.month, 1).toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    });
    exportButton.disabled = true;

    if (loading) {
      status.textContent = 'Loading the schedule\u2026';
      return;
    }
    if (signedOut) {
      status.textContent = 'Sign in to AniList to build your calendar.';
      return;
    }
    if (error) {
      status.textContent = error;
      const retry = button('Retry', 'alx-btn alx-btn-small', 'Retry loading the calendar');
      retry.onclick = () => {
        void load();
      };
      status.appendChild(document.createElement('br'));
      status.appendChild(retry);
      return;
    }

    const list = inMonth();
    const premieres = list.filter((entry) => entry.premiere).length;
    summary.textContent =
      list.length === 0
        ? 'Nothing scheduled this month.'
        : plural(list.length, 'episode', 'episodes') +
          (premieres > 0 ? ' \u00b7 ' + plural(premieres, 'premiere', 'premieres') : '');
    exportButton.disabled = list.length === 0;
    if (list.length > 0) {
      renderGrid(body, list, state);
    }
  };

  const load = async (): Promise<void> => {
    loading = true;
    error = null;
    render();
    const from = monthStart(state);
    const to = monthEnd(state);
    try {
      const viewer = await fetchViewer();
      if (!active) {
        return;
      }
      if (!viewer) {
        signedOut = true;
        loading = false;
        render();
        return;
      }
      signedOut = false;
      const next = await fetchCalendarRange(viewer.id, from, to);
      if (!active) {
        return;
      }
      entries = next;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Could not load your calendar';
    }
    loading = false;
    render();
  };

  const setMonth = (next: MonthState): void => {
    state = next;
    setCalendarHash(monthKey(state), true);
    void load();
  };

  let teardown: () => void = () => {
    active = false;
  };

  const close = (): void => {
    if (location.hash) {
      setCalendarHash(null, false);
      return;
    }
    teardown();
  };

  const shiftMonth = (delta: number): void => {
    const date = new Date(state.year, state.month + delta, 1);
    setMonth({ year: date.getFullYear(), month: date.getMonth() });
  };

  closeButton.onclick = close;
  prevButton.onclick = () => {
    shiftMonth(-1);
  };
  nextButton.onclick = () => {
    shiftMonth(1);
  };
  todayButton.onclick = () => {
    const now = new Date();
    setMonth({ year: now.getFullYear(), month: now.getMonth() });
  };
  exportButton.onclick = () => {
    const list = inMonth();
    if (list.length === 0) {
      return;
    }
    const events: IcsEvent[] = [];
    for (let index = 0; index < list.length; index += 1) {
      const entry = list[index];
      events.push({
        uid: 'bigal-' + entry.mediaId + '-' + entry.episode + '@bigal',
        startMs: entry.airsAt,
        minutes: EXPORT_MINUTES,
        summary: titleOf(entry) + ' \u2014 episode ' + entry.episode + (entry.premiere ? ' (premiere)' : ''),
        description:
          (entry.listStatus === 'PLANNING' ? 'In your plans on AniList' : 'In your watching list on AniList') +
          ' \u00b7 https://anilist.co/anime/' +
          entry.mediaId,
        url: 'https://anilist.co/anime/' + entry.mediaId,
        alarmMinutes: ALARM_MINUTES,
      });
    }
    downloadTextFile(
      'bigal-calendar-' + monthKey(state) + '.ics',
      'text/calendar;charset=utf-8',
      buildIcs(events, 'bigAL premieres ' + monthKey(state))
    );
  };
  overlay.onclick = (event) => {
    if (event.target === overlay) {
      close();
    }
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const nodes = sheet.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])');
    const focusable: HTMLElement[] = [];
    for (let index = 0; index < nodes.length; index += 1) {
      if (!nodes[index].hasAttribute('disabled')) {
        focusable.push(nodes[index]);
      }
    }
    if (focusable.length === 0) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const element = document.activeElement;
    if (event.shiftKey && (element === first || !sheet.contains(element))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && element === last) {
      event.preventDefault();
      first.focus();
    }
  };

  document.body.style.overflow = 'hidden';
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
  window.addEventListener('keydown', onKey);

  teardown = (): void => {
    if (!active) {
      return;
    }
    active = false;
    window.removeEventListener('keydown', onKey);
    document.body.style.overflow = previousOverflow;
    if (overlay.parentElement) {
      overlay.parentElement.removeChild(overlay);
    }
    if (previousFocus && previousFocus.focus) {
      previousFocus.focus();
    }
  };

  // Deep links without a month settle on the current one so the URL stays useful.
  if (initialMonth === null) {
    setCalendarHash(monthKey(state), true);
  }

  closeButton.focus();
  void load();

  return teardown;
}
