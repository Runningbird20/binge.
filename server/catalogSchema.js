// Applies turso/schema.sql (idempotent) to a libSQL client.
const fs = require('fs');
const path = require('path');

const SCHEMA_PATH = path.join(__dirname, '..', 'turso', 'schema.sql');

// Statements end with ';' at the end of a line; trigger bodies end with "END;".
function splitSql(text) {
  const statements = [];
  let current = [];
  let inTrigger = false;
  for (const line of text.split('\n')) {
    if (!current.length && (!line.trim() || line.trim().startsWith('--'))) continue;
    current.push(line);
    if (/^CREATE TRIGGER/i.test(line.trim())) inTrigger = true;
    const done = inTrigger ? /^END;\s*$/i.test(line.trim()) : /;\s*$/.test(line);
    if (done) { statements.push(current.join('\n')); current = []; inTrigger = false; }
  }
  return statements;
}

async function applySchema(client) {
  const statements = splitSql(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  await client.batch(statements, 'write');
  return statements.length;
}

module.exports = { splitSql, applySchema, SCHEMA_PATH };
