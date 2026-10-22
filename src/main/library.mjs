// Pure response normalizers shared by the main process. No network or Electron access.
import { isSafeResourceUrl } from '../safe-media-url.mjs';
const text = value => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
const numeric = value => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};
const list = value => (Array.isArray(value) ? value : []);

function artistsFrom(value) {
  const pairs = list(value?.artistNamePairs);
  const artists = pairs
    .map(artist => ({ id: text(artist?.artistID ?? artist?.id), name: text(artist?.artistName ?? artist?.name) }))
    .filter(artist => !!artist.name);
  if (!artists.length) {
    const fallback = text(value?.artistName) ?? text(value?.singerName);
    const ids = list(value?.artistID).filter(item => typeof item === 'string' && item);
    if (fallback) artists.push(ids.length === 1 ? { id: ids[0], name: fallback } : { name: fallback });
  }
  return artists;
}

function coverFrom(value) {
  const picture = value?.picture ?? {};
  return [picture.bigImgURL, picture.middleImgURL, picture.smallImgURL, value?.coverUrl, value?.cover]
    .map(text).find(url => url && isSafeResourceUrl(url));
}

export function trackFrom(value) {
  const id = text(value?.contentID ?? value?.contentId ?? value?.songCode);
  const title = text(value?.contentName ?? value?.songName);
  if (!id || !title) return null;
  const albumId = text(value?.albumID ?? value?.albumId ?? value?.albumNamePair?.id ?? value?.albumNamePair?.albumID);
  const albumTitle = text(value?.albumName ?? value?.albumNamePair?.name ?? value?.albumNamePair?.albumName);
  return {
    id,
    title,
    artists: artistsFrom(value),
    album: albumId && albumTitle ? { id: albumId, title: albumTitle } : undefined,
    coverUrl: coverFrom(value),
    durationSeconds: numeric(value?.duration),
    // The API marks unlicensed/delisted songs with a non-"1" status; some responses omit the
    // field entirely, so only an explicit non-"1" value marks a track unavailable.
    available: value?.status === undefined || value?.status === null ? true : String(value.status) === '1',
  };
}

export function tracksFrom(items) {
  return list(items).map(trackFrom).filter(track => !!track);
}

const PLAYLIST_KINDS = { '4': 'collected', '5': 'owned', '7': 'chart' };
export const SONG_CONTENT_TYPE = '1';

export function contentTypeOf(value) {
  const raw = value?.contentType;
  return raw === undefined || raw === null ? undefined : String(raw);
}

export function playlistFrom(value) {
  const id = text(value?.contentID ?? value?.contentId ?? value?.musicListID);
  const title = text(value?.contentName ?? value?.name);
  if (!id || !title) return null;
  const type = contentTypeOf(value);
  return {
    id,
    title,
    coverUrl: coverFrom(value),
    count: numeric(value?.totalCount ?? value?.songCount ?? value?.count),
    kind: PLAYLIST_KINDS[type] ?? 'unknown',
    description: typeof (value?.listDesc ?? value?.description) === 'string' ? (value.listDesc ?? value.description) : undefined,
  };
}

// The discovery call mixes songs and every playlist type in one paged list.
export function playlistsFromLibraryEntries(entries) {
  const seen = new Set();
  return list(entries)
    .filter(entry => {
      if (contentTypeOf(entry) === SONG_CONTENT_TYPE) return false;
      const key = `${contentTypeOf(entry)}:${entry?.contentID ?? entry?.contentId ?? entry?.musicListID}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(playlistFrom)
    .filter(playlist => !!playlist);
}

export function tracksFromPlaylistDetail(response) {
  const detail = response?.playListInfoEx ?? {};
  const playlist = playlistFrom({ ...detail.playListInfo, contentType: '5' });
  const tracks = tracksFrom(detail.playListSongInfoList);
  const itemCount = list(detail.playListSongInfoList).length;
  return { playlist, tracks, itemCount };
}

export function tracksFromPublicPlaylist(response) {
  const detail = response?.musicListInfoEx ?? {};
  const playlist = playlistFrom({ ...detail.musicListDetail, contentType: contentTypeOf(detail.musicListDetail) ?? '4' });
  const songs = list(detail.songSimpleInfos);
  return { playlist, tracks: tracksFrom(songs), itemCount: songs.length };
}

export function searchPageFrom(response) {
  const songs = list(response?.songSimpleInfos);
  const total = numeric(response?.totalNum);
  const hasNext = String(response?.hasNextPage ?? '') === '1';
  return { tracks: tracksFrom(songs), itemCount: songs.length, total, hasNext };
}

export function historyFrom(response) {
  return tracksFrom(response?.contentSimpleInfos);
}

export function albumFrom(response) {
  const detail = response?.albumInfoEx ?? {};
  const songs = list(detail.songSimpleInfos);
  const info = detail.albumInfo ?? {};
  return {
    album: {
      id: text(info.albumCode ?? info.albumID) ?? '',
      title: text(info.albumName) ?? '',
      coverUrl: coverFrom(info),
      count: numeric(info.songCount ?? info.totalCount),
      artists: artistsFrom({ artistName: text(info.artistName) }),
    },
    tracks: tracksFrom(songs),
    itemCount: songs.length,
  };
}

export function artistFrom(response) {
  const detail = response?.artistInfoEx ?? {};
  const info = detail.artistInfo ?? {};
  const albums = list(detail.albumSimpleInfos).map(entry => ({
    id: text(entry?.albumCode ?? entry?.albumID) ?? '',
    title: text(entry?.albumName) ?? '',
    coverUrl: coverFrom(entry),
    count: numeric(entry?.songCount),
  })).filter(album => !!album.id && !!album.title);
  return {
    artist: {
      id: text(info.artistCode ?? info.artistID) ?? '',
      name: text(info.artistName) ?? '',
      coverUrl: coverFrom(info),
    },
    tracks: tracksFrom(detail.songSimpleInfos),
    albums,
  };
}
