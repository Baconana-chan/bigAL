import type { StudioKeyWork, TitleStudioCredit } from '../api/anilist';
import { fetchTitleStudios } from '../api/anilist';
import { el, waitFor } from '../core/dom';

function workTitle(work: StudioKeyWork): string {
  return work.title.romaji || work.title.english || work.title.native || 'Unknown title';
}

function renderWork(work: StudioKeyWork): HTMLElement {
  const link = document.createElement('a');
  link.className = 'alx-studios-work';
  link.href = '/anime/' + work.id;

  const cover = el('span', 'alx-studios-work-cover');
  const image = document.createElement('img');
  image.loading = 'lazy';
  image.alt = '';
  image.src = work.coverImage.large || '';
  cover.appendChild(image);
  if (work.averageScore !== null) {
    cover.appendChild(el('span', 'alx-studios-work-score', work.averageScore + '%'));
  }
  link.appendChild(cover);

  link.appendChild(el('span', 'alx-studios-work-title', workTitle(work)));

  const meta: string[] = [];
  if (work.year) {
    meta.push(String(work.year));
  }
  if (work.averageScore !== null) {
    meta.push(work.averageScore + '%');
  }
  link.title = workTitle(work) + (meta.length > 0 ? ' (' + meta.join(' \u00b7 ') + ')' : '');
  return link;
}

function renderCredit(credit: TitleStudioCredit): HTMLElement {
  const row = el('div', 'alx-studios-row');

  const head = el('div', 'alx-studios-row-head');
  const name = document.createElement('a');
  name.className = 'alx-studios-name';
  name.href = '/studio/' + credit.id;
  name.textContent = credit.name;
  name.title = 'Open the enhanced ' + credit.name + ' page';
  head.appendChild(name);

  const role = el(
    'span',
    'alx-studios-role alx-studios-role-' + (credit.isMain ? 'main' : 'supporting'),
    credit.isMain ? 'Main' : 'Supporting'
  );
  role.title = credit.isMain
    ? 'Main animation studio for this title'
    : 'Supporting studio credit for this title';
  head.appendChild(role);

  const more = document.createElement('a');
  more.className = 'alx-studios-more';
  more.href = name.href;
  more.textContent = 'All works';
  more.title = 'Every ' + credit.name + ' work, with filters';
  head.appendChild(more);

  row.appendChild(head);

  if (credit.works.length > 0) {
    const strip = el('div', 'alx-studios-works');
    for (let index = 0; index < credit.works.length; index += 1) {
      strip.appendChild(renderWork(credit.works[index]));
    }
    row.appendChild(strip);
  }

  return row;
}

function renderCard(host: HTMLElement, credits: TitleStudioCredit[]): void {
  host.textContent = '';

  const head = el('div', 'alx-studios-head');
  const heading = document.createElement('h2');
  heading.textContent = 'Studios';
  head.appendChild(heading);
  head.appendChild(el('span', 'alx-studios-note', 'Main credits and key works'));
  host.appendChild(head);

  for (let index = 0; index < credits.length; index += 1) {
    host.appendChild(renderCredit(credits[index]));
  }
}

function renderError(host: HTMLElement, message: string, retry: () => void): void {
  host.textContent = '';
  const head = el('div', 'alx-studios-head');
  const heading = document.createElement('h2');
  heading.textContent = 'Studios';
  head.appendChild(heading);
  host.appendChild(head);
  host.appendChild(el('div', 'alx-studios-error', message));
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'alx-btn alx-btn-small';
  button.textContent = 'Retry';
  button.onclick = retry;
  host.appendChild(button);
}

/**
 * Studio summary under the main column of an anime page. Each studio links to
 * our enhanced studio page and shows a short strip of its best-known works, so
 * a title page answers "who made this" without a second navigation.
 */
export function mountStudioSummary(animeId: number): () => void {
  let active = true;
  let card: HTMLElement | null = null;
  let keepAlive = 0;

  /*
   * Vue re-renders the overview, so the card is re-attached on an interval.
   * It sits after the OP/ED card when that block is enabled, otherwise right
   * after the trailer, and never above the recommendations.
   */
  const ensureMounted = (): void => {
    if (!active || !card) {
      return;
    }
    const overview = document.querySelector('.media-page-unscoped .overview');
    if (!overview) {
      return;
    }

    const themes = overview.querySelector('.alx-themes');
    if (themes && themes.parentElement === overview) {
      if (card.previousElementSibling !== themes) {
        overview.insertBefore(card, themes.nextSibling);
      }
      return;
    }

    const trailer = document.querySelector('.media-page-unscoped .trailer');
    const trailerSection = trailer ? trailer.closest('.grid-section-wrap') : null;
    if (trailerSection && trailerSection.parentElement === overview) {
      if (card.previousElementSibling !== trailerSection) {
        overview.insertBefore(card, trailerSection.nextSibling);
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

    let credits: TitleStudioCredit[] | null = null;
    let error: string | null = null;
    try {
      credits = await fetchTitleStudios(animeId);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Unknown AniList error';
    }
    if (!active) {
      return;
    }
    if (!error && (!credits || credits.length === 0)) {
      // No studio credits: leave the page exactly as AniList rendered it.
      return;
    }

    if (card && card.parentElement) {
      card.parentElement.removeChild(card);
    }
    card = el('div', 'alx-studios');
    if (error || !credits) {
      renderError(card, error || 'AniList did not return studio credits for this title.', () => {
        void start();
      });
    } else {
      renderCard(card, credits);
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
