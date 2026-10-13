const { Pool } = require('pg');

function createPostgresStore(connectionString) {
  const connectionUrl = new URL(connectionString);
  const pool = new Pool({
    connectionString,
    ssl: connectionUrl.searchParams.get('sslmode') === 'require' ? true : undefined
  });
  let pendingSave = Promise.resolve();

  return {
    async initialize() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS shopverse_app_state (
          id SMALLINT PRIMARY KEY CHECK (id = 1),
          data JSONB NOT NULL
        )
      `);
    },
    async load() {
      const result = await pool.query('SELECT data FROM shopverse_app_state WHERE id = 1');
      return result.rows[0] ? result.rows[0].data : null;
    },
    save(state) {
      const snapshot = JSON.stringify(state);
      const saveTask = pendingSave.then(() => pool.query(
        `INSERT INTO shopverse_app_state (id, data)
         VALUES (1, $1::jsonb)
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
        [snapshot]
      ));
      pendingSave = saveTask.catch(() => {});
      return saveTask;
    },
    async close() {
      await pool.end();
    }
  };
}

module.exports = { createPostgresStore };
