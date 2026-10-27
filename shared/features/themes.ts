import type { Theme, ThemeEntry, ThemesResult } from '../api/animethemes';
import { fetchThemes } from '../api/animethemes';
import type { AppContext } from '../core/context';
import { el, icon, linkEl, waitFor, PLAY_ICON } from '../core/dom';

interface ThemeView {
  theme: Theme;
  episodes: string;
  nsfw: boolean;
  spoiler: boolean;
  video: string | null;
}

function prepareTheme(theme: Theme): ThemeView {
  const episodeParts: string[] = [];
  let nsfw = false;
  let allSpoilers = theme.entries.length > 0;
  let video: string | null = null;

  for (let index = 0; index < theme.entries.length; index += 1) {
    const entry: ThemeEntry = theme.entries[index];
    if (entry.episodes && episodeParts.indexOf(entry.episodes) === -1) {
      episodeParts.push(entry.episodes);
    }
    if (entry.nsfw) {
      nsfw = true;
    }
    if (!entry.spoiler) {
      allSpoilers = false;
    }
    if (entry.videos.length > 0) {
      if (!video) {
        video = entry.videos[0];
      }
      if (!entry.spoiler && !entry.nsfw && entry.videos.length > 0) {
        video = entry.videos[0];
      }
    }
  }

  return {
    theme,
    episodes: episodeParts.join(', '),
    nsfw,
    spoiler: allSpoilers,
    video,
  };
}

export function mountThemes(ctx: AppContext, animeId: number): () => void {
  let active = true;
  let card: HTMLElement | null = null;
  let keepAlive = 0;

  /*
   * The themes live in the main column, right below the trailer, so long OP/ED
   * titles and the video player get the full content width instead of the
   * narrow sidebar. Vue can re-render the overview, so the card is re-attached
   * on an interval, always after the trailer section.
   */
  const ensureMounted = (): void => {
    if (!active || !card) {
      return;
    }
    const overview = document.querySelector('.media-page-unscoped .overview');
    if (!overview) {
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

  const renderError = (host: HTMLElement, message: string, retry: () => void): void => {
    host.textContent = '';
    const header = el('div', 'alx-themes-head');
    const heading = document.createElement('h2');
    heading.textContent = 'Openings & Endings';
    header.appendChild(heading);
    host.appendChild(header);
    host.appendChild(el('div', 'alx-themes-error', message));
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'alx-btn alx-btn-small';
    button.textContent = 'Retry';
    button.onclick = retry;
    host.appendChild(button);
  };

  const renderCard = (host: HTMLElement, result: ThemesResult): void => {
    host.textContent = '';

    const header = el('div', 'alx-themes-head');
    const heading = document.createElement('h2');
    heading.textContent = 'Openings & Endings';
    header.appendChild(heading);
    const source = linkEl(result.sourceUrl, 'alx-themes-source', 'AnimeThemes');
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    source.title = result.sourceTitle;
    header.appendChild(source);
    host.appendChild(header);

    const list = el('div', 'alx-theme-list');
    host.appendChild(list);

    const playerWrap = el('div', 'alx-theme-player');
    const video = document.createElement('video');
    video.controls = true;
    video.preload = 'none';
    video.setAttribute('playsinline', 'playsinline');
    playerWrap.appendChild(video);
    const openVideo = linkEl('', 'alx-theme-video-link', 'Open video');
    openVideo.target = '_blank';
    openVideo.rel = 'noopener noreferrer';
    playerWrap.appendChild(openVideo);
    host.appendChild(playerWrap);

    let currentRow: HTMLElement | null = null;
    let currentUrl = '';

    const play = (url: string, row: HTMLElement): void => {
      if (currentRow) {
        currentRow.classList.remove('alx-theme-active');
      }
      currentRow = row;
      row.classList.add('alx-theme-active');
      if (currentUrl !== url) {
        currentUrl = url;
        video.src = url;
        video.load();
      }
      openVideo.href = url;
      playerWrap.classList.add('alx-theme-player-visible');
      const promise = video.play();
      if (promise && typeof promise.catch === 'function') {
        promise.catch(() => {
          // Autoplay blockers are fine; the native controls stay available.
        });
      }
    };

    const views: ThemeView[] = [];
    for (let index = 0; index < result.themes.length; index += 1) {
      views.push(prepareTheme(result.themes[index]));
    }

    for (let index = 0; index < views.length; index += 1) {
      const view = views[index];
      const row = el('div', 'alx-theme');
      const hidden = view.nsfw || (view.spoiler && !ctx.settings.get().showSpoilers);

      const tag = el('span', 'alx-theme-tag ' + (view.theme.type === 'OP' ? 'alx-op' : 'alx-ed'));
      tag.textContent = view.theme.slug || view.theme.type;

      const info = el('div', 'alx-theme-info');
      const title = el('div', 'alx-theme-title');
      const meta = el('div', 'alx-theme-meta');

      row.appendChild(tag);
      row.appendChild(info);
      info.appendChild(title);
      info.appendChild(meta);

      const setContent = (): void => {
        title.textContent = view.theme.title;
        const metaParts: string[] = [];
        if (view.episodes) {
          metaParts.push('Ep. ' + view.episodes);
        }
        if (view.nsfw) {
          metaParts.push('NSFW');
        }
        meta.textContent = metaParts.join(' \u00b7 ');
      };

      const addPlayButton = (): void => {
        if (!view.video) {
          return;
        }
        const playButton = document.createElement('button');
        playButton.type = 'button';
        playButton.className = 'alx-theme-play';
        playButton.setAttribute('aria-label', 'Play ' + view.theme.slug);
        playButton.appendChild(icon(PLAY_ICON));
        playButton.onclick = (event) => {
          event.stopPropagation();
          play(view.video as string, row);
        };
        row.appendChild(playButton);
      };

      if (hidden) {
        row.classList.add('alx-theme-hidden');
        title.textContent = view.nsfw ? 'NSFW theme' : 'Spoiler theme';
        meta.textContent = 'Click to reveal';
        row.title = 'Click to reveal';
        const reveal = (): void => {
          row.classList.remove('alx-theme-hidden');
          row.title = '';
          setContent();
          addPlayButton();
        };
        row.onclick = reveal;
      } else {
        setContent();
        addPlayButton();
      }

      list.appendChild(row);
    }

    if (views.length === 0) {
      host.appendChild(el('div', 'alx-muted', 'No themes found on AnimeThemes.'));
    }
  };

  const start = async (): Promise<void> => {
    const overview = await waitFor('.media-page-unscoped .overview');
    if (!active || !overview) {
      return;
    }

    let result: ThemesResult | null = null;
    let error: string | null = null;
    try {
      result = await fetchThemes(ctx.platform, animeId);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Unknown AnimeThemes error';
    }
    if (!active) {
      return;
    }
    if (!result && !error) {
      return;
    }

    if (card && card.parentElement) {
      card.parentElement.removeChild(card);
    }
    card = el('div', 'alx-themes');
    if (error || !result) {
      renderError(card, error || 'AnimeThemes did not return themes for this title.', () => {
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
