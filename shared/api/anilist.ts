import { cached, dedupe, memoryCached, memoryDeletePrefix, memoryDeleteWhere, memoryGet, memorySet } from '../core/cache';
import type { AccentName } from '../core/palette';
import { isAccentName } from '../core/palette';
import type { Platform } from '../core/platform';

const ENDPOINT = 'https://graphql.anilist.co';
const TIMEOUT_MS = 15000;

export type MediaSort = 'START_DATE_DESC' | 'START_DATE' | 'SCORE_DESC' | 'POPULARITY_DESC' | 'TITLE_ROMAJI';

export interface MediaTitle {
  romaji: string | null;
  english: string | null;
  native: string | null;
}

export interface CoverImage {
  large: string | null;
  extraLarge: string | null;
  color: string | null;
}

export type StudioRole = 'main' | 'supporting';

export interface StudioMediaNode {
  id: number;
  title: MediaTitle;
  coverImage: CoverImage;
  format: string | null;
  status: string | null;
  seasonYear: number | null;
  startDate: { year: number | null } | null;
  episodes: number | null;
  averageScore: number | null;
  popularity: number | null;
  isAdult: boolean | null;
  studioRole: StudioRole;
}

interface StudioEdge {
  isMain: boolean;
  node: { id: number };
}

export interface StudioPageInfo {
  currentPage: number;
  hasNextPage: boolean;
  total: number;
}

export interface StudioDetails {
  id: number;
  name: string;
  isAnimationStudio: boolean;
  favourites: number;
  siteUrl: string;
  media: {
    pageInfo: StudioPageInfo;
    nodes: StudioMediaNode[];
  };
}

interface GraphQlError {
  message: string;
}

interface GraphQlResponse<T> {
  data?: T;
  errors?: GraphQlError[];
}

export class ApiError extends Error {}

async function request<T>(
  query: string,
  variables: Record<string, unknown>,
  toleratePartialErrors = false
): Promise<T> {
  let timer = 0;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = window.setTimeout(() => reject(new ApiError('Request timed out')), TIMEOUT_MS);
  });

  try {
    const response = await Promise.race([
      fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ query, variables }),
      }),
      timeout,
    ]);

    if (!response.ok) {
      let payload: GraphQlResponse<T> | null = null;
      let detail = '';
      try {
        payload = (await response.json()) as GraphQlResponse<T>;
        if (payload.errors && payload.errors.length > 0) {
          detail = payload.errors[0].message;
        }
      } catch (error) {
        detail = '';
      }
      // An unknown username makes AniList answer 500 while still returning a
      // body; batched callers read whatever fields survived.
      if (toleratePartialErrors && payload && payload.data) {
        return payload.data;
      }
      throw new ApiError('AniList returned HTTP ' + response.status + (detail ? ': ' + detail : ''));
    }

    const payload = (await response.json()) as GraphQlResponse<T>;
    if (payload.errors && payload.errors.length > 0) {
      // Batched queries (one alias per friend) fail field by field: a private
      // or missing user must not take the whole comparison down with it.
      if (!toleratePartialErrors || !payload.data) {
        throw new ApiError(payload.errors[0].message);
      }
    }
    if (!payload.data) {
      throw new ApiError('AniList returned an empty response');
    }
    return payload.data;
  } finally {
    window.clearTimeout(timer);
  }
}

const STUDIO_QUERY = `
  query StudioWorks($id: Int!, $page: Int!, $sort: [MediaSort]) {
    Studio(id: $id) {
      id
      name
      isAnimationStudio
      favourites
      siteUrl
      media(page: $page, perPage: 50, sort: $sort) {
        pageInfo {
          currentPage
          hasNextPage
          total
        }
        nodes {
          id
          title { romaji english native }
          coverImage { large extraLarge color }
          format
          status
          seasonYear
          startDate { year }
          episodes
          averageScore
          popularity
          isAdult
          studios {
            edges {
              isMain
              node { id }
            }
          }
        }
      }
    }
  }
`;

type StudioMediaRaw = Omit<StudioMediaNode, 'studioRole'> & {
  studios: { edges: StudioEdge[] } | null;
};

interface StudioRaw extends Omit<StudioDetails, 'media'> {
  media: {
    pageInfo: StudioPageInfo;
    nodes: StudioMediaRaw[];
  };
}

interface StudioQueryData {
  Studio: StudioRaw | null;
}

function studioRoleOf(edges: StudioEdge[] | undefined, studioId: number): StudioRole {
  if (!edges) {
    return 'supporting';
  }
  for (let index = 0; index < edges.length; index += 1) {
    if (edges[index].node.id === studioId && edges[index].isMain) {
      return 'main';
    }
  }
  return 'supporting';
}

export async function fetchStudioPage(
  studioId: number,
  page: number,
  sort: MediaSort
): Promise<StudioDetails> {
  const data = await request<StudioQueryData>(STUDIO_QUERY, {
    id: studioId,
    page,
    sort: [sort],
  });
  if (!data.Studio) {
    throw new ApiError('Studio ' + studioId + ' was not found');
  }
  const media = data.Studio.media;
  const nodes: StudioMediaNode[] = [];
  for (let index = 0; index < media.nodes.length; index += 1) {
    const node = media.nodes[index];
    const role = studioRoleOf(node.studios ? node.studios.edges : undefined, studioId);
    nodes.push({
      id: node.id,
      title: node.title,
      coverImage: node.coverImage,
      format: node.format,
      status: node.status,
      seasonYear: node.seasonYear,
      startDate: node.startDate,
      episodes: node.episodes,
      averageScore: node.averageScore,
      popularity: node.popularity,
      isAdult: node.isAdult,
      studioRole: role,
    });
  }
  return {
    id: data.Studio.id,
    name: data.Studio.name,
    isAnimationStudio: data.Studio.isAnimationStudio,
    favourites: data.Studio.favourites,
    siteUrl: data.Studio.siteUrl,
    media: { pageInfo: media.pageInfo, nodes: nodes },
  };
}

/*
 * Studio credits for the title page. The site only lists studio names in the
 * sidebar; this pair of queries adds the role (main vs supporting) and the
 * studio's best-known works, so the summary can link into our studio page
 * without fetching a whole filmography per title.
 */

export interface StudioKeyWork {
  id: number;
  title: MediaTitle;
  coverImage: CoverImage;
  format: string | null;
  averageScore: number | null;
  year: number | null;
}

export interface TitleStudioCredit {
  id: number;
  name: string;
  isMain: boolean;
  works: StudioKeyWork[];
}

const TITLE_STUDIOS_QUERY = `
  query TitleStudios($id: Int!) {
    Media(id: $id) {
      id
      studios {
        edges {
          isMain
          node { id name }
        }
      }
    }
  }
`;

const STUDIO_KEY_WORKS_QUERY = `
  query StudioKeyWorks($id: Int!) {
    Studio(id: $id) {
      media(page: 1, perPage: 15, sort: [POPULARITY_DESC]) {
        nodes {
          id
          title { romaji english native }
          coverImage { large color }
          format
          averageScore
          startDate { year }
          isAdult
          studios {
            edges {
              isMain
              node { id }
            }
          }
        }
      }
    }
  }
`;

interface TitleStudiosData {
  Media: {
    studios: {
      edges: Array<{ isMain: boolean; node: { id: number; name: string } | null }> | null;
    } | null;
  } | null;
}

interface StudioKeyWorksRaw {
  id: number;
  title: MediaTitle;
  coverImage: CoverImage;
  format: string | null;
  averageScore: number | null;
  startDate: { year: number | null } | null;
  isAdult: boolean | null;
  studios: { edges: StudioEdge[] } | null;
}

interface StudioKeyWorksData {
  Studio: { media: { nodes: StudioKeyWorksRaw[] | null } | null } | null;
}

/** Studios shown per title page; a co-production rarely has more worth listing. */
const MAX_TITLE_STUDIOS = 4;
const MAX_KEY_WORKS = 5;
const TITLE_STUDIOS_TTL = 10 * 60 * 1000;
const STUDIO_WORKS_TTL = 10 * 60 * 1000;
const TITLE_STUDIOS_PREFIX = 'alx:title-studios:';
const STUDIO_WORKS_PREFIX = 'alx:studio-works:';

async function loadStudioKeyWorks(studioId: number): Promise<StudioKeyWork[]> {
  const data = await request<StudioKeyWorksData>(STUDIO_KEY_WORKS_QUERY, { id: studioId });
  if (!data.Studio || !data.Studio.media || !data.Studio.media.nodes) {
    return [];
  }
  const nodes = data.Studio.media.nodes;
  const works: StudioKeyWork[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    // Only the studio's own works: popularity sorting also surfaces titles it
    // helped with, and adult covers do not belong on a general title page.
    if (node.isAdult) {
      continue;
    }
    if (studioRoleOf(node.studios ? node.studios.edges : undefined, studioId) !== 'main') {
      continue;
    }
    works.push({
      id: node.id,
      title: node.title,
      coverImage: node.coverImage,
      format: node.format,
      averageScore: node.averageScore,
      year: node.startDate ? node.startDate.year : null,
    });
  }
  return works;
}

function studioKeyWorks(studioId: number): Promise<StudioKeyWork[]> {
  return memoryCached(STUDIO_WORKS_PREFIX + studioId, STUDIO_WORKS_TTL, () => loadStudioKeyWorks(studioId));
}

/**
 * Animation studios for a title, main studio first, each with a handful of its
 * most popular works (the title itself excluded). Cached per title for ten
 * minutes: studio credits rarely change.
 */
export async function fetchTitleStudios(mediaId: number): Promise<TitleStudioCredit[]> {
  return memoryCached(TITLE_STUDIOS_PREFIX + mediaId, TITLE_STUDIOS_TTL, async () => {
    const data = await request<TitleStudiosData>(TITLE_STUDIOS_QUERY, { id: mediaId });
    const edges = data.Media && data.Media.studios ? data.Media.studios.edges : null;
    if (!edges) {
      return [];
    }

    const main: TitleStudioCredit[] = [];
    const supporting: TitleStudioCredit[] = [];
    const seen: Record<string, boolean> = {};
    for (let index = 0; index < edges.length; index += 1) {
      const node = edges[index].node;
      if (!node || seen[String(node.id)]) {
        continue;
      }
      seen[String(node.id)] = true;
      const credit: TitleStudioCredit = {
        id: node.id,
        name: node.name,
        isMain: edges[index].isMain,
        works: [],
      };
      if (credit.isMain) {
        main.push(credit);
      } else {
        supporting.push(credit);
      }
    }

    const ordered: TitleStudioCredit[] = [];
    for (let index = 0; index < main.length; index += 1) {
      ordered.push(main[index]);
    }
    for (let index = 0; index < supporting.length; index += 1) {
      ordered.push(supporting[index]);
    }
    const limited = ordered.slice(0, MAX_TITLE_STUDIOS);
    if (limited.length === 0) {
      return limited;
    }

    const lists = await Promise.all(
      limited.map((credit) =>
        studioKeyWorks(credit.id).catch((): StudioKeyWork[] => {
          // A studio without key works still gets its row and link.
          return [];
        })
      )
    );
    const result: TitleStudioCredit[] = [];
    for (let index = 0; index < limited.length; index += 1) {
      const works = lists[index];
      const picked: StudioKeyWork[] = [];
      for (let workIndex = 0; workIndex < works.length && picked.length < MAX_KEY_WORKS; workIndex += 1) {
        if (works[workIndex].id !== mediaId) {
          picked.push(works[workIndex]);
        }
      }
      limited[index].works = picked;
      // Licensors and TV stations are credited as studios but own no works;
      // AniList's sidebar already lists them, so only main studios get a row.
      if (limited[index].isMain || picked.length > 0) {
        result.push(limited[index]);
      }
    }
    return result;
  });
}

