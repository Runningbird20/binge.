const neonDb = require('../neonDb');
const { MEDIA_TABLES } = require('../../src/utils/mediaDatabase');
const quote = (name) => {
  if (typeof name !== 'string' || !/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error('Invalid database identifier');
  return `"${name}"`;
};
function splitTop(text) {
  const parts=[];let depth=0,start=0,quoted=false;
  for(let i=0;i<text.length;i++) { const c=text[i]; if(c==='"') quoted=!quoted; if(quoted)continue; if(c==='(')depth++;if(c===')')depth--;if(c===','&&depth===0){parts.push(text.slice(start,i));start=i+1;} }
  parts.push(text.slice(start));return parts.map(x=>x.trim()).filter(Boolean);
}
function filterSql(filter, values) {
  const bind = value => { values.push(value);return `$${values.length}`; };
  const { column, value }=filter; let op=filter.operator;
  if(op==='or'||op==='and') return '('+splitTop(String(value)).map(part=>{
    const nested=part.match(/^(or|and)\((.*)\)$/s);
    if(nested)return filterSql({operator:nested[1],value:nested[2]},values);
    const match=part.match(/^([a-z_][a-z0-9_]*)\.(not\.)?([a-z]+)\.(.*)$/is);
    if(!match)throw new Error('Invalid filter expression');
    let raw=match[4];const operator=(match[2]||'')+match[3];
    if(operator.endsWith('in'))raw=splitTop(raw.replace(/^\(|\)$/g,'')).map(v=>v.replace(/^"|"$/g,''));
    return filterSql({column:match[1],operator,value:raw},values);
  }).join(op==='or'?' OR ':' AND ')+')';
  const negate=op.startsWith('not.');if(negate)op=op.slice(4);
  const col=quote(column);let sql;
  const operators={eq:'=',neq:'<>',gt:'>',gte:'>=',lt:'<',lte:'<=',like:'LIKE',ilike:'ILIKE',cs:'@>'};
  if(op==='is') {if(![null,true,false,'null','true','false'].includes(value))throw new Error('Invalid null filter');sql=`${col} IS ${String(value).toUpperCase()}`;}
  else if(op==='in') {if(!Array.isArray(value)||value.length>10000)throw new Error('Invalid IN filter');sql=value.length?`${col} IN (${value.map(bind).join(',')})`:'FALSE';}
  // PostgREST reads * as the LIKE wildcard (e.g. `title.ilike.Dune*`).
  else if(op==='like'||op==='ilike')sql=`${col} ${operators[op]} ${bind(String(value).replace(/\*/g,'%'))}`;
  else if(operators[op])sql=`${col} ${operators[op]} ${bind(op==='cs'?JSON.stringify(value):value)}`;
  else throw new Error('Unsupported filter');
  return negate?`NOT (${sql})`:sql;
}
function selectSql(columns='*') {
  if(columns==='*')return '*';
  return splitTop(columns).map(col=>{
    const parts=col.split(':');return parts.length===2?`${quote(parts[1])} AS ${quote(parts[0])}`:quote(col);
  }).join(',');
}
async function executeQuery(spec, { trusted=false }={}) {
  try {
    if(!spec||!MEDIA_TABLES.has(spec.table))throw new Error('Table is not accessible');
    const op=spec.operation||'select';if(!['select','insert','upsert','update','delete'].includes(op))throw new Error('Invalid operation');
    const read=op==='select';const table=quote(spec.table);const values=[];
    const filters=[...(spec.filters||[])];
    const rows=(spec.values===undefined?[]:Array.isArray(spec.values)?spec.values:[spec.values]).map(row=>({...row}));
    if(rows.length>1000)throw new Error('Too many rows');
    if(!trusted && !read)throw new Error('Media tables are read-only through this endpoint');
    // Public genre facets are derived from the Neon catalog, not Supabase views.
    if(/^(movie|tv_show|book)_genres$/.test(spec.table)) {
      if(!read)throw new Error('Read-only view');const source={movie_genres:'movies',tv_show_genres:'tv_shows',book_genres:'books'}[spec.table];
      const r=await neonDb.query(`SELECT DISTINCT trim(unnest(string_to_array(genre, ','))) AS genre FROM public.${quote(source)} WHERE genre IS NOT NULL`);
      return {data:r.rows,error:null,count:r.rowCount};
    }
    const where=filters.length?' WHERE '+filters.map(f=>filterSql(f,values)).join(' AND '):'';
    const selected=selectSql(spec.columns);
    const orders=(spec.orders||[]).map(o=>`${quote(o.column)} ${o.ascending===false?'DESC':'ASC'}${o.nullsFirst===undefined?'':o.nullsFirst?' NULLS FIRST':' NULLS LAST'}`);
    let sql;
    if(read) {
      const max=trusted?100000:1000;
      const limit=Math.min(max,Math.max(0,Number(spec.limit??1000)));const offset=Math.max(0,Number(spec.offset||0));
      if(!Number.isSafeInteger(limit)||!Number.isSafeInteger(offset))throw new Error('Invalid range');
      sql=`SELECT ${selected} FROM public.${table}${where}${orders.length?' ORDER BY '+orders.join(','):''} LIMIT ${limit} OFFSET ${offset}`;
    } else if(op==='delete') sql=`DELETE FROM public.${table}${where}${spec.returning?' RETURNING '+selected:''}`;
    else if(op==='update') {
      if(rows.length!==1)throw new Error('Expected a single update');
      const set=Object.entries(rows[0]).map(([k,v])=>{values.push(Array.isArray(v)?JSON.stringify(v):v);return `${quote(k)}=$${values.length}`;});
      if(!set.length)throw new Error('Empty update');
      sql=`UPDATE public.${table} SET ${set.join(',')}${where}${spec.returning?' RETURNING '+selected:''}`;
    } else {
      if(!rows.length)return {data:[],error:null};
      const cols=[...new Set(rows.flatMap(r=>Object.keys(r)))];
      // Filter values belong to UPDATE/DELETE/SELECT, not INSERT.
      values.length=0;
      const tuples=rows.map(row=>'('+cols.map(c=>{if(!(c in row))return 'DEFAULT';values.push(Array.isArray(row[c])?JSON.stringify(row[c]):row[c]);return `$${values.length}`;}).join(',')+')');
      let conflict='';
      if(op==='upsert') {
        const keys=String(spec.onConflict||({title_ratings:'source_key',episode_ratings_cache:'imdb_id,season',subtitle_cache:'key'}[spec.table])||'id').split(',').map(k=>k.trim());
        const set=cols.filter(c=>!keys.includes(c)).map(c=>`${quote(c)}=EXCLUDED.${quote(c)}`);
        conflict=` ON CONFLICT (${keys.map(quote).join(',')}) ${spec.ignoreDuplicates||!set.length?'DO NOTHING':'DO UPDATE SET '+set.join(',')}`;
      }
      sql=`INSERT INTO public.${table} (${cols.map(quote).join(',')}) VALUES ${tuples.join(',')}${conflict}${spec.returning?' RETURNING '+selected:''}`;
    }
    const result=await neonDb.query(sql,values);let count=null;
    if(spec.count){const counted=await neonDb.query(`SELECT count(*)::integer AS count FROM public.${table}${where}`,read?values:[]);count=counted.rows[0].count;}
    let data=spec.head?null:result.rows;
    if(spec.single||spec.maybeSingle){if(result.rows.length>1||spec.single&&!result.rows.length)return {data:null,error:{message:'Expected one row',code:'PGRST116'}};data=result.rows[0]||null;}
    return {data,error:null,count};
  }catch(error){return {data:null,error:{message:error.message,code:error.code||'NEON_QUERY_ERROR'}};}
}
module.exports={executeQuery,filterSql,selectSql,splitTop,quote,MEDIA_TABLES};
