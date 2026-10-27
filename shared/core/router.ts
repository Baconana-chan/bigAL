export interface CalendarHash {
  month: string | null;
}

export type HashView =
  | { kind: 'calendar'; month: string | null }
  | { kind: 'triage' }
  | { kind: 'franchise'; id: number };

export type Route =
  | { kind: 'studio'; id: number }
  | { kind: 'anime'; id: number }
  | { kind: 'home' }
  | { kind: 'other' };

export function parseRoute(pathname: string): Route {
  const studio = /^\/studio\/(\d+)(?:\/|$)/.exec(pathname);
  if (studio) {
    return { kind: 'studio', id: parseInt(studio[1], 10) };
  }
  const anime = /^\/anime\/(\d+)(?:\/|$)/.exec(pathname);
  if (anime) {
    return { kind: 'anime', id: parseInt(anime[1], 10) };
  }
  if (pathname === '/' || /^\/home\/?$/.test(pathname)) {
    return { kind: 'home' };
  }
  return { kind: 'other' };
}

/**
 * The calendar is a view of its own rather than an AniList route: there is no
 * free pathname (the site's router would 404 or redirect it), but a hash keeps
 * the view deep-linkable, survives reloads and lets the back button work.
 */
export function parseHashView(hash: string): HashView | null {
  if (/^#alx\/triage\/?$/.test(hash)) {
    return { kind: 'triage' };
  }
  const franchise = /^#alx\/franchise\/(\d+)\/?$/.exec(hash);
  if (franchise) {
    return { kind: 'franchise', id: parseInt(franchise[1], 10) };
  }
  const match = /^#alx\/calendar(?:\/(\d{4}-\d{2}))?\/?$/.exec(hash);
  if (!match) {
    return null;
  }
  const month = match[1] && /^\d{4}-(0[1-9]|1[0-2])$/.test(match[1]) ? match[1] : null;
  return { kind: 'calendar', month: month };
}

export function parseCalendarHash(hash: string): CalendarHash | null {
  const view = parseHashView(hash);
  return view && view.kind === 'calendar' ? { month: view.month } : null;
}

export function calendarHashOf(month: string | null): string {
  return month ? '#alx/calendar/' + month : '';
}

/** Opens the calendar; the view settles the month itself. */
export function openCalendar(): void {
  const view = parseHashView(location.hash);
  if (view && view.kind === 'calendar') {
    return;
  }
  location.hash = 'alx/calendar';
}

export function closeHashView(): void {
  if (location.hash) {
    location.hash = '';
  }
}

export function openTriage(): void {
  const view = parseHashView(location.hash);
  if (view && view.kind === 'triage') {
    return;
  }
  location.hash = 'alx/triage';
}

/** Franchise tracker href for a title; assigning it opens the view. */
export function franchiseHashOf(mediaId: number): string {
  return '#alx/franchise/' + mediaId;
}

export function openFranchise(mediaId: number): void {
  const view = parseHashView(location.hash);
  if (view && view.kind === 'franchise' && view.id === mediaId) {
    return;
  }
  location.hash = 'alx/franchise/' + mediaId;
}

/** Writes the hash without adding a history entry for month navigation. */
export function setCalendarHash(month: string | null, replace: boolean): void {
  const next = calendarHashOf(month);
  if (location.hash === next) {
    return;
  }
  if (replace) {
    history.replaceState(null, '', location.pathname + location.search + next);
    return;
  }
  // Assigning an empty hash fires hashchange, which is how the view closes.
  location.hash = next ? next.slice(1) : '';
}

export function startHashRouter(onChange: (view: HashView | null) => void): () => void {
  const handler = (): void => onChange(parseHashView(location.hash));
  window.addEventListener('hashchange', handler);
  handler();
  return () => window.removeEventListener('hashchange', handler);
}

/**
 * AniList is a Vue SPA. Content scripts live in an isolated world, so patching
 * history.pushState does not intercept the site's own calls; a cheap poll is
 * the reliable option that also works on older engines.
 */
export function startRouter(onRoute: (route: Route) => void, intervalMs = 400): () => void {
  let lastUrl = location.pathname + location.search + location.hash;
  let stopped = false;

  const check = (): void => {
    if (stopped) {
      return;
    }
    const url = location.pathname + location.search + location.hash;
    if (url !== lastUrl) {
      lastUrl = url;
      onRoute(parseRoute(location.pathname));
    }
  };

  const timer = window.setInterval(check, intervalMs);
  window.addEventListener('popstate', check);

  onRoute(parseRoute(location.pathname));

  return () => {
    stopped = true;
    window.clearInterval(timer);
    window.removeEventListener('popstate', check);
  };
}