/*
 * Progress comparison with friends. AniList returns one media-list entry per
 * query, so every friend gets an alias inside a single batched request: one
 * round trip per title whether the list holds one friend or six. Other users'
 * public lists need no session; a private or renamed account only nulls its own
 * alias, which is why this request tolerates per-field errors.
 */

export interface FriendProgressRow {
  name: string;
  userId: number | null;
  avatar: string | null;
  isViewer: boolean;
  hasEntry: boolean;
  /** The profile could not be read at all: private list or a wrong username. */
  unavailable: boolean;
  status: MediaListStatus | null;
  progress: number;
  updatedAt: number | null;
}

export interface FriendProgress {
  episodes: number | null;
  rows: FriendProgressRow[];
  signedIn: boolean;
}

interface FriendEntryRaw {
  progress: number | null;
  status: MediaListStatus | null;
  updatedAt: number | null;
  user: { id: number; name: string; avatar: { medium: string | null } | null } | null;
}

const FRIENDS_TTL = 2 * 60 * 1000;
const FRIENDS_PREFIX = 'alx:friends:';

export function friendProgressQuery(mediaId: number, names: string[]): string {
  let query =
    'query FriendProgress {\n' +
    '  title: Media(id: ' + mediaId + ') { episodes }\n';
  for (let index = 0; index < names.length; index += 1) {
    query =
      query +
      '  f' +
      index +
      ': Page {\n    mediaList(mediaId: ' +
      mediaId +
      ', userName: ' +
      JSON.stringify(names[index]) +
      ', type: ANIME) {\n      progress\n      status\n      updatedAt\n      user { id name avatar { medium } }\n    }\n  }\n';
  }
  return query + '}\n';
}

interface FriendPageRaw {
  mediaList: FriendEntryRaw[] | null;
}

interface FriendEntries {
  episodes: number | null;
  pages: Array<FriendPageRaw | null>;
  failed: boolean;
}

function readEpisodes(data: Record<string, unknown>): number | null {
  const title = data.title as { episodes: number | null } | null | undefined;
  return title && typeof title.episodes === 'number' ? title.episodes : null;
}

/**
 * Runs the batched query. An empty `pages` array means the batch could not be
 * read at all, which happens when any username is unknown: AniList then nulls
 * every alias and answers 500, so the caller retries name by name.
 */
async function fetchFriendEntries(mediaId: number, names: string[]): Promise<FriendEntries> {
  try {
    const data = await request<Record<string, unknown>>(friendProgressQuery(mediaId, names), {}, true);
    const pages: Array<FriendPageRaw | null> = [];
    let readable = false;
    for (let index = 0; index < names.length; index += 1) {
      const page = data['f' + index] as FriendPageRaw | null | undefined;
      pages.push(page ? page : null);
      if (page) {
        readable = true;
      }
    }
    if (!readable) {
      return { episodes: null, pages: [], failed: true };
    }
    return { episodes: readEpisodes(data), pages: pages, failed: false };
  } catch (error) {
    return { episodes: null, pages: [], failed: true };
  }
}

async function loadFriendProgress(
  mediaId: number,
  names: string[],
  viewerName: string | null
): Promise<FriendProgress> {
  let result = await fetchFriendEntries(mediaId, names);
  let failedRows: boolean[] = [];
  for (let index = 0; index < names.length; index += 1) {
    failedRows.push(false);
  }

  if (result.failed) {
    if (names.length === 1) {
      throw new ApiError('AniList did not return progress for ' + names[0]);
    }
    // One bad name must not hide the other friends, so each gets its own request.
    const singles = await Promise.all(names.map((name) => fetchFriendEntries(mediaId, [name])));
    const pages: Array<FriendPageRaw | null> = [];
    let episodes: number | null = null;
    let readable = 0;
    for (let index = 0; index < singles.length; index += 1) {
      pages.push(singles[index].pages.length > 0 ? singles[index].pages[0] : null);
      if (singles[index].episodes !== null && episodes === null) {
        episodes = singles[index].episodes;
      }
      if (!singles[index].failed) {
        readable += 1;
      } else {
        failedRows[index] = true;
      }
    }
    if (readable === 0) {
      throw new ApiError('AniList did not return friend progress');
    }
    result = { episodes: episodes, pages: pages, failed: false };
  }

  const viewerKey = viewerName ? viewerName.toLowerCase() : '';

  const rows: FriendProgressRow[] = [];
  for (let index = 0; index < names.length; index += 1) {
    const page = result.pages[index];
    const entry = page && page.mediaList && page.mediaList.length > 0 ? page.mediaList[0] : null;
    const typed = names[index];
    rows.push({
      name: entry && entry.user && entry.user.name ? entry.user.name : typed,
      userId: entry && entry.user ? entry.user.id : null,
      avatar: entry && entry.user && entry.user.avatar ? entry.user.avatar.medium : null,
      isViewer: viewerKey !== '' && typed.toLowerCase() === viewerKey,
      hasEntry: entry !== null,
      unavailable: failedRows[index],
      status: entry ? entry.status : null,
      progress: entry && typeof entry.progress === 'number' ? entry.progress : 0,
      updatedAt: entry && typeof entry.updatedAt === 'number' ? entry.updatedAt * 1000 : null,
    });
  }

  rows.sort((left, right) => {
    if (left.isViewer !== right.isViewer) {
      return left.isViewer ? -1 : 1;
    }
    if (left.hasEntry !== right.hasEntry) {
      return left.hasEntry ? -1 : 1;
    }
    if (left.progress !== right.progress) {
      return right.progress - left.progress;
    }
    return left.name.toLowerCase() < right.name.toLowerCase() ? -1 : 1;
  });

  return {
    episodes: result.episodes,
    rows: rows,
    signedIn: viewerName !== null,
  };
}

/**
 * Episode progress for the viewer and the configured friends on one title.
 * The viewer is always part of the comparison when signed in, even if nobody
 * added their own name. Cached for two minutes per title and friend set.
 */
export function fetchFriendProgress(
  mediaId: number,
  friendNames: string[],
  viewerName: string | null
): Promise<FriendProgress> {
  const names: string[] = [];
  const seen: Record<string, boolean> = {};
  const add = (name: string): void => {
    const key = name.toLowerCase();
    if (name === '' || seen[key]) {
      return;
    }
    seen[key] = true;
    names.push(name);
  };
  if (viewerName) {
    add(viewerName);
  }
  for (let index = 0; index < friendNames.length; index += 1) {
    add(friendNames[index]);
  }
  if (names.length === 0) {
    return Promise.resolve({ episodes: null, rows: [], signedIn: false });
  }

  const keys = names.map((name) => name.toLowerCase()).sort();
  const key =
    FRIENDS_PREFIX + mediaId + ':' + (viewerName ? viewerName.toLowerCase() : '') + ':' + keys.join(',');
  return memoryCached(key, FRIENDS_TTL, () => loadFriendProgress(mediaId, names, viewerName));
}

const PROFILE_QUERY = `
  query ProfileColor($name: String) {
    User(name: $name) {
      id
      name
      options {
        profileColor
      }
    }
  }
`;

interface ProfileQueryData {
  User: {
    id: number;
    name: string;
    options: { profileColor: string | null };
  } | null;
}

const PROFILE_TTL = 24 * 60 * 60 * 1000;

export async function fetchProfileColor(platform: Platform, username: string): Promise<AccentName | null> {
  const key = 'alx:profile-color:' + username.toLowerCase();
  return cached<AccentName | null>(platform, key, PROFILE_TTL, async () => {
    const data = await request<ProfileQueryData>(PROFILE_QUERY, { name: username });
    if (!data.User || !data.User.options) {
      return null;
    }
    const color = data.User.options.profileColor;
    return isAccentName(color) ? color : null;
  });
}

/*
 * The public GraphQL endpoint only accepts OAuth tokens, but the site itself is
 * authenticated with cookies and a CSRF token rendered into every page as
 * `window.al_token`. Reading that token requires page context, which content
 * scripts do not get, so we refetch an HTML page with credentials and take the
 * token from the markup. Same-origin requests then act as the signed-in user.
 */

export type MediaListStatus = 'CURRENT' | 'PLANNING' | 'COMPLETED' | 'DROPPED' | 'PAUSED' | 'REPEATING';
export type ScoreFormat = 'POINT_100' | 'POINT_10_DECIMAL' | 'POINT_10' | 'POINT_5' | 'POINT_3';

export interface ViewerInfo {
  id: number;
  name: string;
  scoreFormat: ScoreFormat;
}

export interface ListEntryInfo {
  id: number;
  status: MediaListStatus;
  score: number;
  progress: number;
}

export interface MediaQuickState {
  id: number;
  trailer: { id: string; site: string } | null;
  nextAiringEpisode: { episode: number; airsAt: number } | null;
  entry: ListEntryInfo | null;
}

export interface ListEntryPatch {
  status?: MediaListStatus;
  scoreRaw?: number;
  progress?: number;
}

const SCORE_FORMATS: ScoreFormat[] = ['POINT_100', 'POINT_10_DECIMAL', 'POINT_10', 'POINT_5', 'POINT_3'];

function isScoreFormat(value: string | null | undefined): value is ScoreFormat {
  if (!value) {
    return false;
  }
  for (let index = 0; index < SCORE_FORMATS.length; index += 1) {
    if (SCORE_FORMATS[index] === value) {
      return true;
    }
  }
  return false;
}

export function scoreScale(format: ScoreFormat): { max: number; step: number } {
  switch (format) {
    case 'POINT_10_DECIMAL':
      return { max: 10, step: 0.1 };
    case 'POINT_10':
      return { max: 10, step: 1 };
    case 'POINT_5':
      return { max: 5, step: 1 };
    case 'POINT_3':
      return { max: 3, step: 1 };
    default:
      return { max: 100, step: 1 };
  }
}

/** Converts a score in the viewer's scale to the raw 0-100 value AniList stores. */
export function scoreToRaw(value: number, format: ScoreFormat): number {
  const scale = scoreScale(format);
  if (!isFinite(value) || value <= 0) {
    return 0;
  }
  const clamped = Math.min(value, scale.max);
  return Math.round((clamped / scale.max) * 100);
}

let csrfToken: string | null = null;
let csrfInFlight: Promise<string> | null = null;

async function readCsrfToken(): Promise<string> {
  if (csrfToken) {
    return csrfToken;
  }
  if (!csrfInFlight) {
    csrfInFlight = (async () => {
      const response = await fetch('/home', {
        credentials: 'include',
        headers: { Accept: 'text/html' },
      });
      const html = await response.text();
      const match = /window\.al_token = "([^"]+)";/.exec(html);
      if (!match) {
        throw new ApiError('Could not read the AniList session token');
      }
      csrfToken = match[1];
      return csrfToken;
    })();
  }
  try {
    return await csrfInFlight;
  } finally {
    csrfInFlight = null;
  }
}

async function siteFetch(body: string, token: string): Promise<Response> {
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  let timer = 0;
  if (controller) {
    timer = window.setTimeout(() => {
      if (controller) {
        controller.abort();
      }
    }, TIMEOUT_MS);
  }
  try {
    return await fetch('/graphql', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-csrf-token': token,
      },
      body: body,
      signal: controller ? controller.signal : undefined,
    });
  } finally {
    if (timer) {
      window.clearTimeout(timer);
    }
  }
}

