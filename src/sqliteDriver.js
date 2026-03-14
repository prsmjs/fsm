import sqlite3 from "sqlite3";

export function sqliteDriver({ filename }) {
  const db = new sqlite3.Database(filename);
  const init = new Promise((resolve, reject) => {
    db.run(
      `CREATE TABLE IF NOT EXISTS fsm_storage (
      key   TEXT PRIMARY KEY,
      value TEXT
    )`,
      (err) => (err ? reject(err) : resolve()),
    );
  });
  return {
    async set(key, value) {
      await init;
      return new Promise((resolve, reject) => {
        db.run(`INSERT OR REPLACE INTO fsm_storage(key, value) VALUES (?, ?)`, [key, value], (err) => (err ? reject(err) : resolve()));
      });
    },
    async get(key) {
      await init;
      return new Promise((resolve, reject) => {
        db.get(`SELECT value FROM fsm_storage WHERE key = ?`, [key], (err, row) => {
          if (err) return reject(err);
          resolve(row ? row.value : null);
        });
      });
    },
  };
}
