const { splitDatabaseClient } = require('../../src/utils/mediaDatabase');
const { createNeonQueryClient } = require('../../src/utils/neonQuery');
const { executeQuery } = require('./query');
const neonDb = require('../neonDb');

async function rpc(name,args={}) {
  try {
    if(name!=='search_catalog')throw new Error('Unsupported media function');
    if(Object.keys(args).some(k=>!['q','lim'].includes(k)))throw new Error('Unsupported search argument');
    const result=await neonDb.query('SELECT * FROM public.search_catalog($1,$2)',[String(args.q||'').slice(0,200),Math.min(100,Math.max(1,Number(args.lim)||24))]);
    return {data:result.rows,error:null};
  }catch(error){return {data:null,error:{message:error.message,code:error.code||'NEON_RPC_ERROR'}};}
}
function dataClient() { return createNeonQueryClient(spec=>executeQuery(spec,{trusted:true}),rpc); }
function createHybridClient(url,key,options) {
  const raw=require('@supabase/supabase-js').createClient(url,key,options);
  const media=dataClient();
  return splitDatabaseClient(raw,media);
}
module.exports={dataClient,createHybridClient,rpc};
