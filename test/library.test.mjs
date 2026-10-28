import test from 'node:test';
import assert from 'node:assert/strict';
import {
  trackFrom,
  tracksFrom,
  playlistFrom,
  playlistsFromLibraryEntries,
  tracksFromPlaylistDetail,
  tracksFromPublicPlaylist,
  searchPageFrom,
  historyFrom,
  albumFrom,
  artistFrom,
} from '../src/main/library.mjs';

test('track normalization keeps arrays, falls back to a single name and drops unusable rows', () => {
  assert.deepEqual(trackFrom({ contentID: '1', contentName: '歌', artistNamePairs: [
    { artistID: 'a1', artistName: '甲' }, { artistID: 'a2', artistName: '乙' },
  ], albumID: 'al', albumName: '专辑', duration: '203', picture: { middleImgURL: 'https://x.dbankcdn.cn/c.jpg' } }), {
    id: '1', title: '歌', artists: [{ id: 'a1', name: '甲' }, { id: 'a2', name: '乙' }],
    album: { id: 'al', title: '专辑' }, coverUrl: 'https://x.dbankcdn.cn/c.jpg', durationSeconds: 203, available: true,
  });
  assert.deepEqual(trackFrom({ contentID: '2', contentName: '单艺人', artistName: '丙' }).artists, [{ name: '丙' }]);
  assert.equal(trackFrom({ contentName: '缺少 ID' }), null);
  assert.equal(trackFrom({ contentID: '3' }), null);
  assert.deepEqual(trackFrom({ contentID: '4', contentName: '未知时长', duration: 'n/a' }).durationSeconds, undefined);
  // An explicit non-"1" status marks an unlicensed/delisted song; a missing field keeps it playable.
  assert.equal(trackFrom({ contentID: '5', contentName: '下架', status: '0' }).available, false);
  assert.equal(trackFrom({ contentID: '6', contentName: '无状态字段', status: 2 }).available, false);
  assert.equal(trackFrom({ contentID: '7', contentName: '无状态字段' }).available, true);
  assert.equal(trackFrom({ contentID: '8', contentName: '可用', status: '1' }).available, true);
});

test('trackFrom parses completeFileInfos tiers from the JSON contentExInfo string', () => {
  const ex = {
    completeFileInfos: {
      '1': { format: 'MP3', mediaFileType: 'MP3', fileSize: '4332025', quality: '1' },
      '2': { format: 'MP3', mediaFileType: 'MP3', fileSize: '10807676', quality: '2' },
      '3': { format: 'FLAC', mediaFileType: 'FLAC', fileSize: '31529813', quality: '3' },
      '7': { format: 'FLAC', mediaFileType: 'FLAC', quality: '7' },
      '15': { format: 'MKV', mediaFileType: 'MKV', fileSize: '37253510', quality: '15' },
      '17': { format: 'MKV', mediaFileType: 'MKV', fileSize: '37253510', quality: '17' },
    },
  };
  const track = trackFrom({ contentID: '1092974', contentName: '晴天', contentExInfo: JSON.stringify(ex) });
  // Ultra (7) and the MKV tiers pass the catalog but stay unexposed until playback is verified.
  assert.deepEqual(track.qualities, [
    { quality: 'standard', format: 'MP3', fileSize: 4332025 },
    { quality: 'hq', format: 'MP3', fileSize: 10807676 },
    { quality: 'lossless', format: 'FLAC', fileSize: 31529813 },
  ]);
});

test('trackFrom accepts array-shaped completeFileInfos and tolerates broken payloads', () => {
  const arrayShaped = trackFrom({
    contentID: 'a', contentName: '数组形态',
    contentExInfo: JSON.stringify({ completeFileInfos: [{ quality: '3', format: 'FLAC' }, { quality: '1', format: 'MP3' }] }),
  });
  assert.deepEqual(arrayShaped.qualities, [
    { quality: 'standard', format: 'MP3', fileSize: undefined },
    { quality: 'lossless', format: 'FLAC', fileSize: undefined },
  ]);
  // Broken JSON, missing payload, or only unsupported tiers all yield no qualities key.
  assert.equal('qualities' in trackFrom({ contentID: 'b', contentName: '坏 JSON', contentExInfo: '{oops' }), false);
  assert.equal('qualities' in trackFrom({ contentID: 'c', contentName: '缺失' }), false);
  assert.equal('qualities' in trackFrom({
    contentID: 'd', contentName: '仅 MKV',
    contentExInfo: JSON.stringify({ completeFileInfos: { '15': { format: 'MKV', quality: '15' } } }),
  }), false);
});

