import { getDatabase } from './src/database/db.ts';

const keys = [
  'FX_XAUUSD_1790178374416',
  'FX_XAUUSD_1790177599921',
  'FX_EURAUD_1790243219331',
  'FX_XAUUSD_1790173335146'
];

(async () => {
  const db = await getDatabase();

  for (const key of keys) {
    const sql =
      "SELECT * FROM execution_intents WHERE idempotency_key='" +
      key +
      "'";

    const result = db.exec(sql);

    console.log("");
    console.log("=== " + key + " ===");
    console.log(JSON.stringify(result, null, 2));
  }
})();
