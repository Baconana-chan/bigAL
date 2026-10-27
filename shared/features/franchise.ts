import type { FranchiseNext, FranchiseNode, FranchiseSideEntry, FranchiseTree, MediaListStatus } from '../api/anilist';
import { fetchFranchiseTree, fetchViewer, relationLabel } from '../api/anilist';
import { el, waitFor } from '../core/dom';
import { closeHashView, franchiseHashOf } from '../core/router';
import { formatCountdown } from '../core/time';

const FORMAT_LABELS: Record<string, string> = {
  TV: 'TV',
  TV_SHORT: 'TV short',
  MOVIE: 'Movie',
  SPECIAL: 'Special',
  OVA: 'OVA',
  ONA: 'ONA',
  MUSIC: 'Music',
};

const STATUS_LABELS: Record<MediaListStatus, string> = {
  CURRENT: 'Watching',
  REPEATING: 'Rewatching',
  PLANNING: 'Planning',
  COMPLETED: 'Completed',
  PAUSED: 'Paused',
  DROPPED: 'Dropped',
};

const STATUS_KEYS: Record<MediaListStatus, string> = {
  CURRENT: 'current',
  REPEATING: 'current',
  PLANNING: 'planning',
  COMPLETED: 'completed',
  PAUSED: 'paused',
  DROPPED: 'dropped',
};

function titleOf(node: FranchiseNode): string {
  return node.title.romaji || node.title.english || node.title.native || 'Unknown title';
}

function formatLabel(format: string | null): string {
  return format ? FORMAT_LABELS[format] || format : '';
}

function nodeMeta(node: FranchiseNode): string {
  const parts: string[] = [];
  if (node.year) {
    parts.push(String(node.year));
  }
  const format = formatLabel(node.format);
  if (format) {
    parts.push(format);
  }
  if (node.episodes) {
    parts.push(node.episodes + ' ep');
  }
  return parts.join(' \u00b7 ');
}

function progressText(node: FranchiseNode): string {
  if (!node.entry) {
    return 'Not in your list';
  }
  if (node.episodes !== null) {
    return node.entry.progress + ' / ' + node.episodes;
  }
  return node.entry.progress + ' watched';
}

function watchedPercent(node: FranchiseNode): number {
  if (!node.entry || !node.episodes) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((node.entry.progress / node.episodes) * 100)));
}

function plural(count: number, one: string, many: string): string {
  return count + ' ' + (count === 1 ? one : many);
}

function statusChip(node: FranchiseNode): HTMLElement | null {
  if (!node.entry) {
    return null;
  }
  const status = node.entry.status;
  const chip = el('span', 'alx-fr-chip alx-fr-chip-' + STATUS_KEYS[status], STATUS_LABELS[status]);
  return chip;
}

function nextHint(plan: FranchiseNext): string {
  if (plan.airsAt === null) {
    return 'Episode ' + plan.episode;
  }
  return 'Episode ' + plan.episode + ' \u00b7 ' + formatCountdown(plan.airsAt);
}

function coverNode(node: FranchiseNode, className: string): HTMLElement {
  const wrap = el('span', className);
  if (node.cover) {
    const image = document.createElement('img');
    image.loading = 'lazy';
    image.alt = '';
    image.src = node.cover;
    wrap.appendChild(image);
  }
  return wrap;
}

/**
 * Compact franchise block under the main column of a title page: what to watch
 * next in this franchise plus a link to the full tracker. Nothing is injected
 * for a standalone title, so pages without sequels stay untouched.
 */
