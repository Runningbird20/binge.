const express = require('express');
const { executeQuery } = require('../data-access/query');
const { rpc } = require('../data-access/client');
const { watchCatalog, specShape } = require('../data-access/monitor');
const router = express.Router();
// Database failures and slow queries are logged to /admin → Errors (data-access/monitor.js).
// Public media metadata only. User tables and mutations are never accepted.
router.post('/query', async (req, res) => {
  const spec = req.body || {};
  const result = await watchCatalog(req, `${spec.operation || 'select'} ${spec.table}`, () => executeQuery(spec), { shape: specShape(spec) });
  res.status(result.error ? 400 : 200).json(result);
});
router.post('/rpc/:name', async (req, res) => {
  const result = await watchCatalog(req, `rpc ${req.params.name}`, () => rpc(req.params.name, req.body));
  res.status(result.error ? 400 : 200).json(result);
});
// Read-only PostgREST-shaped catalog endpoint for the TV clients.
router.get('/rest/:table', async (req,res) => {
  const spec={table:req.params.table,operation:'select',columns:req.query.select||'*',filters:[],orders:[],limit:req.query.limit,offset:req.query.offset};
  for(const [key,raw] of Object.entries(req.query)) {
    if(['select','limit','offset'].includes(key))continue;
    if(key==='order') {
      spec.orders=String(raw).split(',').map(value=>{const [column,direction,nulls]=value.split('.');return {column,ascending:direction!=='desc',...(nulls?{nullsFirst:nulls==='nullsfirst'}:{})};});
    } else if(key==='or'||key==='and') spec.filters.push({operator:key,value:String(raw).replace(/^\(|\)$/g,'')});
    else {
      const match=String(raw).match(/^(not\.)?([a-z]+)\.(.*)$/s);
      if(!match)return res.status(400).json({message:'Invalid media filter'});
      const operator=(match[1]||'')+match[2];let value=match[3];
      if(operator.endsWith('in'))value=require('../data-access/query').splitTop(value.replace(/^\(|\)$/g,'')).map(v=>v.replace(/^"|"$/g,''));
      spec.filters.push({column:key,operator,value});
    }
  }
  if(String(req.headers.prefer||'').includes('count='))spec.count='exact';
  const result=await watchCatalog(req,`select ${spec.table}`,()=>executeQuery(spec),{shape:specShape(spec)});
  if(result.error)return res.status(400).json({message:result.error.message});
  if(result.count!==null)res.set('Content-Range',`0-${Math.max(0,result.data.length-1)}/${result.count}`);
  res.json(result.data);
});
module.exports = router;
