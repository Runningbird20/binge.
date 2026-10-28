// Catalog maintenance uses Neon only. NODE_PATH in CI points at scripts/node_modules.
function createCatalogClient() {
  if(!process.env.DATABASE_URL && !process.env.DATABASE_URL_UNPOOLED)throw new Error('Neon DATABASE_URL is required for catalog maintenance');
  return require('../server/data-access/client').dataClient();
}
module.exports={createCatalogClient};
