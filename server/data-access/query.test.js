const test=require('node:test');const assert=require('node:assert/strict');
const db=require('../catalogDb');const {executeQuery,filterSql,selectSql,orderSql}=require('./query');

function capture(rows=[{id:1,title:'Example'}]){
 const original={query:db.query,batch:db.batch};const sent=[];
 db.query=async(sql,params)=>{sent.push({sql,params});return {rows,rowCount:rows.length};};
 db.batch=async(statements)=>{sent.push(...statements);return statements.map(()=>({rows:[],rowsAffected:1}));};
 return {sent,restore(){Object.assign(db,original);}};
}

test('filter values are parameterized and nested expressions retain grouping',()=>{
 const values=[];const sql=filterSql({operator:'or',value:'title.ilike.%test%,and(year.gte.2000,year.lte.2020)'},values);
 assert.match(sql,/OR/);assert.match(sql,/AND/);assert.deepEqual(values,['%test%','2000','2020']);
 assert.match(sql,/\?1/);assert.match(sql,/\?3/);
 assert.throws(()=>selectSql('id; DROP TABLE profiles'));
});
test('user tables cannot be read through the media endpoint',async()=>{
 for(const table of ['profiles','account_profiles','watchlist','movie_ratings','continue_watching','profile_locks']) {
  const result=await executeQuery({table,columns:'*'});assert.match(result.error.message,/not accessible/);
 }
});
test('browser clients cannot mutate media tables',async()=>{
 for(const operation of ['insert','update','upsert','delete']) {
  const result=await executeQuery({table:'movies',operation,values:{title:'changed'}});assert.match(result.error.message,/read-only/);
 }
});
test('media queries use bound filters and enforce a bounded page size',async()=>{
 const c=capture();
 try{const result=await executeQuery({table:'movies',columns:'id,title',filters:[{column:'title',operator:'ilike',value:"%O'Brien%"}],limit:99999});
 assert.equal(result.error,null);assert.match(c.sent[0].sql,/LIMIT 1000/);assert.match(c.sent[0].sql,/"title" LIKE \?1/);assert.deepEqual(c.sent[0].params,["%O'Brien%"]);assert.equal(result.data.length,1);
 }finally{c.restore();}
});
test('invalid column syntax is rejected before querying',async()=>{
 const result=await executeQuery({table:'movies',columns:'id,auth.users(*)'});assert.match(result.error.message,/Invalid database identifier/);
});
test('PostgREST * wildcards become LIKE wildcards',()=>{
 const values=[];filterSql({operator:'or',value:'title.ilike.Dune*,title.ilike.*Hobbit*'},values);
 assert.deepEqual(values,['Dune%','%Hobbit%']);
});
test('orders keep Postgres NULL placement (SQLite sorts NULL the other way)',()=>{
 assert.equal(orderSql({column:'year',ascending:true}),'"year" ASC NULLS LAST');
 assert.equal(orderSql({column:'popularity',ascending:false}),'"popularity" DESC NULLS FIRST');
 assert.equal(orderSql({column:'popularity',ascending:false,nullsFirst:false}),'"popularity" DESC NULLS LAST');
 assert.equal(orderSql({column:'title',ascending:true}),'"title" COLLATE NOCASE ASC');
});
test('trusted catalog writes fill the search columns and never use DEFAULT',async()=>{
 const c=capture();
 try{
  const result=await executeQuery({table:'movies',operation:'upsert',onConflict:'source_key',values:[{title:'Amélie',source_key:'tmdb:movie:194'},{title:'Léon',source_key:'tmdb:movie:101',year:1994}]},{trusted:true});
  assert.equal(result.error,null);
  assert.equal(c.sent.length,2,'rows with different columns go in separate statements');
  assert.doesNotMatch(c.sent.map(s=>s.sql).join(' '),/DEFAULT/);
  assert.match(c.sent[0].sql,/ON CONFLICT \("source_key"\) DO UPDATE SET/);
  assert.match(c.sent[0].sql,/"search_norm"/);
  assert.ok(c.sent[0].params.includes('amelie'));
  assert.ok(c.sent[1].params.includes('leon'));
 }finally{c.restore();}
});
test('genre views are read-only',async()=>{
 const result=await executeQuery({table:'movie_genres',operation:'insert',values:{genre:'x'}},{trusted:true});
 assert.match(result.error.message,/Read-only view/);
});
test('planned counts come from the stored row count',async()=>{
 const c=capture([{value:184718}]);
 try{
  const planned=await executeQuery({table:'movies',columns:'id',count:'planned',head:true});
  assert.equal(planned.count,184718);
  assert.match(c.sent.at(-1).sql,/catalog_stats/);
 }finally{c.restore();}
});
test('exact counts are counted once, stored, then reused',async()=>{
 const original=db.query;const sent=[];
 db.query=async(sql,params)=>{sent.push(sql);
  if(/FROM catalog_stats/.test(sql))return {rows:[]};
  if(/count\(\*\)/.test(sql))return {rows:[{count:7}]};
  return {rows:[]};};
 try{
  const spec={table:'books',columns:'id',count:'exact',head:true,filters:[{column:'genre',operator:'ilike',value:'%Fantasy%'}]};
  assert.equal((await executeQuery(spec)).count,7);
  assert.ok(sent.some(s=>/SELECT count\(\*\) AS count FROM "books" WHERE "genre" LIKE \?1/.test(s)));
  assert.ok(sent.some(s=>/INSERT INTO catalog_stats/.test(s)),'stored for other instances');
  const before=sent.length;
  assert.equal((await executeQuery(spec)).count,7);
  assert.equal(sent.length,before,'second ask is served from memory');
 }finally{db.query=original;}
});
test('route SQL written for Postgres is translated for SQLite',()=>{
 assert.equal(db.translate('SELECT * FROM movies WHERE title ILIKE $1 OR genre ilike $1 LIMIT $2'),'SELECT * FROM movies WHERE title LIKE ?1 OR genre LIKE ?1 LIMIT ?2');
 assert.equal(db.toArg(true),1);assert.equal(db.toArg({a:1}),'{"a":1}');assert.equal(db.toArg(undefined),null);
});
test('search cache keys ignore case, accents and punctuation',()=>{
 const {searchKey}=require('./client');
 assert.equal(searchKey('Amélie!',24),searchKey('amelie',24));
 assert.equal(searchKey('Spider-Man',24),searchKey('spider man',24));
 assert.notEqual(searchKey('dune',24),searchKey('dune',10));
 assert.equal(searchKey('오징어 게임',24),'24|오징어 게임');
});
test('repeated searches are served from the cache',async()=>{
 const search=require('../catalogSearch');const {rpc}=require('./client');const original=search.searchCatalog;let calls=0;
 search.searchCatalog=async()=>{calls+=1;return [{id:1,title:'Dune'}];};
 try{
  const first=await rpc('search_catalog',{q:'Dune: Part Two',lim:24});
  const second=await rpc('search_catalog',{q:'dune part two',lim:24});
  assert.equal(calls,1);assert.deepEqual(second.data,first.data);
 }finally{search.searchCatalog=original;}
});
