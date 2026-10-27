import type { FriendProgress, FriendProgressRow, MediaListStatus } from '../api/anilist';
import { fetchFriendProgress, fetchViewer } from '../api/anilist';
import type { AppContext } from '../core/context';
import { el, waitFor } from '../core/dom';

const STATUS_META: Array<{ value: MediaListStatus; label: string; color: string }> = [
  { value: 'CURRENT', label: 'Watching', color: '#3db4f2' },
  { value: 'REPEATING', label: 'Rewatching', color: '#3db4f2' },
  { value: 'PLANNING', label: 'Planning', color: '#f7a331' },
  { value: 'COMPLETED', label: 'Completed', color: '#7bd555' },
  { value: 'PAUSED', label: 'Paused', color: '#f7c53a' },
  { value: 'DROPPED', label: 'Dropped', color: '#e85d75' },
];

function statusMeta(status: MediaListStatus | null): { label: string; color: string } | null {
  if (!status) {
    return null;
  }
  for (let index = 0; index < STATUS_META.length; index += 1) {
    if (STATUS_META[index].value === status) {
      return STATUS_META[index];
    }
  }
  return { label: 'In list', color: '#3db4f2' };
}

function tint(hex: string): string {
  const value = hex.replace('#', '');
  const red = parseInt(value.slice(0, 2), 16);
  const green = parseInt(value.slice(2, 4), 16);
  const blue = parseInt(value.slice(4, 6), 16);
  return 'rgba(' + red + ',' + green + ',' + blue + ',0.16)';
}

function plural(count: number, one: string, many: string): string {
  return count + ' ' + (count === 1 ? one : many);
}

function relativeTime(at: number | null): string {
  if (at === null) {
    return '';
  }
  const minutes = Math.floor((Date.now() - at) / 60000);
  if (minutes < 1) {
    return 'updated just now';
  }
  if (minutes < 60) {
    return 'updated ' + plural(minutes, 'minute', 'minutes') + ' ago';
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return 'updated ' + plural(hours, 'hour', 'hours') + ' ago';
  }
  const days = Math.floor(hours / 24);
  if (days < 31) {
    return 'updated ' + plural(days, 'day', 'days') + ' ago';
  }
  const months = Math.floor(days / 30);
  if (months < 12) {
    return 'updated ' + plural(months, 'month', 'months') + ' ago';
  }
  return 'updated ' + plural(Math.floor(days / 365), 'year', 'years') + ' ago';
}

function progressText(row: FriendProgressRow, episodes: number | null): string {
  if (!row.hasEntry || row.unavailable) {
    // The status chip already says whether the row is missing entirely.
    return '';
  }
  if (episodes !== null && episodes > 0) {
    return row.progress + ' / ' + episodes;
  }
  return row.progress === 1 ? '1 episode' : row.progress + ' episodes';
}

/** Fraction watched, or -1 when the title has no total to divide by. */
function fraction(row: FriendProgressRow, episodes: number | null): number {
  if (!row.hasEntry) {
    return 0;
  }
  if (row.status === 'COMPLETED') {
    return 1;
  }
  if (episodes === null || episodes <= 0) {
    return -1;
  }
  return Math.max(0, Math.min(1, row.progress / episodes));
}

function deltaText(row: FriendProgressRow, viewer: FriendProgressRow | null): string {
  if (row.isViewer || !viewer || !viewer.hasEntry || !row.hasEntry) {
    return '';
  }
  const diff = row.progress - viewer.progress;
  if (diff === 0) {
    return 'level';
  }
  return diff > 0 ? diff + ' ahead' : -diff + ' behind';
}

