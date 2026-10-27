import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const port = Number(process.argv[2] || 4173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

// Minimal stand-in for the AniList site endpoints used by quick actions, so the
// signed-in flow (status menu, editor, removal) can be exercised locally.
const entries = new Map();
const quickMedia = new Map();
// List statuses written by the triage view, keyed by list-entry id, so the
// mocked planning list reacts to a bulk action like AniList would.
const listMoves = new Map();
// The franchise mock needs a library: the seasons watched or in progress and one
// still in plans.
entries.set(16498, { id: 16498, status: 'COMPLETED', score: 0, progress: 25 });
entries.set(20958, { id: 20958, status: 'COMPLETED', score: 0, progress: 12 });
entries.set(99147, { id: 99147, status: 'CURRENT', score: 0, progress: 10 });
entries.set(110277, { id: 110277, status: 'PLANNING', score: 0, progress: 0 });
let signedOut = false;
// Public progress data comes from the real API, so the mocked session can claim
// to be a real AniList profile to exercise "you vs friends" deltas.
let viewerName = 'Harness';

function mockQuickNodes(ids) {
  return ids.map((id, index) => {
    if (!quickMedia.has(id)) {
      quickMedia.set(id, {
        id: id,
        trailer: index % 2 === 0 ? { id: 'dQw4w9WgXcQ', site: 'youtube' } : null,
        nextAiringEpisode: index % 3 === 0 ? { episode: 5, timeUntilAiring: 86400 * 3 + 7200 } : null,
      });
    }
    const base = quickMedia.get(id);
    return {
      id: base.id,
      trailer: base.trailer,
      nextAiringEpisode: base.nextAiringEpisode,
      mediaListEntry: entries.get(id) || null,
    };
  });
}

const server = http.createServer(async (request, response) => {
  const urlPath = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname);

  if (urlPath === '/__state') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({ entries: Array.from(entries.values()), signedOut: signedOut, viewerName: viewerName })
    );
    return;
  }

  if (urlPath === '/__viewer') {
    const params = new URL(request.url || '/', 'http://localhost').searchParams;
    viewerName = params.get('name') || 'Harness';
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ viewerName: viewerName }));
    return;
  }

  if (urlPath === '/__signout' || urlPath === '/__signin') {
    signedOut = urlPath === '/__signout';
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ signedOut: signedOut }));
    return;
  }

  if (urlPath === '/graphql' && request.method === 'POST') {
    let raw = '';
    for await (const chunk of request) {
      raw += chunk;
    }
    const payload = JSON.parse(raw || '{}');
    const query = String(payload.query || '');
    const variables = payload.variables || {};
    let data = null;
    if (query.includes('ViewerInfo')) {
      data = {
        Viewer: signedOut
          ? null
          : { id: 1, name: viewerName, mediaListOptions: { scoreFormat: 'POINT_100' } },
      };
    } else if (query.includes('QuickStates')) {
      data = { Page: { media: mockQuickNodes(variables.ids || []) } };
    } else if (query.includes('StudioDnaCast')) {
      // Cast only comes back for a signed-in visitor; rotate the pool per title
      // so some actors recur often and others appear in a single work.
      const cast = [
        'Kana Hanazawa',
        'Tomokazu Sugita',
        'Aoi Yuuki',
        'Mamoru Miyano',
        'Yuki Kaji',
        'Saori Hayami',
      ];
      const offset = Number(variables.id || 0) % cast.length;
      const edges = [];
      for (let index = 0; index < 3; index += 1) {
        const slot = (offset + index) % cast.length;
        edges.push({
          role: 'MAIN',
          voiceActors: [{ id: 7100 + slot, name: { full: cast[slot] }, image: { medium: null } }],
        });
      }
      data = { Media: { characters: { edges: edges } } };
    } else if (query.includes('PlannedUpcoming')) {
      const now = Math.floor(Date.now() / 1000);
      const entry = (id, romaji, episode, seconds) => ({
        media: {
          id: id,
          title: { romaji: romaji, english: null, native: null },
          coverImage: { large: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/18227.jpg', extraLarge: null },
          nextAiringEpisode: seconds === null ? null : { episode: episode, airingAt: now + seconds },
        },
      });
      data = {
        MediaListCollection: {
          lists: [
            {
              entries: [
                entry(9002, 'Second Premiere', 1, 86400 * 10),
                entry(9001, 'First Premiere', 1, 86400 * 3),
                entry(9005, 'Hitori Tsuma', 1, 86400 * 7),
                entry(9003, 'Already Airing', 3, 86400 * 2),
                entry(9004, 'No Schedule', 1, null),
              ],
            },
          ],
        },
      };
    } else if (query.includes('BacklogTriageLists')) {
      // Planning entries chosen to exercise all three triage signals: six-year
      // and four-year old plans, two two-title franchises (FMA/FMA:B and
      // AoT S2/S3) and a sequel whose prequel (16498) sits in Dropped.
      const now = Math.floor(Date.now() / 1000);
      const years = 365 * 24 * 3600;
      const entry = (mediaId, romaji, cover, episodes, createdYears, touchedYears, status) => ({
        id: mediaId,
        status: listMoves.get(String(mediaId)) || status || 'PLANNING',
        createdAt: Math.floor(now - createdYears * years),
        updatedAt: Math.floor(now - touchedYears * years),
        media: {
          id: mediaId,
          title: { romaji: romaji, english: null, native: null },
          coverImage: { large: cover },
          format: 'TV',
          episodes: episodes,
        },
      });
      data = {
        MediaListCollection: {
          lists: [
            {
              entries: [
                entry(16498, 'Shingeki no Kyojin', null, 25, 7, 6, 'DROPPED'),
                entry(5114, 'Hagane no Renkinjutsushi: FULLMETAL ALCHEMIST', null, 64, 6, 6),
                entry(121, 'Hagane no Renkinjutsushi', null, 51, 7, 5),
                entry(20958, 'Shingeki no Kyojin Season 2', null, 12, 4, 3),
                entry(99147, 'Shingeki no Kyojin Season 3', null, 22, 3, 3),
                entry(101348, 'VINLAND SAGA', null, 24, 3, 3),
                entry(101921, 'Kaguya-sama wa Kokurasetai', null, 12, 4, 4),
                entry(21, 'ONE PIECE', null, null, 3, 2),
                entry(9253, 'STEINS;GATE', null, 24, 2, 0.1),
              ],
            },
          ],
        },
      };
    } else if (query.includes('BacklogRelations')) {
      const relations = {
        5114: [{ relationType: 'PREQUEL', node: { id: 121 } }],
        121: [{ relationType: 'SEQUEL', node: { id: 5114 } }],
        20958: [{ relationType: 'PREQUEL', node: { id: 16498 } }],
        99147: [{ relationType: 'PREQUEL', node: { id: 20958 } }],
      };
      data = {};
      const pattern = /m(\d+): Media\(id: (\d+)\)/g;
      let match = pattern.exec(query);
      while (match) {
        const key = 'm' + match[1];
        const mediaId = Number(match[2]);
        data[key] = { relations: { edges: relations[mediaId] || [] } };
        match = pattern.exec(query);
      }
    } else if (query.includes('FranchiseTree')) {
      // Attack on Titan: four seasons in a PREQUEL/SEQUEL chain with different
      // list states, plus two OVAs hanging off it as side stories.
      const cover = 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx16498-C6FPmWm59CyP.jpg';
      const franchise = {
        16498: {
          romaji: 'Shingeki no Kyojin',
          episodes: 25,
          format: 'TV',
          status: 'FINISHED',
          seasonYear: 2013,
          startDate: { year: 2013, month: 4, day: 7 },
          nextAiringEpisode: null,
          relations: [
            { relationType: 'SEQUEL', node: { id: 20958 } },
            { relationType: 'SIDE_STORY', node: { id: 18397 } },
          ],
        },
        20958: {
          romaji: 'Shingeki no Kyojin Season 2',
          episodes: 12,
          format: 'TV',
          status: 'FINISHED',
          seasonYear: 2017,
          startDate: { year: 2017, month: 4, day: 1 },
          nextAiringEpisode: null,
          relations: [
            { relationType: 'PREQUEL', node: { id: 16498 } },
            { relationType: 'SEQUEL', node: { id: 99147 } },
            { relationType: 'SIDE_STORY', node: { id: 104578 } },
          ],
        },
        99147: {
          romaji: 'Shingeki no Kyojin Season 3',
          episodes: 24,
          format: 'TV',
          status: 'FINISHED',
          seasonYear: 2018,
          startDate: { year: 2018, month: 7, day: 23 },
          nextAiringEpisode: null,
          relations: [
            { relationType: 'PREQUEL', node: { id: 20958 } },
            { relationType: 'SEQUEL', node: { id: 110277 } },
          ],
        },
        110277: {
          romaji: 'Shingeki no Kyojin Season 3 Part 2',
          episodes: 10,
          format: 'TV',
          status: 'FINISHED',
          seasonYear: 2019,
          startDate: { year: 2019, month: 4, day: 29 },
          nextAiringEpisode: null,
          relations: [{ relationType: 'PREQUEL', node: { id: 99147 } }],
        },
        18397: {
          romaji: 'Shingeki no Kyojin: Kuinaki Sentaku',
          episodes: 2,
          format: 'OVA',
          status: 'FINISHED',
          seasonYear: 2014,
          startDate: { year: 2014, month: 12, day: 9 },
          nextAiringEpisode: null,
          relations: [{ relationType: 'SIDE_STORY', node: { id: 16498 } }],
        },
        104578: {
          romaji: 'Shingeki no Kyojin: Lost Girls',
          episodes: 3,
          format: 'OVA',
          status: 'FINISHED',
          seasonYear: 2017,
          startDate: { year: 2017, month: 12, day: 8 },
          nextAiringEpisode: null,
          relations: [{ relationType: 'SIDE_STORY', node: { id: 20958 } }],
        },
      };
      data = {};
      const pattern = /m(\d+): Media\(id: (\d+)/g;
      let match = pattern.exec(query);
      while (match) {
        const key = 'm' + match[1];
        const item = franchise[Number(match[2])];
        data[key] = item
          ? {
              id: Number(match[2]),
              title: { romaji: item.romaji, english: null, native: null },
              coverImage: { large: cover },
              format: item.format,
              episodes: item.episodes,
              duration: 24,
              status: item.status,
              seasonYear: item.seasonYear,
              startDate: item.startDate,
              nextAiringEpisode: item.nextAiringEpisode,
              relations: { edges: item.relations },
              mediaListEntry: signedOut ? null : entries.get(Number(match[2])) || null,
            }
          : null;
        match = pattern.exec(query);
      }
    } else if (query.includes('ContinueWatching')) {
      // One Piece is far behind, Vinland Saga has half its episodes left, one
      // airing title is caught up (and its next episode airs 20s after load, so
      // the rail's tick turns it into "1 behind"), two finished titles are done.
      const now = Math.floor(Date.now() / 1000);
      const entry = (id, romaji, cover, progress, episodes, next) => ({
        progress: progress,
        media: {
          id: id,
          title: { romaji: romaji, english: null, native: null },
          coverImage: { large: cover },
          episodes: episodes,
          nextAiringEpisode: next,
        },
      });
      data = {
        MediaListCollection: {
          lists: [
            {
              entries: [
                entry(
                  21,
                  'ONE PIECE',
                  'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx21-ELSYx3yMPcKM.jpg',
                  1100,
                  null,
                  { episode: 1181, airingAt: now + 3 * 3600 }
                ),
                entry(
                  101348,
                  'VINLAND SAGA',
                  'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx101348-2fhDFPCuMNiz.jpg',
                  12,
                  24,
                  null
                ),
                entry(206949, 'Kyouran Reijou Nia Liston', null, 3, 12, { episode: 4, airingAt: now + 20 }),
                entry(101921, 'Kaguya-sama wa Kokurasetai', null, 12, 12, null),
                entry(16498, 'Shingeki no Kyojin', null, 25, 25, null),
              ],
            },
          ],
        },
      };
    } else if (query.includes('CalendarLists')) {
      const entry = (id, romaji, status) => ({
        status: status,
        media: {
          id: id,
          title: { romaji: romaji, english: null, native: null },
          coverImage: { large: null },
        },
      });
      data = {
        MediaListCollection: {
          lists: [
            {
              entries: [
                entry(21, 'ONE PIECE', 'CURRENT'),
                entry(206949, 'Kyouran Reijou Nia Liston', 'CURRENT'),
                entry(101348, 'VINLAND SAGA', 'PLANNING'),
                entry(116589, '86: Eighty Six', 'PLANNING'),
              ],
            },
          ],
        },
      };
    } else if (query.includes('AiringRange')) {
      // A week of episodes starting a couple of hours from now. The range in
      // the query is deliberately ignored so the client-side month filter and
      // the month navigation are exercised.
      const now = Math.floor(Date.now() / 1000);
      data = {
        Page: {
          pageInfo: { hasNextPage: false },
          airingSchedules: [
            { episode: 1181, airingAt: now + 3 * 3600, media: { id: 21 } },
            { episode: 4, airingAt: now + 27 * 3600, media: { id: 206949 } },
            { episode: 1, airingAt: now + 51 * 3600, media: { id: 101348 } },
            { episode: 1, airingAt: now + 99 * 3600, media: { id: 116589 } },
            { episode: 1182, airingAt: now + 171 * 3600, media: { id: 21 } },
          ],
        },
      };
    } else if (query.includes('BacklogLists')) {
      // Seeds and plans used by the home "Next from your plans" block. The
      // recommendation edges are real, and the plan deliberately holds six
      // titles Attack on Titan recommends: before the per-reason cap that one
      // seed filled almost every card.
      const entry = (id, romaji, status, score) => ({
        status: status,
        score: score,
        media: { id: id, title: { romaji: romaji, english: null, native: null } },
      });
      data = {
        MediaListCollection: {
          lists: [
            {
              entries: [
                entry(5114, 'Hagane no Renkinjutsushi: FULLMETAL ALCHEMIST', 'COMPLETED', 95),
                entry(9253, 'STEINS;GATE', 'COMPLETED', 92),
                entry(101921, 'Kaguya-sama wa Kokurasetai', 'COMPLETED', 90),
                entry(16498, 'Shingeki no Kyojin', 'COMPLETED', 88),
                entry(10087, 'Fate/Zero', 'DROPPED', 40),
                entry(101348, 'VINLAND SAGA', 'PLANNING', 0),
                entry(101759, 'Yakusoku no Neverland', 'PLANNING', 0),
                entry(116589, '86: Eighty Six', 'PLANNING', 0),
                entry(21196, 'Koutetsujou no Kabaneri', 'PLANNING', 0),
                entry(20829, 'Owari no Seraph', 'PLANNING', 0),
                entry(153288, 'Kaijuu 8-gou', 'PLANNING', 0),
                entry(21234, 'Boku dake ga Inai Machi', 'PLANNING', 0),
                entry(21355, 'Re:Zero kara Hajimeru Isekai Seikatsu', 'PLANNING', 0),
                entry(129201, 'Summer Time Render', 'PLANNING', 0),
                entry(124080, 'Horimiya', 'PLANNING', 0),
                entry(4224, 'Toradora!', 'PLANNING', 0),
                entry(21, 'ONE PIECE', 'PLANNING', 0),
                entry(457, 'Mushishi', 'PLANNING', 0),
                entry(97986, 'Made in Abyss', 'PLANNING', 0),
              ],
            },
          ],
        },
      };
    } else if (query.includes('SaveEntry')) {
      let mediaId = variables.mediaId;
      if (variables.id) {
        for (const [key, entry] of entries.entries()) {
          if (entry.id === variables.id) {
            mediaId = key;
          }
        }
        // Triage edits an entry by its list id without a media id; keep those
        // saves addressable instead of piling them onto one undefined key.
        if (mediaId === undefined) {
          mediaId = 'entry:' + variables.id;
        }
        listMoves.set(String(variables.id), variables.status || 'CURRENT');
      }
      const existing = entries.get(mediaId) || { id: mediaId, status: 'CURRENT', score: 0, progress: 0 };
      if (variables.status) {
        existing.status = variables.status;
      }
      if (typeof variables.scoreRaw === 'number') {
        existing.score = variables.scoreRaw;
      }
      if (typeof variables.progress === 'number') {
        existing.progress = variables.progress;
      }
      entries.set(mediaId, existing);
      data = { SaveMediaListEntry: existing };
    } else if (query.includes('RemoveEntry')) {
      for (const [mediaId, entry] of entries.entries()) {
        if (entry.id === variables.id) {
          entries.delete(mediaId);
        }
      }
      data = { DeleteMediaListEntry: { deleted: true } };
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ data: data }));
    return;
  }
  const filePath = path.resolve(root, '.' + urlPath);
  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }
  try {
    const data = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': types[path.extname(filePath)] || 'application/octet-stream',
      // Rebuilds must show up on reload; otherwise Chromium keeps an old bundle.
      'Cache-Control': 'no-store',
    });
    response.end(data);
  } catch (error) {
    const html = await readFile(path.join(root, 'builder/_harness.html'));
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(html);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log('harness listening on http://127.0.0.1:' + port);
});
