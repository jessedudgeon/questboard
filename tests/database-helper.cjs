const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
// In-memory PostgreSQL only. No URL, credentials, network database, or production data.
async function database({migrate=true}={}) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;`);
  for (const file of fs.readdirSync(path.join(__dirname,'../schema')).sort()) {
    if (file.endsWith('.sql')) await db.exec(fs.readFileSync(path.join(__dirname,'../schema',file),'utf8'));
  }
  if (migrate) await applyMigrations(db);
  return db;
}
async function applyMigrations(db) {
  for (const file of fs.readdirSync(path.join(__dirname,'../supabase/migrations')).sort()) {
    if (file.endsWith('.sql')) await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',file),'utf8'));
  }
}
module.exports = { database, applyMigrations };
