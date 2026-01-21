/* eslint-disable no-console */

const path = require('path');

function main() {
  const sqliteRel = process.env.SQLITE_PATH || 'storage/data/app.db';
  const sqlitePath = path.isAbsolute(sqliteRel) ? sqliteRel : path.join(process.cwd(), sqliteRel);

  const Database = require('better-sqlite3');
  const db = new Database(sqlitePath, { readonly: true });

  try {
    // dbstat is often available in modern SQLite builds.
    const rows = db
      .prepare(
        `SELECT name, SUM(pgsize) AS bytes
         FROM dbstat
         GROUP BY name
         ORDER BY bytes DESC, name ASC`
      )
      .all();

    const orders = (() => {
      try {
        return db.prepare('SELECT COUNT(1) AS c FROM orders').get().c;
      } catch {
        return null;
      }
    })();

    console.log(JSON.stringify({ sqlitePath, orders, byName: rows }, null, 2));
  } catch (e) {
    console.log(
      JSON.stringify(
        {
          sqlitePath,
          error: 'dbstat_unavailable',
          message: String(e && e.message ? e.message : e),
          hint: 'If dbstat is not available, we can approximate per-order size from file deltas over time using scripts/storage-metrics-log.js.',
        },
        null,
        2
      )
    );
  }
}

main();
