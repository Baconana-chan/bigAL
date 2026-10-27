import type { ContinueWatchingItem } from '../api/anilist';
import { fetchContinueWatching, fetchViewer } from '../api/anilist';
import { el, waitFor } from '../core/dom';
import { formatCountdown } from '../core/time';

const LIMIT = 10;
const TICK_MS = 30000;
const MOUNT_CHECK_MS = 1500;

interface CardState {
  item: ContinueWatchingItem;
  card: HTMLAnchorElement;
  badge: HTMLElement;
  meta: HTMLElement;
}

function titleOf(item: ContinueWatchingItem): string {
  return item.title.romaji || item.title.english || item.title.native || 'Unknown title';
}

function progressText(item: ContinueWatchingItem): string {
  return item.episodes !== null ? item.progress + ' / ' + item.episodes : item.progress + ' watched';
}

function describe(item: ContinueWatchingItem): string {
  const total = item.episodes !== null ? '/' + item.episodes : '';
  return (
    titleOf(item) +
    ' \u2014 next: episode ' +
    item.nextEpisode +
    ' (' +
    item.progress +
    total +
    ' watched)' +
    (item.behind > 0
      ? ', ' + item.behind + ' episode' + (item.behind === 1 ? '' : 's') + ' already out'
      : ', airs in ' + formatCountdown(item.airsAt === null ? Date.now() : item.airsAt))
  );
}

function setBadge(state: CardState): void {
  const item = state.item;
  if (item.behind > 0) {
    state.badge.textContent = item.behind + ' behind';
    state.badge.className = 'alx-continue-badge alx-continue-badge-behind';
    state.badge.title = item.behind + ' episode' + (item.behind === 1 ? ' is' : 's are') + ' already out';
    return;
  }
  state.badge.textContent =
    item.airsAt === null ? 'due now' : formatCountdown(item.airsAt) + ' left';
  state.badge.className = 'alx-continue-badge alx-continue-badge-caught';
  state.badge.title =
    'Caught up \u00b7 episode ' + item.nextEpisode + ' airs ' + new Date(item.airsAt === null ? Date.now() : item.airsAt).toLocaleString();
}

function renderCard(item: ContinueWatchingItem, cards: CardState[]): HTMLElement {
  const card = document.createElement('a');
  card.className = 'alx-continue-card' + (item.behind > 0 ? ' alx-continue-card-behind' : '');
  card.href = '/anime/' + item.mediaId;
  card.title = describe(item);

  const coverWrap = el('span', 'alx-continue-cover-wrap');
  if (item.cover) {
    const cover = document.createElement('img');
    cover.className = 'alx-continue-cover';
    cover.loading = 'lazy';
    cover.alt = '';
    cover.src = item.cover;
    coverWrap.appendChild(cover);
  }
  const badge = el('span', 'alx-continue-badge');
  coverWrap.appendChild(badge);
  card.appendChild(coverWrap);

  card.appendChild(el('span', 'alx-continue-title', titleOf(item)));
  const meta = el('span', 'alx-continue-meta', 'Ep ' + item.nextEpisode + ' \u00b7 ' + progressText(item));
  card.appendChild(meta);

  const state: CardState = { item: item, card: card, badge: badge, meta: meta };
  setBadge(state);
  cards.push(state);
  return card;
}

function renderBlock(items: ContinueWatchingItem[], cards: CardState[]): HTMLElement {
  const section = el('div', 'list-preview-wrap alx-continue-wrap');
  const header = el('div', 'section-header');
  const heading = document.createElement('h2');
  heading.textContent = 'Continue watching';
  header.appendChild(heading);
  section.appendChild(header);
  section.appendChild(
    el('div', 'alx-continue-note', 'The next episode you have not watched, and how far behind you are.')
  );

  const row = el('div', 'alx-continue');
  for (let index = 0; index < items.length; index += 1) {
    row.appendChild(renderCard(items[index], cards));
  }
  section.appendChild(row);
  return section;
}

/**
 * Home rail of current titles with something left to watch. Titles behind on
 * released episodes come first and keep counting after an episode airs while
 * the page is open; caught-up titles show a countdown to the next airing.
 */
export function mountContinueWatching(): () => void {
  let active = true;
  let block: HTMLElement | null = null;
  let guard = 0;
  let tick = 0;
  const cards: CardState[] = [];

  const update = (): void => {
    const now = Date.now();
    for (let index = 0; index < cards.length; index += 1) {
      const state = cards[index];
      if (state.item.airsAt !== null && state.item.airsAt <= now) {
        // The episode aired while the page was open: the viewer is now behind.
        state.item.airsAt = null;
        state.item.behind = 1;
        state.meta.textContent = 'Ep ' + state.item.nextEpisode + ' \u00b7 ' + progressText(state.item);
        state.card.className = 'alx-continue-card alx-continue-card-behind';
        state.card.title = describe(state.item);
      }
      setBadge(state);
    }
  };

  const ensureMounted = (): void => {
    if (!active || !block) {
      return;
    }
    const host = document.querySelector('.list-previews');
    if (!host) {
      return;
    }
    const plans = host.querySelector('.alx-plans-wrap');
    if (plans && plans.parentElement === host) {
      if (block.previousElementSibling !== plans) {
        host.insertBefore(block, plans.nextSibling);
      }
      return;
    }
    if (block.parentElement !== host) {
      host.appendChild(block);
    }
  };

  const start = async (): Promise<void> => {
    let items: ContinueWatchingItem[] = [];
    try {
      const viewer = await fetchViewer();
      if (!active || !viewer) {
        return;
      }
      items = await fetchContinueWatching(viewer.id);
    } catch (error) {
      return;
    }
    if (!active || items.length === 0) {
      return;
    }

    const host = await waitFor('.list-previews');
    if (!active || !host) {
      return;
    }
    block = renderBlock(items.slice(0, LIMIT), cards);
    ensureMounted();
    guard = window.setInterval(ensureMounted, MOUNT_CHECK_MS);
    tick = window.setInterval(update, TICK_MS);
  };

  void start();

  return () => {
    active = false;
    if (guard) {
      window.clearInterval(guard);
      guard = 0;
    }
    if (tick) {
      window.clearInterval(tick);
      tick = 0;
    }
    if (block && block.parentElement) {
      block.parentElement.removeChild(block);
    }
    block = null;
    cards.length = 0;
  };
}