async function siteRequest<T>(
  query: string,
  variables: Record<string, unknown>,
  toleratePartialErrors = false
): Promise<T> {
  let token = await readCsrfToken();
  let response = await siteFetch(JSON.stringify({ query, variables }), token);
  if (response.status === 403) {
    // The token is bound to the session and can go stale after signing in or out.
    csrfToken = null;
    token = await readCsrfToken();
    response = await siteFetch(JSON.stringify({ query, variables }), token);
  }
  if (!response.ok) {
    let payload: GraphQlResponse<T> | null = null;
    try {
      payload = (await response.json()) as GraphQlResponse<T>;
    } catch (error) {
      payload = null;
    }
    if (toleratePartialErrors && payload && payload.data) {
      return payload.data;
    }
    throw new ApiError('AniList returned HTTP ' + response.status);
  }
  const payload = (await response.json()) as GraphQlResponse<T>;
  if (payload.errors && payload.errors.length > 0) {
    if (!toleratePartialErrors || !payload.data) {
      throw new ApiError(payload.errors[0].message);
    }
  }
  if (!payload.data) {
    throw new ApiError('AniList returned an empty response');
  }
  return payload.data;
}

const VIEWER_QUERY = `
  query ViewerInfo {
    Viewer {
      id
      name
      mediaListOptions {
        scoreFormat
      }
    }
  }
`;

let viewerCache: ViewerInfo | null | undefined;
let viewerCacheAt = 0;
let viewerInFlight: Promise<ViewerInfo | null> | null = null;
const VIEWER_GUEST_TTL = 60 * 1000;

export async function fetchViewer(): Promise<ViewerInfo | null> {
  if (viewerCache !== undefined) {
    // A signed-in viewer is stable for the session; a guest may sign in later.
    if (viewerCache !== null || Date.now() - viewerCacheAt < VIEWER_GUEST_TTL) {
      return viewerCache;
    }
  }
  if (!viewerInFlight) {
    viewerInFlight = (async () => {
      try {
        const data = await siteRequest<{
          Viewer: { id: number; name: string; mediaListOptions: { scoreFormat: string | null } | null } | null;
        }>(VIEWER_QUERY, {});
        if (!data.Viewer) {
          viewerCache = null;
          return null;
        }
        const format = data.Viewer.mediaListOptions ? data.Viewer.mediaListOptions.scoreFormat : null;
        viewerCache = {
          id: data.Viewer.id,
          name: data.Viewer.name,
          scoreFormat: isScoreFormat(format) ? format : 'POINT_100',
        };
      } catch (error) {
        viewerCache = null;
      }
      viewerCacheAt = Date.now();
      return viewerCache;
    })();
  }
  try {
    return await viewerInFlight;
  } finally {
    viewerInFlight = null;
  }
}

const QUICK_QUERY = `
  query QuickStates($ids: [Int]) {
    Page(perPage: 50) {
      media(id_in: $ids, type: ANIME) {
        id
        trailer { id site }
        nextAiringEpisode { episode timeUntilAiring }
        mediaListEntry { id status score progress }
      }
    }
  }
`;

const QUICK_PUBLIC_QUERY = `
  query QuickStatesPublic($ids: [Int]) {
    Page(perPage: 50) {
      media(id_in: $ids, type: ANIME) {
        id
        trailer { id site }
        nextAiringEpisode { episode timeUntilAiring }
      }
    }
  }
`;

interface QuickMediaRaw {
  id: number;
  trailer: { id: string | null; site: string | null } | null;
  nextAiringEpisode: { episode: number; timeUntilAiring: number } | null;
  mediaListEntry?: ListEntryInfo | null;
}

interface QuickQueryData {
  Page: { media: QuickMediaRaw[] } | null;
}

function toQuickState(node: QuickMediaRaw): MediaQuickState {
  const trailer = node.trailer && node.trailer.id && node.trailer.site
    ? { id: node.trailer.id, site: node.trailer.site }
    : null;
  const airing = node.nextAiringEpisode
    ? {
        episode: node.nextAiringEpisode.episode,
        airsAt: Date.now() + node.nextAiringEpisode.timeUntilAiring * 1000,
      }
    : null;
  return {
    id: node.id,
    trailer: trailer,
    nextAiringEpisode: airing,
    entry: node.mediaListEntry ? node.mediaListEntry : null,
  };
}

const QUICK_TTL = 60 * 1000;
const QUICK_CACHE_PREFIX = 'alx:quick:';
const QUICK_REQUEST_PREFIX = 'alx:quick-request:';

function quickCacheKey(mediaId: number, viewer: ViewerInfo | null): string {
  return QUICK_CACHE_PREFIX + (viewer ? 'u' + viewer.id : 'guest') + ':' + mediaId;
}

async function loadQuickStates(chunk: number[], viewer: ViewerInfo | null): Promise<MediaQuickState[]> {
  let data: QuickQueryData;
  if (viewer) {
    try {
      data = await siteRequest<QuickQueryData>(QUICK_QUERY, { ids: chunk });
    } catch (error) {
      data = await request<QuickQueryData>(QUICK_PUBLIC_QUERY, { ids: chunk });
    }
  } else {
    data = await request<QuickQueryData>(QUICK_PUBLIC_QUERY, { ids: chunk });
  }
  if (!data.Page) {
    return [];
  }
  const states: MediaQuickState[] = [];
  for (let index = 0; index < data.Page.media.length; index += 1) {
    states.push(toQuickState(data.Page.media[index]));
  }
  return states;
}

/**
 * Trailer, airing and list-entry info per title. Results are cached per media
 * for a minute, so a grid does not refetch covers that were already hydrated
 * when the user navigates back. Concurrent callers asking for the same chunk
 * share one request.
 */
export async function fetchQuickStates(ids: number[], viewer: ViewerInfo | null): Promise<MediaQuickState[]> {
  const result: MediaQuickState[] = [];
  const missing: number[] = [];
  for (let index = 0; index < ids.length; index += 1) {
    const hit = memoryGet<MediaQuickState>(quickCacheKey(ids[index], viewer));
    if (hit) {
      result.push(hit);
    } else {
      missing.push(ids[index]);
    }
  }
  for (let start = 0; start < missing.length; start += 50) {
    const chunk = missing.slice(start, start + 50);
    const requestKey =
      QUICK_REQUEST_PREFIX + (viewer ? 'u' + viewer.id : 'guest') + ':' + chunk.slice().sort().join(',');
    const states = await dedupe(requestKey, () => loadQuickStates(chunk, viewer));
    for (let index = 0; index < states.length; index += 1) {
      const state = states[index];
      memorySet(quickCacheKey(state.id, viewer), state, QUICK_TTL);
      result.push(state);
    }
  }
  return result;
}

const SAVE_ENTRY_MUTATION = `
  mutation SaveEntry($id: Int, $mediaId: Int, $status: MediaListStatus, $scoreRaw: Int, $progress: Int) {
    SaveMediaListEntry(id: $id, mediaId: $mediaId, status: $status, scoreRaw: $scoreRaw, progress: $progress) {
      id
      status
      score
      progress
    }
  }
`;

export async function saveListEntry(
  mediaId: number,
  entryId: number | null,
  patch: ListEntryPatch
): Promise<ListEntryInfo> {
  const variables: Record<string, unknown> = {};
  if (entryId !== null) {
    variables.id = entryId;
  } else {
    variables.mediaId = mediaId;
  }
  if (patch.status !== undefined) {
    variables.status = patch.status;
  }
  if (patch.scoreRaw !== undefined) {
    variables.scoreRaw = patch.scoreRaw;
  }
  if (patch.progress !== undefined) {
    variables.progress = patch.progress;
  }
  const data = await siteRequest<{ SaveMediaListEntry: ListEntryInfo }>(SAVE_ENTRY_MUTATION, variables);
  invalidateQuickMedia(mediaId);
  invalidatePlanning();
  return data.SaveMediaListEntry;
}

const DELETE_ENTRY_MUTATION = `
  mutation RemoveEntry($id: Int) {
    DeleteMediaListEntry(id: $id) {
      deleted
    }
  }
`;

export async function deleteListEntry(entryId: number): Promise<void> {
  await siteRequest<{ DeleteMediaListEntry: { deleted: boolean | null } }>(DELETE_ENTRY_MUTATION, { id: entryId });
  memoryDeletePrefix(QUICK_CACHE_PREFIX);
  invalidatePlanning();
}

/*
 * MediaListCollection returns the whole planning list in one response, unlike
 * the 50-per-page mediaList connection. That matters for large libraries: with
 * pagination the newest entries (the premieres worth showing) sit past the cap.
 */
const PLANNED_QUERY = `
  query PlannedUpcoming($userId: Int) {
    MediaListCollection(userId: $userId, type: ANIME, status: PLANNING) {
      lists {
        entries {
          media {
            id
            title { romaji english native }
            coverImage { large extraLarge }
            nextAiringEpisode { episode airingAt }
          }
        }
      }
    }
  }
`;

export interface PlannedUpcoming {
  id: number;
  title: MediaTitle;
  coverImage: CoverImage;
  airsAt: number;
}

interface PlannedMedia {
  id: number;
  title: MediaTitle;
  coverImage: CoverImage;
  nextAiringEpisode: { episode: number; airingAt: number } | null;
}

interface PlannedQueryData {
  MediaListCollection: {
    lists: Array<{ entries: Array<{ media: PlannedMedia | null }> }> | null;
  } | null;
}

const PLANNED_TTL = 2 * 60 * 1000;
const PLANNED_CACHE_PREFIX = 'alx:planned:';

/**
 * Planning-list anime whose first episode has not aired yet. Entries that
 * already started airing are intentionally dropped: once a couple of episodes
 * are out, a title sitting in "Planning" is no longer a premiere to wait for.
 */
async function loadPlannedUpcoming(viewerId: number): Promise<PlannedUpcoming[]> {
  const data = await siteRequest<PlannedQueryData>(PLANNED_QUERY, { userId: viewerId });
  const collection = data.MediaListCollection;
  if (!collection || !collection.lists) {
    return [];
  }

  const result: PlannedUpcoming[] = [];
  const seen: Record<string, boolean> = {};
  for (let listIndex = 0; listIndex < collection.lists.length; listIndex += 1) {
    const entries = collection.lists[listIndex].entries;
    for (let index = 0; index < entries.length; index += 1) {
      const media = entries[index].media;
      if (!media || !media.nextAiringEpisode || media.nextAiringEpisode.episode !== 1) {
        continue;
      }
      if (seen[String(media.id)]) {
        continue;
      }
      seen[String(media.id)] = true;
      result.push({
        id: media.id,
        title: media.title,
        coverImage: media.coverImage,
        airsAt: media.nextAiringEpisode.airingAt * 1000,
      });
    }
  }
  result.sort((left, right) => left.airsAt - right.airsAt);
  return result;
}

export function fetchPlannedUpcoming(viewerId: number): Promise<PlannedUpcoming[]> {
  return memoryCached(PLANNED_CACHE_PREFIX + viewerId, PLANNED_TTL, () => loadPlannedUpcoming(viewerId));
}

