import sqlite3 from "sqlite3";

/**
 * Creates a storage driver backed by SQLite for use with setStorageDriver().
 *
 * @param {Object} options - Driver options.
 * @param {string} options.filename - Path to the SQLite database file; pass ":memory:" for an ephemeral in-memory store. The fsm_storage table is created automatically if it does not exist.
 * @returns {{ set: function(string, string): Promise<void>, get: function(string): Promise<string|null> }} A driver with async set(key, value) and get(key) methods.
 */
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