function summaryText(progress: FriendProgress, viewer: FriendProgressRow | null): string {
  const friends: FriendProgressRow[] = [];
  for (let index = 0; index < progress.rows.length; index += 1) {
    if (!progress.rows[index].isViewer) {
      friends.push(progress.rows[index]);
    }
  }
  let tracked = 0;
  for (let index = 0; index < friends.length; index += 1) {
    if (friends[index].hasEntry) {
      tracked += 1;
    }
  }

  if (!progress.signedIn) {
    return tracked === 0 ? 'None of them track this title yet.' : plural(tracked, 'friend tracks', 'friends track') + ' this title.';
  }
  if (!viewer || !viewer.hasEntry) {
    return tracked === 0 ? 'Nobody has added this title yet.' : 'You have not added this title yet.';
  }
  if (tracked === 0) {
    return 'None of your friends track this title yet.';
  }

  let ahead = 0;
  let behind = 0;
  let level = 0;
  for (let index = 0; index < friends.length; index += 1) {
    const friend = friends[index];
    if (!friend.hasEntry) {
      continue;
    }
    if (friend.progress > viewer.progress) {
      ahead += 1;
    } else if (friend.progress < viewer.progress) {
      behind += 1;
    } else {
      level += 1;
    }
  }

  const parts: string[] = [];
  if (ahead > 0) {
    parts.push(plural(ahead, 'friend', 'friends') + ' ahead');
  }
  if (behind > 0) {
    parts.push(behind + ' behind');
  }
  if (level > 0) {
    parts.push(level + ' level');
  }
  return parts.join(' \u00b7 ');
}

function avatarNode(row: FriendProgressRow): HTMLElement {
  if (row.avatar) {
    const image = document.createElement('img');
    image.className = 'alx-friends-avatar';
    image.loading = 'lazy';
    image.alt = '';
    image.src = row.avatar;
    return image;
  }
  const fallback = el(
    'span',
    'alx-friends-avatar alx-friends-avatar-empty',
    row.name.slice(0, 1).toUpperCase()
  );
  return fallback;
}

function renderRow(row: FriendProgressRow, viewer: FriendProgressRow | null, progress: FriendProgress): HTMLElement {
  const item = document.createElement('li');
  item.className = 'alx-friends-row' + (row.isViewer ? ' alx-friends-row-self' : '');

  item.appendChild(avatarNode(row));

  const person = el('span', 'alx-friends-person');
  const name = document.createElement('a');
  name.className = 'alx-friends-name';
  name.href = '/user/' + encodeURIComponent(row.name);
  name.textContent = row.name;
  name.title = 'Open ' + row.name + ' on AniList';
  person.appendChild(name);

  if (row.isViewer) {
    person.appendChild(el('span', 'alx-friends-you', 'You'));
  }

  const meta = statusMeta(row.status);
  if (meta) {
    const chip = el('span', 'alx-friends-status', meta.label);
    chip.style.color = meta.color;
    chip.style.backgroundColor = tint(meta.color);
    person.appendChild(chip);
  } else if (row.unavailable) {
    const chip = el('span', 'alx-friends-status alx-friends-status-empty', 'Not accessible');
    chip.title = 'Private list, or the username does not exist on AniList';
    person.appendChild(chip);
  } else if (!row.hasEntry) {
    person.appendChild(el('span', 'alx-friends-status alx-friends-status-empty', row.isViewer ? 'Not on your list' : 'No entry'));
  }

  const share = row.unavailable ? -1 : fraction(row, progress.episodes);
  if (share >= 0 && row.hasEntry) {
    const bar = el('span', 'alx-friends-bar');
    const fill = el('span', 'alx-friends-bar-fill');
    fill.style.width = Math.round(share * 100) + '%';
    bar.appendChild(fill);
    person.appendChild(bar);
  }

  const updated = relativeTime(row.updatedAt);
  if (updated) {
    person.appendChild(el('span', 'alx-friends-updated', updated));
  }
  item.appendChild(person);

  const count = progressText(row, progress.episodes);
  if (count) {
    item.appendChild(el('span', 'alx-friends-count', count));
  }

  const delta = deltaText(row, viewer);
  if (delta) {
    const chip = el(
      'span',
      'alx-friends-delta' +
        (delta === 'level' ? ' alx-friends-delta-level' : delta.indexOf('ahead') !== -1 ? ' alx-friends-delta-ahead' : ' alx-friends-delta-behind'),
      delta
    );
    item.appendChild(chip);
  }

  return item;
}

function head(): HTMLElement {
  const wrap = el('div', 'alx-friends-head');
  const heading = document.createElement('h2');
  heading.textContent = "Friends' progress";
  wrap.appendChild(heading);
  wrap.appendChild(el('span', 'alx-friends-note', 'Episode counts only'));
  return wrap;
}