/*
 * Backlog picks: a "what should I finally start" rail built from the user's
 * own library. AniList's community recommendations are attached to each title,
 * so highly rated completed entries act as taste seeds; anything they point at
 * that already sits in the planning list becomes a pick. Genre profiles were
 * the obvious alternative, but they average diverse tastes into mush — a
 * recommendation edge keeps the reason ("like X") attached.
 */

export interface BacklogPickSource {
  id: number;
  title: MediaTitle;
}

export interface BacklogPick {
  id: number;
  title: MediaTitle;
  coverImage: CoverImage;
  format: string | null;
  episodes: number | null;
  averageScore: number | null;
  because: BacklogPickSource[];
}

export interface BacklogViewer {
  id: number;
  scoreFormat: ScoreFormat;
}

interface BacklogListEntry {
  status: MediaListStatus;
  score: number | null;
  media: { id: number; title: MediaTitle } | null;
}

const BACKLOG_LISTS_QUERY = `
  query BacklogLists($userId: Int!) {
    MediaListCollection(userId: $userId, type: ANIME) {
      lists {
        entries {
          status
          score
          media { id title { romaji english native } }
        }
      }
    }
  }
`;

function backlogRecommendationQuery(ids: number[]): string {
  let query = 'query BacklogRecommendations {\n';
  for (let index = 0; index < ids.length; index += 1) {
    query =
      query +
      '  s' +
      index +
      ': Media(id: ' +
      ids[index] +
      ') {\n' +
      '    recommendations(page: 1, perPage: 12, sort: RATING_DESC) {\n' +
      '      nodes {\n' +
      '        rating\n' +
      '        mediaRecommendation {\n' +
      '          id\n' +
      '          title { romaji english native }\n' +
      '          coverImage { large }\n' +
      '          format\n' +
      '          episodes\n' +
      '          averageScore\n' +
      '        }\n' +
      '      }\n' +
      '    }\n' +
      '  }\n';
  }
  return query + '}\n';
}

interface BacklogRecoNode {
  rating: number | null;
  mediaRecommendation: {
    id: number;
    title: MediaTitle;
    coverImage: { large: string | null } | null;
    format: string | null;
    episodes: number | null;
    averageScore: number | null;
  } | null;
}

interface BacklogSeed {
  id: number;
  title: MediaTitle;
  weight: number;
}

/**
 * { userId, scoreFormat } is enough: the viewer is already known by the caller.
 * Seeds are sampled evenly across every liked title rather than taking the
 * eight highest scores, which would hand the block to one franchise and hide a
 * mixed taste profile (a 10/10 slice-of-life and a 10/10 action show both get
 * a voice).
 */

const BACKLOG_SEEDS = 8;
const BACKLOG_RECO_CHUNK = 4;
const MAX_PICKS_PER_SOURCE = 2;
const BACKLOG_TTL = 5 * 60 * 1000;
const BACKLOG_RECO_TTL = 30 * 60 * 1000;
const BACKLOG_PREFIX = 'alx:backlog-picks:';
const BACKLOG_RECO_PREFIX = 'alx:backlog-reco:';

function seedRecommendations(ids: number[]): Promise<Record<string, BacklogRecoNode[]>> {
  const key = BACKLOG_RECO_PREFIX + ids.slice().sort((left, right) => left - right).join(',');
  return memoryCached(key, BACKLOG_RECO_TTL, async () => {
    const data = await request<Record<string, unknown>>(backlogRecommendationQuery(ids), {}, true);
    const result: Record<string, BacklogRecoNode[]> = {};
    for (let index = 0; index < ids.length; index += 1) {
      const media = data['s' + index] as { recommendations: { nodes: BacklogRecoNode[] } | null } | null | undefined;
      const nodes = media && media.recommendations && media.recommendations.nodes ? media.recommendations.nodes : [];
      result[String(ids[index])] = nodes;
    }
    return result;
  });
}

async function loadBacklogPicks(viewer: BacklogViewer, limit: number): Promise<BacklogPick[]> {
  const data = await siteRequest<{
    MediaListCollection: { lists: Array<{ entries: BacklogListEntry[] }> | null } | null;
  }>(BACKLOG_LISTS_QUERY, { userId: viewer.id });
  const collection = data.MediaListCollection;
  if (!collection || !collection.lists) {
    return [];
  }

  const scale = scoreScale(viewer.scoreFormat).max;
  const planning: Record<string, boolean> = {};
  const seeds: BacklogSeed[] = [];
  for (let listIndex = 0; listIndex < collection.lists.length; listIndex += 1) {
    const entries = collection.lists[listIndex].entries;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (!entry.media) {
        continue;
      }
      const id = entry.media.id;
      if (entry.status === 'PLANNING') {
        planning[String(id)] = true;
        continue;
      }
      if (entry.status !== 'COMPLETED' && entry.status !== 'CURRENT' && entry.status !== 'REPEATING') {
        continue;
      }
      const score = typeof entry.score === 'number' && entry.score > 0 ? Math.min(1, entry.score / scale) : 0;
      seeds.push({ id: id, title: entry.media.title, weight: score });
    }
  }

  if (seeds.length === 0 || Object.keys(planning).length === 0) {
    return [];
  }

  // Liked titles first; if the user does not score, fall back to everything.
  let liked: BacklogSeed[] = [];
  const thresholds = [0.7, 0.5, 0.01];
  for (let index = 0; index < thresholds.length && liked.length < 3; index += 1) {
    liked = [];
    for (let seedIndex = 0; seedIndex < seeds.length; seedIndex += 1) {
      if (seeds[seedIndex].weight >= thresholds[index]) {
        liked.push(seeds[seedIndex]);
      }
    }
  }
  if (liked.length === 0) {
    for (let index = 0; index < seeds.length; index += 1) {
      liked.push({ id: seeds[index].id, title: seeds[index].title, weight: 0.4 });
    }
  }

  liked.sort((left, right) => right.weight - left.weight);
  const picked: BacklogSeed[] = [];
  const step = liked.length > BACKLOG_SEEDS ? liked.length / BACKLOG_SEEDS : 1;
  for (let index = 0; index < liked.length && picked.length < BACKLOG_SEEDS; index += 1) {
    const candidate = liked[Math.floor(index * step)];
    if (candidate && picked.indexOf(candidate) === -1) {
      picked.push(candidate);
    }
  }

  interface Source {
    id: number;
    title: MediaTitle;
    contribution: number;
  }
  interface Aggregate {
    pick: BacklogPick;
    total: number;
    sources: Record<string, Source>;
  }
  const aggregates: Record<string, Aggregate> = {};

  for (let start = 0; start < picked.length; start += BACKLOG_RECO_CHUNK) {
    const chunk = picked.slice(start, start + BACKLOG_RECO_CHUNK);
    const ids: number[] = [];
    for (let index = 0; index < chunk.length; index += 1) {
      ids.push(chunk[index].id);
    }
    let map: Record<string, BacklogRecoNode[]> = {};
    try {
      map = await seedRecommendations(ids);
    } catch (error) {
      // One failed chunk must not sink the rest of the block.
      map = {};
    }
    for (let seedIndex = 0; seedIndex < chunk.length; seedIndex += 1) {
      const seed = chunk[seedIndex];
      const nodes = map[String(seed.id)] || [];
      // AniList ratings are absolute vote counts, so a blockbuster favourite
      // easily outvotes everything else. Normalising inside each seed keeps the
      // edges comparable: one seed's best edge counts as much as another's.
      let maxRating = 0;
      for (let index = 0; index < nodes.length; index += 1) {
        const rating = nodes[index].rating;
        if (typeof rating === 'number' && rating > maxRating) {
          maxRating = rating;
        }
      }
      if (maxRating <= 0) {
        maxRating = 1;
      }
      for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
        const node = nodes[nodeIndex];
        const target = node.mediaRecommendation;
        if (!target || !planning[String(target.id)]) {
          continue;
        }
        const rating = typeof node.rating === 'number' && node.rating > 0 ? node.rating : 1;
        const contribution = (rating / maxRating) * (0.3 + seed.weight);
        const key = String(target.id);
        let aggregate = aggregates[key];
        if (!aggregate) {
          aggregate = {
            pick: {
              id: target.id,
              title: target.title,
              coverImage: {
                large: target.coverImage ? target.coverImage.large : null,
                extraLarge: null,
                color: null,
              },
              format: target.format,
              episodes: target.episodes,
              averageScore: target.averageScore,
              because: [],
            },
            total: 0,
            sources: {},
          };
          aggregates[key] = aggregate;
        }
        aggregate.total += contribution;
        if (!aggregate.sources[String(seed.id)]) {
          aggregate.sources[String(seed.id)] = {
            id: seed.id,
            title: seed.title,
            contribution: contribution,
          };
        }
      }
    }
  }

  const ordered: Aggregate[] = [];
  const keys = Object.keys(aggregates);
  for (let index = 0; index < keys.length; index += 1) {
    ordered.push(aggregates[keys[index]]);
  }
  ordered.sort((left, right) => right.total - left.total);

  /*
   * One favourite can vouch for a whole shelf of similar shows, which used to
   * fill five of six cards and made the block look broken. A pick is credited
   * to its dominant reason and each reason gets at most two cards; the rail can
   * end up shorter, which is preferable to six variations of the same title.
   */
  const result: BacklogPick[] = [];
  const usedBySource: Record<string, number> = {};
  for (let index = 0; index < ordered.length && result.length < limit; index += 1) {
    const aggregate = ordered[index];
    const sourceKeys = Object.keys(aggregate.sources);
    let primary = '';
    let primaryContribution = -1;
    const sources: Source[] = [];
    for (let sourceIndex = 0; sourceIndex < sourceKeys.length; sourceIndex += 1) {
      const source = aggregate.sources[sourceKeys[sourceIndex]];
      sources.push(source);
      if (source.contribution > primaryContribution) {
        primary = sourceKeys[sourceIndex];
        primaryContribution = source.contribution;
      }
    }
    const used = usedBySource[primary] || 0;
    if (used >= MAX_PICKS_PER_SOURCE) {
      continue;
    }
    usedBySource[primary] = used + 1;

    sources.sort((left, right) => right.contribution - left.contribution);
    const because: BacklogPickSource[] = [];
    for (let sourceIndex = 0; sourceIndex < sources.length && because.length < 2; sourceIndex += 1) {
      because.push({ id: sources[sourceIndex].id, title: sources[sourceIndex].title });
    }
    aggregate.pick.because = because;
    result.push(aggregate.pick);
  }
  return result;
}

/**
 * Planning entries that AniList's community links to titles the viewer rated
 * highly. Cached for five minutes; any list mutation drops it.
 */
export function fetchBacklogPicks(viewer: BacklogViewer, limit = 6): Promise<BacklogPick[]> {
  return memoryCached(
    BACKLOG_PREFIX + viewer.id + ':' + limit,
    BACKLOG_TTL,
    () => loadBacklogPicks(viewer, limit)
  );
}

/*
 * Premiere calendar. One list request finds every watching/rewatching/planned
 * title, then airingSchedules covers a whole date range at once — unlike
 * nextAiringEpisode, which only knows the upcoming episode and cannot fill a
 * month grid. Planned titles appear as soon as AniList has a scheduled date;
 * "not yet released" entries without a date simply have no rows.
 */

export interface CalendarEntry {
  mediaId: number;
  title: MediaTitle;
  cover: string | null;
  episode: number;
  airsAt: number;
  premiere: boolean;
  listStatus: MediaListStatus;
}

interface CalendarListEntry {
  status: MediaListStatus;
  media: {
    id: number;
    title: MediaTitle;
    coverImage: { large: string | null } | null;
  } | null;
}

