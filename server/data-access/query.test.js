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