function renderCard(host: HTMLElement, progress: FriendProgress): void {
  host.textContent = '';
  host.appendChild(head());

  let viewer: FriendProgressRow | null = null;
  for (let index = 0; index < progress.rows.length; index += 1) {
    if (progress.rows[index].isViewer) {
      viewer = progress.rows[index];
    }
  }

  host.appendChild(el('div', 'alx-friends-summary', summaryText(progress, viewer)));

  const list = document.createElement('ul');
  list.className = 'alx-friends-list';
  list.setAttribute('aria-label', "Episode progress of you and your friends");
  for (let index = 0; index < progress.rows.length; index += 1) {
    list.appendChild(renderRow(progress.rows[index], viewer, progress));
  }
  host.appendChild(list);
}

function renderError(host: HTMLElement, message: string, retry: () => void): void {
  host.textContent = '';
  host.appendChild(head());
  host.appendChild(el('div', 'alx-friends-error', message));
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'alx-btn alx-btn-small';
  button.textContent = 'Retry';
  button.onclick = retry;
  host.appendChild(button);
}

/**
 * Progress comparison under the main column of a title page. One batched
 * AniList request covers the viewer plus every configured friend, so a title
 * page shows who is ahead without a request per person.
 *
 * Only episode numbers and list status are shown: the block never reveals
 * episode titles, and it stays out of the page when no friends are configured.
 */
export function mountFriends(ctx: AppContext, animeId: number): () => void {
  let active = true;
  let card: HTMLElement | null = null;
  let keepAlive = 0;

  /*
   * Vue re-renders the overview, so the card is re-attached on an interval. It
   * follows the studio credits when that block is on, then OP/ED, then the
   * trailer, and never sits above the recommendations.
   */
  const ensureMounted = (): void => {
    if (!active || !card) {
      return;
    }
    const overview = document.querySelector('.media-page-unscoped .overview');
    if (!overview) {
      return;
    }

    const anchors = ['.alx-studios', '.alx-themes'];
    let previous: Element | null = null;
    for (let index = 0; index < anchors.length && !previous; index += 1) {
      const node: Element | null = overview.querySelector(anchors[index]);
      if (node && node.parentElement === overview) {
        previous = node;
      }
    }
    if (!previous) {
      const trailer = document.querySelector('.media-page-unscoped .trailer');
      const trailerSection = trailer ? trailer.closest('.grid-section-wrap') : null;
      if (trailerSection && trailerSection.parentElement === overview) {
        previous = trailerSection;
      }
    }

    if (previous) {
      if (card.previousElementSibling !== previous) {
        overview.insertBefore(card, previous.nextSibling);
      }
      return;
    }

    const recommendations = overview.querySelector('.recommendations');
    if (recommendations && recommendations.parentElement === overview) {
      if (card.nextElementSibling !== recommendations) {
        overview.insertBefore(card, recommendations);
      }
      return;
    }

    if (card.parentElement !== overview) {
      overview.appendChild(card);
    }
  };

  const start = async (): Promise<void> => {
    const overview = await waitFor('.media-page-unscoped .overview');
    if (!active || !overview) {
      return;
    }

    const friends = ctx.settings.get().friends;
    let result: FriendProgress | null = null;
    let error: string | null = null;
    try {
      const viewer = await fetchViewer();
      result = await fetchFriendProgress(animeId, friends, viewer ? viewer.name : null);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Unknown AniList error';
    }
    if (!active) {
      return;
    }
    if (!error && (!result || result.rows.length === 0)) {
      return;
    }

    if (card && card.parentElement) {
      card.parentElement.removeChild(card);
    }
    card = el('div', 'alx-friends');
    if (error || !result) {
      renderError(card, error || 'AniList did not return progress for this title.', () => {
        void start();
      });
    } else {
      renderCard(card, result);
    }
    ensureMounted();

    if (!keepAlive) {
      keepAlive = window.setInterval(ensureMounted, 1500);
    }
  };

  void start();

  return () => {
    active = false;
    if (keepAlive) {
      window.clearInterval(keepAlive);
      keepAlive = 0;
    }
    if (card && card.parentElement) {
      card.parentElement.removeChild(card);
    }
    card = null;
  };
}
