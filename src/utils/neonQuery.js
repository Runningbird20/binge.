// Shared fluent query description. Execution stays on the authenticated server;
// database credentials never enter the browser bundle.
class NeonQuery {
  constructor(execute, table) {
    this.execute = execute;
    this.spec = { table, operation: 'select', columns: '*', filters: [], orders: [] };
  }
  select(columns = '*', options = {}) { this.spec.columns = columns; this.spec.returning = true; Object.assign(this.spec, options); return this; }
  insert(values) { this.spec.operation = 'insert'; this.spec.values = values; this.spec.returning = false; return this; }
  upsert(values, options = {}) { this.spec.operation = 'upsert'; this.spec.values = values; this.spec.returning = false; Object.assign(this.spec, options); return this; }
  update(values) { this.spec.operation = 'update'; this.spec.values = values; this.spec.returning = false; return this; }
  delete(options = {}) { this.spec.operation = 'delete'; this.spec.returning = false; Object.assign(this.spec, options); return this; }
  filter(column, operator, value) { this.spec.filters.push({ column, operator, value }); return this; }
  eq(c,v) { return this.filter(c,'eq',v); }
  neq(c,v) { return this.filter(c,'neq',v); }
  gt(c,v) { return this.filter(c,'gt',v); }
  gte(c,v) { return this.filter(c,'gte',v); }
  lt(c,v) { return this.filter(c,'lt',v); }
  lte(c,v) { return this.filter(c,'lte',v); }
  ilike(c,v) { return this.filter(c,'ilike',v); }
  like(c,v) { return this.filter(c,'like',v); }
  in(c,v) { return this.filter(c,'in',v); }
  is(c,v) { return this.filter(c,'is',v); }
  contains(c,v) { return this.filter(c,'cs',v); }
  not(c,op,v) { return this.filter(c,`not.${op}`,v); }
  or(value) { this.spec.filters.push({ operator: 'or', value }); return this; }
  match(values) { Object.entries(values).forEach(([key,value])=>this.eq(key,value)); return this; }
  order(column, options = {}) { this.spec.orders.push({ column, ...options }); return this; }
  limit(value) { this.spec.limit = value; return this; }
  range(from,to) { this.spec.offset = from; this.spec.limit = to-from+1; return this; }
  single() { this.spec.single = true; return this; }
  maybeSingle() { this.spec.maybeSingle = true; return this; }
  then(resolve,reject) { return this.execute(this.spec).then(resolve,reject); }
}
function createNeonQueryClient(execute, rpc) {
  return { from: (table) => new NeonQuery(execute,table), rpc };
}
module.exports = { createNeonQueryClient };
