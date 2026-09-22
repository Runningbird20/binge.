const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {Client}=require('pg');

test('standalone account, catalog, profile isolation, ratings, progress, storage and recovery',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'binge-api-test-'));
 const pgData=path.join(root,'pg');const port='55441';let started=false,server,client;
 const run=(cmd,args)=>{const r=spawnSync(cmd,args,{encoding:'utf8'});assert.equal(r.status,0,`${cmd}: ${r.stderr||r.error}`);return r.stdout;};
 const previousUrl=process.env.DATABASE_URL;
 try{
  run('initdb',['-D',pgData,'-A','trust','-U','binge_test','--no-locale']);
  run('pg_ctl',['-D',pgData,'-l',path.join(root,'pg.log'),'-o',`-p ${port} -h 127.0.0.1 -k ${root}`,'-w','start']);started=true;
  process.env.DATABASE_URL=`postgresql://binge_test@127.0.0.1:${port}/postgres?sslmode=disable`;
  client=new Client({connectionString:process.env.DATABASE_URL});await client.connect();
  await require('../../scripts/migrate-standalone').initialize(client);
  for(const [collection,data] of [
   ['movies',{id:'1',title:'Safe movie',year:2020,genre:'Drama',age_rating:'G'}],
   ['movies',{id:'2',title:'Adult movie',year:2024,genre:'Crime',age_rating:'R'}],
   ['tv_shows',{id:'3',title:'A series',year:2020,age_rating:'PG'}],
   ['books',{id:'1152880317676263401',title:'Big ID book',year:2000,genre:'Fiction'}],
  ])await client.query('INSERT INTO binge.records VALUES($1,$2,$3)',[collection,data.id,JSON.stringify(data)]);
  const app=require('./app');server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base=`http://127.0.0.1:${server.address().port}`;
  async function request(route,{method='GET',body,cookie,profile,headers={},raw=false}={}){
   const response=await fetch(base+route,{method,headers:{'X-Binge-Request':'1',...(body!==undefined&&!raw?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(profile?{'X-Binge-Profile':profile}:{}),...headers},body:body===undefined?undefined:raw?body:JSON.stringify(body)});
   const data=response.headers.get('content-type')?.includes('json')?await response.json():Buffer.from(await response.arrayBuffer());
   return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  const signup=async(name)=>request('/api/backend/auth/signup',{method:'POST',body:{email:`${name}@example.com`,password:'correct-horse-123',options:{data:{username:name,bio:'Test'}}}});
  const alice=await signup('alice');assert.equal(alice.status,201,JSON.stringify(alice.data));
  const bob=await signup('bob');assert.equal(bob.status,201);
  const aliceId=alice.data.data.user.id;
  async function query(table,input={},who=alice,profile){return request('/api/backend/query',{method:'POST',cookie:who?.cookie,profile,body:{table,...input}});}
  const profiles=await query('account_profiles');assert.equal(profiles.data.data.length,1);
  const profile=profiles.data.data[0].id;
  const bobProfile=(await query('account_profiles',{},bob)).data.data[0].id;
  const books=await query('books',{filters:[{op:'eq',column:'id',value:'1152880317676263401'}]});assert.equal(books.data.data[0].id,'1152880317676263401');
  assert.equal((await query('accounts')).status,404);
  assert.equal((await query('movies',{filters:[{op:'eq',column:"id') OR true --",value:1}]})).status,400);
  const kid=await query('account_profiles',{action:'insert',values:{account_id:aliceId,name:'Kid',is_kids:true,avatar_url:'🐱'},single:'required'});
  assert.equal(kid.status,200,JSON.stringify(kid.data));const kidId=kid.data.data.id;
  const kidMovies=await query('movies',{},alice,kidId);assert.deepEqual(kidMovies.data.data.map(r=>r.id),['1']);
  const foreign=await query('watchlist',{},bob,profile);assert.equal(foreign.status,403);
  const write=await query('watchlist',{action:'insert',values:{user_id:aliceId,profile_id:profile,media_type:'book',media_id:'1152880317676263401',status:'reading'}},alice,profile);
  assert.equal(write.status,200,JSON.stringify(write.data));
  assert.equal((await query('watchlist',{},alice,profile)).data.data.length,1);
  assert.equal((await query('watchlist',{},alice,kidId)).data.data.length,0);
  assert.equal((await query('watchlist',{},bob,bobProfile)).data.data.length,0);
  assert.equal((await query('watchlist',{action:'insert',values:{user_id:aliceId,media_type:'movie',media_id:1}},bob,bobProfile)).status,403);
  assert.equal((await query('profiles',{action:'update',filters:[{op:'eq',column:'id',value:aliceId}],values:{is_admin:true}},alice,profile)).status,403);
  const rating={action:'upsert',values:{user_id:aliceId,profile_id:profile,media_id:'1152880317676263401',prose:4,review:'Good'}};
  assert.equal((await query('book_ratings',rating,alice,profile)).status,200);
  rating.values={...rating.values,prose:5};delete rating.values.review;
  assert.equal((await query('book_ratings',rating,alice,profile)).status,200);
  const saved=await query('book_ratings',{},alice,profile);assert.equal(saved.data.data.length,1);assert.equal(saved.data.data[0].review,'Good');assert.equal(saved.data.data[0].prose,5);
  const ep={action:'upsert',values:{media_id:3,season:1,episode:2}};
  assert.equal((await query('episode_progress',ep,alice,profile)).status,200);
  assert.equal((await query('episode_progress',ep,alice,profile)).status,200);
  assert.equal((await query('episode_progress',{},alice,profile)).data.data.length,1);
  // Other viewers can read public default-profile ratings, never household activity.
  assert.equal((await query('book_ratings',{filters:[{op:'eq',column:'user_id',value:aliceId}]},bob,bobProfile)).data.data.length,1);
  await query('profiles',{action:'update',filters:[{op:'eq',column:'id',value:aliceId}],values:{is_public:false}},alice,profile);
  assert.equal((await query('book_ratings',{filters:[{op:'eq',column:'user_id',value:aliceId}]},bob,bobProfile)).data.data.length,0);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR5kAAAAASUVORK5CYII=','base64');
  assert.equal((await request(`/api/backend/assets/avatars/${aliceId}/avatar.png`,{method:'PUT',body:png,raw:true,cookie:alice.cookie})).status,200);
  assert.deepEqual((await request(`/api/backend/assets/avatars/${aliceId}/avatar.png`)).data,png);
  assert.equal((await request(`/api/backend/assets/avatars/${aliceId}/avatar.png`,{method:'PUT',body:png,raw:true,cookie:bob.cookie})).status,403);
  assert.equal((await request('/api/admin/users',{cookie:alice.cookie})).status,403);
  await client.query("UPDATE binge.records SET data=data||'{\"is_admin\":true}'::jsonb WHERE collection='profiles' AND id=$1",[aliceId]);
  assert.equal((await request('/api/admin/users',{cookie:alice.cookie,profile:kidId})).status,403);
  assert.equal((await request('/api/admin/users',{cookie:alice.cookie,profile})).status,200);
  const before=await request('/api/backend/auth/session',{cookie:alice.cookie});assert.equal(before.data.data.session.user.id,aliceId);
  const adminCreated=await request('/api/admin/users',{method:'POST',cookie:alice.cookie,profile,body:{email:'third@example.com',password:'third-password',options:{data:{username:'third'}}}});
  assert.equal(adminCreated.status,201);assert.equal(adminCreated.cookie,undefined);
  const csrf=await request('/api/backend/auth/logout',{method:'POST',cookie:alice.cookie,body:{},headers:{Origin:'https://evil.example'}});assert.equal(csrf.status,403);
  const password=await request('/api/backend/auth/user',{method:'PATCH',cookie:alice.cookie,body:{password:'new-password-123'}});assert.equal(password.status,200);
  assert.equal((await request('/api/backend/auth/session',{cookie:alice.cookie})).data.data.session,null);
  const login=await request('/api/backend/auth/login',{method:'POST',body:{email:'alice@example.com',password:'new-password-123'}});assert.equal(login.status,200);
  // A one-use recovery token invalidates existing sessions and cannot be replayed.
  const resetToken='fixture-reset-token';const hash=require('./auth').hash;
  await client.query("INSERT INTO binge.password_resets VALUES($1,$2,now()+interval '30 minutes')",[hash(resetToken),aliceId]);
  const resetBody={token:resetToken,password:'reset-password-123'};
  assert.equal((await request('/api/backend/auth/password-reset/complete',{method:'POST',body:resetBody})).status,200);
  assert.equal((await request('/api/backend/auth/password-reset/complete',{method:'POST',body:resetBody})).status,400);
  assert.equal((await request('/api/backend/auth/session',{cookie:login.cookie})).data.data.session,null);
  assert.equal((await request('/api/backend/auth/logout',{method:'POST',cookie:bob.cookie,body:{}})).status,200);
  assert.equal((await request('/api/backend/auth/session',{cookie:bob.cookie})).data.data.session,null);
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  await require('./db').close();if(client)await client.end();
  if(started)run('pg_ctl',['-D',pgData,'-m','fast','-w','stop']);
  await fs.rm(root,{recursive:true,force:true});
  if(previousUrl)process.env.DATABASE_URL=previousUrl;else delete process.env.DATABASE_URL;
 }
});
