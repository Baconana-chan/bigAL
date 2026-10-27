import type { MediaListStatus, TriageEntry } from '../api/anilist';
import { fetchBacklogTriage, fetchViewer, saveListEntry } from '../api/anilist';
import { el } from '../core/dom';
import { closeHashView } from '../core/router';

const STALE_YEARS = 2;
const MAX_ROWS = 25;
const MAX_GROUPS = 10;
const MAX_ROWS_PER_GROUP = 6;

const FORMAT_LABELS: Record<string, string> = {
  TV: 'TV',
  TV_SHORT: 'TV short',
  MOVIE: 'Movie',
  SPECIAL: 'Special',
  OVA: 'OVA',
  ONA: 'ONA',
  MUSIC: 'Music',
};

interface RowRef {
  entry: TriageEntry;
  node: HTMLElement;
  checkbox: HTMLInputElement;
}

function titleOf(entry: TriageEntry): string {
  return entry.title.romaji || entry.title.english || entry.title.native || 'Unknown title';
}

function labelOf(title: { romaji: string | null; english: string | null; native: string | null }): string {
  return title.romaji || title.english || title.native || 'a prequel';
}

function metaText(entry: TriageEntry): string {
  const parts: string[] = [];
  if (entry.format) {
    parts.push(FORMAT_LABELS[entry.format] || entry.format);
  }
  if (entry.episodes) {
    parts.push(entry.episodes + ' ep');
  }
  if (entry.addedAt !== null) {
    parts.push('in plans since ' + new Date(entry.addedAt).getFullYear());
  }
  if (entry.idleYears >= 1) {
    parts.push('idle ' + entry.idleYears + (entry.idleYears === 1 ? ' yr' : ' yrs'));
  }
  return parts.join(' \u00b7 ');
}

function button(label: string, className: string, title?: string): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  node.textContent = label;
  if (title) {
    node.title = title;
    node.setAttribute('aria-label', title);
  }
  return node;
}

/**
 * Backlog triage view (#alx/triage): planning entries that need a decision —
 * untouched for years, several seasons of one franchise, or a sequel whose
 * predecessor was dropped. Everything is reviewable before it changes: nothing
 * is written until a bulk action is confirmed, and those reuse the same session
 * mutation as the quick actions.
 */
