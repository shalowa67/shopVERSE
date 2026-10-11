const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const schema = `
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS carts (
    user_id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS product_reviews (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
`;

function createStore(databasePath, legacyFilePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec(schema);

  function runTransaction(operation) {
    database.exec('BEGIN IMMEDIATE');
    try {
      operation();
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  const countUsers = database.prepare('SELECT COUNT(*) AS count FROM users');
  const hasUsers = countUsers.get().count > 0;

  if (!hasUsers && legacyFilePath && fs.existsSync(legacyFilePath)) {
    const legacyState = JSON.parse(fs.readFileSync(legacyFilePath, 'utf8'));
    const hasCollections = ['users', 'products', 'orders', 'productReviews', 'notifications']
      .every((key) => Array.isArray(legacyState[key]));

    if (!hasCollections || !legacyState.carts || typeof legacyState.carts !== 'object' || Array.isArray(legacyState.carts)) {
      database.close();
      throw new Error(`ShopVerse legacy data file has an invalid structure: ${legacyFilePath}`);
    }

    runTransaction(() => {
      writeRows('users', legacyState.users, (item) => item.id);
      writeRows('products', legacyState.products, (item) => item.id);
      writeRows('carts', Object.entries(legacyState.carts), ([userId]) => userId, ([, cart]) => cart);
      writeRows('orders', legacyState.orders, (item) => item.id);
      writeRows('product_reviews', legacyState.productReviews, (item) => item.id);
      writeRows('notifications', legacyState.notifications, (item) => item.id);
    });
  }

  function writeRows(table, items, getId, mapItem = (item) => item) {
    const keyColumn = table === 'carts' ? 'user_id' : 'id';
    const insert = database.prepare(`INSERT OR REPLACE INTO ${table} (${keyColumn}, data) VALUES (?, ?)`);
    for (const item of items) {
      const mapped = mapItem(item);
      const id = getId(item);
      insert.run(id, JSON.stringify(mapped));
    }
  }

  function readRows(table) {
    const rows = database.prepare(`SELECT data FROM ${table}`).all();
    return rows.map((row) => JSON.parse(row.data));
  }

  function readCarts() {
    const rows = database.prepare('SELECT user_id, data FROM carts').all();
    return Object.fromEntries(rows.map((row) => [row.user_id, JSON.parse(row.data)]));
  }

  function replaceState(state) {
    runTransaction(() => {
      for (const table of ['users', 'products', 'carts', 'orders', 'product_reviews', 'notifications']) {
        database.exec(`DELETE FROM ${table}`);
      }

      writeRows('users', state.users, (item) => item.id);
      writeRows('products', state.products, (item) => item.id);
      writeRows('carts', Object.entries(state.carts), ([userId]) => userId, ([, cart]) => cart);
      writeRows('orders', state.orders, (item) => item.id);
      writeRows('product_reviews', state.productReviews, (item) => item.id);
      writeRows('notifications', state.notifications, (item) => item.id);
    });
  }

  return {
    load() {
      return {
        users: readRows('users'),
        products: readRows('products'),
        carts: readCarts(),
        orders: readRows('orders'),
        productReviews: readRows('product_reviews'),
        notifications: readRows('notifications')
      };
    },
    save(state) {
      replaceState(state);
    },
    close() {
      database.close();
    }
  };
}

module.exports = { createStore };
