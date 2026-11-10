const express = require('express');
const { executeQuery } = require('../data-access/query');
const { rpc } = require('../data-access/client');
const router = express.Router();

// Production watch: a failed or slow catalog request goes to the admin
// panel's Errors (error_events), so a broken catalog shows up there instead
// of as silently empty rows. Each kind of problem at most once a minute per
// server instance; slow means over 3s (Turso bills rows read, and a slow
// query usually means a missing index: run with CATALOG_DEBUG=plan).
const SLOW_MS = 3000;
const lastReport = new Map();
function describe(req, body) {
  const what = req.path.startsWith('/rest/') ? `GET ${req.path}` : `${req.method} ${req.path}`;
  const table = req.body?.table ? ` ${req.body.table}` : '';
  return `${what}${table}`.slice(0, 200);
}
router.use((req, res, next) => {
  const started = Date.now();
  let body;
  const json = res.json.bind(res);
  res.json = (value) => { body = value; return json(value); };
  res.on('finish', () => {
    const ms = Date.now() - started;
    const failed = res.statusCode >= 400;
    if (!failed && ms < SLOW_MS) return;
    const message = failed
      ? `Catalog ${res.statusCode}: ${String(body?.error?.message || body?.message || 'error').slice(0, 300)} (${describe(req)})`
      : `Catalog slow: ${ms}ms (${describe(req)})`;
    const kind = failed ? message.replace(/\d+/g, '#') : `slow ${describe(req).replace(/\d+/g, '#')}`;
    if (Date.now() - (lastReport.get(kind) || 0) < 60_000) return;
    lastReport.set(kind, Date.now());
    if (lastReport.size > 500) lastReport.delete(lastReport.keys().next().value);
    require('./ops').recordError({
      source: 'server',
      message,
      stack: failed ? JSON.stringify({ query: req.query, body: req.body }).slice(0, 2000) : null,
      url: `${req.method} ${req.originalUrl}`.slice(0, 500),
      user_agent: String(req.headers['user-agent'] || '').slice(0, 300),
    });
  });
  next();
});
// Public media metadata only. User tables and mutations are never accepted.
router.post('/query', async (req, res) => {
  const result = await executeQuery(req.body);
  res.status(result.error ? 400 : 200).json(result);
});
router.post('/rpc/:name', async (req, res) => {
  const result = await rpc(req.params.name, req.body);
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
  const result=await executeQuery(spec);
  if(result.error)return res.status(400).json({message:result.error.message});
  if(result.count!==null)res.set('Content-Range',`0-${Math.max(0,result.data.length-1)}/${result.count}`);
  res.json(result.data);
});
module.exports = router;
