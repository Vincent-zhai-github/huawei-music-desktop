import { MUSIC_ENDPOINT, musicHeaders, ProviderError } from './auth.mjs';
import { qualityCodeOf } from './shared/qualities.mjs';
import { fetch as httpFetch } from 'undici';

const asId = (value, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error(`${label}无效`);
  return value.trim();
};

// Read-only operations independently implemented from observed public H5 call shapes.
// Write operations use the same observed shapes but never auto-retry: a timeout may still
// have applied server-side, so callers must read back before repeating anything.
export class MusicClient {
  #session;
  #fetch;
  /** @param {{session?: any, fetchImpl?: typeof fetch}} options */
  constructor({session=null, fetchImpl=httpFetch}={}) {this.#session=session;this.#fetch=fetchImpl;}

  async #request(path, params, {method='POST', authenticated=false, retry=true, stage='音乐只读请求'}={}) {
    if(authenticated && !this.#session?.token) throw new Error('此操作需要音乐会话');
    const url=new URL(path,MUSIC_ENDPOINT);
    if(method==='GET')for(const [key,value]of Object.entries(params))url.searchParams.set(key,String(value));
    let response;
    const attempts = retry ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        response=await this.#fetch(url,{method,headers:musicHeaders(authenticated ? this.#session.token : null),
          ...(method==='POST'?{body:JSON.stringify(params)}:{}),signal:AbortSignal.timeout(25_000),redirect:'error'});
        break;
      } catch {
        if (attempt === attempts - 1) throw new Error(retry ? '音乐只读请求网络失败' : `${stage}网络失败`);
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
    let data;try {data=await response.json();}catch {throw new ProviderError(stage,response.status);}
    if(!response.ok || data.result?.resultCode!=='000000')throw new ProviderError(stage,response.status,data);
    return data;
  }
  search(query,{start=0,limit=20}={}) {
    if(typeof query!=='string'||!query.trim())throw new Error('搜索词不能为空');
    return this.#request('/music-search-service/v10/service/fuzzysearch',{
      contentType:'1',correct:'1',queryWord:query.trim().slice(0,80),start:String(start),limit:String(limit)});
  }
  publicPlaylist(id,{start=0,limit=20}={}) {
    return this.#request('/music-operation-service/v2/service/musiclist/detail/bymusiclistid',{
      musicListID:asId(id,'歌单 ID'),copyrightSwitch:'1',start,limit:String(limit)});
  }
  favorites({start=0,limit=20,contentTypes=['1']}={}) {
    if(!this.#session?.snsUserID)throw new Error('音乐会话缺少 SNS 用户标识');
    return this.#request('/music-userbehavior-service/v3/service/favorite/simple/all',{
      targetSnsUserID:this.#session.snsUserID,start,limit,contentTypes},{authenticated:true});
  }
  // One call shape discovers songs and every personal playlist type; callers must split by contentType.
  library({start=0,limit=50}={}) {
    return this.favorites({start,limit,contentTypes:['1','4','5','7']});
  }
  playlistDetail(playListID,{start=0,limit=20}={}) {
    if(typeof playListID!=='string'||!playListID.trim())throw new Error('指定歌单详情需要真实 playListID；不是歌单列表接口');
    return this.#request('/music-userbehavior-service/v1/service/playlist/detail/all',{
      start,limit,playListID:playListID.trim()},{method:'GET',authenticated:true});
  }
  recent() {
    return this.#request('/music-userbehavior-service/v1/service/recentlyplayed/query',
      {contentType:'1'},{method:'GET',authenticated:true});
  }
  album(id,{start=0,limit=50}={}) {
    return this.#request('/music-metacontent-service/v1/service/album/detail/byalbumcode',
      {albumCode:asId(id,'专辑 ID'),start,limit},{method:'GET'});
  }
  artist(id,{songNum=20,albumNum=20}={}) {
    return this.#request('/music-metacontent-service/v2/service/artist/detail/byartistcode',
      {artistCode:asId(id,'歌手 ID'),songNum,albumNum});
  }
  favoriteExist(contentID) {
    return this.#request('/music-userbehavior-service/v1/service/favorite/simple/exist',
      {contentType:'1',contentID:asId(contentID,'歌曲 ID')},{method:'GET',authenticated:true});
  }
  setFavorite(contentID, favorite) {
    const action = favorite ? 'create' : 'delete';
    return this.#request(`/music-userbehavior-service/v1/service/favorite/${action}`,
      {contentType:'1',contentID:asId(contentID,'歌曲 ID')},
      {authenticated:true,retry:false,stage:'收藏操作'});
  }
  createPlaylist({name,songCodes,createTime}={}) {
    if(typeof name!=='string'||!name.trim()||name.trim().length>60)throw new Error('歌单名称需为 1-60 个字符');
    const codes=(Array.isArray(songCodes)?songCodes:[]).map(code=>asId(code,'歌曲 ID'));
    if(!codes.length)throw new Error('首版创建歌单至少需要一首歌曲');
    if(codes.length>200)throw new Error('一次创建的歌曲过多');
    if(typeof createTime!=='string'||!/^\d{14}$/.test(createTime))throw new Error('创建时间需要 UTC yyyyMMddHHmmss');
    return this.#request('/music-userbehavior-service/v1/service/playlist/create',
      {createTime,playListName:name.trim(),songCodes:codes,shareFlag:'0'},
      {authenticated:true,retry:false,stage:'创建歌单'});
  }
  updatePlaylistDescription(id, description) {
    if(typeof description!=='string'||description.length>200)throw new Error('简介不能超过 200 个字符');
    return this.#request('/music-userbehavior-service/v1/service/playlist/update',
      {actionType:'1',listDesc:description,playListID:asId(id,'歌单 ID')},
      {authenticated:true,retry:false,stage:'修改歌单简介'});
  }
  deletePlaylist(id) {
    return this.#request('/music-userbehavior-service/v1/service/playlist/delete',
      {playListID:asId(id,'歌单 ID')},
      {authenticated:true,retry:false,stage:'删除歌单'});
  }
  // Observed H5 shape: one wrapper object with a createRecentPlayInfos array. The H5 client sends
  // its own playback position and the client must never invent a larger duration than really heard.
  createRecentPlay(infos) {
    const list = Array.isArray(infos) ? infos : [];
    if (!list.length || list.length > 20) throw new Error('播放历史上报需要 1-20 条记录');
    for (const entry of list) {
      if (typeof entry?.contentCode !== 'string' || !entry.contentCode.trim()) throw new Error('播放历史上报缺少歌曲 ID');
      if (typeof entry?.contentType !== 'string' || !entry.contentType) throw new Error('播放历史上报缺少内容类型');
      if (!Number.isFinite(entry?.duration) || entry.duration < 0 || entry.duration > 24 * 3600) throw new Error('播放时长无效');
      if (typeof entry?.createTime !== 'string' || !/^\d{14}$/.test(entry.createTime)) throw new Error('上报时间需要 UTC yyyyMMddHHmmss');
    }
    return this.#request('/music-userbehavior-service/v1/service/recentlyplayed/create',
      { createRecentPlayInfos: list }, { authenticated: true, retry: false, stage: '播放历史上报' });
  }
  resolvePlayback(trackId, quality='standard') {
    if (typeof trackId !== 'string' || !trackId.trim()) throw new Error('播放需要真实歌曲 ID');
    const qualityType = qualityCodeOf(quality);
    if (!qualityType) throw new Error('不支持的音质');
    return this.#request('/music-play-service/v3/service/file/bycontentcode', {
      contentCode: trackId, contentType: '1', qualityType,
    }, { authenticated: true });
  }
}
