import type {
  ListEntryInfo,
  MediaListStatus,
  MediaQuickState,
  MediaSort,
  StudioDetails,
  StudioDna,
  StudioDnaPerson,
  StudioMediaNode,
  StudioRole,
  ViewerInfo,
} from '../api/anilist';
import { fetchQuickStates, fetchStudioDna, fetchStudioPage, fetchViewer } from '../api/anilist';
import { el, formatNumber, icon, mean, waitFor, HEART_ICON } from '../core/dom';
import { buildQuickActions, closeQuickActionsPopover } from './quick-actions';

interface SortOption {
  value: MediaSort;
  label: string;
}

const SORT_OPTIONS: SortOption[] = [
  { value: 'START_DATE_DESC', label: 'Newest first' },
  { value: 'START_DATE', label: 'Oldest first' },
  { value: 'SCORE_DESC', label: 'Highest score' },
  { value: 'POPULARITY_DESC', label: 'Most popular' },
  { value: 'TITLE_ROMAJI', label: 'Title A-Z' },
];

const FORMATS: Array<{ value: string; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'TV', label: 'TV' },
  { value: 'TV_SHORT', label: 'TV Short' },
  { value: 'MOVIE', label: 'Movies' },
  { value: 'OVA', label: 'OVA' },
  { value: 'ONA', label: 'ONA' },
  { value: 'SPECIAL', label: 'Special' },
  { value: 'MUSIC', label: 'Music' },
];

const ROLES: Array<{ value: 'ALL' | StudioRole; label: string }> = [
  { value: 'ALL', label: 'All credits' },
  { value: 'main', label: 'Main works' },
  { value: 'supporting', label: 'Supporting only' },
];

const LIST_STATUS: Array<{ value: MediaListStatus; label: string; color: string }> = [
  { value: 'CURRENT', label: 'Watching', color: '#3db4f2' },
  { value: 'REPEATING', label: 'Rewatching', color: '#3db4f2' },
  { value: 'PLANNING', label: 'Planning', color: '#f7a331' },
  { value: 'COMPLETED', label: 'Completed', color: '#7bd555' },
  { value: 'PAUSED', label: 'Paused', color: '#f7c53a' },
  { value: 'DROPPED', label: 'Dropped', color: '#e85d75' },
];

function listStatusMeta(status: MediaListStatus): { label: string; color: string } {
  for (let index = 0; index < LIST_STATUS.length; index += 1) {
    if (LIST_STATUS[index].value === status) {
      return LIST_STATUS[index];
    }
  }
  return { label: 'In list', color: '#3db4f2' };
}

