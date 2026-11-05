// Catalog maintenance uses the Turso catalog only. NODE_PATH in CI points at scripts/node_modules.
function createCatalogClient() {
  if(!process.env.TURSO_DATABASE_URL)throw new Error('TURSO_DATABASE_URL is required for catalog maintenance');
  return require('../server/data-access/client').dataClient();
}
module.exports={createCatalogClient};
