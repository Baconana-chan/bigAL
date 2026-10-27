import { cached } from '../core/cache';
import type { Platform } from '../core/platform';

const ENDPOINT = 'https://graphql.animethemes.moe';
const TIMEOUT_MS = 15000;
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

export interface ThemeEntry {
  episodes: string | null;
  nsfw: boolean;
  spoiler: boolean;
  videos: string[];
}

export interface Theme {
  type: 'OP' | 'ED';
  sequence: number | null;
  slug: string;
  title: string;
  entries: ThemeEntry[];
}

export interface ThemesResult {
  sourceTitle: string;
  sourceUrl: string;
  slug: string;
  themes: Theme[];
}

class AnimeThemesError extends Error {}

interface AnimeThemesResponse {
  data?: { findAnimeByExternalSite: AnimeThemesAnime[] | null };
  errors?: Array<{ message: string }>;
}

interface AnimeThemesAnime {
  id: number;
  slug: string;
  siteUrl: string | null;
  title: { romaji: string | null };
  animethemes: Array<{
    type: 'OP' | 'ED';
    sequence: number | null;
    slug: string;
    song: { title: { romaji: string | null; native: string | null } } | null;
    animethemeentries: Array<{
      episodes: string | null;
      nsfw: boolean;
      spoiler: boolean;
      videos: { nodes: Array<{ link: string | null }> };
    }>;
  }>;
}

const QUERY = `
  query Themes($id: [Int!]) {
    findAnimeByExternalSite(site: ANILIST, id: $id) {
      id
      slug
      siteUrl
      title { romaji }
      animethemes {
        type
        sequence
        slug
        song {
          title { romaji native }
        }
        animethemeentries {
          episodes
          nsfw
          spoiler
          videos {
            nodes { link }
          }
        }
      }
    }
  }
`;

async function request(animeId: number): Promise<ThemesResult | null> {
  let timer = 0;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = window.setTimeout(() => reject(new AnimeThemesError('Request timed out')), TIMEOUT_MS);
  });

  try {
    const response = await Promise.race([
      fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ query: QUERY, variables: { id: [animeId] } }),
      }),
      timeout,
    ]);

    if (!response.ok) {
      throw new AnimeThemesError('AnimeThemes returned HTTP ' + response.status);
    }

    const payload = (await response.json()) as AnimeThemesResponse;
    if (payload.errors && payload.errors.length > 0) {
      throw new AnimeThemesError(payload.errors[0].message);
    }
    const matches = payload.data ? payload.data.findAnimeByExternalSite : null;
    if (!matches || matches.length === 0) {
      return null;
    }

    let best: AnimeThemesAnime | null = null;
    for (let index = 0; index < matches.length; index += 1) {
      const candidate = matches[index];
      if (candidate.animethemes && candidate.animethemes.length > 0) {
        best = candidate;
        break;
      }
    }
    if (!best) {
      return null;
    }

    const themes: Theme[] = [];
    for (let index = 0; index < best.animethemes.length; index += 1) {
      const source = best.animethemes[index];
      const entries: ThemeEntry[] = [];
      for (let entryIndex = 0; entryIndex < source.animethemeentries.length; entryIndex += 1) {
        const entry = source.animethemeentries[entryIndex];
        const videos: string[] = [];
        for (let videoIndex = 0; videoIndex < entry.videos.nodes.length; videoIndex += 1) {
          const link = entry.videos.nodes[videoIndex].link;
          if (link) {
            videos.push(link);
          }
        }
        entries.push({
          episodes: entry.episodes,
          nsfw: Boolean(entry.nsfw),
          spoiler: Boolean(entry.spoiler),
          videos,
        });
      }
      if (entries.length === 0) {
        continue;
      }
      const songTitle = source.song && source.song.title;
      const title = (songTitle && (songTitle.romaji || songTitle.native)) || source.slug;
      themes.push({
        type: source.type,
        sequence: source.sequence,
        slug: source.slug,
        title,
        entries,
      });
    }

    themes.sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === 'OP' ? -1 : 1;
      }
      const leftNumber = left.sequence === null ? parseInt(left.slug.replace(/[^0-9]/g, ''), 10) || 0 : left.sequence;
      const rightNumber =
        right.sequence === null ? parseInt(right.slug.replace(/[^0-9]/g, ''), 10) || 0 : right.sequence;
      if (leftNumber !== rightNumber) {
        return leftNumber - rightNumber;
      }
      return left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0;
    });

    return {
      sourceTitle: best.title.romaji || best.slug,
      sourceUrl: best.siteUrl || 'https://animethemes.moe/anime/' + best.slug,
      slug: best.slug,
      themes,
    };
  } finally {
    window.clearTimeout(timer);
  }
}

export function fetchThemes(platform: Platform, animeId: number): Promise<ThemesResult | null> {
  return cached<ThemesResult | null>(platform, 'alx:themes:' + animeId, CACHE_TTL, () => request(animeId));
}