export function mountTriage(): () => void {
  let active = true;
  let entries: TriageEntry[] = [];
  let selected: Record<string, boolean> = {};
  let loading = true;
  let busy = false;
  let error: string | null = null;

  const previousFocus = document.activeElement as HTMLElement | null;
  const previousOverflow = document.body.style.overflow;

  const overlay = el('div', 'alx-triage-overlay');
  const sheet = el('div', 'alx-triage');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', 'Backlog triage');

  const head = el('div', 'alx-triage-head');
  const headingWrap = el('div', 'alx-triage-heading');
  headingWrap.appendChild(el('h2', 'alx-triage-title', 'Backlog triage'));
  headingWrap.appendChild(
    el('div', 'alx-triage-sub', 'Planning entries worth a decision. Nothing changes until you pick an action.')
  );
  head.appendChild(headingWrap);
  const closeButton = button('\u00d7', 'alx-triage-close', 'Close triage');
  head.appendChild(closeButton);
  sheet.appendChild(head);

  const summary = el('div', 'alx-triage-summary');
  summary.setAttribute('aria-live', 'polite');
  sheet.appendChild(summary);

  const body = el('div', 'alx-triage-body');
  sheet.appendChild(body);

  const statusLine = el('div', 'alx-triage-status');
  statusLine.setAttribute('role', 'status');
  statusLine.setAttribute('aria-live', 'polite');
  sheet.appendChild(statusLine);

  const footer = el('div', 'alx-triage-footer');
  const selectedLabel = el('span', 'alx-triage-selected', 'Nothing selected');
  const clearButton = button('Clear', 'alx-btn alx-btn-small alx-btn-ghost', 'Clear the selection');
  const pauseButton = button('Pause selected', 'alx-btn alx-btn-small alx-btn-ghost', 'Move selected titles to Paused');
  const dropButton = button('Move to dropped', 'alx-btn alx-btn-small', 'Move selected titles to Dropped');
  footer.appendChild(selectedLabel);
  const footerActions = el('span', 'alx-triage-footer-actions');
  footerActions.appendChild(clearButton);
  footerActions.appendChild(pauseButton);
  footerActions.appendChild(dropButton);
  footer.appendChild(footerActions);
  sheet.appendChild(footer);

  /** Every row currently in the DOM, so selection changes repaint all of them. */
  const rows: RowRef[] = [];
  /** Result of the last bulk action, kept across the refresh that follows it. */
  let lastStatus = '';
  /** Only the newest read may paint: a slow refresh must not undo a newer action. */
  let readToken = 0;

  const selectedCount = (): number => Object.keys(selected).length;

  const syncSelection = (): void => {
    const count = selectedCount();
    for (let index = 0; index < rows.length; index += 1) {
      rows[index].checkbox.checked = Boolean(selected[String(rows[index].entry.entryId)]);
    }
    selectedLabel.textContent =
      count === 0 ? 'Nothing selected' : count + (count === 1 ? ' title selected' : ' titles selected');
    clearButton.disabled = busy || count === 0;
    pauseButton.disabled = busy || count === 0;
    dropButton.disabled = busy || count === 0;
  };

  const buildRow = (entry: TriageEntry): RowRef => {
    const row = el('div', 'alx-triage-row');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'alx-triage-check';
    checkbox.checked = Boolean(selected[String(entry.entryId)]);
    checkbox.setAttribute('aria-label', 'Select ' + titleOf(entry));
    checkbox.onchange = () => {
      if (checkbox.checked) {
        selected[String(entry.entryId)] = true;
      } else {
        delete selected[String(entry.entryId)];
      }
      syncSelection();
    };
    row.appendChild(checkbox);

    const coverWrap = el('span', 'alx-triage-cover-wrap');
    if (entry.cover) {
      const cover = document.createElement('img');
      cover.className = 'alx-triage-cover';
      cover.loading = 'lazy';
      cover.alt = '';
      cover.src = entry.cover;
      coverWrap.appendChild(cover);
    }
    row.appendChild(coverWrap);

    const info = el('div', 'alx-triage-info');
    const title = document.createElement('a');
    title.className = 'alx-triage-name';
    title.href = '/anime/' + entry.mediaId;
    title.textContent = titleOf(entry);
    // The site is a SPA: without this the overlay would stay on top of the
    // title page the user just opened.
    title.onclick = () => {
      close();
    };
    info.appendChild(title);
    info.appendChild(el('div', 'alx-triage-meta', metaText(entry)));

    const chips = el('div', 'alx-triage-chips');
    if (entry.franchiseSize >= 2) {
      const chip = el('span', 'alx-triage-chip', entry.franchiseSize + ' from one franchise');
      chip.title = 'Other seasons or spin-offs of this series sit in your plans too';
      chips.appendChild(chip);
    }
    if (entry.droppedParent) {
      const chip = el('span', 'alx-triage-chip alx-triage-chip-warn', 'First season dropped');
      chip.title = 'You dropped ' + labelOf(entry.droppedParent);
      chips.appendChild(chip);
    }
    if (chips.childElementCount > 0) {
      info.appendChild(chips);
    }
    row.appendChild(info);

    return { entry: entry, node: row, checkbox: checkbox };
  };

  const appendRows = (host: HTMLElement, list: TriageEntry[]): RowRef[] => {
    const refs: RowRef[] = [];
    for (let index = 0; index < list.length; index += 1) {
      const ref = buildRow(list[index]);
      host.appendChild(ref.node);
      rows.push(ref);
      refs.push(ref);
    }
    return refs;
  };

  const selectAllButton = (refs: RowRef[], sectionTitle: string): HTMLButtonElement => {
    const node = button('Select all', 'alx-triage-select-all', 'Select every title under "' + sectionTitle + '"');
    node.onclick = () => {
      let all = refs.length > 0;
      for (let index = 0; index < refs.length; index += 1) {
        if (!selected[String(refs[index].entry.entryId)]) {
          all = false;
          break;
        }
      }
      for (let index = 0; index < refs.length; index += 1) {
        const key = String(refs[index].entry.entryId);
        if (all) {
          delete selected[key];
        } else {
          selected[key] = true;
        }
      }
      node.textContent = all ? 'Select all' : 'Deselect all';
      syncSelection();
    };
    return node;
  };

  const sectionHead = (titleText: string, count: number, extra?: HTMLElement): HTMLElement => {
    const header = el('div', 'alx-triage-section-head');
    const heading = document.createElement('h3');
    heading.className = 'alx-triage-section-title';
    heading.textContent = titleText;
    header.appendChild(heading);
    header.appendChild(el('span', 'alx-triage-section-count', String(count)));
    if (extra) {
      header.appendChild(extra);
    }
    return header;
  };

  const render = (): void => {
    rows.length = 0;
    body.textContent = '';
    statusLine.textContent = '';

    if (loading) {
      statusLine.textContent = 'Reading your planning list\u2026';
      summary.textContent = '';
      syncSelection();
      return;
    }
    if (error) {
      summary.textContent = '';
      statusLine.textContent = error;
      const retry = button('Retry', 'alx-btn alx-btn-small', 'Read the planning list again');
      retry.onclick = () => {
        void load();
      };
      statusLine.appendChild(document.createElement('br'));
      statusLine.appendChild(retry);
      syncSelection();
      return;
    }

    statusLine.textContent = lastStatus;

    /*
     * One entry gets one row. A six-year-old plan that is also the third season
     * of a franchise would otherwise be listed twice, and "select all" would
     * look like it mis-counted. Franchise groups claim their members first
     * because the grouping is the point of that section; the remaining sections
     * take what is left.
     */
    const claimed: Record<string, boolean> = {};
    const claim = (entry: TriageEntry): boolean => {
      const key = String(entry.entryId);
      if (claimed[key]) {
        return false;
      }
      claimed[key] = true;
      return true;
    };

    // "Your first season was dropped" is the strongest signal, so those entries
    // are placed first and keep their row even when the title also belongs to a
    // franchise group.
    const droppedSeasons: TriageEntry[] = [];
    for (let index = 0; index < entries.length; index += 1) {
      if (entries[index].droppedParent && claim(entries[index])) {
        droppedSeasons.push(entries[index]);
      }
    }

    const groups: Array<{ key: number; entries: TriageEntry[] }> = [];
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (entry.franchiseSize < 2 || claimed[String(entry.entryId)]) {
        continue;
      }
      let found = false;
      for (let groupIndex = 0; groupIndex < groups.length && !found; groupIndex += 1) {
        if (groups[groupIndex].key === entry.franchiseKey) {
          groups[groupIndex].entries.push(entry);
          found = true;
        }
      }
      if (!found) {
        groups.push({ key: entry.franchiseKey, entries: [entry] });
      }
    }
    // A franchise left with a single unclaimed member is no longer a duplicate
    // problem; that entry falls through to the sections below.
    const paired = groups.filter((group) => group.entries.length >= 2);
    paired.sort((left, right) => right.entries.length - left.entries.length);
    const shownGroups = paired.slice(0, MAX_GROUPS);
    for (let index = 0; index < shownGroups.length; index += 1) {
      for (let rowIndex = 0; rowIndex < shownGroups[index].entries.length; rowIndex += 1) {
        claim(shownGroups[index].entries[rowIndex]);
      }
    }

    const stale: TriageEntry[] = [];
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (entry.idleYears >= STALE_YEARS && !claimed[String(entry.entryId)]) {
        claim(entry);
        stale.push(entry);
      }
    }

    let franchiseEntries = 0;
    for (let index = 0; index < shownGroups.length; index += 1) {
      franchiseEntries += shownGroups[index].entries.length;
    }

    const parts: string[] = [entries.length + (entries.length === 1 ? ' title in plans' : ' titles in plans')];
    if (stale.length > 0) {
      parts.push(stale.length + ' untouched ' + STALE_YEARS + '+ yrs');
    }
    if (shownGroups.length > 0) {
      parts.push(
        franchiseEntries +
          ' across ' +
          shownGroups.length +
          (shownGroups.length === 1 ? ' franchise' : ' franchises')
      );
    }
    if (droppedSeasons.length > 0) {
      parts.push(droppedSeasons.length + ' after a dropped season');
    }
    summary.textContent = parts.join(' \u00b7 ');

    if (stale.length === 0 && shownGroups.length === 0 && droppedSeasons.length === 0) {
      body.appendChild(
        el(
          'div',
          'alx-triage-empty',
          entries.length === 0
            ? 'Your planning list is empty.'
            : 'Nothing stands out: no stale entries, no repeated franchises and no plans behind a dropped season.'
        )
      );
      syncSelection();
      return;
    }

    if (droppedSeasons.length > 0) {
      const section = el('div', 'alx-triage-section');
      const shown = droppedSeasons.slice(0, MAX_ROWS);
      const rowsHost = el('div', 'alx-triage-rows');
      const refs = appendRows(rowsHost, shown);
      section.appendChild(
        sectionHead(
          'After a season you dropped',
          droppedSeasons.length,
          selectAllButton(refs, 'After a season you dropped')
        )
      );
      section.appendChild(
        el('div', 'alx-triage-hint', 'The prequel is in your dropped list; continuing a series you already abandoned is rarely intended.')
      );
      section.appendChild(rowsHost);
      if (droppedSeasons.length > shown.length) {
        section.appendChild(el('div', 'alx-triage-more', '+' + (droppedSeasons.length - shown.length) + ' more not shown'));
      }
      body.appendChild(section);
    }

    if (shownGroups.length > 0) {
      const section = el('div', 'alx-triage-section');
      const groupRefs: RowRef[] = [];
      const groupsHost = el('div', 'alx-triage-groups');
      for (let index = 0; index < shownGroups.length; index += 1) {
        const group = shownGroups[index];
        const block = el('div', 'alx-triage-group');
        const groupHead = el('div', 'alx-triage-group-head');
        groupHead.appendChild(el('span', 'alx-triage-group-title', titleOf(group.entries[0]) + ' and related'));
        groupHead.appendChild(el('span', 'alx-triage-group-count', group.entries.length + ' entries'));
        block.appendChild(groupHead);
        const rowsHost = el('div', 'alx-triage-rows');
        const shown = group.entries.slice(0, MAX_ROWS_PER_GROUP);
        const refs = appendRows(rowsHost, shown);
        for (let refIndex = 0; refIndex < refs.length; refIndex += 1) {
          groupRefs.push(refs[refIndex]);
        }
        block.appendChild(rowsHost);
        if (group.entries.length > shown.length) {
          block.appendChild(el('div', 'alx-triage-more', '+' + (group.entries.length - shown.length) + ' more in this franchise'));
        }
        groupsHost.appendChild(block);
      }
      section.appendChild(
        sectionHead(
          'Several seasons of one franchise',
          shownGroups.length,
          selectAllButton(groupRefs, 'Several seasons of one franchise')
        )
      );
      section.appendChild(el('div', 'alx-triage-hint', 'Related entries are all waiting in plans; usually one is enough.'));
      section.appendChild(groupsHost);
      if (paired.length > shownGroups.length) {
        section.appendChild(el('div', 'alx-triage-more', '+' + (paired.length - shownGroups.length) + ' more franchises not shown'));
      }
      body.appendChild(section);
    }

    if (stale.length > 0) {
      const section = el('div', 'alx-triage-section');
      const shown = stale.slice(0, MAX_ROWS);
      const rowsHost = el('div', 'alx-triage-rows');
      const refs = appendRows(rowsHost, shown);
      section.appendChild(
        sectionHead(
          'Untouched for ' + STALE_YEARS + '+ years',
          stale.length,
          selectAllButton(refs, 'Untouched for ' + STALE_YEARS + '+ years')
        )
      );
      section.appendChild(
        el('div', 'alx-triage-hint', 'No status, score or progress change for years — the plan is acting as a bookmark.')
      );
      section.appendChild(rowsHost);
      if (stale.length > shown.length) {
        section.appendChild(el('div', 'alx-triage-more', '+' + (stale.length - shown.length) + ' more not shown'));
      }
      body.appendChild(section);
    }

    syncSelection();
  };

  const load = async (): Promise<void> => {
    const token = ++readToken;
    loading = true;
    error = null;
    lastStatus = '';
    render();
    try {
      const viewer = await fetchViewer();
      if (!active || token !== readToken) {
        return;
      }
      if (!viewer) {
        error = 'Sign in to AniList to review your planning list.';
        loading = false;
        render();
        return;
      }
      entries = await fetchBacklogTriage(viewer.id);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Could not read your planning list';
    }
    if (!active || token !== readToken) {
      return;
    }
    loading = false;
    render();
  };

  const apply = async (status: MediaListStatus, label: string): Promise<void> => {
    if (busy) {
      return;
    }
    const chosen: TriageEntry[] = [];
    for (let index = 0; index < entries.length; index += 1) {
      if (selected[String(entries[index].entryId)]) {
        chosen.push(entries[index]);
      }
    }
    if (chosen.length === 0) {
      return;
    }

    busy = true;
    syncSelection();
    const done: Record<string, boolean> = {};
    let failed = 0;
    for (let index = 0; index < chosen.length; index += 1) {
      if (!active) {
        return;
      }
      statusLine.textContent = 'Updating ' + (index + 1) + ' / ' + chosen.length + '\u2026';
      try {
        await saveListEntry(chosen[index].mediaId, chosen[index].entryId, { status: status });
        done[String(chosen[index].entryId)] = true;
      } catch (caught) {
        failed += 1;
      }
    }
    if (!active) {
      return;
    }

    const kept: TriageEntry[] = [];
    for (let index = 0; index < entries.length; index += 1) {
      if (!done[String(entries[index].entryId)]) {
        kept.push(entries[index]);
      }
    }
    entries = kept;
    selected = {};
    busy = false;
    render();
    const moved = chosen.length - failed;
    lastStatus =
      'Moved ' + moved + (moved === 1 ? ' title' : ' titles') + ' to ' + label + (failed > 0 ? ' \u00b7 ' + failed + ' failed' : '');
    statusLine.textContent = lastStatus;
    // Dropping or pausing a title changes what the *other* entries mean — a
    // sequel can stop being "behind a dropped season" — so the view re-reads
    // the list instead of trusting its own snapshot.
    void refresh();
  };

  const refresh = async (): Promise<void> => {
    const token = ++readToken;
    try {
      const viewer = await fetchViewer();
      if (!active || !viewer || token !== readToken) {
        return;
      }
      const next = await fetchBacklogTriage(viewer.id);
      if (!active || token !== readToken) {
        return;
      }
      entries = next;
      render();
    } catch (caught) {
      // The list already reflects the change; a failed refresh keeps it.
    }
  };

  let teardown: () => void = () => {
    active = false;
  };

  const close = (): void => {
    if (location.hash) {
      closeHashView();
      return;
    }
    teardown();
  };

  closeButton.onclick = close;
  clearButton.onclick = () => {
    selected = {};
    syncSelection();
  };
  pauseButton.onclick = () => {
    void apply('PAUSED', 'Paused');
  };
  dropButton.onclick = () => {
    void apply('DROPPED', 'Dropped');
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
    const nodes = sheet.querySelectorAll<HTMLElement>('button, a[href], input:not([disabled])');
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

  closeButton.focus();
  void load();

  return teardown;
}