interface CalendarSchedule {
  episode: number;
  airingAt: number;
  media: { id: number } | null;
}

interface CalendarRangePage {
  Page: {
    pageInfo: { hasNextPage: boolean } | null;
    airingSchedules: CalendarSchedule[] | null;
  } | null;
}

const CALENDAR_LISTS_QUERY = `
  query CalendarLists($userId: Int!) {
    MediaListCollection(userId: $userId, type: ANIME, status_in: [CURRENT, REPEATING, PLANNING]) {
      lists {
        entries {
          status
          media {
            id
            title { romaji english native }
            coverImage { large }
          }
        }
      }
    }
  }
`;

const CALENDAR_RANGE_QUERY = `
  query AiringRange($ids: [Int], $from: Int, $to: Int, $page: Int) {
    Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, mediaId_in: $ids, sort: TIME) {
        episode
        airingAt
        media { id }
      }
    }
  }
`;

const CALENDAR_TTL = 5 * 60 * 1000;
const CALENDAR_PREFIX = 'alx:calendar:';
const CALENDAR_CHUNK = 50;
const CALENDAR_MAX_PAGES = 5;

async function loadCalendarRange(viewerId: number, from: number, to: number): Promise<CalendarEntry[]> {
  const data = await siteRequest<{
    MediaListCollection: { lists: Array<{ entries: CalendarListEntry[] }> | null } | null;
  }>(CALENDAR_LISTS_QUERY, { userId: viewerId });
  const collection = data.MediaListCollection;
  if (!collection || !collection.lists) {
    return [];
  }

  const tracked: Record<string, { title: MediaTitle; cover: string | null; status: MediaListStatus }> = {};
  const ids: number[] = [];
  const lists: Array<{ entries: CalendarListEntry[] }> = collection.lists;
  for (let listIndex = 0; listIndex < lists.length; listIndex += 1) {
    const listEntries: CalendarListEntry[] = lists[listIndex].entries;
    for (let index = 0; index < listEntries.length; index += 1) {
      const trackedMedia: CalendarListEntry['media'] = listEntries[index].media;
      if (!trackedMedia) {
        continue;
      }
      const key = String(trackedMedia.id);
      if (tracked[key]) {
        continue;
      }
      tracked[key] = {
        title: trackedMedia.title,
        cover: trackedMedia.coverImage ? trackedMedia.coverImage.large : null,
        status: listEntries[index].status,
      };
      ids.push(trackedMedia.id);
    }
  }
  if (ids.length === 0) {
    return [];
  }

  const entries: CalendarEntry[] = [];
  const seen: Record<string, boolean> = {};
  for (let start = 0; start < ids.length; start += CALENDAR_CHUNK) {
    const chunk = ids.slice(start, start + CALENDAR_CHUNK);
    for (let page = 1; page <= CALENDAR_MAX_PAGES; page += 1) {
      const pageData = await siteRequest<CalendarRangePage>(CALENDAR_RANGE_QUERY, {
        ids: chunk,
        from: Math.floor(from / 1000),
        to: Math.floor(to / 1000),
        page: page,
      });
      if (!pageData.Page || !pageData.Page.airingSchedules) {
        break;
      }
      const schedules = pageData.Page.airingSchedules;
      for (let index = 0; index < schedules.length; index += 1) {
        const schedule = schedules[index];
        const meta = schedule.media ? tracked[String(schedule.media.id)] : undefined;
        if (!meta) {
          continue;
        }
        const key = schedule.media ? String(schedule.media.id) + ':' + schedule.episode : '';
        if (!key || seen[key]) {
          continue;
        }
        seen[key] = true;
        entries.push({
          mediaId: schedule.media ? schedule.media.id : 0,
          title: meta.title,
          cover: meta.cover,
          episode: schedule.episode,
          airsAt: schedule.airingAt * 1000,
          premiere: meta.status === 'PLANNING' && schedule.episode === 1,
          listStatus: meta.status,
        });
      }
      if (!pageData.Page.pageInfo || !pageData.Page.pageInfo.hasNextPage) {
        break;
      }
    }
  }

  entries.sort((left, right) => left.airsAt - right.airsAt);
  return entries;
}

/** Scheduled episodes for the viewer's lists between two timestamps. */
export function fetchCalendarRange(
  viewerId: number,
  fromMs: number,
  toMs: number
): Promise<CalendarEntry[]> {
  return memoryCached(
    CALENDAR_PREFIX + viewerId + ':' + fromMs + ':' + toMs,
    CALENDAR_TTL,
    () => loadCalendarRange(viewerId, fromMs, toMs)
  );
}

/*
 * Continue watching: the next *unwatched* episode per current title. AniList's
 * own airing rail always shows the upcoming episode, which is useless when the
 * viewer is four episodes behind — this compares progress with what has aired
 * and reports the gap instead.
 */

export interface ContinueWatchingItem {
  mediaId: number;
  title: MediaTitle;
  cover: string | null;
  progress: number;
  episodes: number | null;
  nextEpisode: number;
  /** Air time of the next episode, or null when it is already available. */
  airsAt: number | null;
  behind: number;
}

interface ContinueEntryRaw {
  progress: number | null;
  media: {
    id: number;
    title: MediaTitle;
    coverImage: { large: string | null } | null;
    episodes: number | null;
    nextAiringEpisode: { episode: number; airingAt: number } | null;
  } | null;
}

const CONTINUE_QUERY = `
  query ContinueWatching($userId: Int!) {
    MediaListCollection(userId: $userId, type: ANIME, status_in: [CURRENT, REPEATING]) {
      lists {
        entries {
          progress
          media {
            id
            title { romaji english native }
            coverImage { large }
            episodes
            nextAiringEpisode { episode airingAt }
          }
        }
      }
    }
  }
`;

const CONTINUE_TTL = 2 * 60 * 1000;
const CONTINUE_PREFIX = 'alx:continue:';

async function loadContinueWatching(viewerId: number): Promise<ContinueWatchingItem[]> {
  const data = await siteRequest<{
    MediaListCollection: { lists: Array<{ entries: ContinueEntryRaw[] }> | null } | null;
  }>(CONTINUE_QUERY, { userId: viewerId });
  const collection = data.MediaListCollection;
  if (!collection || !collection.lists) {
    return [];
  }

  const items: ContinueWatchingItem[] = [];
  const seen: Record<string, boolean> = {};
  for (let listIndex = 0; listIndex < collection.lists.length; listIndex += 1) {
    const listEntries = collection.lists[listIndex].entries;
    for (let index = 0; index < listEntries.length; index += 1) {
      const entry = listEntries[index];
      const media = entry.media;
      if (!media || seen[String(media.id)]) {
        continue;
      }
      seen[String(media.id)] = true;
      const progress = typeof entry.progress === 'number' ? entry.progress : 0;
      const total = typeof media.episodes === 'number' ? media.episodes : null;
      const next = media.nextAiringEpisode;
      const aired = next ? Math.max(0, next.episode - 1) : total !== null ? total : progress;
      const behind = Math.max(0, aired - progress);

      let nextEpisode: number;
      let airsAt: number | null = null;
      if (behind > 0) {
        // The next unwatched episode is already out.
        nextEpisode = progress + 1;
      } else if (next) {
        nextEpisode = next.episode;
        airsAt = next.airingAt * 1000;
      } else {
        // Finished and fully watched: nothing to continue.
        continue;
      }
      if (total !== null && nextEpisode > total) {
        continue;
      }

      items.push({
        mediaId: media.id,
        title: media.title,
        cover: media.coverImage ? media.coverImage.large : null,
        progress: progress,
        episodes: total,
        nextEpisode: nextEpisode,
        airsAt: airsAt,
        behind: behind,
      });
    }
  }

  // Most episodes waiting first; caught-up titles then sort by next air time.
  items.sort((left, right) => {
    if (left.behind !== right.behind) {
      return right.behind - left.behind;
    }
    const leftAt = left.airsAt === null ? 0 : left.airsAt;
    const rightAt = right.airsAt === null ? 0 : right.airsAt;
    return leftAt - rightAt;
  });
  return items;
}

/** Current/rewatching titles with something left to watch, cached for two minutes. */
export function fetchContinueWatching(viewerId: number): Promise<ContinueWatchingItem[]> {
  return memoryCached(CONTINUE_PREFIX + viewerId, CONTINUE_TTL, () => loadContinueWatching(viewerId));
}

/*
 * Backlog triage. Planning lists rot: entries added years ago, three seasons of
 * the same franchise, or a sequel whose first season was dropped. One collection
 * request supplies statuses and timestamps; one chunked relations request tells
 * which planning entries share a franchise and which ones hang off a dropped
 * parent.
 */

export interface TriageEntry {
  entryId: number;
  mediaId: number;
  title: MediaTitle;
  cover: string | null;
  format: string | null;
  episodes: number | null;
  addedAt: number | null;
  /** Whole years since the entry was last changed, 0 when unknown. */
  idleYears: number;
  franchiseKey: number;
  franchiseSize: number;
  droppedParent: MediaTitle | null;
}

interface TriageListEntry {
  id: number;
  status: MediaListStatus;
  createdAt: number | null;
  updatedAt: number | null;
  media: {
    id: number;
    title: MediaTitle;
    coverImage: { large: string | null } | null;
    format: string | null;
    episodes: number | null;
  } | null;
}

interface TriageRelationEdge {
  relationType: string | null;
  node: { id: number } | null;
}

interface TriagePlanning {
  entryId: number;
  media: NonNullable<TriageListEntry['media']>;
  createdAt: number | null;
  updatedAt: number | null;
}

const TRIAGE_LISTS_QUERY = `
  query BacklogTriageLists($userId: Int!) {
    MediaListCollection(userId: $userId, type: ANIME) {
      lists {
        entries {
          id
          status
          createdAt
          updatedAt
          media {
            id
            title { romaji english native }
            coverImage { large }
            format
            episodes
          }
        }
      }
    }
  }
`;

const TRIAGE_TTL = 10 * 60 * 1000;
const TRIAGE_PREFIX = 'alx:triage:';
const TRIAGE_CHUNK = 50;
/** Franchise links that make two planning entries part of one series. */
const FRANCHISE_RELATIONS: Record<string, boolean> = {
  PREQUEL: true,
  SEQUEL: true,
  PARENT: true,
  SIDE_STORY: true,
  SPIN_OFF: true,
  ALTERNATIVE: true,
};
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function triageRelationsQuery(ids: number[]): string {
  let query = 'query BacklogRelations {\n';
  for (let index = 0; index < ids.length; index += 1) {
    query =
      query +
      '  m' +
      index +
      ': Media(id: ' +
      ids[index] +
      ') { relations { edges { relationType node { id } } } }\n';
  }
  return query + '}\n';
}

async function loadTriageRelations(ids: number[]): Promise<Record<string, TriageRelationEdge[]>> {
  const relations: Record<string, TriageRelationEdge[]> = {};
  for (let start = 0; start < ids.length; start += TRIAGE_CHUNK) {
    const chunk = ids.slice(start, start + TRIAGE_CHUNK);
    let data: Record<string, unknown> = {};
    try {
      data = await siteRequest<Record<string, unknown>>(triageRelationsQuery(chunk), {}, true);
    } catch (error) {
      // A failed chunk leaves its entries without franchise data, not broken.
      continue;
    }
    for (let index = 0; index < chunk.length; index += 1) {
      const media = data['m' + index] as { relations: { edges: TriageRelationEdge[] } | null } | null | undefined;
      const edges = media && media.relations && media.relations.edges ? media.relations.edges : [];
      relations[String(chunk[index])] = edges;
    }
  }
  return relations;
}