const STATUSES: Array<{ value: string; label: string }> = [
  { value: 'ALL', label: 'Any status' },
  { value: 'FINISHED', label: 'Finished' },
  { value: 'RELEASING', label: 'Airing' },
  { value: 'NOT_YET_RELEASED', label: 'Upcoming' },
  { value: 'HIATUS', label: 'Hiatus' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

interface StudioState {
  sort: MediaSort;
  page: number;
  items: StudioMediaNode[];
  format: string;
  status: string;
  role: 'ALL' | StudioRole;
  search: string;
  loading: boolean;
  done: boolean;
  error: string | null;
  nativeVisible: boolean;
  reloadPending: boolean;
}

function formatLabel(format: string | null): string {
  if (!format) {
    return 'Unknown';
  }
  switch (format) {
    case 'TV_SHORT':
      return 'TV Short';
    case 'MOVIE':
      return 'Movie';
    case 'SPECIAL':
      return 'Special';
    default:
      return format;
  }
}

function titleOf(item: StudioMediaNode): string {
  return item.title.romaji || item.title.english || item.title.native || 'Unknown title';
}

function yearOf(item: StudioMediaNode): number | null {
  if (item.startDate && item.startDate.year) {
    return item.startDate.year;
  }
  return item.seasonYear;
}

function button(className: string, text: string): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  node.textContent = text;
  return node;
}

function stat(label: string, valueNode: Node, extraClass?: string): HTMLElement {
  const wrap = el('div', 'alx-stat' + (extraClass ? ' ' + extraClass : ''));
  const labelNode = el('div', 'alx-stat-label');
  labelNode.appendChild(document.createTextNode(label));
  const value = el('div', 'alx-stat-value');
  value.appendChild(valueNode);
  wrap.appendChild(labelNode);
  wrap.appendChild(value);
  return wrap;
}

function textNode(text: string): Text {
  return document.createTextNode(text);
}

export interface StudioOptions {
  /** Show the hover quick actions on covers; list markers stay either way. */
  quickActions: boolean;
  /** Show the recurring-people panel built from the studio's top works. */
  dna: boolean;
}

export function mountStudio(studioId: number, options: StudioOptions): () => void {
  let active = true;
  let cleanup: (() => void) | null = null;

  const setup = async (): Promise<void> => {
    const header = await waitFor('.studio-page-unscoped .container.header');
    if (!active || !header) {
      return;
    }
    let studio = document.querySelector('.studio-page-unscoped');
    if (!studio || !studio.parentElement) {
      return;
    }

    const host = studio.parentElement;
    const section = el('div', 'alx-studio');
    section.id = 'alx-studio';
    host.insertBefore(section, studio.nextSibling);
    studio.classList.add('alx-native-hidden');

    const state: StudioState = {
      sort: 'START_DATE_DESC',
      page: 0,
      items: [],
      format: 'ALL',
      status: 'ALL',
      role: 'ALL',
      search: '',
      loading: false,
      done: false,
      error: null,
      nativeVisible: false,
      reloadPending: false,
    };

    let meta: StudioDetails | null = null;
    let viewer: ViewerInfo | null = null;
    let viewerLoaded = false;
    const quick: Record<string, MediaQuickState> = {};
    let quickBusy = false;
    let quickPending = false;

    const onEntryChanged = (mediaId: number) => (entry: ListEntryInfo | null): void => {
      const current = quick[String(mediaId)];
      if (current) {
        quick[String(mediaId)] = {
          id: current.id,
          trailer: current.trailer,
          nextAiringEpisode: current.nextAiringEpisode,
          entry: entry,
        };
      }
      renderGrid();
    };

    const hydrateQuick = async (): Promise<void> => {
      if (!active) {
        return;
      }
      if (quickBusy) {
        quickPending = true;
        return;
      }
      const missing: number[] = [];
      for (let index = 0; index < state.items.length; index += 1) {
        const id = state.items[index].id;
        if (!quick[String(id)]) {
          missing.push(id);
        }
      }
      if (missing.length === 0) {
        return;
      }
      quickBusy = true;
      try {
        if (!viewerLoaded) {
          viewer = await fetchViewer();
          viewerLoaded = true;
        }
        const states = await fetchQuickStates(missing, viewer);
        if (!active) {
          return;
        }
        for (let index = 0; index < states.length; index += 1) {
          quick[String(states[index].id)] = states[index];
        }
      } finally {
        quickBusy = false;
      }
      if (active) {
        renderGrid();
        if (quickPending) {
          quickPending = false;
          void hydrateQuick();
        }
      }
    };

    const head = el('div', 'alx-studio-head');
    const defaultBtn = button('alx-btn alx-btn-ghost', 'Default view');
    head.appendChild(defaultBtn);
    section.appendChild(head);

    const summary = el('div', 'alx-summary');
    section.appendChild(summary);

    // Studio DNA: filled in after the summary so the grid is not held up by it.
    const dnaHost = el('div', 'alx-dna');
    dnaHost.style.display = 'none';
    section.appendChild(dnaHost);

    const renderDnaPerson = (person: StudioDnaPerson): HTMLElement => {
      const link = document.createElement('a');
      link.className = 'alx-dna-person';
      link.href = '/staff/' + person.id;
      link.title =
        person.name +
        (person.roles.length > 0 ? ' \u2014 ' + person.roles.join(', ') : '') +
        ' \u00b7 ' +
        (person.works === 1 ? '1 work' : person.works + ' works');

      const avatar = el('span', 'alx-dna-avatar');
      if (person.image) {
        const image = document.createElement('img');
        image.loading = 'lazy';
        image.alt = '';
        image.src = person.image;
        avatar.appendChild(image);
      } else {
        avatar.textContent = person.name.charAt(0).toUpperCase();
      }
      link.appendChild(avatar);

      const info = el('span', 'alx-dna-info');
      info.appendChild(el('span', 'alx-dna-name', person.name));
      let meta = 'main roles';
      if (person.kind !== 'cast' && person.roles.length > 0) {
        meta = person.roles.slice(0, 2).join(', ');
      }
      info.appendChild(el('span', 'alx-dna-meta', meta));
      link.appendChild(info);

      link.appendChild(el('span', 'alx-dna-count', person.works + '\u00d7'));
      return link;
    };

    const renderDna = (dna: StudioDna): void => {
      dnaHost.textContent = '';
      const groups: Array<{ title: string; people: StudioDnaPerson[] }> = [
        { title: 'Directors', people: dna.directors },
        { title: 'Composers', people: dna.composers },
        { title: 'Recurring cast', people: dna.cast },
      ];
      let total = 0;
      for (let index = 0; index < groups.length; index += 1) {
        total += groups[index].people.length;
      }
      if (total === 0) {
        // Nothing recurs in the sample: better no panel than an empty one.
        dnaHost.style.display = 'none';
        return;
      }

      const head = el('div', 'alx-dna-head');
      const heading = document.createElement('h2');
      heading.textContent = 'Studio DNA';
      head.appendChild(heading);
      let note = 'Recurring people across ' + dna.works + ' works';
      if (dna.castWorks > 0) {
        note += ' \u00b7 cast checked on ' + dna.castWorks;
      }
      head.appendChild(el('span', 'alx-dna-note', note));
      dnaHost.appendChild(head);

      const grid = el('div', 'alx-dna-grid');
      for (let index = 0; index < groups.length; index += 1) {
        const group = groups[index];
        if (group.people.length === 0) {
          continue;
        }
        const box = el('div', 'alx-dna-group');
        box.appendChild(el('div', 'alx-dna-group-title', group.title));
        for (let personIndex = 0; personIndex < group.people.length; personIndex += 1) {
          box.appendChild(renderDnaPerson(group.people[personIndex]));
        }
        grid.appendChild(box);
      }
      dnaHost.appendChild(grid);
      dnaHost.style.display = '';
    };

    const loadDna = async (): Promise<void> => {
      if (!options.dna) {
        return;
      }
      dnaHost.textContent = '';
      dnaHost.appendChild(el('div', 'alx-dna-loading', 'Reading studio credits\u2026'));
      dnaHost.style.display = '';
      try {
        const dna = await fetchStudioDna(studioId);
        if (!active) {
          return;
        }
        renderDna(dna);
      } catch (error) {
        if (!active) {
          return;
        }
        // Credits are a bonus; the studio page works without them.
        dnaHost.style.display = 'none';
      }
    };

    const toolbar = el('div', 'alx-toolbar');
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'alx-input alx-search';
    search.placeholder = 'Search loaded works';
    const sortSelect = document.createElement('select');
    sortSelect.className = 'alx-input alx-select';
    for (let index = 0; index < SORT_OPTIONS.length; index += 1) {
      const option = document.createElement('option');
      option.value = SORT_OPTIONS[index].value;
      option.textContent = SORT_OPTIONS[index].label;
      sortSelect.appendChild(option);
    }
    sortSelect.value = state.sort;
    const statusSelect = document.createElement('select');
    statusSelect.className = 'alx-input alx-select';
    for (let index = 0; index < STATUSES.length; index += 1) {
      const option = document.createElement('option');
      option.value = STATUSES[index].value;
      option.textContent = STATUSES[index].label;
      statusSelect.appendChild(option);
    }
    const roleSelect = document.createElement('select');
    roleSelect.className = 'alx-input alx-select';
    const roleOptions: HTMLOptionElement[] = [];
    for (let index = 0; index < ROLES.length; index += 1) {
      const option = document.createElement('option');
      option.value = ROLES[index].value;
      option.textContent = ROLES[index].label;
      roleOptions.push(option);
      roleSelect.appendChild(option);
    }
    const chips = el('div', 'alx-chips');
    toolbar.appendChild(search);
    toolbar.appendChild(sortSelect);
    toolbar.appendChild(statusSelect);
    toolbar.appendChild(roleSelect);
    toolbar.appendChild(chips);
    section.appendChild(toolbar);

    const grid = el('div', 'alx-grid');
    section.appendChild(grid);

    const footer = el('div', 'alx-studio-footer');
    const statusLine = el('div', 'alx-muted', 'Loading studio...');
    const loadBtn = button('alx-btn', 'Load more works');
    footer.appendChild(statusLine);
    footer.appendChild(loadBtn);
    section.appendChild(footer);

    const updateDefaultButton = (): void => {
      defaultBtn.textContent = state.nativeVisible ? 'Enhanced view' : 'Default view';
    };

    const visibleItems = (): StudioMediaNode[] => {
      const searchText = state.search.trim().toLowerCase();
      const result: StudioMediaNode[] = [];
      for (let index = 0; index < state.items.length; index += 1) {
        const item = state.items[index];
        if (state.format !== 'ALL' && item.format !== state.format) {
          continue;
        }
        if (state.status !== 'ALL' && item.status !== state.status) {
          continue;
        }
        if (state.role !== 'ALL' && item.studioRole !== state.role) {
          continue;
        }
        if (searchText) {
          const haystack = (
            (item.title.romaji || '') +
            ' ' +
            (item.title.english || '') +
            ' ' +
            (item.title.native || '')
          ).toLowerCase();
          if (haystack.indexOf(searchText) === -1) {
            continue;
          }
        }
        result.push(item);
      }
      return result;
    };

    const renderChips = (): void => {
      chips.textContent = '';
      let mainCount = 0;
      for (let itemIndex = 0; itemIndex < state.items.length; itemIndex += 1) {
        if (state.items[itemIndex].studioRole === 'main') {
          mainCount += 1;
        }
      }
      roleOptions[0].textContent = 'All credits (' + state.items.length + ')';
      roleOptions[1].textContent = 'Main works (' + mainCount + ')';
      roleOptions[2].textContent = 'Supporting (' + (state.items.length - mainCount) + ')';

      for (let index = 0; index < FORMATS.length; index += 1) {
        const definition = FORMATS[index];
        let count = 0;
        if (definition.value !== 'ALL') {
          for (let itemIndex = 0; itemIndex < state.items.length; itemIndex += 1) {
            if (state.items[itemIndex].format === definition.value) {
              count += 1;
            }
          }
        }
        const chip = button(
          'alx-chip' + (state.format === definition.value ? ' alx-chip-active' : ''),
          definition.label + (count > 0 ? ' ' + count : '')
        );
        chip.setAttribute('data-format', definition.value);
        chip.onclick = () => {
          state.format = definition.value;
          renderChips();
          renderGrid();
        };
        chips.appendChild(chip);
      }
    };

    const renderSummary = (): void => {
      summary.textContent = '';
      const years: number[] = [];
      const scores: number[] = [];
      let top: StudioMediaNode | null = null;
      for (let index = 0; index < state.items.length; index += 1) {
        const item = state.items[index];
        const year = yearOf(item);
        if (year) {
          years.push(year);
        }
        if (item.averageScore) {
          scores.push(item.averageScore);
          if (!top || (top.averageScore || 0) < item.averageScore) {
            top = item;
          }
        }
      }

      const favourites = meta ? meta.favourites : null;
      const favouriteValue = el('span', 'alx-stat-inline');
      const heart = icon(HEART_ICON, 'alx-heart');
      favouriteValue.appendChild(heart);
      favouriteValue.appendChild(textNode(favourites === null ? ' -' : ' ' + formatNumber(favourites)));
      summary.appendChild(stat('Favourites', favouriteValue));

      summary.appendChild(stat('Works loaded', textNode(String(state.items.length))));

      let yearValue = ' -';
      if (years.length > 0) {
        let min = years[0];
        let max = years[0];
        for (let index = 1; index < years.length; index += 1) {
          if (years[index] < min) min = years[index];
          if (years[index] > max) max = years[index];
        }
        yearValue = min === max ? String(min) : min + ' - ' + max;
      }
      summary.appendChild(stat('Years', textNode(yearValue)));

      const average = mean(scores);
      summary.appendChild(stat('Average score', textNode(average === null ? ' -' : Math.round(average) + '%')));

      const topWrap = el('div', 'alx-stat');
      topWrap.appendChild(el('div', 'alx-stat-label', 'Top rated'));
      const topValue = el('div', 'alx-stat-value alx-stat-top');
      if (top) {
        const topLink = document.createElement('a');
        topLink.className = 'alx-inline-link';
        topLink.href = '/anime/' + top.id;
        topLink.textContent = titleOf(top);
        topValue.appendChild(topLink);
        topValue.appendChild(textNode(' ' + (top.averageScore || 0) + '%'));
      } else {
        topValue.textContent = ' -';
      }
      topWrap.appendChild(topValue);
      summary.appendChild(topWrap);

      if (meta && !meta.isAnimationStudio) {
        const note = el('div', 'alx-summary-note', 'This studio is not flagged as an animation studio on AniList.');
        summary.appendChild(note);
      }
    };

    const renderGrid = (): void => {
      grid.textContent = '';

      if (state.error && state.items.length === 0) {
        const errorBox = el('div', 'alx-error');
        errorBox.appendChild(el('div', 'alx-error-text', state.error));
        const retry = button('alx-btn', 'Retry');
        retry.onclick = () => {
          void load(true);
        };
        errorBox.appendChild(retry);
        grid.appendChild(errorBox);
        statusLine.textContent = 'Could not load studio works.';
        loadBtn.style.display = 'none';
        return;
      }

      if (state.items.length === 0) {
        grid.appendChild(el('div', 'alx-empty', state.loading ? 'Loading studio works...' : 'No works found.'));
        statusLine.textContent = state.loading ? 'Loading studio works...' : '';
        loadBtn.style.display = 'none';
        return;
      }

      const items = visibleItems();
      if (items.length === 0) {
        grid.appendChild(el('div', 'alx-empty', 'No loaded works match these filters.'));
      } else {
        const fragment = document.createDocumentFragment();
        for (let index = 0; index < items.length; index += 1) {
          const item = items[index];
          const card = el('div', 'alx-work');

          const cover = el('div', 'alx-work-cover');
          const coverLink = document.createElement('a');
          coverLink.className = 'alx-work-cover-link';
          coverLink.href = '/anime/' + item.id;
          coverLink.setAttribute('aria-label', titleOf(item));
          const image = document.createElement('img');
          image.loading = 'lazy';
          image.alt = '';
          image.src = item.coverImage.large || item.coverImage.extraLarge || '';
          coverLink.appendChild(image);
          cover.appendChild(coverLink);
          if (item.averageScore !== null) {
            cover.appendChild(el('span', 'alx-work-score', item.averageScore + '%'));
          }
          const roleBadge = el(
            'span',
            'alx-work-role alx-work-role-' + item.studioRole,
            item.studioRole === 'main' ? 'Main' : 'Supporting'
          );
          roleBadge.title =
            item.studioRole === 'main'
              ? 'Main animation studio for this title'
              : 'Supporting studio credit for this title';
          cover.appendChild(roleBadge);

          const quickState = quick[String(item.id)];
          if (quickState && options.quickActions) {
            cover.appendChild(
              buildQuickActions(item, {
                viewer: viewer,
                state: quickState,
                onEntryChanged: onEntryChanged(item.id),
              })
            );
          }
          card.appendChild(cover);

          const titleLink = document.createElement('a');
          titleLink.className = 'alx-work-title';
          titleLink.href = '/anime/' + item.id;
          titleLink.textContent = titleOf(item);
          card.appendChild(titleLink);
          const metaParts: string[] = [formatLabel(item.format)];
          const year = yearOf(item);
          if (year) {
            metaParts.push(String(year));
          }
          if (item.episodes) {
            metaParts.push(item.episodes + ' ep');
          }
          const metaLine = el('div', 'alx-work-meta');
          if (quickState && quickState.entry) {
            const status = listStatusMeta(quickState.entry.status);
            const marker = el('span', 'alx-work-status');
            marker.style.color = status.color;
            marker.title = 'In your list: ' + status.label;
            marker.appendChild(el('span', 'alx-work-status-dot'));
            marker.appendChild(textNode(status.label));
            metaLine.appendChild(marker);
            metaLine.appendChild(textNode(' \u00b7 '));
          }
          metaLine.appendChild(textNode(metaParts.join(' \u00b7 ')));
          card.appendChild(metaLine);
          fragment.appendChild(card);
        }
        grid.appendChild(fragment);
      }

      const loaded = state.items.length;
      const shown = items.length;
      let statusText = loaded === shown ? loaded + ' works loaded' : shown + ' of ' + loaded + ' loaded works shown';
      if (!state.done) {
        statusText += ' \u00b7 more pages available';
      } else if (loaded > 0) {
        statusText += ' \u00b7 all pages loaded';
      }
      if (state.error) {
        statusText += ' \u00b7 could not load more: ' + state.error;
      }
      statusLine.textContent = statusText;
      loadBtn.style.display = state.done ? 'none' : '';
      loadBtn.disabled = state.loading;
      loadBtn.textContent = state.loading ? 'Loading...' : 'Load more works';
    };

    const load = async (reset: boolean): Promise<void> => {
      if (state.loading) {
        if (reset) {
          state.reloadPending = true;
        }
        return;
      }
      if (reset) {
        state.items = [];
        state.page = 0;
        state.done = false;
      }
      state.loading = true;
      state.error = null;
      if (reset) {
        renderGrid();
        renderSummary();
      } else {
        loadBtn.disabled = true;
        loadBtn.textContent = 'Loading...';
      }

      const page = reset ? 1 : state.page + 1;
      try {
        const data = await fetchStudioPage(studioId, page, state.sort);
        if (!active) {
          return;
        }
        meta = data;
        const seen: Record<string, boolean> = {};
        for (let index = 0; index < state.items.length; index += 1) {
          seen[String(state.items[index].id)] = true;
        }
        for (let index = 0; index < data.media.nodes.length; index += 1) {
          const node = data.media.nodes[index];
          if (!seen[String(node.id)]) {
            seen[String(node.id)] = true;
            state.items.push(node);
          }
        }
        state.page = page;
        state.done = data.media.nodes.length === 0;
      } catch (error) {
        if (!active) {
          return;
        }
        state.error = error instanceof Error ? error.message : 'Unknown AniList error';
      } finally {
        state.loading = false;
        if (active) {
          renderSummary();
          renderChips();
          renderGrid();
          void hydrateQuick();
        }
        if (active && state.reloadPending) {
          state.reloadPending = false;
          void load(true);
        }
      }
    };

    search.oninput = () => {
      state.search = search.value;
      renderGrid();
    };
    sortSelect.onchange = () => {
      state.sort = sortSelect.value as MediaSort;
      void load(true);
    };
    statusSelect.onchange = () => {
      state.status = statusSelect.value;
      renderGrid();
    };
    roleSelect.onchange = () => {
      state.role = roleSelect.value as 'ALL' | StudioRole;
      renderGrid();
    };
    loadBtn.onclick = () => {
      void load(false);
    };
    defaultBtn.onclick = () => {
      const currentStudio = document.querySelector('.studio-page-unscoped');
      if (currentStudio) {
        studio = currentStudio;
      }
      if (!studio) {
        return;
      }
      state.nativeVisible = !state.nativeVisible;
      if (state.nativeVisible) {
        studio.classList.remove('alx-native-hidden');
        section.classList.add('alx-studio-hidden');
      } else {
        studio.classList.add('alx-native-hidden');
        section.classList.remove('alx-studio-hidden');
      }
      if (state.nativeVisible) {
        defaultBtn.classList.add('alx-fixed-toggle');
      } else {
        defaultBtn.classList.remove('alx-fixed-toggle');
      }
      updateDefaultButton();
    };

    const guard = window.setInterval(() => {
      if (!active) {
        return;
      }
      const current = document.querySelector('.studio-page-unscoped');
      if (!current) {
        return;
      }
      if (current !== studio) {
        studio = current;
      }
      if (!state.nativeVisible) {
        studio.classList.add('alx-native-hidden');
      }
      const parent = studio.parentElement;
      if (parent && section.parentElement !== parent) {
        parent.insertBefore(section, studio.nextSibling);
      }
    }, 1000);

    cleanup = () => {
      closeQuickActionsPopover(false);
      window.clearInterval(guard);
      if (studio) {
        studio.classList.remove('alx-native-hidden');
      }
      if (section.parentElement) {
        section.parentElement.removeChild(section);
      }
    };

    updateDefaultButton();
    renderChips();
    void load(true);
    void loadDna();
  };

  void setup();

  return () => {
    active = false;
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
  };
}
