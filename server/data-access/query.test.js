const test=require('node:test');const assert=require('node:assert/strict');
const db=require('../neonDb');const {executeQuery,filterSql,selectSql}=require('./query');
test('filter values are parameterized and nested expressions retain grouping',()=>{
 const values=[];const sql=filterSql({operator:'or',value:'title.ilike.%test%,and(year.gte.2000,year.lte.2020)'},values);
 assert.match(sql,/OR/);assert.match(sql,/AND/);assert.deepEqual(values,['%test%','2000','2020']);
 assert.throws(()=>selectSql('id; DROP TABLE profiles'));
});
test('user tables cannot be read through the Neon media endpoint',async()=>{
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
 const original=db.query;let sent;db.query=async(sql,params)=>{sent={sql,params};return {rows:[{id:'1',title:'Example'}],rowCount:1};};
 try{const result=await executeQuery({table:'movies',columns:'id,title',filters:[{column:'title',operator:'ilike',value:"%O'Brien%"}],limit:99999});
 assert.equal(result.error,null);assert.match(sent.sql,/LIMIT 1000/);assert.deepEqual(sent.params,["%O'Brien%"]);assert.equal(result.data.length,1);
 }finally{db.query=original;}
});
test('invalid column syntax is rejected before querying',async()=>{
 const result=await executeQuery({table:'movies',columns:'id,auth.users(*)'});assert.match(result.error.message,/Invalid database identifier/);
});
test('PostgREST * wildcards become LIKE wildcards',()=>{
 const values=[];filterSql({operator:'or',value:'title.ilike.Dune*,title.ilike.*Hobbit*'},values);
 assert.deepEqual(values,['Dune%','%Hobbit%']);
});
test('bigint ids come back as numbers, like PostgREST',()=>{
 const parse=db.getPool?.()?.options?.types?.getTypeParser(20);
 if(parse){assert.equal(parse('236187'),236187);assert.equal(parse('9007199254740993'),'9007199254740993');}
});
test('search cache keys ignore case, accents and punctuation',()=>{
 const {searchKey}=require('./client');
 assert.equal(searchKey('Amélie!',24),searchKey('amelie',24));
 assert.equal(searchKey('Spider-Man',24),searchKey('spider man',24));
 assert.notEqual(searchKey('dune',24),searchKey('dune',10));
 assert.equal(searchKey('오징어 게임',24),'24|오징어 게임');
});
test('repeated searches are served from the cache',async()=>{
 const {rpc}=require('./client');const original=db.query;let calls=0;
 db.query=async()=>{calls+=1;return {rows:[{id:1,title:'Dune'}]};};
 try{
  const first=await rpc('search_catalog',{q:'Dune: Part Two',lim:24});
  const second=await rpc('search_catalog',{q:'dune part two',lim:24});
  assert.equal(calls,1);assert.deepEqual(second.data,first.data);
 }finally{db.query=original;}
});