async function loadBacklogTriage(viewerId: number): Promise<TriageEntry[]> {
  const data = await siteRequest<{
    MediaListCollection: { lists: Array<{ entries: TriageListEntry[] }> | null } | null;
  }>(TRIAGE_LISTS_QUERY, { userId: viewerId });
  const collection = data.MediaListCollection;
  if (!collection || !collection.lists) {
    return [];
  }

  const planning: TriagePlanning[] = [];
  const dropped: Record<string, MediaTitle> = {};
  for (let listIndex = 0; listIndex < collection.lists.length; listIndex += 1) {
    const listEntries = collection.lists[listIndex].entries;
    for (let index = 0; index < listEntries.length; index += 1) {
      const entry = listEntries[index];
      const media = entry.media;
      if (!media) {
        continue;
      }
      if (entry.status === 'PLANNING') {
        planning.push({
          entryId: entry.id,
          media: media,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        });
      } else if (entry.status === 'DROPPED') {
        dropped[String(media.id)] = media.title;
      }
    }
  }
  if (planning.length === 0) {
    return [];
  }

  const planningIds: Record<string, boolean> = {};
  for (let index = 0; index < planning.length; index += 1) {
    planningIds[String(planning[index].media.id)] = true;
  }
  const relations = await loadTriageRelations(planning.map((item) => item.media.id));

  // Union-find over planning ids, so "Naruto", "Naruto: Shippuuden" and a
  // spin-off collapse into one franchise without parsing title strings.
  const parent: Record<string, string> = {};
  const find = (value: string): string => {
    let current = value;
    while (parent[current] !== undefined && parent[current] !== current) {
      current = parent[current];
    }
    parent[value] = current;
    return current;
  };
  const union = (left: string, right: string): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) {
      parent[leftRoot] = rightRoot;
    }
  };
  for (let index = 0; index < planning.length; index += 1) {
    parent[String(planning[index].media.id)] = String(planning[index].media.id);
  }
  for (let index = 0; index < planning.length; index += 1) {
    const mediaId = planning[index].media.id;
    const edges = relations[String(mediaId)] || [];
    for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
      const edge = edges[edgeIndex];
      if (!edge.node || !edge.relationType || !FRANCHISE_RELATIONS[edge.relationType]) {
        continue;
      }
      if (planningIds[String(edge.node.id)]) {
        union(String(mediaId), String(edge.node.id));
      }
    }
  }

  const franchiseSizes: Record<string, number> = {};
  for (let index = 0; index < planning.length; index += 1) {
    const mediaId = String(planning[index].media.id);
    const root = find(mediaId);
    franchiseSizes[root] = (franchiseSizes[root] || 0) + 1;
  }

  const now = Date.now();
  const entries: TriageEntry[] = [];
  for (let index = 0; index < planning.length; index += 1) {
    const item = planning[index];
    const media = item.media;
    const changedAt = item.updatedAt !== null ? item.updatedAt : item.createdAt;
    const idleYears = changedAt !== null ? Math.floor((now - changedAt * 1000) / YEAR_MS) : 0;
    const addedAt = item.createdAt !== null ? item.createdAt * 1000 : null;

    let droppedParent: MediaTitle | null = null;
    const edges = relations[String(media.id)] || [];
    for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
      const edge = edges[edgeIndex];
      if (!edge.node || !edge.relationType) {
        continue;
      }
      if (edge.relationType !== 'PREQUEL' && edge.relationType !== 'PARENT') {
        continue;
      }
      const parentTitle = dropped[String(edge.node.id)];
      if (parentTitle) {
        droppedParent = parentTitle;
        break;
      }
    }

    const root = find(String(media.id));
    entries.push({
      entryId: item.entryId,
      mediaId: media.id,
      title: media.title,
      cover: media.coverImage ? media.coverImage.large : null,
      format: media.format,
      episodes: media.episodes,
      addedAt: addedAt,
      idleYears: Math.max(0, idleYears),
      franchiseKey: parseInt(root, 10),
      franchiseSize: franchiseSizes[root] || 1,
      droppedParent: droppedParent,
    });
  }

  entries.sort((left, right) => right.idleYears - left.idleYears);
  return entries;
}

/** Planning entries with aging, franchise and dropped-parent context. */
export function fetchBacklogTriage(viewerId: number): Promise<TriageEntry[]> {
  return memoryCached(TRIAGE_PREFIX + viewerId, TRIAGE_TTL, () => loadBacklogTriage(viewerId));
}

/*
 * Franchise tracker. AniList's relations are a graph, not a list: seasons chain
 * through PREQUEL/SEQUEL, films and OVAs hang off as SIDE_STORY or SPIN_OFF, and
 * recaps are SUMMARY. Walking that graph from the title the user is looking at
 * gives the whole franchise (and its watch order) without parsing name strings.
 */

export interface FranchiseNode {
  id: number;
  title: MediaTitle;
  cover: string | null;
  format: string | null;
  episodes: number | null;
  duration: number | null;
  status: string | null;
  year: number | null;
  startAt: number | null;
  /** Episodes that have aired so far; 0 while a premiere is still ahead. */
  aired: number;
  nextEpisode: { episode: number; airsAt: number } | null;
  entry: ListEntryInfo | null;
}

export interface FranchiseSideEntry {
  node: FranchiseNode;
  /** Main-line title this one hangs off, or null when the link is indirect. */
  anchorId: number | null;
  /** Raw AniList relation, e.g. SIDE_STORY; empty when unknown. */
  relation: string;
}

export interface FranchiseNext {
  node: FranchiseNode;
  episode: number;
  /** Null when that episode is already out. */
  airsAt: number | null;
}

export interface FranchiseTree {
  rootId: number;
  /** Seasons and films of the main story, in release order. */
  main: FranchiseNode[];
  /** Everything else that hangs off the main line. */
  side: FranchiseSideEntry[];
  next: FranchiseNext | null;
  watchedEpisodes: number;
  knownEpisodes: number;
  signedIn: boolean;
  /** Some relations were left unvisited because the graph hit its size cap. */
  truncated: boolean;
}

interface FranchiseRawNode {
  id: number;
  title: MediaTitle;
  coverImage: { large: string | null } | null;
  format: string | null;
  episodes: number | null;
  duration: number | null;
  status: string | null;
  seasonYear: number | null;
  startDate: { year: number | null; month: number | null; day: number | null } | null;
  nextAiringEpisode: { episode: number; airingAt: number } | null;
  relations: { edges: Array<{ relationType: string | null; node: { id: number } | null }> | null } | null;
  mediaListEntry?: ListEntryInfo | null;
}

interface FranchiseLink {
  from: number;
  to: number;
  type: string;
}

const FRANCHISE_TTL = 5 * 60 * 1000;
const FRANCHISE_PREFIX = 'alx:franchise:';
const FRANCHISE_MAX_NODES = 40;
/** A long chain (season after season) needs one round per hop; the cap is size, not depth. */
const FRANCHISE_MAX_ROUNDS = 8;

/** Relations followed while walking the graph; recap films are left out. */
const FRANCHISE_WALK: Record<string, boolean> = {
  PREQUEL: true,
  SEQUEL: true,
  PARENT: true,
  CHILD: true,
  SIDE_STORY: true,
  SPIN_OFF: true,
  ALTERNATIVE: true,
};

/** The main story is only the season chain; everything else is optional. */
const FRANCHISE_MAIN: Record<string, boolean> = { PREQUEL: true, SEQUEL: true };

const INVERSE_RELATION: Record<string, string> = {
  PREQUEL: 'SEQUEL',
  SEQUEL: 'PREQUEL',
  PARENT: 'CHILD',
  CHILD: 'PARENT',
};

const FRANCHISE_FIELDS = `
    id
    title { romaji english native }
    coverImage { large }
    format
    episodes
    duration
    status
    seasonYear
    startDate { year month day }
    nextAiringEpisode { episode airingAt }
    relations { edges { relationType node { id } } }
`;

function franchiseQuery(ids: number[], withEntries: boolean): string {
  let query = 'query FranchiseTree {\n';
  for (let index = 0; index < ids.length; index += 1) {
    query += '  m' + index + ': Media(id: ' + ids[index] + ', type: ANIME) {\n' + FRANCHISE_FIELDS;
    if (withEntries) {
      query += '    mediaListEntry { id status score progress }\n';
    }
    query += '  }\n';
  }
  return query + '}\n';
}

async function fetchFranchiseBatch(
  ids: number[],
  withEntries: boolean
): Promise<Array<FranchiseRawNode | null>> {
  const query = franchiseQuery(ids, withEntries);
  let data: Record<string, unknown>;
  if (withEntries) {
    try {
      data = await siteRequest<Record<string, unknown>>(query, {}, true);
    } catch (error) {
      // A rate limit would hit the fallback too; only a session problem is retried.
      if (isRateLimited(error)) {
        throw error;
      }
      // A session hiccup should not hide the tree; retry publicly without progress.
      data = await request<Record<string, unknown>>(query, {}, true);
    }
  } else {
    data = await request<Record<string, unknown>>(query, {}, true);
  }
  const result: Array<FranchiseRawNode | null> = [];
  for (let index = 0; index < ids.length; index += 1) {
    const node = data['m' + index] as FranchiseRawNode | null | undefined;
    result.push(node ? node : null);
  }
  return result;
}

/**
 * Relations sometimes point at titles AniList has since removed (merged or
 * deleted ids). One such id makes AniList null every alias in the request, so a
 * failed batch is bisected until the dead reference is isolated — a franchise
 * with one broken link still renders instead of stopping at the first hop.
 */
async function fetchFranchiseNodes(
  ids: number[],
  withEntries: boolean
): Promise<Array<FranchiseRawNode | null>> {
  if (ids.length === 0) {
    return [];
  }
  let result: Array<FranchiseRawNode | null> = [];
  let readable = false;
  try {
    result = await fetchFranchiseBatch(ids, withEntries);
    for (let index = 0; index < result.length; index += 1) {
      if (result[index]) {
        readable = true;
        break;
      }
    }
  } catch (error) {
    // Splitting a rate-limited batch would only make the limit worse.
    if (isRateLimited(error)) {
      throw error;
    }
    readable = false;
  }
  if (readable || ids.length === 1) {
    return result;
  }

  const middle = Math.ceil(ids.length / 2);
  const left = await fetchFranchiseNodes(ids.slice(0, middle), withEntries);
  const right = await fetchFranchiseNodes(ids.slice(middle), withEntries);
  return left.concat(right);
}

function isRateLimited(error: unknown): boolean {
  return error instanceof Error && error.message.indexOf('429') !== -1;
}

function startTimestamp(date: FranchiseRawNode['startDate']): number | null {
  if (!date || !date.year) {
    return null;
  }
  const month = date.month ? date.month - 1 : 0;
  const day = date.day ? date.day : 1;
  return new Date(date.year, month, day).getTime();
}

function airedEpisodes(node: FranchiseRawNode): number {
  if (node.nextAiringEpisode) {
    return Math.max(0, node.nextAiringEpisode.episode - 1);
  }
  if (node.status === 'FINISHED' || node.status === 'CANCELLED') {
    return node.episodes !== null ? node.episodes : 0;
  }
  // Airing on hiatus: without a schedule the viewer's own progress is the only
  // honest answer, so nothing is reported as "behind".
  return node.mediaListEntry ? node.mediaListEntry.progress : 0;
}