export function mountFranchiseSummary(rootId: number): () => void {
  let active = true;
  let block: HTMLElement | null = null;
  let keepAlive = 0;

  const ensureMounted = (): void => {
    if (!active || !block) {
      return;
    }
    const overview = document.querySelector('.media-page-unscoped .overview');
    if (!overview) {
      return;
    }
    // OP/ED and studio credits are the neighbours this block belongs with.
    const anchor =
      overview.querySelector('.alx-studios') ||
      overview.querySelector('.alx-themes') ||
      (document.querySelector('.media-page-unscoped .trailer')
        ? document.querySelector('.media-page-unscoped .trailer')!.closest('.grid-section-wrap')
        : null);
    if (anchor && anchor.parentElement === overview) {
      if (block.previousElementSibling !== anchor) {
        overview.insertBefore(block, anchor.nextSibling);
      }
      return;
    }
    const recommendations = overview.querySelector('.recommendations');
    if (recommendations && recommendations.parentElement === overview) {
      overview.insertBefore(block, recommendations);
      return;
    }
    if (block.parentElement !== overview) {
      overview.appendChild(block);
    }
  };

  const render = (tree: FranchiseTree): void => {
    block = el('div', 'alx-franchise');

    const head = el('div', 'alx-franchise-head');
    const heading = document.createElement('h2');
    heading.textContent = 'Franchise';
    head.appendChild(heading);
    const more = document.createElement('a');
    more.className = 'alx-franchise-more';
    more.href = franchiseHashOf(rootId);
    more.textContent = 'Open tracker';
    more.title = 'Watch order, progress and the next unwatched episode';
    head.appendChild(more);
    block.appendChild(head);

    if (tree.signedIn && tree.next) {
      const card = document.createElement('a');
      card.className = 'alx-franchise-next';
      card.href = '/anime/' + tree.next.node.id;
      card.title = titleOf(tree.next.node);
      card.appendChild(coverNode(tree.next.node, 'alx-franchise-cover'));

      const info = el('div', 'alx-franchise-nextinfo');
      info.appendChild(el('div', 'alx-franchise-nextlabel', 'Next unwatched'));
      info.appendChild(el('div', 'alx-franchise-nexttitle', titleOf(tree.next.node)));
      info.appendChild(el('div', 'alx-franchise-nextmeta', nextHint(tree.next)));
      card.appendChild(info);
      block.appendChild(card);
    } else if (tree.signedIn) {
      block.appendChild(el('div', 'alx-franchise-done', 'Everything in this franchise is watched.'));
    } else {
      block.appendChild(el('div', 'alx-franchise-done', 'Sign in to AniList to see your progress here.'));
    }

    const total = tree.main.length + tree.side.length;
    const parts: string[] = [plural(total, 'title', 'titles')];
    // Without a session there is no progress to report; a "0 of 59" would read
    // like the viewer had watched nothing rather than like they are signed out.
    if (tree.signedIn && tree.knownEpisodes > 0) {
      parts.push(tree.watchedEpisodes + ' of ' + tree.knownEpisodes + ' episodes watched');
    }
    block.appendChild(el('div', 'alx-franchise-foot', parts.join(' \u00b7 ')));
  };

  const start = async (): Promise<void> => {
    const overview = await waitFor('.media-page-unscoped .overview');
    if (!active || !overview) {
      return;
    }
    let tree: FranchiseTree;
    try {
      const viewer = await fetchViewer();
      if (!active) {
        return;
      }
      tree = await fetchFranchiseTree(rootId, viewer ? viewer.id : null);
    } catch (error) {
      return;
    }
    if (!active || tree.main.length + tree.side.length < 2) {
      // A standalone title is not a franchise; leave the page as it is.
      return;
    }

    render(tree);
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
    if (block && block.parentElement) {
      block.parentElement.removeChild(block);
    }
    block = null;
  };
}

/**
 * Full tracker on its own hash route (`#alx/franchise/<id>`): the main story in
 * release order with progress badges, the next unwatched episode, and every
 * side story or spin-off that hangs off it.
 */
