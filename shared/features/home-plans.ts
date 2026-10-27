import type { PlannedUpcoming } from '../api/anilist';
import { fetchPlannedUpcoming, fetchViewer } from '../api/anilist';
import { el, waitFor } from '../core/dom';
import { formatCountdown } from '../core/time';

const TICK_MS = 30000;
const MOUNT_CHECK_MS = 1500;

interface PlanCard {
  item: PlannedUpcoming;
  node: HTMLAnchorElement;
  time: HTMLElement;
}

function titleOf(item: PlannedUpcoming): string {
  return item.title.romaji || item.title.english || item.title.native || 'Unknown title';
}

/**
 * Adds an "Anime in Plans" block to the signed-in home page: planning entries
 * whose first episode is still ahead, ordered by premiere time. Titles that
 * already started airing are omitted, so the block only lists real premieres.
 */
export function mountHomePlans(): () => void {
  let active = true;
  let block: HTMLElement | null = null;
  let guard = 0;
  let tick = 0;
  const cards: PlanCard[] = [];

  const removeBlock = (): void => {
    if (block && block.parentElement) {
      block.parentElement.removeChild(block);
    }
    block = null;
  };

  const updateTimes = (): void => {
    const now = Date.now();
    for (let index = cards.length - 1; index >= 0; index -= 1) {
      const card = cards[index];
      if (card.item.airsAt <= now) {
        if (card.node.parentElement) {
          card.node.parentElement.removeChild(card.node);
        }
        cards.splice(index, 1);
        continue;
      }
      card.time.textContent = formatCountdown(card.item.airsAt);
    }
    if (cards.length === 0) {
      removeBlock();
      if (tick) {
        window.clearInterval(tick);
        tick = 0;
      }
    }
  };

  const ensureMounted = (): void => {
    if (!active || !block) {
      return;
    }
    const host = document.querySelector('.list-previews');
    if (host && block.parentElement !== host) {
      host.appendChild(block);
    }
  };

  const render = (items: PlannedUpcoming[]): HTMLElement => {
    const section = el('div', 'list-preview-wrap alx-plans-wrap');
    const header = el('div', 'section-header');
    const heading = document.createElement('h2');
    heading.textContent = 'Anime in Plans';
    header.appendChild(heading);
    const calendar = document.createElement('a');
    calendar.className = 'alx-plans-link';
    calendar.href = '#alx/calendar';
    calendar.textContent = 'Open calendar';
    calendar.title = 'Month view of premieres and airing episodes';
    header.appendChild(calendar);
    section.appendChild(header);

    const grid = el('div', 'alx-plans');
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const card = document.createElement('a');
      card.className = 'alx-plan';
      card.href = '/anime/' + item.id;
      card.title =
        titleOf(item) +
        ' \u00b7 episode 1 on ' +
        new Date(item.airsAt).toLocaleString();

      const cover = document.createElement('img');
      cover.className = 'alx-plan-cover';
      cover.loading = 'lazy';
      cover.alt = '';
      cover.src = item.coverImage.large || item.coverImage.extraLarge || '';
      card.appendChild(cover);

      const overlay = el('span', 'alx-plan-overlay');
      overlay.appendChild(el('span', 'alx-plan-ep', 'Ep 1'));
      const time = el('span', 'alx-plan-time', formatCountdown(item.airsAt));
      overlay.appendChild(time);
      card.appendChild(overlay);

      grid.appendChild(card);
      cards.push({ item: item, node: card, time: time });
    }
    section.appendChild(grid);
    return section;
  };

  const start = async (): Promise<void> => {
    const viewer = await fetchViewer();
    if (!active || !viewer) {
      return;
    }
    const items = await fetchPlannedUpcoming(viewer.id);
    if (!active) {
      return;
    }
    const upcoming: PlannedUpcoming[] = [];
    const now = Date.now();
    for (let index = 0; index < items.length; index += 1) {
      if (items[index].airsAt > now) {
        upcoming.push(items[index]);
      }
    }
    if (upcoming.length === 0) {
      return;
    }

    const host = await waitFor('.list-previews');
    if (!active || !host) {
      return;
    }
    block = render(upcoming);
    host.appendChild(block);
    guard = window.setInterval(ensureMounted, MOUNT_CHECK_MS);
    tick = window.setInterval(updateTimes, TICK_MS);
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
    removeBlock();
  };
}
