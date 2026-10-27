import type { BacklogPick } from '../api/anilist';
import { fetchBacklogPicks, fetchViewer } from '../api/anilist';
import { el, waitFor } from '../core/dom';

const MOUNT_CHECK_MS = 1500;

function titleOf(pick: BacklogPick): string {
  return pick.title.romaji || pick.title.english || pick.title.native || 'Unknown title';
}

function metaOf(pick: BacklogPick): string {
  const parts: string[] = [];
  if (pick.format) {
    parts.push(pick.format === 'TV' ? 'TV' : pick.format.charAt(0) + pick.format.slice(1).toLowerCase());
  }
  if (pick.episodes) {
    parts.push(pick.episodes + ' ep');
  }
  return parts.join(' \u00b7 ');
}

function renderCard(pick: BacklogPick): HTMLElement {
  const card = document.createElement('a');
  card.className = 'alx-pick';
  card.href = '/anime/' + pick.id;

  const reasonTitle: string[] = [];
  for (let index = 0; index < pick.because.length; index += 1) {
    const source = pick.because[index];
    reasonTitle.push(source.title.romaji || source.title.english || source.title.native || 'liked title');
  }
  card.title = titleOf(pick) + (reasonTitle.length > 0 ? ' \u2014 like ' + reasonTitle.join(', ') : '');

  const coverWrap = el('span', 'alx-pick-cover-wrap');
  const cover = document.createElement('img');
  cover.className = 'alx-pick-cover';
  cover.loading = 'lazy';
  cover.alt = '';
  cover.src = pick.coverImage.large || '';
  coverWrap.appendChild(cover);
  if (pick.averageScore !== null) {
    coverWrap.appendChild(el('span', 'alx-pick-score', pick.averageScore + '%'));
  }
  card.appendChild(coverWrap);

  card.appendChild(el('span', 'alx-pick-title', titleOf(pick)));

  const meta = metaOf(pick);
  if (meta) {
    card.appendChild(el('span', 'alx-pick-meta', meta));
  }

  if (reasonTitle.length > 0) {
    card.appendChild(el('span', 'alx-pick-because', 'Like ' + reasonTitle.join(' \u00b7 ')));
  }

  return card;
}

function renderBlock(picks: BacklogPick[]): HTMLElement {
  const section = el('div', 'list-preview-wrap alx-picks-wrap');
  const header = el('div', 'section-header');
  const heading = document.createElement('h2');
  heading.textContent = 'Next from your plans';
  header.appendChild(heading);
  section.appendChild(header);
  section.appendChild(el('div', 'alx-picks-note', 'Planning entries AniList links to titles you rated highly.'));

  const row = el('div', 'alx-picks');
  for (let index = 0; index < picks.length; index += 1) {
    row.appendChild(renderCard(picks[index]));
  }
  section.appendChild(row);
  return section;
}

/**
 * A fifth home block: planning entries that AniList's community recommendations
 * connect to the titles this user rated highly. Picks keep the reason attached
 * ("like X"), so the rail is explainable instead of a black-box score, and the
 * block stays away from the page when nothing overlaps.
 */
export function mountBacklogPicks(): () => void {
  let active = true;
  let block: HTMLElement | null = null;
  let guard = 0;

  const ensureMounted = (): void => {
    if (!active || !block) {
      return;
    }
    const host = document.querySelector('.list-previews');
    if (!host) {
      return;
    }
    // Sit after the continue-watching rail, then after Anime in Plans, so the
    // order stays plans → continue → picks however late each block arrives.
    const anchors = ['.alx-continue-wrap', '.alx-plans-wrap'];
    let previous: Element | null = null;
    for (let index = 0; index < anchors.length && !previous; index += 1) {
      const node: Element | null = host.querySelector(anchors[index]);
      if (node && node.parentElement === host) {
        previous = node;
      }
    }
    if (previous) {
      if (block.previousElementSibling !== previous) {
        host.insertBefore(block, previous.nextSibling);
      }
      return;
    }
    if (block.parentElement !== host) {
      host.appendChild(block);
    }
  };

  const start = async (): Promise<void> => {
    let picks: BacklogPick[] = [];
    try {
      const viewer = await fetchViewer();
      if (!active || !viewer) {
        return;
      }
      picks = await fetchBacklogPicks(viewer);
    } catch (error) {
      // The home page already works without this block; stay quiet.
      return;
    }
    if (!active || picks.length === 0) {
      return;
    }

    const host = await waitFor('.list-previews');
    if (!active || !host) {
      return;
    }
    block = renderBlock(picks);
    ensureMounted();
    guard = window.setInterval(ensureMounted, MOUNT_CHECK_MS);
  };

  void start();

  return () => {
    active = false;
    if (guard) {
      window.clearInterval(guard);
      guard = 0;
    }
    if (block && block.parentElement) {
      block.parentElement.removeChild(block);
    }
    block = null;
  };
}
