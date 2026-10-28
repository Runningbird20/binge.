// Legacy HTTP endpoints retain Supabase as the authoritative user store.
const express=require('express');
const {createClient}=require('@supabase/supabase-js');
const {dataClient}=require('../data-access/client');
const TABLE={movie:'movies',tv_show:'tv_shows',book:'books'};
const RATINGS={movie:{table:'movie_ratings',columns:['acting','writing','originality','pacing','cinematography'],max:[5,5,5,5,5]},tv_show:{table:'tv_show_ratings',columns:['premise','originality','acting','cinematography','writing','pacing','resonance'],max:[5,5,6,5,6,5,6]},book:{table:'book_ratings',columns:['prose','plot','characters','originality','pacing','resonance'],max:[5,5,6,5,5,6]}};
function client(req){return createClient(process.env.SUPABASE_URL||process.env.REACT_APP_SUPABASE_URL,process.env.SUPABASE_PUBLISHABLE_KEY||process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY,{auth:{persistSession:false},global:{headers:{Authorization:req.headers.authorization}}});}
function scope(query,req){query=query.eq('user_id',req.user.id);const profile=req.headers['x-profile-id'];return profile?query.eq('profile_id',profile):query;}
async function read(query){const {data,error}=await query;if(error)throw error;return data;}
async function profileId(req,sb){const supplied=req.headers['x-profile-id'];if(!supplied)return null;const row=await read(sb.from('account_profiles').select('id').eq('id',supplied).eq('account_id',req.user.id).maybeSingle());if(!row)throw Error('Profile does not belong to this account');return supplied;}
async function enrich(rows) {
 const metadata=new Map();
 await Promise.all(Object.entries(TABLE).map(async([type,table])=>{
  const ids=[...new Set(rows.filter(row=>row.media_type===type).map(row=>row.media_id))];
  if(!ids.length)return;
  const {data,error}=await dataClient().from(table).select('id,title,year,genre,'+(type==='book'?'cover_url':'poster_url')).in('id',ids);
  if(error)throw error;
  for(const row of data||[])metadata.set(`${type}:${row.id}`,row);
 }));
 return rows.map(row=>{const media=metadata.get(`${row.media_type}:${row.media_id}`);return {...media,...row,image_url:media?.poster_url||media?.cover_url||null};});
}
function wrap(handler){return async(req,res)=>{try{await handler(req,res,client(req));}catch(error){res.status(400).json({error:error.message});}};}
const watchlist=express.Router();
watchlist.get('/',wrap(async(req,res,sb)=>{let query=scope(sb.from('watchlist').select('*'),req).order('added_at',{ascending:false});if(req.query.media_type)query=query.eq('media_type',req.query.media_type);if(req.query.status)query=query.eq('status',req.query.status);res.json(await enrich(await read(query)));}));
watchlist.post(['/', '/auto-add'],wrap(async(req,res,sb)=>{
 const {media_type,media_id,status='plan_to_watch'}=req.body;if(!TABLE[media_type]||!media_id)throw Error('Valid media_type and media_id required');
 const pid=await profileId(req,sb);let existing=scope(sb.from('watchlist').select('id').eq('media_type',media_type).eq('media_id',media_id),req);if(!pid)existing=existing.is('profile_id',null);
 const found=await read(existing.maybeSingle());
 if(found){if(req.path!=='/auto-add')await read(scope(sb.from('watchlist').update({status}).eq('id',found.id),req));return res.json(req.path==='/auto-add'?{success:true}:{id:found.id});}
 const created=await read(sb.from('watchlist').insert({user_id:req.user.id,profile_id:pid,media_type,media_id,status}).select('id').single());res.status(201).json({...created,success:true});
}));
watchlist.patch('/progress',wrap(async(req,res,sb)=>{
 const {media_type,media_id}=req.body;if(!TABLE[media_type]||!media_id)throw Error('Valid media_type and media_id required');const pid=await profileId(req,sb);
 let q=scope(sb.from('watchlist').select('id').eq('media_type',media_type).eq('media_id',media_id),req);if(!pid)q=q.is('profile_id',null);let found=await read(q.maybeSingle());
 const patch={updated_at:new Date().toISOString()};for(const k of ['current_season','current_episode','current_page','current_chapter','status','notes'])if(req.body[k]!==undefined)patch[k]=req.body[k];
 if(found)await read(scope(sb.from('watchlist').update(patch).eq('id',found.id),req));else found=await read(sb.from('watchlist').insert({user_id:req.user.id,profile_id:pid,media_type,media_id,status:'watching',...patch}).select('id').single());res.json({success:true,id:found.id});
}));
watchlist.patch('/:id',wrap(async(req,res,sb)=>{await read(scope(sb.from('watchlist').update({status:req.body.status,updated_at:new Date().toISOString()}).eq('id',req.params.id),req));res.json({success:true});}));
watchlist.delete('/:id',wrap(async(req,res,sb)=>{await read(scope(sb.from('watchlist').delete().eq('id',req.params.id),req));res.json({success:true});}));
const ratings=express.Router();
ratings.get('/my',wrap(async(req,res,sb)=>{const types=req.query.media_type?[req.query.media_type]:Object.keys(RATINGS);const rows=[];for(const type of types){const r=RATINGS[type];if(!r)continue;const found=await read(scope(sb.from(r.table).select('id,user_id,media_id,created_at,'+r.columns.join(',')),req));rows.push(...found.map(row=>({...row,media_type:type})));}res.json(await enrich(rows));}));
ratings.get('/:media_type/:media_id',wrap(async(req,res,sb)=>{const schema=RATINGS[req.params.media_type];if(!schema)throw Error('Invalid media_type');res.json(await read(scope(sb.from(schema.table).select('id,user_id,media_id,created_at,'+schema.columns.join(',')).eq('media_id',req.params.media_id),req).maybeSingle()));}));
ratings.post('/',wrap(async(req,res,sb)=>{
 const {media_type,media_id,categories}=req.body;const schema=RATINGS[media_type];if(!schema||!media_id||!categories)throw Error('Valid media_type, media_id and categories required');const pid=await profileId(req,sb);
 const row={user_id:req.user.id,profile_id:pid,media_id};for(let i=0;i<schema.columns.length;i++){const key=schema.columns[i],n=Number(categories[key]);if(!Number.isFinite(n)||n<1||n>schema.max[i])throw Error('Invalid rating value');row[key]=n;}
 await read(sb.from(schema.table).upsert(row,{onConflict:'user_id,media_id,profile_id'}));res.json({success:true});
}));
ratings.delete('/:media_type/:media_id',wrap(async(req,res,sb)=>{const schema=RATINGS[req.params.media_type];if(!schema)throw Error('Invalid media_type');await read(scope(sb.from(schema.table).delete().eq('media_id',req.params.media_id),req));res.json({success:true});}));
const episodes=express.Router();
episodes.post('/episode-progress',wrap(async(req,res,sb)=>{const {media_id,season,episode}=req.body;if(!media_id||!season||!episode)throw Error('Episode identity required');await read(sb.from('episode_progress').upsert({user_id:req.user.id,profile_id:await profileId(req,sb),media_id,season,episode,watched_at:new Date().toISOString()},{onConflict:'user_id,media_id,season,episode,profile_id'}));res.json({success:true});}));
episodes.get('/episode-progress/:mediaId',wrap(async(req,res,sb)=>{res.json(await read(scope(sb.from('episode_progress').select('season,episode,watched_at').eq('media_id',req.params.mediaId),req)));}));
episodes.delete('/episode-progress',wrap(async(req,res,sb)=>{await read(scope(sb.from('episode_progress').delete().eq('media_id',req.body.media_id).eq('season',req.body.season).eq('episode',req.body.episode),req));res.json({success:true});}));
module.exports={watchlist,ratings,episodes};
