const { splitDatabaseClient } = require('../../src/utils/mediaDatabase');
const { createNeonQueryClient } = require('../../src/utils/neonQuery');
const { executeQuery } = require('./query');
const neonDb = require('../neonDb');

// Popular searches repeat a lot; the catalog only changes with the twice-weekly
// sync, so results are kept per instance for a while. Keyed like
// search_catalog normalizes (case, accents, punctuation), so "Amélie" and
// "amelie" share an entry. Oldest entries go first once full.
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const SEARCH_CACHE_MAX = 500;
const searchCache = new Map();
const searchKey = (q, lim) => `${lim}|${q.normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}`;

async function rpc(name,args={}) {
  try {
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
    const result=await neonDb.query('SELECT * FROM public.search_catalog($1,$2)',[q,lim]);
    searchCache.set(key,{at:Date.now(),rows:result.rows});
    if(searchCache.size>SEARCH_CACHE_MAX)searchCache.delete(searchCache.keys().next().value);
    return {data:result.rows,error:null};
  }catch(error){return {data:null,error:{message:error.message,code:error.code||'NEON_RPC_ERROR'}};}
}
function dataClient() { return createNeonQueryClient(spec=>executeQuery(spec,{trusted:true}),rpc); }
function createHybridClient(url,key,options) {
  const raw=require('@supabase/supabase-js').createClient(url,key,options);
  const media=dataClient();
  return splitDatabaseClient(raw,media);
}
module.exports={dataClient,createHybridClient,rpc,searchKey};