export function mountFranchise(rootId: number): () => void {
  let active = true;
  let tree: FranchiseTree | null = null;
  let loading = true;
  let error: string | null = null;

  const previousFocus = document.activeElement as HTMLElement | null;
  const previousOverflow = document.body.style.overflow;

  const overlay = el('div', 'alx-fr-overlay');
  const sheet = el('div', 'alx-fr');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', 'Franchise tracker');

  const head = el('div', 'alx-fr-head');
  const headingWrap = el('div', 'alx-fr-heading');
  headingWrap.appendChild(el('h2', 'alx-fr-title', 'Franchise'));
  const subtitle = el('div', 'alx-fr-sub', 'Release order from AniList relations');
  headingWrap.appendChild(subtitle);
  head.appendChild(headingWrap);
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'alx-fr-close';
  closeButton.setAttribute('aria-label', 'Close franchise tracker');
  closeButton.textContent = '\u00d7';
  head.appendChild(closeButton);
  sheet.appendChild(head);

  const summary = el('div', 'alx-fr-summary');
  sheet.appendChild(summary);

  const body = el('div', 'alx-fr-body');
  sheet.appendChild(body);

  const statusLine = el('div', 'alx-fr-status');
  statusLine.setAttribute('role', 'status');
  statusLine.setAttribute('aria-live', 'polite');
  sheet.appendChild(statusLine);

  const footer = el('div', 'alx-fr-footer');
  footer.appendChild(
    el(
      'div',
      'alx-fr-note',
      'Order comes from PREQUEL/SEQUEL links, so it follows the story rather than air dates of spin-offs. Recap films are left out.'
    )
  );
  sheet.appendChild(footer);

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

  const rowNode = (
    node: FranchiseNode,
    order: number | null,
    isNext: boolean,
    side: FranchiseSideEntry | null,
    titles: Record<string, string>
  ): HTMLElement => {
    const row = el('div', 'alx-fr-row' + (isNext ? ' alx-fr-row-next' : ''));

    if (order !== null) {
      row.appendChild(el('span', 'alx-fr-order', String(order)));
    } else {
      row.appendChild(el('span', 'alx-fr-order alx-fr-order-side', '\u00b7'));
    }

    row.appendChild(coverNode(node, 'alx-fr-cover'));

    const info = el('div', 'alx-fr-info');
    const name = document.createElement('a');
    name.className = 'alx-fr-name';
    name.href = '/anime/' + node.id;
    name.textContent = titleOf(node);
    name.onclick = () => {
      // The site is a SPA; close the overlay so the title page is visible.
      close();
    };
    info.appendChild(name);

    const metaParts: string[] = [];
    const meta = nodeMeta(node);
    if (meta) {
      metaParts.push(meta);
    }
    if (side) {
      const anchorTitle = side.anchorId !== null ? titles[String(side.anchorId)] : '';
      const relation = relationLabel(side.relation);
      metaParts.push(anchorTitle ? relation + ' of ' + anchorTitle : relation);
    }
    info.appendChild(el('div', 'alx-fr-meta', metaParts.join(' \u00b7 ')));

    if (node.entry && node.episodes) {
      const bar = el('div', 'alx-fr-bar');
      const fill = el('span', 'alx-fr-bar-fill');
      fill.style.width = watchedPercent(node) + '%';
      bar.appendChild(fill);
      info.appendChild(bar);
    }
    if (isNext) {
      info.appendChild(el('div', 'alx-fr-nexthint', 'Next unwatched'));
    }
    row.appendChild(info);

    const badges = el('div', 'alx-fr-badges');
    const chip = statusChip(node);
    if (chip) {
      badges.appendChild(chip);
    }
    badges.appendChild(el('span', 'alx-fr-count', progressText(node)));
    row.appendChild(badges);

    return row;
  };

  const render = (): void => {
    body.textContent = '';
    statusLine.textContent = '';
    summary.textContent = '';

    if (loading) {
      statusLine.textContent = 'Walking the franchise relations\u2026';
      return;
    }
    if (error) {
      statusLine.textContent = error;
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'alx-btn alx-btn-small';
      retry.textContent = 'Retry';
      retry.onclick = () => {
        void load();
      };
      statusLine.appendChild(document.createElement('br'));
      statusLine.appendChild(retry);
      return;
    }
    if (!tree) {
      return;
    }

    const titles: Record<string, string> = {};
    for (let index = 0; index < tree.main.length; index += 1) {
      titles[String(tree.main[index].id)] = titleOf(tree.main[index]);
    }
    for (let index = 0; index < tree.side.length; index += 1) {
      titles[String(tree.side[index].node.id)] = titleOf(tree.side[index].node);
    }

    const rootNode = tree.main.filter((node) => node.id === rootId)[0];
    subtitle.textContent = rootNode
      ? titleOf(rootNode) + ' \u00b7 release order from AniList relations'
      : 'Release order from AniList relations';

    if (tree.signedIn && tree.next) {
      const next = tree.next.node;
      const card = document.createElement('a');
      card.className = 'alx-fr-nextcard';
      card.href = '/anime/' + next.id;
      card.appendChild(coverNode(next, 'alx-fr-nextcover'));
      const info = el('div', 'alx-fr-nextinfo');
      info.appendChild(el('span', 'alx-fr-nextlabel', tree.next.airsAt === null ? 'Next unwatched' : 'Caught up'));
      info.appendChild(el('span', 'alx-fr-nexttitle', titleOf(next)));
      info.appendChild(el('span', 'alx-fr-nextmeta', nextHint(tree.next)));
      card.appendChild(info);
      summary.appendChild(card);
    } else if (tree.signedIn) {
      summary.appendChild(el('div', 'alx-fr-done', 'Nothing left to watch: every entry here is completed or dropped.'));
    } else {
      summary.appendChild(el('div', 'alx-fr-done', 'Sign in to AniList to see your progress and what to watch next.'));
    }

    const stats = el('div', 'alx-fr-stats');
    const total = tree.main.length + tree.side.length;
    stats.textContent =
      plural(total, 'title', 'titles') +
      (tree.signedIn && tree.knownEpisodes > 0
        ? ' \u00b7 ' + tree.watchedEpisodes + ' of ' + tree.knownEpisodes + ' episodes watched'
        : '');
    if (tree.truncated) {
      stats.textContent += ' \u00b7 long franchise, only part of it is shown';
    }
    summary.appendChild(stats);

    const mainSection = el('div', 'alx-fr-section');
    const mainHead = el('div', 'alx-fr-section-head');
    const mainTitle = document.createElement('h3');
    mainTitle.className = 'alx-fr-section-title';
    mainTitle.textContent = 'Main story';
    mainHead.appendChild(mainTitle);
    mainHead.appendChild(el('span', 'alx-fr-section-count', String(tree.main.length)));
    mainSection.appendChild(mainHead);
    for (let index = 0; index < tree.main.length; index += 1) {
      const node = tree.main[index];
      const isNext = tree.next !== null && tree.next.node.id === node.id;
      mainSection.appendChild(rowNode(node, index + 1, isNext, null, titles));
    }
    body.appendChild(mainSection);

    if (tree.side.length > 0) {
      const sideSection = el('div', 'alx-fr-section');
      const sideHead = el('div', 'alx-fr-section-head');
      const sideTitle = document.createElement('h3');
      sideTitle.className = 'alx-fr-section-title';
      sideTitle.textContent = 'Side stories & spin-offs';
      sideHead.appendChild(sideTitle);
      sideHead.appendChild(el('span', 'alx-fr-section-count', String(tree.side.length)));
      sideSection.appendChild(sideHead);
      sideSection.appendChild(
        el('div', 'alx-fr-hint', 'Optional viewing that hangs off the main line; the order inside this list is optional too.')
      );
      for (let index = 0; index < tree.side.length; index += 1) {
        const side = tree.side[index];
        const isNext = tree.next !== null && tree.next.node.id === side.node.id;
        sideSection.appendChild(rowNode(side.node, null, isNext, side, titles));
      }
      body.appendChild(sideSection);
    }
  };

  const load = async (): Promise<void> => {
    loading = true;
    error = null;
    render();
    try {
      const viewer = await fetchViewer();
      if (!active) {
        return;
      }
      tree = await fetchFranchiseTree(rootId, viewer ? viewer.id : null);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Could not read this franchise';
    }
    if (!active) {
      return;
    }
    loading = false;
    render();
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
    const nodes = sheet.querySelectorAll<HTMLElement>('button, a[href]');
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

  closeButton.onclick = close;
  overlay.onclick = (event) => {
    if (event.target === overlay) {
      close();
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
