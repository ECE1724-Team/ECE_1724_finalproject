import type { BetterAuthOptions } from "@better-auth/core";
import {
  createAdapterFactory,
  type AdapterFactory,
  type AdapterFactoryCustomizeAdapterCreator,
  type CleanedWhere,
  type CustomAdapter,
  type DBAdapter,
} from "@better-auth/core/db/adapter";
import { Database } from "../../db/transaction.js";

const TABLES: Readonly<Record<string, string>> = Object.freeze({
  user: "auth_user",
  account: "auth_account",
  session: "auth_session",
  verification: "auth_verification",
  rateLimit: "auth_rate_limit",
});

function quoteIdentifier(value: string): string {
  // Identifiers come from reviewed server configuration, never HTTP input.
  // Reject invalid/truncated identifiers as well as SQL expression fragments.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value) || Buffer.byteLength(value) > 63) {
    throw new Error(`Unsupported authentication SQL identifier: ${value}`);
  }
  return `"${value}"`;
}

function nonnegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a nonnegative safe integer`);
  }
  return value;
}

/**
 * A deliberately small PostgreSQL adapter for the four Better Auth core models
 * and its optional database rate limiter. It performs no password/token logic.
 * All values are parameters and all columns are validated against BA's schema.
 */
export function createPostgresAuthAdapter(database: Database): AdapterFactory<BetterAuthOptions> {
  return (suppliedOptions: BetterAuthOptions): DBAdapter => {
    // The factory implements joins using additional adapter reads. This keeps
    // both model/field mapping and those reads inside our PoolClient context.
    const options: BetterAuthOptions = {
      ...suppliedOptions,
      advanced: {
        ...suppliedOptions.advanced,
        database: { ...suppliedOptions.advanced?.database, joins: false },
      },
    };

    const customAdapter: AdapterFactoryCustomizeAdapterCreator = ({
      schema,
      getModelName,
      getFieldName,
    }) => {
      const models = new Map<string, {
        key: string;
        table: string;
        columns: Set<string>;
        numericColumns: Set<string>;
      }>();

      for (const [key, definition] of Object.entries(schema)) {
        const expectedTable = TABLES[key];
        const physicalTable = getModelName(key);
        if (!expectedTable || physicalTable !== expectedTable) {
          throw new Error(`Unsupported auth model mapping: ${key} -> ${physicalTable}`);
        }
        const columns = new Set<string>(["id"]);
        const numericColumns = new Set<string>();
        for (const [field, attributes] of Object.entries(definition.fields)) {
          const column = attributes.fieldName ?? field;
          quoteIdentifier(column);
          if (field !== "id" && columns.has(column)) {
            throw new Error(`Duplicate auth column mapping: ${physicalTable}.${column}`);
          }
          if (field === "id" && column !== "id") {
            throw new Error("Authentication primary keys must use the id column");
          }
          columns.add(column);
          if (attributes.type === "number") numericColumns.add(column);
        }
        models.set(physicalTable, {
          key,
          table: `"public".${quoteIdentifier(physicalTable)}`,
          columns,
          numericColumns,
        });
      }

      function modelInfo(model: string, modelKey?: string) {
        const info = models.get(model);
        if (!info || (modelKey !== undefined && modelKey !== info.key)) {
          throw new Error(`Unsupported authentication model: ${model}`);
        }
        return info;
      }

      type ModelInfo = ReturnType<typeof modelInfo>;

      function column(info: ModelInfo, field: string, alias?: string): string {
        if (!info.columns.has(field)) {
          throw new Error(`Unknown authentication column: ${info.key}.${field}`);
        }
        return `${alias ? `${quoteIdentifier(alias)}.` : ""}${quoteIdentifier(field)}`;
      }

      function selection(info: ModelInfo, fields?: string[]): string {
        return fields?.length
          ? fields.map((field) => column(info, getFieldName({ model: info.key, field }))).join(", ")
          : "*";
      }

      function bind(values: unknown[], value: unknown): string {
        values.push(value);
        return `$${values.length}`;
      }

      function predicate(
        info: ModelInfo,
        where: CleanedWhere[] | undefined,
        values: unknown[],
        alias?: string,
      ): string {
        const and: string[] = [];
        const or: string[] = [];
        for (const condition of where ?? []) {
          const { field, value, operator, connector, mode } = condition;
          if (connector !== "AND" && connector !== "OR") throw new Error("Invalid where connector");
          if (mode !== "sensitive" && mode !== "insensitive") throw new Error("Invalid where mode");
          let lhs = column(info, field, alias);
          const insensitive = mode === "insensitive" && (
            typeof value === "string" || Array.isArray(value) && value.every((item) => typeof item === "string")
          );
          let clause: string;
          if (value === null && (operator === "eq" || operator === "ne")) {
            clause = `${lhs} IS ${operator === "ne" ? "NOT " : ""}NULL`;
          } else if (operator === "in" || operator === "not_in") {
            if (!Array.isArray(value)) throw new Error(`${operator} requires an array`);
            if (!value.length) {
              clause = operator === "in" ? "FALSE" : "TRUE";
            } else {
              if (insensitive) lhs = `LOWER(${lhs})`;
              const placeholders = value.map((item) => bind(values, insensitive && typeof item === "string" ? item.toLowerCase() : item));
              clause = `${lhs} ${operator === "not_in" ? "NOT IN" : "IN"} (${placeholders.join(", ")})`;
            }
          } else if (operator === "contains" || operator === "starts_with" || operator === "ends_with") {
            if (typeof value !== "string") throw new Error(`${operator} requires a string`);
            // Treat the requested substring literally, including SQL wildcards.
            const escaped = value.replace(/[!%_]/g, (character) => `!${character}`);
            const pattern = `${operator !== "starts_with" ? "%" : ""}${escaped}${operator !== "ends_with" ? "%" : ""}`;
            clause = `${lhs} ${insensitive ? "ILIKE" : "LIKE"} ${bind(values, pattern)} ESCAPE '!'`;
          } else {
            const sqlOperators = { eq: "=", ne: "<>", lt: "<", lte: "<=", gt: ">", gte: ">=" } as const;
            if (!Object.hasOwn(sqlOperators, operator)) throw new Error("Unsupported where operator");
            if (insensitive) lhs = `LOWER(${lhs})`;
            const rhs = bind(values, insensitive && typeof value === "string" ? value.toLowerCase() : value);
            clause = `${lhs} ${sqlOperators[operator as keyof typeof sqlOperators]} ${rhs}`;
          }
          (connector === "OR" ? or : and).push(`(${clause})`);
        }
        // Match Better Auth's official adapter grouping: AND conditions plus
        // one parenthesized OR group, rather than an unsafe ungrouped suffix.
        return [and.length ? `(${and.join(" AND ")})` : "", or.length ? `(${or.join(" OR ")})` : ""]
          .filter(Boolean).join(" AND ") || "TRUE";
      }

      function assignments(info: ModelInfo, data: Record<string, unknown>, values: unknown[]): string[] {
        return Object.entries(data).filter(([, value]) => value !== undefined)
          .map(([field, value]) => `${column(info, field)} = ${bind(values, value)}`);
      }

      function singleRowGuard(info: ModelInfo, where: CleanedWhere[], values: unknown[]): string {
        const candidate = predicate(info, where, values, "candidate");
        const current = predicate(info, where, values, "target");
        // Repeat the guard on the actual write. PostgreSQL rechecks that guard
        // against the current row after waiting on a concurrent writer; a guard
        // confined to the subquery would allow stale compare-and-swap writes.
        return `${column(info, "id", "target")} IN (SELECT ${column(info, "id", "candidate")} FROM ${info.table} AS "candidate" WHERE ${candidate} LIMIT 1) AND (${current})`;
      }

      const implementation: CustomAdapter = {
        async create<T extends Record<string, unknown>>({ model, modelKey, data }: {
          model: string; modelKey?: string; data: T;
        }): Promise<T> {
          const info = modelInfo(model, modelKey);
          const values: unknown[] = [];
          const entries = Object.entries(data).filter(([, value]) => value !== undefined);
          const fields = entries.map(([field]) => column(info, field));
          const placeholders = entries.map(([, value]) => bind(values, value));
          const result = await database.query(
            `INSERT INTO ${info.table} ${entries.length ? `(${fields.join(", ")}) VALUES (${placeholders.join(", ")})` : "DEFAULT VALUES"} RETURNING *`,
            values,
          );
          if (!result.rows[0]) throw new Error("Authentication insert returned no row");
          return result.rows[0] as T;
        },

        async findOne<T>({ model, modelKey, where, select, join }: Parameters<CustomAdapter["findOne"]>[0]) {
          const info = modelInfo(model, modelKey);
          if (join && Object.keys(join).length) throw new Error("Native authentication joins are disabled");
          const values: unknown[] = [];
          const condition = predicate(info, where, values);
          const result = await database.query(`SELECT ${selection(info, select)} FROM ${info.table} WHERE ${condition} LIMIT 1`, values);
          return (result.rows[0] ?? null) as T | null;
        },

        async findMany<T>({ model, modelKey, where, select, join, sortBy, limit, offset }: Parameters<CustomAdapter["findMany"]>[0]) {
          const info = modelInfo(model, modelKey);
          if (join && Object.keys(join).length) throw new Error("Native authentication joins are disabled");
          const values: unknown[] = [];
          const condition = predicate(info, where, values);
          let order = "";
          if (sortBy) {
            if (sortBy.direction !== "asc" && sortBy.direction !== "desc") throw new Error("Invalid sort direction");
            order = ` ORDER BY ${column(info, getFieldName({ model: info.key, field: sortBy.field }))} ${sortBy.direction.toUpperCase()}`;
          }
          const pagination = ` LIMIT ${bind(values, nonnegativeInteger(limit, "limit"))}${offset === undefined ? "" : ` OFFSET ${bind(values, nonnegativeInteger(offset, "offset"))}`}`;
          const result = await database.query(`SELECT ${selection(info, select)} FROM ${info.table} WHERE ${condition}${order}${pagination}`, values);
          return result.rows as T[];
        },

        async update<T>({ model, modelKey, where, update }: Parameters<CustomAdapter["update"]>[0]) {
          const info = modelInfo(model, modelKey);
          if (!where.length) return null;
          const values: unknown[] = [];
          const set = assignments(info, update as Record<string, unknown>, values);
          if (!set.length) {
            const condition = predicate(info, where, values);
            const result = await database.query(`SELECT * FROM ${info.table} WHERE ${condition} LIMIT 1`, values);
            return (result.rows[0] ?? null) as T | null;
          }
          const condition = singleRowGuard(info, where, values);
          const result = await database.query(`UPDATE ${info.table} AS "target" SET ${set.join(", ")} WHERE ${condition} RETURNING "target".*`, values);
          return (result.rows[0] ?? null) as T | null;
        },

        async updateMany({ model, modelKey, where, update }) {
          const info = modelInfo(model, modelKey);
          const values: unknown[] = [];
          const set = assignments(info, update, values);
          if (!set.length) return 0;
          const condition = predicate(info, where, values);
          const result = await database.query(`UPDATE ${info.table} SET ${set.join(", ")} WHERE ${condition}`, values);
          return result.rowCount ?? 0;
        },

        async delete({ model, modelKey, where }) {
          const info = modelInfo(model, modelKey);
          if (!where.length) return;
          const values: unknown[] = [];
          const condition = singleRowGuard(info, where, values);
          await database.query(`DELETE FROM ${info.table} AS "target" WHERE ${condition}`, values);
        },

        async deleteMany({ model, modelKey, where }) {
          const info = modelInfo(model, modelKey);
          const values: unknown[] = [];
          const condition = predicate(info, where, values);
          const result = await database.query(`DELETE FROM ${info.table} WHERE ${condition}`, values);
          return result.rowCount ?? 0;
        },

        async consumeOne<T>({ model, modelKey, where }: Parameters<NonNullable<CustomAdapter["consumeOne"]>>[0]) {
          const info = modelInfo(model, modelKey);
          if (!where.length) return null;
          const values: unknown[] = [];
          const condition = singleRowGuard(info, where, values);
          const result = await database.query(`DELETE FROM ${info.table} AS "target" WHERE ${condition} RETURNING "target".*`, values);
          return (result.rows[0] ?? null) as T | null;
        },

        async incrementOne<T>({ model, modelKey, where, increment, set }: Parameters<NonNullable<CustomAdapter["incrementOne"]>>[0]) {
          const info = modelInfo(model, modelKey);
          if (!where.length) return null;
          const values: unknown[] = [];
          const increments = Object.entries(increment);
          for (const [field, delta] of increments) {
            if (!info.numericColumns.has(field) || !Number.isFinite(delta)) {
              throw new Error(`Invalid authentication numeric increment: ${info.key}.${field}`);
            }
          }
          const absolute = Object.fromEntries(Object.entries(set ?? {}).filter(([field]) => !Object.hasOwn(increment, field)));
          const updates = assignments(info, absolute, values);
          for (const [field, delta] of increments) {
            updates.push(`${column(info, field)} = ${column(info, field, "target")} + ${bind(values, delta)}`);
          }
          if (!updates.length) throw new Error("incrementOne requires at least one assignment");
          const condition = singleRowGuard(info, where, values);
          const result = await database.query(`UPDATE ${info.table} AS "target" SET ${updates.join(", ")} WHERE ${condition} RETURNING "target".*`, values);
          return (result.rows[0] ?? null) as T | null;
        },

        async count({ model, modelKey, where }) {
          const info = modelInfo(model, modelKey);
          const values: unknown[] = [];
          const condition = predicate(info, where, values);
          const result = await database.query<{ count: string }>(`SELECT COUNT(*) AS "count" FROM ${info.table} WHERE ${condition}`, values);
          const count = Number(result.rows[0]?.count ?? 0);
          if (!Number.isSafeInteger(count) || count < 0) throw new Error("Authentication row count exceeds the safe integer range");
          return count;
        },
      };
      return implementation;
    };

    let adapter: DBAdapter;
    adapter = createAdapterFactory({
      config: {
        adapterId: "jobflow-postgres",
        adapterName: "JobFlow PostgreSQL",
        supportsUUIDs: true,
        supportsDates: true,
        supportsJSON: true,
        supportsBooleans: true,
        supportsArrays: true,
        // node-postgres serializes JavaScript arrays as SQL arrays; JSON values
        // (including arrays and scalar strings) need explicit JSON encoding.
        customTransformInput: ({ data, fieldAttributes }) => fieldAttributes.type === "json" && data !== undefined
          ? JSON.stringify(data)
          : data,
        customTransformOutput: ({ data, fieldAttributes }) => {
          if (fieldAttributes.type !== "number" || typeof data !== "string") return data;
          const value = Number(data);
          if (!Number.isFinite(value) || (fieldAttributes.bigint && !Number.isSafeInteger(value))) {
            throw new Error("Authentication numeric value exceeds the supported range");
          }
          return value;
        },
        transaction: (work) => database.transaction(async () => work(adapter)),
      },
      adapter: customAdapter,
    })(options);
    return adapter;
  };
}
