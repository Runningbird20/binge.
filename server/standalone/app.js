const express=require('express');
const helmet=require('helmet');
const {database,transaction}=require('./db');
const {query,fail}=require('./query');
const {router:auth,authenticate,requireUser,requireAdmin,createAccount}=require('./auth');
const app=express();
app.disable('x-powered-by');
if(process.env.VERCEL==='1')app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:false,crossOriginResourcePolicy:{policy:'same-origin'}}));
app.use('/api',(req,res,next)=>{
  res.setHeader('Cache-Control','no-store');
  if(!['GET','HEAD','OPTIONS'].includes(req.method)){
    if(req.headers['x-binge-request']!=='1')return res.status(403).json({error:{message:'Missing request verification.'}});
    const allowed=[process.env.APP_ORIGIN,process.env.CLIENT_URL,process.env.VERCEL_URL&&`https://${process.env.VERCEL_URL}`].filter(Boolean);
    if(process.env.NODE_ENV!=='production')allowed.push('http://localhost:3000','http://localhost:5001','http://127.0.0.1:3000');
    if(req.headers.origin&&!allowed.includes(req.headers.origin))return res.status(403).json({error:{message:'Origin not allowed.'}});
  }
  next();
});
app.get('/api/health',async(_req,res)=>{await database().query('SELECT 1');res.json({ok:true,backend:'standalone-postgres'});});
app.use('/api',authenticate);
app.put('/api/backend/assets/:bucket/*name',express.raw({type:()=>true,limit:'4mb'}),async(req,res)=>{
  requireUser(req);
  const bucket=req.params.bucket,name=Array.isArray(req.params.name)?req.params.name.join('/'):req.params.name;
  if(bucket!=='avatars'||name.split('/')[0]!==req.user.id||name.includes('..'))fail('Upload denied.',403);
  const bytes=req.body;
  let type=null;
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))type='image/png';
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)type='image/jpeg';
  if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')type='image/webp';
  if(!type)fail('Upload a PNG, JPEG, or WebP image.');
  await database().query(`INSERT INTO binge.assets(bucket,name,owner_id,content_type,content) VALUES($1,$2,$3,$4,$5) ON CONFLICT(bucket,name) DO UPDATE SET content=excluded.content,content_type=excluded.content_type,updated_at=now()`,[bucket,name,req.user.id,type,bytes]);
  res.json({data:{path:name},error:null});
});
app.get('/api/backend/assets/:bucket/*name',async(req,res)=>{
  if(req.params.bucket!=='avatars')fail('Not found.',404);
  const name=Array.isArray(req.params.name)?req.params.name.join('/'):req.params.name;
  const {rows}=await database().query('SELECT content,content_type FROM binge.assets WHERE bucket=$1 AND name=$2',[req.params.bucket,name]);
  if(!rows[0])fail('Not found.',404);
  res.setHeader('Content-Type',rows[0].content_type);res.setHeader('Cache-Control','public, max-age=300');res.send(rows[0].content);
});
app.use(express.json({limit:'256kb'}));
app.use('/api/backend/auth',auth);
app.post('/api/backend/query',async(req,res)=>res.json(await query(req.body,req.user,req.profileId)));
app.get('/api/admin/users',async(req,res)=>{
  await requireAdmin(req);
  const {rows}=await database().query("SELECT r.data,a.email,a.last_sign_in_at FROM binge.records r JOIN binge.accounts a ON a.id=r.id WHERE r.collection='profiles' ORDER BY a.created_at DESC LIMIT 1000");
  res.json(rows.map(r=>({...r.data,email:r.email,last_sign_in_at:r.last_sign_in_at})));
});
app.post('/api/admin/users',async(req,res)=>{await requireAdmin(req);const user=await transaction(c=>createAccount(c,req.body));res.status(201).json({data:{user,session:null},error:null});});
app.patch('/api/admin/users/:id/toggle-admin',async(req,res)=>{
  await requireAdmin(req);if(req.params.id===req.user.id)fail('You cannot remove your own admin access.');
  const {rows}=await database().query("UPDATE binge.records SET data=data||jsonb_build_object('is_admin',NOT coalesce((data->>'is_admin')::boolean,false),'user_type',CASE WHEN data->>'is_admin'='true' THEN 'user' ELSE 'admin' END) WHERE collection='profiles' AND id=$1 RETURNING data",[req.params.id]);
  if(!rows[0])fail('User not found.',404);res.json(rows[0].data);
});
app.delete('/api/admin/users/:id',async(req,res)=>{
  await requireAdmin(req);if(req.params.id===req.user.id)fail('You cannot delete your own account here.');
  await transaction(async c=>{
    await c.query("DELETE FROM binge.records WHERE (collection='profiles' AND id=$1) OR data->>'user_id'=$1 OR data->>'account_id'=$1 OR data->>'follower_id'=$1 OR data->>'following_id'=$1",[req.params.id]);
    await c.query('DELETE FROM binge.accounts WHERE id=$1',[req.params.id]);
  });res.json({ok:true});
});
app.use('/api/media',require('./media'));
app.get(['/api/search', '/api/search-related'], async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ movies: [], tv: [], books: [], people: [] });
  const pattern = `%${q}%`;
  const types = String(req.query.types || 'movies,tv,books').split(',').map(s => s.trim());
  const results = { movies: [], tv: [], books: [], people: [] };
  if (types.includes('movies')) {
    const { rows } = await database().query(
      "SELECT data FROM binge.records WHERE collection='movies' AND (data->>'title' ILIKE $1 OR data->>'genre' ILIKE $1) AND data->>'poster_url' IS NOT NULL ORDER BY (data->>'year')::numeric DESC NULLS LAST LIMIT 8",
      [pattern]
    );
    results.movies = rows.map(r => r.data);
  }
  if (types.includes('tv') || types.includes('tv_shows')) {
    const { rows } = await database().query(
      "SELECT data FROM binge.records WHERE collection='tv_shows' AND (data->>'title' ILIKE $1 OR data->>'genre' ILIKE $1) AND data->>'poster_url' IS NOT NULL ORDER BY (data->>'year')::numeric DESC NULLS LAST LIMIT 8",
      [pattern]
    );
    results.tv = rows.map(r => r.data);
  }
  if (types.includes('books')) {
    const { rows } = await database().query(
      "SELECT data FROM binge.records WHERE collection='books' AND (data->>'title' ILIKE $1 OR data->>'author' ILIKE $1) LIMIT 8",
      [pattern]
    );
    results.books = rows.map(r => r.data);
  }
  res.json(results);
});

// External streaming and scraper provider integrations.
for(const name of ['sports','proxy','embed-proxy','manga','weebcentral','bato','books']){
  const filename=name==='embed-proxy'?'embedProxy':name;
  app.use(`/api/${name}`,require(`../routes/${filename}`));
}
app.use('/api',(_req,res)=>res.status(404).json({error:{message:'API route not found.'}}));
app.use((error,_req,res,_next)=>{
  const status=error.status|| (error.code==='23505'?409:500);
  const message=error.code==='23505'?'This username, email, or saved entry already exists.':status>=500?'The server could not complete the request.':error.message;
  if(status>=500)console.error('Standalone API error:',error.code||error.name);
  res.status(status).json({data:null,error:{message,code:error.code||String(status)}});
});
module.exports=app;
