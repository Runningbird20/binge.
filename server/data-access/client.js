const { splitDatabaseClient } = require('../../src/utils/mediaDatabase');
const { createCatalogQueryClient } = require('../../src/utils/catalogQuery');
const { executeQuery } = require('./query');
const catalogSearch = require('../catalogSearch');

// Popular searches repeat a lot; the catalog only changes with the twice-weekly
// sync, so results are kept per instance for a while. Keyed like
// searchNorm normalizes (case, accents, punctuation), so "Amélie" and
// "amelie" share an entry. Oldest entries go first once full.
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const SEARCH_CACHE_MAX = 500;
const searchCache = new Map();
const searchKey = (q, lim) => `${lim}|${q.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}`;

// search_related: search's description matches (catalogRelated.js), cached
// like searches.
const relatedCache = new Map();
async function searchRelatedRpc(args) {
  if(Object.keys(args).some(k=>!['q','types'].includes(k)))throw new Error('Unsupported search argument');
  const types=String(args.types||'movies,tv,books').split(',').map(t=>t.trim()).filter(Boolean);
  const key=`${types.join(',')}|${searchKey(String(args.q||'').slice(0,200),0)}`;
  const hit=relatedCache.get(key);
  if(hit&&Date.now()-hit.at<SEARCH_CACHE_TTL_MS)return {data:hit.rows,error:null};
  const rows=await require('../catalogRelated').searchRelated(args.q,types);
  relatedCache.set(key,{at:Date.now(),rows});
  if(relatedCache.size>SEARCH_CACHE_MAX)relatedCache.delete(relatedCache.keys().next().value);
  return {data:rows,error:null};
}

async function rpc(name,args={}) {
  try {
    if(name==='search_related')return await searchRelatedRpc(args||{});
    if(name!=='search_catalog')throw new Error('Unsupported media function');
    if(Object.keys(args).some(k=>!['q','lim'].includes(k)))throw new Error('Unsupported search argument');
    const q=String(args.q||'').slice(0,200);
    const lim=Math.min(100,Math.max(1,Number(args.lim)||24));
    const key=searchKey(q,lim);
    const hit=searchCache.get(key);
    if(hit&&Date.now()-hit.at<SEARCH_CACHE_TTL_MS){
      searchCache.delete(key);searchCache.set(key,hit); // most recently used last
      return {data:hit.rows,error:null};
    }
    const rows=await catalogSearch.searchCatalog(q,lim);
    searchCache.set(key,{at:Date.now(),rows});
    if(searchCache.size>SEARCH_CACHE_MAX)searchCache.delete(searchCache.keys().next().value);
    return {data:rows,error:null};
  }catch(error){return {data:null,error:{message:error.message,code:error.code||'CATALOG_RPC_ERROR'}};}
}
function dataClient() { return createCatalogQueryClient(spec=>executeQuery(spec,{trusted:true}),rpc); }
function createHybridClient(url,key,options) {
  const raw=require('@supabase/supabase-js').createClient(url,key,options);
  const media=dataClient();
  return splitDatabaseClient(raw,media);
}
module.exports={dataClient,createHybridClient,rpc,searchKey};
