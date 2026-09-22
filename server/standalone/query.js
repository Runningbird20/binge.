const crypto = require('crypto');
const { database, transaction } = require('./db');
const CATALOG = new Set(['movies','tv_shows','books']);
const PRIVATE = new Set(['watchlist','continue_watching','episode_progress','movie_ratings','tv_show_ratings','book_ratings']);
const READABLE = new Set([...CATALOG,...PRIVATE,'profiles','account_profiles']);
const FACETS = { movie_genres: 'movies', tv_show_genres: 'tv_shows', book_genres: 'books' };
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const column = (name) => { if (!/^[a-z][a-z0-9_]*$/.test(name)) fail('Invalid field.'); return `data->>'${name}'`; };
const jsonId = (value) => typeof value === 'number' && !Number.isSafeInteger(value) ? fail('Media ID lost precision. Reload the title.') : String(value);

function filtersSql(filters, params) {
  const bind = (value) => { params.push(value); return `$${params.length}`; };
  if (!Array.isArray(filters) || filters.length > 50) fail('Invalid filters.');
  return filters.map((f) => {
    if (f.op === 'or') {
      if (typeof f.value !== 'string' || f.value.length > 10000) fail('Invalid OR filter.');
      const children = f.value.split(',').map((part) => {
        const match = part.match(/^([a-z_][a-z0-9_]*)\.(eq|ilike|like)\.(.*)$/);
        if (!match) fail('Unsupported OR filter.');
        return { column: match[1], op: match[2], value: match[3] };
      });
      return `(${filtersSql(children, params).join(' OR ')})`;
    }
    const field = column(f.column);
    switch (f.op) {
      case 'eq': return `${field} = ${bind(String(f.value))}`;
      case 'neq': return `${field} <> ${bind(String(f.value))}`;
      case 'is':
        if (f.value === null) return `${field} IS NULL`;
        if (typeof f.value === 'boolean') return `${field} = ${bind(String(f.value))}`;
        fail('Unsupported IS value.'); break;
      case 'not':
        if (f.operator === 'is' && f.value === null) return `${field} IS NOT NULL`;
        fail('Unsupported NOT filter.'); break;
      case 'in':
        if (!Array.isArray(f.value) || f.value.length > 2000) fail('Invalid IN filter.');
        return `${field} = ANY(${bind(f.value.map(String))}::text[])`;
      case 'ilike': case 'like': return `${field} ${f.op.toUpperCase()} ${bind(String(f.value))}`;
      case 'gt': case 'gte': case 'lt': case 'lte': {
        const operator = {gt:'>',gte:'>=',lt:'<',lte:'<='}[f.op];
        const numeric = ['year','popularity','vote_average','season','episode'].includes(f.column);
        if (numeric && !Number.isFinite(Number(f.value))) fail('Invalid number.');
        return `${numeric ? `(${field})::numeric` : field} ${operator} ${bind(numeric ? Number(f.value) : String(f.value))}`;
      }
      default: fail('Unsupported filter.');
    }
    return '';
  });
}

async function activeProfile(user, profileId, client = database()) {
  if (!user || !profileId) return null;
  const { rows } = await client.query("SELECT data FROM binge.records WHERE collection='account_profiles' AND id=$1 AND data->>'account_id'=$2", [String(profileId),user.id]);
  if (!rows[0]) fail('Profile does not belong to this account.',403);
  return rows[0].data;
}
async function isAdmin(user, profileId, client = database()) {
  if (!user) return false;
  const profile = await activeProfile(user,profileId,client);
  if (profile && !profile.is_default) return false;
  const { rows } = await client.query("SELECT data FROM binge.records WHERE collection='profiles' AND id=$1", [user.id]);
  return rows[0]?.data?.is_admin === true;
}

