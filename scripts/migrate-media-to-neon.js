// Non-destructive migration: inserts missing records; source data is never deleted.
const fs=require('fs');const path=require('path');const {Client}=require('pg');
require('dotenv').config({path:'.env.local',quiet:true});require('dotenv').config({path:'.env',quiet:true});
const {createClient}=require('@supabase/supabase-js');
const apply=process.argv.includes('--apply');
const allowed=['movies','tv_shows','books','title_ratings','episode_ratings_cache','subtitle_cache'];
const requested=process.argv.find(arg=>arg.startsWith('--tables='))?.slice(9).split(',');
const tables=requested||allowed;
if(tables.some(table=>!allowed.includes(table)))throw Error('Only media tables may be migrated');
const quote=s=>{if(!/^[a-z_][a-z0-9_]*$/i.test(s))throw Error('Invalid identifier');return '"'+s+'"';};
async function main(){
 const url=process.env.SUPABASE_URL||process.env.REACT_APP_SUPABASE_URL;
 const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw Error('Supabase server credentials are missing');
 const sb=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const db=new Client({connectionString:process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:10000});
 await db.connect();
 try {
  for(const table of tables){
   const schema=await db.query("select column_name,data_type,is_identity from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position",[table]);
   if(!schema.rowCount)throw Error('Destination table missing: '+table);
   const columns=schema.rows.filter(r=>r.column_name!=='pin'&&r.column_name!=='review'&& !(r.column_name==='id'&&r.is_identity==='YES'&&!['movies','tv_shows','books'].includes(table))).map(r=>r.column_name);
   const {count,error}=await sb.from(table).select('*',{count:'exact',head:true});
   if(error&&['PGRST205','42P01'].includes(error.code)){console.log(`${table}: already removed from Supabase`);continue;}
   if(error)throw Error(table+': '+error.message);
   const before=await db.query(`select count(*)::integer as n from public.${quote(table)}`);
   console.log(`${table}: source=${count}, destination=${before.rows[0].n}`);
   if(!apply)continue;
   let inserted=0;
   for(let offset=0;offset<count;offset+=500){
    const {data,error:readError}=await sb.from(table).select(columns.join(',')).order(columns.includes('id')?'id':columns[0]).range(offset,offset+499);
    if(readError)throw Error(table+': '+readError.message);
    if(!data?.length)break;
    if(offset%10000===0)console.log(`${table}: scanning ${offset}/${count}`);
    const values=[];const tuples=data.map(row=>'('+columns.map(c=>{const value=row[c]??null;const type=schema.rows.find(r=>r.column_name===c)?.data_type;values.push(value!==null&&['json','jsonb'].includes(type)?JSON.stringify(value):value);return '$'+values.length;}).join(',')+')');
    await db.query('BEGIN');
    try {
     const result=await db.query(`insert into public.${quote(table)} (${columns.map(quote).join(',')}) overriding system value values ${tuples.join(',')} on conflict do nothing`,values);
     inserted+=result.rowCount;
     await db.query('COMMIT');
    }catch(e){await db.query('ROLLBACK');throw e;}
   }
   // Restore identity sequences after importing explicit source IDs.
   if(columns.includes('id')){
    const seq=await db.query('select pg_get_serial_sequence($1,$2) as seq',['public.'+table,'id']);
    if(seq.rows[0]?.seq)await db.query(`select setval($1::regclass, greatest(coalesce((select max(id) from public.${quote(table)}),0),1), exists(select 1 from public.${quote(table)}))`,[seq.rows[0].seq]);
   }
   console.log(`${table}: copied ${inserted} missing rows (existing Neon records preserved)`);
  }
  console.log(apply?'Media data copy completed. Supabase source was preserved.':'Dry run completed. Use --apply to copy missing rows.');
 }finally{await db.end();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
