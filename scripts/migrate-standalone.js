#!/usr/bin/env node
// Imports a verified export into an EMPTY, non-Supabase destination. Never changes source data.
const fs=require('fs');
const fsp=require('fs/promises');
const path=require('path');
const readline=require('readline');
const crypto=require('crypto');
const {Client}=require('pg');
require('dotenv').config({path:'.env.local',quiet:true});
require('dotenv').config({path:'.env',quiet:true});
const {hashFile}=require('./export-supabase');
function parseRow(line){return JSON.parse(line,(key,value,ctx)=>{
  if(typeof value==='number' && (key==='id'||key.endsWith('_id')))return ctx.source;
  return value;
});}
function fileIn(root,relative){const file=path.resolve(root,relative);if(!file.startsWith(root+path.sep))throw new Error('Invalid manifest file path.');return file;}
async function initialize(client){await client.query(await fsp.readFile(path.join(__dirname,'../server/standalone/schema.sql'),'utf8'));}
async function migrate(root,{catalogOnly=false}={}){
  root=path.resolve(root);
  const url=process.env.DATABASE_URL;
  if(!url)throw new Error('Set DATABASE_URL to the destination Neon/Postgres database.');
  if(/supabase\.(co|com)$/.test(new URL(url).hostname)||url===process.env.SUPABASE_DB_URL)throw new Error('Destination must not be the Supabase source.');
  const manifest=JSON.parse(await fsp.readFile(path.join(root,'manifest.json'),'utf8'));
  if(!catalogOnly && !manifest.complete)throw new Error('Full migration requires a complete database/storage export. Use --catalog-only only for local/staging preparation.');
  const tables=manifest.tables.filter(t=>catalogOnly? t.schema==='public'&&['movies','tv_shows','books'].includes(t.table):t.schema==='public'||t.schema==='auth'&&t.table==='users');
  if(!tables.length)throw new Error('No tables found.');
  if(!catalogOnly&&!tables.some(t=>t.schema==='auth'&&t.table==='users'))throw new Error('Auth accounts are missing.');
  for(const t of tables){
    if(!['verified','exported-publicly-visible-rows'].includes(t.status))throw new Error(`Incomplete table: ${t.table}`);
    if(await hashFile(fileIn(root,t.file))!==t.sha256)throw new Error(`Checksum mismatch: ${t.table}`);
  }
  if(!catalogOnly)for(const asset of manifest.storage?.objects||[]){if(await hashFile(fileIn(root,asset.file))!==asset.sha256)throw new Error('Storage checksum mismatch.');}
  const client=new Client({connectionString:url,connectionTimeoutMillis:15000});
  await client.connect();
  const report={source:path.basename(root),catalogOnly,startedAt:new Date().toISOString(),tables:[],assets:0,complete:false};
  try{
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('binge-migration'))");
    await initialize(client);
    // Every destination collection being imported must be empty. Roll back on any conflict.
    if(!catalogOnly){const result=await client.query('SELECT count(*) FROM binge.accounts');if(Number(result.rows[0].count))throw new Error('Destination has accounts. Use an empty staging database.');}
    for(const t of tables){
      if(t.schema==='public'){
        const result=await client.query('SELECT count(*) FROM binge.records WHERE collection=$1',[t.table]);
        if(Number(result.rows[0].count))throw new Error(`Destination collection ${t.table} is not empty.`);
      }
    }
    const sorted=[...tables].sort((a,b)=>a.schema==='auth'?-1:b.schema==='auth'?1:0);
    for(const table of sorted){
      let rows=0,batch=[];
      const flush=async()=>{
        if(!batch.length)return;
        if(table.schema==='auth'){
          for(const r of batch){
            if(!r.email)throw new Error('An account has no email; resolve its login strategy before migration.');
            // OAuth-only accounts retain their IDs but require password recovery before login.
            const pw=r.encrypted_password || '!password-reset-required';
            const banned=r.banned_until&&new Date(r.banned_until)>new Date();
            await client.query('INSERT INTO binge.accounts(id,email,password_hash,metadata,created_at,last_sign_in_at,disabled) VALUES($1,$2,$3,$4,$5,$6,$7)',[r.id,r.email,pw,JSON.stringify(r.raw_user_meta_data||{}),r.created_at,r.last_sign_in_at||null,!!banned||!!r.deleted_at]);
          }
        }else{
          await client.query(`INSERT INTO binge.records(collection,id,data) SELECT $1,value->>'id',value FROM jsonb_array_elements($2::jsonb)`,[table.table,JSON.stringify(batch)]);
        }
        rows+=batch.length;batch=[];
      };
      const lines=readline.createInterface({input:fs.createReadStream(fileIn(root,table.file)),crlfDelay:Infinity});
      for await(const line of lines){
        if(!line.trim())continue;
        const row=parseRow(line);
        // Tables with composite primary keys are retained with deterministic document IDs.
        if(row.id==null)row.id='composite:'+crypto.createHash('sha256').update(JSON.stringify(row)).digest('hex');
        row.id=String(row.id);
        batch.push(row);if(batch.length===500)await flush();
      }
      await flush();
      if(rows!==table.rows)throw new Error(`Row count mismatch for ${table.table}`);
      report.tables.push({schema:table.schema,table:table.table,rows});
      console.log(`${table.schema}.${table.table}: ${rows} rows imported`);
    }
    if(!catalogOnly){
      for(const asset of manifest.storage?.objects||[]){
        const bytes=await fsp.readFile(fileIn(root,asset.file));
        const owner=asset.name.split('/')[0];
        const ownerExists=(await client.query('SELECT id FROM binge.accounts WHERE id=$1',[owner])).rows[0];
        const storageTable=manifest.tables.find(t=>t.schema==='storage'&&t.table==='objects');
        // Avatar files are sniffed on upload; preserve standard formats for migrated assets.
        const ext=path.extname(asset.name).toLowerCase();
        const mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'}[ext]||'application/octet-stream';
        await client.query('INSERT INTO binge.assets(bucket,name,owner_id,content_type,content) VALUES($1,$2,$3,$4,$5)',[asset.bucket,asset.name,ownerExists?owner:null,mime,bytes]);
        report.assets++;
        const publicPath=`/api/backend/assets/${encodeURIComponent(asset.bucket)}/${asset.name.split('/').map(encodeURIComponent).join('/')}`;
        const oldPath=`/storage/v1/object/public/${asset.bucket}/${asset.name}`;
        await client.query("UPDATE binge.records SET data=jsonb_set(data,'{avatar_url}',to_jsonb($1::text)) WHERE position($2 in data->>'avatar_url')>0",[publicPath,oldPath]);
        await client.query("UPDATE binge.accounts SET metadata=jsonb_set(metadata,'{avatar_url}',to_jsonb($1::text)) WHERE position($2 in metadata->>'avatar_url')>0",[publicPath,oldPath]);
        void storageTable;
      }
      // Preserve existing profile IDs. Create defaults only for accounts with none.
      const accounts=(await client.query('SELECT id,metadata,email,created_at FROM binge.accounts')).rows;
      for(const a of accounts){
        const existing=await client.query("SELECT id FROM binge.records WHERE collection='account_profiles' AND data->>'account_id'=$1 AND data->>'is_default'='true'",[a.id]);
        let defaultId=existing.rows[0]?.id;
        if(!defaultId){defaultId=crypto.randomUUID();const data={id:defaultId,account_id:a.id,name:a.metadata.username||a.email.split('@')[0],is_default:true,is_kids:false,created_at:a.created_at};await client.query("INSERT INTO binge.records VALUES('account_profiles',$1,$2)",[defaultId,JSON.stringify(data)]);}
        await client.query("UPDATE binge.records SET data=jsonb_set(data,'{profile_id}',to_jsonb($2::text)) WHERE collection IN ('watchlist','movie_ratings','tv_show_ratings','book_ratings','episode_progress','continue_watching') AND data->>'user_id'=$1 AND data->>'profile_id' IS NULL",[a.id,defaultId]);
      }
    }
    await client.query('COMMIT');
    report.complete=true;report.finishedAt=new Date().toISOString();
    const reportFile=path.join(root,`migration-${Date.now()}.json`);await fsp.writeFile(reportFile,JSON.stringify(report,null,2)+'\n',{mode:0o600});
    console.log(`Migration committed. Report: ${reportFile}`);
    return report;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{await client.end();}
}
async function main(){
  if(process.argv.includes('--schema-only')){
    if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required.');
    if(/supabase\.(co|com)$/.test(new URL(process.env.DATABASE_URL).hostname))throw new Error('Use the destination database.');
    const client=new Client({connectionString:process.env.DATABASE_URL});await client.connect();try{await initialize(client);}finally{await client.end();}console.log('Standalone schema initialized.');return;
  }
  const root=process.argv.slice(2).find(a=>!a.startsWith('--'));
  if(!root)throw new Error('Usage: node scripts/migrate-standalone.js <export-directory> [--catalog-only] | --schema-only');
  await migrate(root,{catalogOnly:process.argv.includes('--catalog-only')});
}
if(require.main===module)main().catch(error=>{console.error(error.code?`Database operation failed (${error.code}); transaction rolled back.`:error.message);process.exitCode=1;});
module.exports={migrate,parseRow,initialize};