function projection(rows, fields, table, user) {
  const names = !fields || fields === '*' ? null : fields.split(',').map((s) => s.trim());
  if (names) names.forEach(column);
  return rows.map(({data}) => {
    const safe = {...data};
    if (table === 'profiles' && safe.id !== user?.id) {
      for (const key of Object.keys(safe)) if (!['id','username','bio','avatar_url','created_at','is_public'].includes(key)) delete safe[key];
    }
    return names ? Object.fromEntries(names.map((key) => [key,safe[key] ?? null])) : safe;
  });
}

async function query(input, user, profileId) {
  const { table, action = 'select', filters = [], fields = '*', options = {} } = input;
  if (FACETS[table]) {
    if (action !== 'select') fail('Read only.',403);
    const { rows } = await database().query("SELECT DISTINCT trim(g) AS genre FROM binge.records, LATERAL regexp_split_to_table(data->>'genre', ',') g WHERE collection=$1 AND trim(g)<>'' ORDER BY genre", [FACETS[table]]);
    return { data: rows, error: null, count: null };
  }
  if (!READABLE.has(table)) fail('Unknown collection.',404);
  if (!['select','insert','upsert','update','delete'].includes(action)) fail('Unknown operation.');
  if (!user && !CATALOG.has(table) && table !== 'profiles') fail('Sign in required.',401);
  const profile = await activeProfile(user, profileId);
  if (action !== 'select') return mutate(input,user,profile);
  const params = [table];
  const conditions = ['collection=$1', ...filtersSql(filters,params)];
  if (PRIVATE.has(table)) {
    const target = filters.find(f => f.op === 'eq' && f.column === 'user_id')?.value;
    if (target && String(target) !== user.id && ['watchlist','movie_ratings','tv_show_ratings','book_ratings'].includes(table)) {
      params.push(String(target));
      const targetParam = `$${params.length}`;
      conditions.push(`data->>'user_id'=${targetParam}`);
      conditions.push(`EXISTS (SELECT 1 FROM binge.records p WHERE p.collection='profiles' AND p.id=${targetParam} AND coalesce(p.data->>'is_public','true')='true')`);
      conditions.push(`(data->>'profile_id' IS NULL OR data->>'profile_id' IN (SELECT h.id FROM binge.records h WHERE h.collection='account_profiles' AND h.data->>'account_id'=${targetParam} AND h.data->>'is_default'='true'))`);
    } else {
      params.push(user.id); conditions.push(`data->>'user_id'=$${params.length}`);
      params.push(profile?.id || ''); conditions.push(`coalesce(data->>'profile_id','')=$${params.length}`);
    }
  }
  if (table === 'account_profiles') { params.push(user.id); conditions.push(`data->>'account_id'=$${params.length}`); }
  if (table === 'profiles') { params.push(user?.id || ''); conditions.push(`(id=$${params.length} OR coalesce(data->>'is_public','true')='true')`); }
  if (CATALOG.has(table) && profile?.is_kids) {
    if (table !== 'books') conditions.push("data->>'age_rating' IN ('G','PG','TV-Y','TV-Y7','TV-G','TV-PG')");
  }
  const where = conditions.join(' AND ');
  const orders = input.orders || [];
  if (!Array.isArray(orders) || orders.length > 5) fail('Invalid ordering.');
  const order = orders.map(({column: name, ascending = true, nullsFirst = false}) => {
    const field = column(name);
    const value = ['year','popularity','vote_average'].includes(name) ? `(${field})::numeric` : field;
    return `${value} ${ascending ? 'ASC' : 'DESC'} NULLS ${nullsFirst ? 'FIRST' : 'LAST'}`;
  });
  order.push('id ASC');
  const offset = Number(input.offset || 0), limit = Math.min(Number(input.limit ?? 1000),1000);
  if (!Number.isSafeInteger(offset) || offset<0 || !Number.isSafeInteger(limit) || limit<0) fail('Invalid pagination.');
  let count = null;
  if (options.count) count = Number((await database().query(`SELECT count(*) FROM binge.records WHERE ${where}`,params)).rows[0].count);
  const rows = options.head ? [] : (await database().query(`SELECT data FROM binge.records WHERE ${where} ORDER BY ${order.join(',')} LIMIT $${params.length+1} OFFSET $${params.length+2}`, [...params,limit,offset])).rows;
  return finish(projection(rows,fields,table,user),input,count);
}
function finish(data,input,count=null) {
  if (input.single && (data.length>1 || (!data.length && input.single==='required'))) fail('Expected one record.',406);
  return { data: input.options?.head ? null : input.single ? data[0] || null : data, error:null, count };
}