function toFranchiseNode(node: FranchiseRawNode): FranchiseNode {
  return {
    id: node.id,
    title: node.title,
    cover: node.coverImage ? node.coverImage.large : null,
    format: node.format,
    episodes: node.episodes,
    duration: node.duration,
    status: node.status,
    year: node.startDate && node.startDate.year ? node.startDate.year : node.seasonYear,
    startAt: startTimestamp(node.startDate),
    aired: airedEpisodes(node),
    nextEpisode: node.nextAiringEpisode
      ? { episode: node.nextAiringEpisode.episode, airsAt: node.nextAiringEpisode.airingAt * 1000 }
      : null,
    entry: node.mediaListEntry ? node.mediaListEntry : null,
  };
}

function mainLineOf(rootId: number, links: FranchiseLink[]): number[] {
  const adjacency: Record<string, number[]> = {};
  for (let index = 0; index < links.length; index += 1) {
    const link = links[index];
    if (!FRANCHISE_MAIN[link.type]) {
      continue;
    }
    if (!adjacency[String(link.from)]) {
      adjacency[String(link.from)] = [];
    }
    if (!adjacency[String(link.to)]) {
      adjacency[String(link.to)] = [];
    }
    adjacency[String(link.from)].push(link.to);
    adjacency[String(link.to)].push(link.from);
  }

  const seen: Record<string, boolean> = {};
  seen[String(rootId)] = true;
  const queue: number[] = [rootId];
  const result: number[] = [];
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    result.push(current);
    const neighbours = adjacency[String(current)] || [];
    for (let index = 0; index < neighbours.length; index += 1) {
      const next = neighbours[index];
      if (!seen[String(next)]) {
        seen[String(next)] = true;
        queue.push(next);
      }
    }
  }
  return result;
}

function sortChronologically(nodes: FranchiseNode[]): FranchiseNode[] {
  return nodes.slice().sort((left, right) => {
    const leftAt = left.startAt === null ? Number.MAX_SAFE_INTEGER : left.startAt;
    const rightAt = right.startAt === null ? Number.MAX_SAFE_INTEGER : right.startAt;
    if (leftAt !== rightAt) {
      return leftAt - rightAt;
    }
    return left.id - right.id;
  });
}

/** How a side entry is introduced: "side story of X" and friends. */
export function relationLabel(relation: string): string {
  switch (relation) {
    case 'SIDE_STORY':
      return 'side story';
    case 'SPIN_OFF':
      return 'spin-off';
    case 'ALTERNATIVE':
      return 'alternative version';
    case 'PARENT':
      return 'parent story';
    case 'CHILD':
      return 'child story';
    case 'SUMMARY':
      return 'recap';
    default:
      return 'related';
  }
}

const SIDE_ORDER: Record<string, number> = {
  PARENT: 0,
  CHILD: 1,
  SIDE_STORY: 2,
  SPIN_OFF: 3,
  ALTERNATIVE: 4,
};

function sideOf(
  ids: number[],
  mainIds: Record<string, boolean>,
  nodesById: Record<string, FranchiseNode>,
  links: FranchiseLink[]
): FranchiseSideEntry[] {
  const result: FranchiseSideEntry[] = [];
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index];
    if (mainIds[String(id)] || !nodesById[String(id)]) {
      continue;
    }
    let anchorId: number | null = null;
    let relation = '';
    // Prefer a direct link to the main story: it is what the label describes.
    for (let linkIndex = 0; linkIndex < links.length && anchorId === null; linkIndex += 1) {
      const link = links[linkIndex];
      if (link.from === id && mainIds[String(link.to)]) {
        anchorId = link.to;
        relation = link.type;
      } else if (link.to === id && mainIds[String(link.from)]) {
        anchorId = link.from;
        relation = INVERSE_RELATION[link.type] || link.type;
      }
    }
    if (anchorId === null) {
      for (let linkIndex = 0; linkIndex < links.length && anchorId === null; linkIndex += 1) {
        const link = links[linkIndex];
        if (link.from === id && nodesById[String(link.to)]) {
          anchorId = link.to;
          relation = link.type;
        } else if (link.to === id && nodesById[String(link.from)]) {
          anchorId = link.from;
          relation = INVERSE_RELATION[link.type] || link.type;
        }
      }
    }
    result.push({ node: nodesById[String(id)], anchorId: anchorId, relation: relation });
  }

  result.sort((left, right) => {
    const leftOrder = SIDE_ORDER[left.relation] === undefined ? 9 : SIDE_ORDER[left.relation];
    const rightOrder = SIDE_ORDER[right.relation] === undefined ? 9 : SIDE_ORDER[right.relation];
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    const leftAt = left.node.startAt === null ? Number.MAX_SAFE_INTEGER : left.node.startAt;
    const rightAt = right.node.startAt === null ? Number.MAX_SAFE_INTEGER : right.node.startAt;
    if (leftAt !== rightAt) {
      return leftAt - rightAt;
    }
    return left.node.id - right.node.id;
  });
  return result;
}

function isFinished(node: FranchiseNode): boolean {
  const status = node.entry ? node.entry.status : null;
  return status === 'COMPLETED' || status === 'DROPPED';
}

function progressOf(node: FranchiseNode): number {
  return node.entry ? node.entry.progress : 0;
}

/**
 * The next thing to watch: something already out comes first, so a franchise
 * the user paused midway wins over a season that merely airs next week. Only
 * when nothing is available does a caught-up title report its next airing.
 */
function planNext(main: FranchiseNode[], side: FranchiseSideEntry[]): FranchiseNext | null {
  const candidates: FranchiseNode[] = [];
  for (let index = 0; index < main.length; index += 1) {
    candidates.push(main[index]);
  }
  for (let index = 0; index < side.length; index += 1) {
    candidates.push(side[index].node);
  }

  for (let index = 0; index < candidates.length; index += 1) {
    const node = candidates[index];
    if (isFinished(node)) {
      continue;
    }
    const progress = progressOf(node);
    if (progress < node.aired) {
      return { node: node, episode: progress + 1, airsAt: null };
    }
  }

  for (let index = 0; index < candidates.length; index += 1) {
    const node = candidates[index];
    if (isFinished(node) || !node.nextEpisode) {
      continue;
    }
    return { node: node, episode: node.nextEpisode.episode, airsAt: node.nextEpisode.airsAt };
  }
  return null;
}

async function loadFranchise(rootId: number, viewerId: number | null): Promise<FranchiseTree> {
  const signedIn = viewerId !== null;
  const nodesById: Record<string, FranchiseNode> = {};
  const order: number[] = [];
  const links: FranchiseLink[] = [];
  const queued: Record<string, boolean> = {};
  let frontier: number[] = [rootId];
  let truncated = false;

  for (let round = 0; round < FRANCHISE_MAX_ROUNDS && frontier.length > 0; round += 1) {
    const batch: number[] = [];
    for (let index = 0; index < frontier.length; index += 1) {
      const id = frontier[index];
      if (!nodesById[String(id)] && !queued[String(id)]) {
        queued[String(id)] = true;
        batch.push(id);
      }
    }
    if (batch.length === 0) {
      break;
    }
    const room = FRANCHISE_MAX_NODES - order.length;
    if (room <= 0) {
      truncated = true;
      break;
    }
    let ids = batch;
    if (batch.length > room) {
      ids = batch.slice(0, room);
      truncated = true;
    }

    let raw: Array<FranchiseRawNode | null>;
    try {
      raw = await fetchFranchiseNodes(ids, signedIn);
    } catch (error) {
      if (round === 0) {
        throw error;
      }
      // The titles found so far are still worth showing.
      truncated = true;
      break;
    }

    const next: number[] = [];
    const nextSeen: Record<string, boolean> = {};
    for (let index = 0; index < ids.length; index += 1) {
      const node = raw[index];
      if (!node) {
        continue;
      }
      nodesById[String(node.id)] = toFranchiseNode(node);
      order.push(node.id);
      const edges = node.relations && node.relations.edges ? node.relations.edges : [];
      for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
        const edge = edges[edgeIndex];
        if (!edge.node || !edge.relationType || !FRANCHISE_WALK[edge.relationType]) {
          continue;
        }
        links.push({ from: node.id, to: edge.node.id, type: edge.relationType });
        // Several relations often point at the same title; one alias each.
        if (!nodesById[String(edge.node.id)] && !nextSeen[String(edge.node.id)]) {
          nextSeen[String(edge.node.id)] = true;
          next.push(edge.node.id);
        }
      }
    }
    frontier = next;
  }
  for (let index = 0; index < frontier.length; index += 1) {
    if (!nodesById[String(frontier[index])]) {
      truncated = true;
      break;
    }
  }

  if (!nodesById[String(rootId)]) {
    throw new ApiError('AniList did not return this title');
  }

  const mainIds: Record<string, boolean> = {};
  const mainLine = mainLineOf(rootId, links);
  const mainNodes: FranchiseNode[] = [];
  for (let index = 0; index < mainLine.length; index += 1) {
    const node = nodesById[String(mainLine[index])];
    if (node) {
      mainIds[String(node.id)] = true;
      mainNodes.push(node);
    }
  }

  let watchedEpisodes = 0;
  let knownEpisodes = 0;
  for (let index = 0; index < order.length; index += 1) {
    const node = nodesById[String(order[index])];
    if (!node) {
      continue;
    }
    if (node.episodes !== null) {
      knownEpisodes += node.episodes;
    }
    const progress = progressOf(node);
    watchedEpisodes += node.episodes !== null ? Math.min(progress, node.episodes) : progress;
  }

  const main = sortChronologically(mainNodes);
  const side = sideOf(order, mainIds, nodesById, links);

  return {
    rootId: rootId,
    main: main,
    side: side,
    next: planNext(main, side),
    watchedEpisodes: watchedEpisodes,
    knownEpisodes: knownEpisodes,
    signedIn: signedIn,
    truncated: truncated,
  };
}

/**
 * The franchise around one title, in release order, with the viewer's progress.
 * Cached for five minutes per title and viewer; list mutations drop it.
 */
export function fetchFranchiseTree(rootId: number, viewerId: number | null): Promise<FranchiseTree> {
  const viewerKey = viewerId === null ? 'guest' : String(viewerId);
  return memoryCached(FRANCHISE_PREFIX + rootId + ':' + viewerKey, FRANCHISE_TTL, () =>
    loadFranchise(rootId, viewerId)
  );
}

/*
 * Studio DNA: the people who keep showing up across a studio's works. The site
 * lists credits per title only, so the sample is the studio's most popular
 * works, their key staff edges, and the Japanese voice cast of their main
 * characters. Two AniList quirks shape the requests: staff pages cap at 25, and
 * `voiceActors` comes back null unless the request carries the visitor's
 * session (and only on a root `Media` query with an explicit language), hence
 * one cast request per title through the same-origin endpoint, signed-in only.
 */

export type StudioDnaKind = 'director' | 'composer' | 'cast';

export interface StudioDnaPerson {
  id: number;
  name: string;
  image: string | null;
  /** Sampled works this person is credited on. */
  works: number;
  roles: string[];
  kind: StudioDnaKind;
}

export interface StudioDna {
  studioId: number;
  /** Works sampled for crew credits. */
  works: number;
  /** Works that actually returned a cast, which can be fewer. */
  castWorks: number;
  directors: StudioDnaPerson[];
  composers: StudioDnaPerson[];
  cast: StudioDnaPerson[];
}

