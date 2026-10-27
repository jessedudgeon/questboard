const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { database } = require('./database-helper.cjs');
test('Fresh schema and existing permission regression suite in isolated PostgreSQL', async () => {
  const db = await database();
  try {
    await db.exec(fs.readFileSync(path.join(__dirname,'permissions.sql'),'utf8'));
    const {rows} = await db.query('select count(*)::int as count from auth.users');
    assert.equal(rows[0].count,0,'fixtures must roll back');
  } finally { await db.close(); }
});
