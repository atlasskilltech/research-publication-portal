/**
 * Helpers for the explicit, repeatable MySQL migrations in database/migrations.
 *
 * MySQL DDL auto-commits (it cannot be rolled back), so instead of one big
 * transaction every step is IDEMPOTENT: it inspects information_schema and only
 * acts when the object is missing. Re-running a migration is always safe.
 * Nothing here drops, truncates or renames anything.
 */
export const TABLE_OPTS = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
/** Every id the app generates (crypto.randomUUID). */
export const UUID = "CHAR(36) CHARACTER SET ascii COLLATE ascii_bin";

export function helpers(db, log = () => {}) {
  const one = (sql, p) => db.one(sql, p);
  const tableExists = async (t) =>
    !!(await one("SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?", [t]));
  const columnInfo = (t, c) =>
    one(
      "SELECT column_name AS name, column_type AS type, is_nullable AS nullable, character_set_name AS cs, collation_name AS coll " +
        "FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?",
      [t, c],
    );
  const indexExists = async (t, name) =>
    !!(await one("SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1", [t, name]));
  const constraintExists = async (name) =>
    !!(await one("SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() AND constraint_name = ? LIMIT 1", [name]));

  return {
    db,
    log,
    tableExists,
    columnInfo,
    indexExists,
    constraintExists,
    /** CREATE TABLE IF NOT EXISTS, logged only when it actually creates. */
    async createTable(name, body) {
      if (await tableExists(name)) return false;
      await db.query(`CREATE TABLE IF NOT EXISTS \`${name}\` (\n${body}\n) ${TABLE_OPTS}`);
      log(`  + table ${name}`);
      return true;
    },
    async addColumn(table, column, ddl) {
      if (await columnInfo(table, column)) return false;
      await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${ddl}`);
      log(`  + column ${table}.${column}`);
      return true;
    },
    async addIndex(table, name, ddl) {
      if (await indexExists(table, name)) return false;
      await db.query(`ALTER TABLE \`${table}\` ADD ${ddl}`);
      log(`  + index ${table}.${name}`);
      return true;
    },
    async addConstraint(table, name, ddl) {
      if (await constraintExists(name)) return false;
      await db.query(`ALTER TABLE \`${table}\` ADD CONSTRAINT \`${name}\` ${ddl}`);
      log(`  + constraint ${name}`);
      return true;
    },
    /** Exact column type of users.id (+ charset/collation) so FK columns always match it. */
    async userIdType(usersTable) {
      const c = await columnInfo(usersTable, "id");
      if (!c) throw new Error(`${usersTable}.id not found`);
      return `${c.type.toUpperCase()}${c.cs ? ` CHARACTER SET ${c.cs} COLLATE ${c.coll}` : ""}`;
    },
    /** Rows in a table (for safety checks). */
    async count(table) {
      return Number((await one(`SELECT COUNT(*) AS n FROM \`${table}\``)).n);
    },
  };
}