const STUDIO_DNA_TTL = 30 * 60 * 1000;
const STUDIO_DNA_PREFIX = 'alx:studio-dna:';
const STUDIO_DNA_SAMPLE = 25;
const STUDIO_DNA_CAST_SAMPLE = 8;
const STUDIO_DNA_CAST_CHUNK = 4;

const STUDIO_DNA_WORKS_QUERY = `
  query StudioDnaWorks($id: Int!) {
    Studio(id: $id) {
      media(page: 1, perPage: 25, sort: [POPULARITY_DESC]) {
        nodes {
          id
          isAdult
          studios {
            edges {
              isMain
              node { id }
            }
          }
        }
      }
    }
  }
`;

const STUDIO_DNA_STAFF_QUERY = `
  query StudioDnaStaff($ids: [Int]) {
    Page(page: 1, perPage: 25) {
      media(id_in: $ids, type: ANIME) {
        id
        staff(page: 1, perPage: 25, sort: RELEVANCE) {
          edges {
            role
            node {
              id
              name { full }
              image { medium }
              primaryOccupations
            }
          }
        }
      }
    }
  }
`;

const STUDIO_DNA_CAST_QUERY = `
  query StudioDnaCast($id: Int!) {
    Media(id: $id, type: ANIME) {
      characters(page: 1, perPage: 25, sort: [ROLE, RELEVANCE, ID]) {
        edges {
          role
          voiceActors(language: JAPANESE) { id name { full } image { medium } }
        }
      }
    }
  }
`;

interface StudioDnaWorkRaw {
  id: number;
  isAdult: boolean | null;
  studios: { edges: Array<{ isMain: boolean; node: { id: number } | null }> | null } | null;
}

interface StudioDnaStaffEdge {
  role: string | null;
  node: {
    id: number;
    name: { full: string | null } | null;
    image: { medium: string | null } | null;
    primaryOccupations: string[] | null;
  };
}

interface StudioDnaCastEdge {
  role: string | null;
  voiceActors: Array<{
    id: number;
    name: { full: string | null } | null;
    image: { medium: string | null } | null;
  }> | null;
}

interface DnaAccumulator {
  id: number;
  name: string;
  image: string | null;
  works: Record<string, boolean>;
  roles: Record<string, boolean>;
}

/**
 * Series/film directors and their assistants. Episode, sound and department
 * directors are deliberately left out: those credits reappear on nearly every
 * title, so they would drown out the people who shape the studio's works.
 */
const DIRECTOR_ROLES: Record<string, boolean> = {
  director: true,
  'assistant director': true,
  'series director': true,
};

const COMPOSER_ROLES: Record<string, boolean> = {
  music: true,
  composer: true,
  'theme song composition': true,
  'insert song composition': true,
  'music composition': true,
};

function isDirectorRole(role: string): boolean {
  return DIRECTOR_ROLES[role.toLowerCase()] === true;
}

function isComposerRole(role: string): boolean {
  return COMPOSER_ROLES[role.toLowerCase()] === true;
}

function personName(name: { full: string | null } | null): string {
  return name && name.full ? name.full.trim() : '';
}

function addCredit(
  people: Record<string, DnaAccumulator>,
  person: { id: number; name: { full: string | null } | null; image: { medium: string | null } | null },
  workId: number,
  role: string
): void {
  const name = personName(person.name);
  if (!name) {
    return;
  }
  const key = String(person.id);
  let entry = people[key];
  if (!entry) {
    entry = {
      id: person.id,
      name: name,
      image: person.image ? person.image.medium : null,
      works: {},
      roles: {},
    };
    people[key] = entry;
  }
  entry.works[String(workId)] = true;
  if (role) {
    entry.roles[role] = true;
  }
}

function toPeople(
  people: Record<string, DnaAccumulator>,
  kind: StudioDnaKind,
  limit: number
): StudioDnaPerson[] {
  const all: StudioDnaPerson[] = [];
  const keys = Object.keys(people);
  for (let index = 0; index < keys.length; index += 1) {
    const entry = people[keys[index]];
    const works = Object.keys(entry.works).length;
    if (works < 2) {
      continue;
    }
    all.push({
      id: entry.id,
      name: entry.name,
      image: entry.image,
      works: works,
      roles: Object.keys(entry.roles),
      kind: kind,
    });
  }
  all.sort((left, right) => {
    if (left.works !== right.works) {
      return right.works - left.works;
    }
    return left.name.toLowerCase() < right.name.toLowerCase() ? -1 : 1;
  });
  return all.slice(0, limit);
}

async function loadStudioDnaWorks(studioId: number): Promise<number[]> {
  const data = await request<{ Studio: { media: { nodes: StudioDnaWorkRaw[] } | null } | null }>(
    STUDIO_DNA_WORKS_QUERY,
    { id: studioId }
  );
  if (!data.Studio || !data.Studio.media) {
    return [];
  }
  const nodes = data.Studio.media.nodes;
  const ids: number[] = [];
  // AniList repeats a node for some studio credit lists; one sample per title.
  const seen: Record<string, boolean> = {};
  for (let index = 0; index < nodes.length && ids.length < STUDIO_DNA_SAMPLE; index += 1) {
    const node = nodes[index];
    if (node.isAdult || seen[String(node.id)]) {
      continue;
    }
    const edges = node.studios ? node.studios.edges : null;
    let main = false;
    if (edges) {
      for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
        const edge = edges[edgeIndex];
        if (edge.node && edge.node.id === studioId && edge.isMain) {
          main = true;
          break;
        }
      }
    }
    if (main) {
      seen[String(node.id)] = true;
      ids.push(node.id);
    }
  }
  return ids;
}

async function loadStudioDnaCrew(
  ids: number[]
): Promise<{ directors: StudioDnaPerson[]; composers: StudioDnaPerson[] }> {
  const directors: Record<string, DnaAccumulator> = {};
  const composers: Record<string, DnaAccumulator> = {};
  if (ids.length === 0) {
    return { directors: toPeople(directors, 'director', 6), composers: toPeople(composers, 'composer', 4) };
  }

  const data = await request<{
    Page: { media: Array<{ id: number; staff: { edges: StudioDnaStaffEdge[] } | null }> } | null;
  }>(STUDIO_DNA_STAFF_QUERY, { ids: ids });
  if (!data.Page) {
    return { directors: [], composers: [] };
  }

  for (let index = 0; index < data.Page.media.length; index += 1) {
    const media = data.Page.media[index];
    const edges = media.staff ? media.staff.edges : [];
    for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
      const edge = edges[edgeIndex];
      const role = edge.role ? edge.role.trim() : '';
      if (!role || !edge.node) {
        continue;
      }
      const occupations = edge.node.primaryOccupations || [];
      let voiceActor = false;
      for (let occupationIndex = 0; occupationIndex < occupations.length; occupationIndex += 1) {
        if (occupations[occupationIndex].toLowerCase().indexOf('voice') !== -1) {
          voiceActor = true;
          break;
        }
      }
      if (voiceActor) {
        // Cast is read from characters, where the main roles are known.
        continue;
      }
      if (isDirectorRole(role)) {
        addCredit(directors, edge.node, media.id, role);
      } else if (isComposerRole(role)) {
        addCredit(composers, edge.node, media.id, role);
      }
    }
  }

  return {
    directors: toPeople(directors, 'director', 6),
    composers: toPeople(composers, 'composer', 4),
  };
}

async function loadStudioDnaCast(ids: number[]): Promise<{ cast: StudioDnaPerson[]; works: number }> {
  const cast: Record<string, DnaAccumulator> = {};
  let sampled = 0;
  const sample = ids.slice(0, STUDIO_DNA_CAST_SAMPLE);
  for (let start = 0; start < sample.length; start += STUDIO_DNA_CAST_CHUNK) {
    const chunk = sample.slice(start, start + STUDIO_DNA_CAST_CHUNK);
    const results = await Promise.all(
      chunk.map((mediaId) =>
        siteRequest<{ Media: { characters: { edges: StudioDnaCastEdge[] } | null } | null }>(
          STUDIO_DNA_CAST_QUERY,
          { id: mediaId }
        ).catch((): { Media: null } => ({ Media: null }))
      )
    );
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      if (!result.Media || !result.Media.characters) {
        continue;
      }
      const edges = result.Media.characters.edges;
      const seen: Record<string, boolean> = {};
      let found = 0;
      for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
        const edge = edges[edgeIndex];
        if (!edge.role || edge.role.toUpperCase() !== 'MAIN' || !edge.voiceActors) {
          continue;
        }
        for (let vaIndex = 0; vaIndex < edge.voiceActors.length; vaIndex += 1) {
          const va = edge.voiceActors[vaIndex];
          if (seen[String(va.id)]) {
            continue;
          }
          seen[String(va.id)] = true;
          found += 1;
          addCredit(cast, va, chunk[index], '');
        }
      }
      // AniList nulls `voiceActors` when its rate limit is tight, so a work only
      // counts as sampled when the cast actually came back.
      if (found > 0) {
        sampled += 1;
      }
    }
  }
  return { cast: toPeople(cast, 'cast', 8), works: sampled };
}

async function loadStudioDna(studioId: number): Promise<StudioDna> {
  const ids = await loadStudioDnaWorks(studioId);
  if (ids.length === 0) {
    return { studioId, works: 0, castWorks: 0, directors: [], composers: [], cast: [] };
  }

  let crew: { directors: StudioDnaPerson[]; composers: StudioDnaPerson[] } = { directors: [], composers: [] };
  try {
    crew = await loadStudioDnaCrew(ids);
  } catch (error) {
    // A failed staff batch should not take the cast section down with it.
    crew = { directors: [], composers: [] };
  }

  let cast: { cast: StudioDnaPerson[]; works: number } = { cast: [], works: 0 };
  // AniList only fills `voiceActors` for a signed-in session, so a guest would
  // pay one request per title for a field that always comes back null.
  const viewer = await fetchViewer().catch((): null => null);
  if (viewer) {
    try {
      cast = await loadStudioDnaCast(ids);
    } catch (error) {
      cast = { cast: [], works: 0 };
    }
  }

  return {
    studioId,
    works: ids.length,
    castWorks: cast.works,
    directors: crew.directors,
    composers: crew.composers,
    cast: cast.cast,
  };
}

/** Recurring directors, composers and Japanese cast across a studio's top works. */
export function fetchStudioDna(studioId: number): Promise<StudioDna> {
  return memoryCached(STUDIO_DNA_PREFIX + studioId, STUDIO_DNA_TTL, () => loadStudioDna(studioId));
}

/*
 * List mutations make every cached view stale. The planning collection is
 * dropped entirely; quick states are dropped per media so the rest of a grid
 * stays cached. Deletes only know the entry id, so they drop all quick states.
 */
function invalidatePlanning(): void {
  memoryDeletePrefix(PLANNED_CACHE_PREFIX);
  memoryDeletePrefix(BACKLOG_PREFIX);
  memoryDeletePrefix(CALENDAR_PREFIX);
  memoryDeletePrefix(CONTINUE_PREFIX);
  memoryDeletePrefix(TRIAGE_PREFIX);
  memoryDeletePrefix(FRANCHISE_PREFIX);
}

function invalidateQuickMedia(mediaId: number): void {
  const suffix = ':' + mediaId;
  memoryDeleteWhere((key) => key.indexOf(QUICK_CACHE_PREFIX) === 0 && key.slice(-suffix.length) === suffix);
}
