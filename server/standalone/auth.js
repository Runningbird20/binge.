const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const express = require('express');
const {database,transaction}=require('./db');
const {fail,isAdmin,cleanPayload}=require('./query');
const hash=(s)=>crypto.createHash('sha256').update(s).digest('hex');
const cookieName=process.env.NODE_ENV==='production'?'__Host-binge_session':'binge_session';
function tokenFrom(req){
  const bearer=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  const cookie=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  return cookie || bearer || '';
}
function accountUser(row){return {id:row.id,email:row.email,user_metadata:row.metadata||{},app_metadata:{},created_at:row.created_at};}
async function authenticate(req,_res,next){
  try{
    const token=tokenFrom(req);
    if(token){const {rows}=await database().query(`SELECT a.*,s.created_at AS session_created_at FROM binge.sessions s JOIN binge.accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.expires_at>now() AND NOT a.disabled`,[hash(token)]);
      if(rows[0]){req.user=accountUser(rows[0]);req.sessionCreatedAt=rows[0].session_created_at;}}
    req.profileId=req.headers['x-binge-profile']||null;
    next();
  }catch(error){next(error);}
}
function requireUser(req){if(!req.user)fail('Sign in required.',401);return req.user;}
async function requireAdmin(req){requireUser(req);if(!await isAdmin(req.user,req.profileId))fail('Admin access required.',403);}
async function issueSession(client,res,user){
  const token=crypto.randomBytes(32).toString('base64url');
  await client.query("INSERT INTO binge.sessions(token_hash,account_id,expires_at) VALUES($1,$2,now()+interval '7 days')",[hash(token),user.id]);
  res.cookie(cookieName,token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:7*86400000});
  return {user,access_token:token,expires_at:Math.floor(Date.now()/1000)+7*86400};
}
function validatePassword(value){if(typeof value!=='string'||value.length<8||Buffer.byteLength(value)>72)fail('Password must be at least 8 characters and at most 72 bytes.');}
function validateEmail(value){if(typeof value!=='string'||value.length>254||!/^\S+@\S+\.\S+$/.test(value))fail('Invalid email address.');return value.trim().toLowerCase();}
async function throttle(req,label){
  // Persisted in Postgres: limits are shared by Vercel instances.
  const key=hash(`${label}:${req.ip}`);
  const {rows}=await database().query(`INSERT INTO binge.auth_limits(key,attempts,expires_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN binge.auth_limits.expires_at<now() THEN 1 ELSE binge.auth_limits.attempts+1 END,expires_at=CASE WHEN binge.auth_limits.expires_at<now() THEN now()+interval '15 minutes' ELSE binge.auth_limits.expires_at END RETURNING attempts`,[key]);
  if(rows[0].attempts>20)fail('Too many attempts. Try again in 15 minutes.',429);
}
async function createAccount(client,body){
  const email=validateEmail(body.email);validatePassword(body.password);
  const input=body.options?.data||body.data||{};
  const meta=cleanPayload('profiles',{username:input.username,bio:input.bio||'',avatar_url:input.avatar_url||null});
  if(!meta.username)fail('Username is required.');
  const id=crypto.randomUUID(),created_at=new Date().toISOString();
  const passwordHash=await bcrypt.hash(body.password,12);
  await client.query('INSERT INTO binge.accounts(id,email,password_hash,metadata) VALUES($1,$2,$3,$4)',[id,email,passwordHash,JSON.stringify(meta)]);
  const profile={...meta,id,email,is_admin:false,is_public:true,user_type:'user',created_at};
  await client.query("INSERT INTO binge.records(collection,id,data) VALUES('profiles',$1,$2)",[id,JSON.stringify(profile)]);
  const household={id:crypto.randomUUID(),account_id:id,name:meta.username,is_default:true,is_kids:false,avatar_url:meta.avatar_url,created_at};
  await client.query("INSERT INTO binge.records(collection,id,data) VALUES('account_profiles',$1,$2)",[household.id,JSON.stringify(household)]);
  return {id,email,user_metadata:meta,app_metadata:{},created_at};
}
const router=express.Router();
router.get('/session',async(req,res)=>{
  res.json({data:{session:req.user?{user:req.user,access_token:tokenFrom(req)}:null},error:null});
});
router.post('/signup',async(req,res)=>{
  await throttle(req,'signup');
  const result=await transaction(async client=>{const user=await createAccount(client,req.body);const session=await issueSession(client,res,user);return {user,session};});
  res.status(201).json({data:result,error:null});
});
router.post('/login',async(req,res)=>{
  await throttle(req,'login');const email=validateEmail(req.body.email);
  const {rows}=await database().query('SELECT * FROM binge.accounts WHERE lower(email)=$1',[email]);
  const account=rows[0];
  const dummy='$2b$12$abcdefghijklmnopqrstuuT9r/.sxL/UyBjYlTXjxUh83Eq44SkeuK';
  const valid=typeof req.body.password==='string'&&await bcrypt.compare(req.body.password,account?.password_hash||dummy);
  if(!account||account.disabled||!valid)fail('Invalid email or password.',401);
  const user=accountUser(account);
  const session=await transaction(async client=>{
    await client.query('UPDATE binge.accounts SET last_sign_in_at=now() WHERE id=$1',[user.id]);
    return issueSession(client,res,user);
  });
  res.json({data:{user,session},error:null});
});
router.post('/logout',async(req,res)=>{
  await database().query('DELETE FROM binge.sessions WHERE token_hash=$1',[hash(tokenFrom(req))]);
  res.clearCookie(cookieName,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/'});
  res.json({data:{},error:null});
});
router.patch('/user',async(req,res)=>{
  requireUser(req);const {password,email,data}=req.body;
  if((password||email)&&Date.now()-new Date(req.sessionCreatedAt).getTime()>15*60000)fail('Please sign in again before changing email or password.',401);
  if(password)validatePassword(password);
  const newEmail=email?validateEmail(email):req.user.email;
  const meta=data?cleanPayload('profiles',data):{};
  const result=await transaction(async client=>{
    const {rows}=await client.query('SELECT * FROM binge.accounts WHERE id=$1 FOR UPDATE',[req.user.id]);
    const merged={...rows[0].metadata,...meta};
    const passwordHash=password?await bcrypt.hash(password,12):rows[0].password_hash;
    await client.query('UPDATE binge.accounts SET email=$2,password_hash=$3,metadata=$4 WHERE id=$1',[req.user.id,newEmail,passwordHash,JSON.stringify(merged)]);
    await client.query("UPDATE binge.records SET data=data||$2::jsonb WHERE collection='profiles' AND id=$1",[req.user.id,JSON.stringify({...meta,email:newEmail})]);
    const user={...req.user,email:newEmail,user_metadata:merged};
    if(password){await client.query('DELETE FROM binge.sessions WHERE account_id=$1',[user.id]);await issueSession(client,res,user);}
    return user;
  });
  res.json({data:{user:result},error:null});
});
router.post('/password-reset',async(req,res)=>{
  await throttle(req,'reset');const email=validateEmail(req.body.email);
  if(!process.env.SMTP_URL||!process.env.MAIL_FROM||!process.env.APP_ORIGIN)fail('Password recovery email is not configured.',503);
  const {rows}=await database().query('SELECT id FROM binge.accounts WHERE lower(email)=$1 AND NOT disabled',[email]);
  if(rows[0]){
    const token=crypto.randomBytes(32).toString('base64url');
    await database().query("INSERT INTO binge.password_resets(token_hash,account_id,expires_at) VALUES($1,$2,now()+interval '30 minutes')",[hash(token),rows[0].id]);
    const url=new URL('/reset-password',process.env.APP_ORIGIN);url.hash=token;
    await require('nodemailer').createTransport(process.env.SMTP_URL).sendMail({from:process.env.MAIL_FROM,to:email,subject:'Reset your binge. password',text:`Reset your password within 30 minutes: ${url}\nIf you did not request this, ignore this email.`});
  }
  res.json({data:{},error:null});
});
router.post('/password-reset/complete',async(req,res)=>{
  await throttle(req,'reset-complete');validatePassword(req.body.password);
  if(typeof req.body.token!=='string')fail('Invalid reset link.');
  await transaction(async client=>{
    const {rows}=await client.query('DELETE FROM binge.password_resets WHERE token_hash=$1 AND expires_at>now() RETURNING account_id',[hash(req.body.token)]);
    if(!rows[0])fail('Reset link expired or already used.',400);
    const accountId=rows[0].account_id;
    await client.query('UPDATE binge.accounts SET password_hash=$2 WHERE id=$1',[accountId,await bcrypt.hash(req.body.password,12)]);
    await client.query('DELETE FROM binge.sessions WHERE account_id=$1',[accountId]);
    await client.query('DELETE FROM binge.password_resets WHERE account_id=$1',[accountId]);
  });
  res.json({data:{},error:null});
});
module.exports={router,authenticate,requireUser,requireAdmin,createAccount,hash};