test('contentType splits songs from playlist types without losing unknown kinds', () => {
  const entries = [
    { contentID: 'song', contentName: '歌曲', contentType: '1' },
    { contentID: 'owned', contentName: '自建', contentType: '5', totalCount: '5' },
    { contentID: 'collected', contentName: '收藏', contentType: '4' },
    { contentID: 'chart', contentName: '榜单', contentType: 7 },
  ];
  assert.deepEqual(playlistsFromLibraryEntries(entries).map(item => [item.id, item.kind, item.count]), [
    ['owned', 'owned', 5], ['collected', 'collected', undefined], ['chart', 'chart', undefined],
  ]);
  assert.equal(playlistFrom({ contentID: 'x', contentName: 'y', contentType: '99' }).kind, 'unknown');
  assert.equal(playlistFrom({ contentName: '无 ID', contentType: '5' }), null);
});

test('owned playlist detail reads playListInfoEx and reports the raw item count', () => {
  const result = tracksFromPlaylistDetail({ playListInfoEx: {
    playListInfo: { contentID: 'p1', contentName: '我的歌单', totalCount: '5', listDesc: '简介' },
    playListSongInfoList: [{ contentID: 's1', contentName: '歌' }],
  } });
  assert.equal(result.playlist.kind, 'owned');
  assert.equal(result.playlist.description, '简介');
  assert.equal(result.itemCount, 1);
  assert.deepEqual(result.tracks.map(track => track.id), ['s1']);
});

test('public playlist detail reads musicListInfoEx and tolerates a missing body', () => {
  const result = tracksFromPublicPlaylist({ musicListInfoEx: {
    musicListDetail: { contentID: 'm1', contentName: '公开歌单' },
    songSimpleInfos: [{ contentID: 's2', contentName: '歌二' }],
  } });
  assert.equal(result.playlist.kind, 'collected');
  assert.deepEqual(result.tracks.map(track => track.id), ['s2']);
  assert.deepEqual(tracksFromPublicPlaylist({}).tracks, []);
  assert.equal(tracksFromPublicPlaylist({}).playlist, null);
});

test('search page exposes total and next page evidence', () => {
  const page = searchPageFrom({ totalNum: '57', hasNextPage: '1', songSimpleInfos: [{ contentID: 'a', contentName: 'a' }] });
  assert.equal(page.total, 57);
  assert.equal(page.hasNext, true);
  assert.equal(page.itemCount, 1);
  const last = searchPageFrom({ totalNum: 1, hasNextPage: '0', songSimpleInfos: [{ contentID: 'a', contentName: 'a' }] });
  assert.equal(last.hasNext, false);
  assert.deepEqual(searchPageFrom({}).tracks, []);
});

test('history, album and artist responses normalize without inventing values', () => {
  assert.deepEqual(historyFrom({ contentSimpleInfos: [{ contentID: 'h', contentName: '历史' }] }).map(t => t.id), ['h']);
  const album = albumFrom({ albumInfoEx: { albumInfo: { albumCode: 'al', albumName: '专辑', artistName: '歌手' }, songSimpleInfos: [{ contentID: 's', contentName: 's' }] } });
  assert.equal(album.album.id, 'al');
  assert.deepEqual(album.album.artists, [{ name: '歌手' }]);
  assert.equal(album.itemCount, 1);
  const artist = artistFrom({ artistInfoEx: {
    artistInfo: { artistCode: 'ar', artistName: '歌手' },
    songSimpleInfos: [{ contentID: 's', contentName: 's' }],
    albumSimpleInfos: [{ albumCode: 'al', albumName: '专辑' }],
  } });
  assert.equal(artist.artist.id, 'ar');
  assert.deepEqual(artist.albums.map(a => a.id), ['al']);
  assert.deepEqual(artist.albums[0], { id: 'al', title: '专辑', coverUrl: undefined, count: undefined });
});

test('unknown numeric fields stay unknown and resource URLs are allowlisted', () => {
  for (const duration of ['', null, undefined, true, 'NaN']) {
    assert.equal(trackFrom({ contentID: 's', contentName: 's', duration }).durationSeconds, undefined);
  }
  assert.equal(trackFrom({ contentID: 's', contentName: 's', coverUrl: 'http://127.0.0.1/private' }).coverUrl, undefined);
  assert.equal(trackFrom({ contentID: 's', contentName: 's', artistName: 'One', artistID: ['ar'] }).artists[0].id, 'ar');
  assert.equal(playlistsFromLibraryEntries([
    { contentID: 'p', contentName: 'p', contentType: '5' },
    { contentID: 'p', contentName: 'p', contentType: '5' },
  ]).length, 1);
});

test('tracksFrom ignores non array payloads instead of throwing', () => {
  assert.deepEqual(tracksFrom(undefined), []);
  assert.deepEqual(tracksFrom({}), []);
});