const FIELDS = {
  profiles: ['username','email','bio','avatar_url','is_public'],
  account_profiles: ['name','avatar_url','avatar_color','is_kids'],
  watchlist: ['media_type','media_id','status','current_season','current_episode','current_page','current_chapter','notes'],
  continue_watching: ['media_type','media_id','current_season','current_episode','current_page','current_chapter'],
  episode_progress: ['media_id','season','episode','watched_at'],
  movie_ratings: ['media_id','acting','writing','originality','pacing','cinematography','review'],
  tv_show_ratings: ['media_id','premise','originality','acting','cinematography','writing','pacing','resonance','review'],
  book_ratings: ['media_id','prose','plot','characters','originality','pacing','resonance','review'],
};
function cleanPayload(table,value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') fail('Invalid record.');
  const out = {};
  for (const [key,v] of Object.entries(value)) {
    if (['id','user_id','account_id','profile_id','created_at','updated_at','added_at'].includes(key)) continue;
    if (!FIELDS[table].includes(key)) fail(`Field ${key} cannot be changed.`,403);
    if (v !== null && !['string','number','boolean'].includes(typeof v)) fail('Invalid field value.');
    if (typeof v==='string' && v.length>10000) fail('Field too long.');
    out[key] = v;
  }
  if ('media_id' in out) out.media_id = jsonId(out.media_id);
  if (out.media_type && !['movie','tv_show','book'].includes(out.media_type)) fail('Invalid media type.');
  if ('username' in out && !/^[a-zA-Z0-9_.-]{2,30}$/.test(out.username)) fail('Username must be 2–30 letters, numbers, dots, underscores or hyphens.');
  if ('bio' in out && String(out.bio||'').length>280) fail('Bio must be at most 280 characters.');
  if ('name' in out && (typeof out.name!=='string' || !out.name.trim() || out.name.length>50)) fail('Profile name is required (maximum 50 characters).');
  if ('is_kids' in out && typeof out.is_kids!=='boolean') fail('Invalid kids setting.');
  if (out.avatar_url && !(table==='account_profiles' && [...out.avatar_url].length<=8) && !/^(https?:\/\/|\/api\/backend\/assets\/|\/avatars\/|data:image\/(?:svg\+xml|png|jpeg|webp)[;,])/.test(out.avatar_url)) fail('Invalid avatar URL.');
  return out;
}
async function mutate(input,user,profile) {
  const { table, action, filters = [] } = input;
  if (!user || !FIELDS[table]) fail('Write denied.',403);
  return transaction(async (client) => {
    // Serialize writes per account, including conflict-target updates and profile deletion.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user.id]);
    const params = [table];
    const conditions = ['collection=$1',...filtersSql(filters,params)];
    params.push(user.id);
    conditions.push(table==='profiles' ? `id=$${params.length}` : `data->>'${table==='account_profiles'?'account_id':'user_id'}'=$${params.length}`);
    if (PRIVATE.has(table)) { params.push(profile?.id || ''); conditions.push(`coalesce(data->>'profile_id','')=$${params.length}`); }
    let rows=[];
    if (action==='update' || action==='delete') {
      if (!filters.length) fail('A record filter is required.');
      rows=(await client.query(`SELECT data FROM binge.records WHERE ${conditions.join(' AND ')} FOR UPDATE`,params)).rows;
      if (rows.length>1000) fail('Too many records.');
    } else {
      if (Array.isArray(input.values)) fail('Only one record can be saved at a time.');
      const value=input.values || {};
      if (value.user_id && String(value.user_id)!==user.id) fail('Write denied.',403);
      if (value.account_id && String(value.account_id)!==user.id) fail('Write denied.',403);
      if (value.profile_id && String(value.profile_id)!==profile?.id) fail('Profile mismatch.',403);
      const clean=cleanPayload(table,value);
      const owner=table==='profiles'?{}:table==='account_profiles'?{account_id:user.id}:{user_id:user.id,profile_id:profile?.id||null};
      const now=new Date().toISOString();
      let data={...clean,...owner,id:table==='profiles'?user.id:crypto.randomUUID(),created_at:now,updated_at:now,added_at:now};
      if (table==='profiles') { data.email=user.email; data.is_admin=false; data.user_type='user'; data.is_public=true; }
      if (table==='account_profiles') {
        const existing=await client.query("SELECT id FROM binge.records WHERE collection='account_profiles' AND data->>'account_id'=$1",[user.id]);
        if(existing.rows.length>=8) fail('Maximum of eight household profiles.');
        data.is_default=false;
      }
      if (action==='upsert') {
        if(!PRIVATE.has(table)) fail('Upsert not supported for this collection.');
        const keys=table==='episode_progress'?['user_id','profile_id','media_id','season','episode']:['watchlist','continue_watching'].includes(table)?['user_id','profile_id','media_type','media_id']:['user_id','profile_id','media_id'];
        const values=[table];const where=keys.map(k=>{values.push(data[k]==null?'':String(data[k]));return `coalesce(data->>'${k}','')=$${values.length}`;});
        const existing=(await client.query(`SELECT data FROM binge.records WHERE collection=$1 AND ${where.join(' AND ')} FOR UPDATE`,values)).rows[0]?.data;
        if(existing)data={...existing,...clean,updated_at:now};
      }
      await validateMedia(client,table,data);
      await client.query(`INSERT INTO binge.records(collection,id,data) VALUES($1,$2,$3) ${action==='upsert'?'ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data':''}`,[table,data.id,JSON.stringify(data)]);
      return finish(projection([{data}],input.fields,table,user),input);
    }
    const updated=[];
    for (const {data} of rows) {
      if (action==='delete') {
        if(table==='profiles') fail('Use the account deletion endpoint.',403);
        if(table==='account_profiles' && data.is_default) fail('The default profile cannot be deleted.');
        await client.query('DELETE FROM binge.records WHERE collection=$1 AND id=$2',[table,data.id]);
        if(table==='account_profiles') await client.query("DELETE FROM binge.records WHERE data->>'user_id'=$1 AND data->>'profile_id'=$2",[user.id,data.id]);
        updated.push({data});
      } else {
        const clean=cleanPayload(table,input.values);
        if(table==='profiles' && clean.email && clean.email!==user.email) fail('Change email through account settings.');
        const next={...data,...clean,updated_at:new Date().toISOString()};
        await validateMedia(client,table,next);
        await client.query('UPDATE binge.records SET data=$3 WHERE collection=$1 AND id=$2',[table,data.id,JSON.stringify(next)]);
        updated.push({data:next});
      }
    }
    return finish(projection(updated,input.fields,table,user),input);
  });
}
async function validateMedia(client,table,data) {
  if(!PRIVATE.has(table)) return;
  const mediaTable={movie:'movies',tv_show:'tv_shows',book:'books'}[data.media_type] || {movie_ratings:'movies',tv_show_ratings:'tv_shows',book_ratings:'books',episode_progress:'tv_shows'}[table];
  if(!mediaTable || !data.media_id) fail('Media type and ID are required.');
  const {rows}=await client.query('SELECT id FROM binge.records WHERE collection=$1 AND id=$2',[mediaTable,String(data.media_id)]);
  if(!rows.length) fail('Title not found.',404);
}
module.exports={query,activeProfile,isAdmin,fail,cleanPayload};
