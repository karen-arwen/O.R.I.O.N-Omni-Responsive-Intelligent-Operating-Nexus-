"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostgresEventStore = void 0;
class PostgresEventStore {
    constructor({ pool }) {
        this.pool = pool;
    }
    normalizeTimestamp(ts) {
        return ts ? new Date(ts).toISOString() : new Date().toISOString();
    }
    async withClient(fn) {
        const client = await this.pool.connect();
        try {
            return await fn(client);
        }
        finally {
            client.release();
        }
    }
    async append(event) {
        await this.appendMany([event]);
    }
    async appendMany(events) {
        if (events.length === 0)
            return;
        await this.withClient(async (client) => {
            await client.query("BEGIN");
            try {
                for (const ev of events) {
                    await client.query(`
            INSERT INTO events(
              id, tenant_id, aggregate_id, type, ts, decision_id, correlation_id, payload, meta
            ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
            ON CONFLICT (id) DO NOTHING
          `, [
                        ev.id,
                        ev.meta.tenantId,
                        ev.aggregateId,
                        ev.type,
                        this.normalizeTimestamp(ev.timestamp),
                        ev.meta.decisionId ?? null,
                        ev.meta.correlationId ?? null,
                        JSON.stringify(ev.payload ?? {}),
                        JSON.stringify(ev.meta),
                    ]);
                }
                await client.query("COMMIT");
            }
            catch (err) {
                await client.query("ROLLBACK");
                throw err;
            }
        });
    }
    async getByAggregateId(aggregateId) {
        const res = await this.pool.query(`SELECT * FROM events WHERE aggregate_id=$1 ORDER BY ts ASC, id ASC`, [aggregateId]);
        return res.rows.map(rowToEvent);
    }
    async query(filter = {}) {
        if (!filter.tenantId)
            throw new Error("tenantId is required for postgres event store");
        const values = [];
        const where = [];
        where.push(`tenant_id = $${values.length + 1}`);
        values.push(filter.tenantId);
        if (filter.decisionId) {
            where.push(`decision_id = $${values.length + 1}`);
            values.push(filter.decisionId);
        }
        if (filter.correlationId) {
            where.push(`correlation_id = $${values.length + 1}`);
            values.push(filter.correlationId);
        }
        if (filter.aggregateId) {
            where.push(`aggregate_id = $${values.length + 1}`);
            values.push(filter.aggregateId);
        }
        if (filter.types && filter.types.length > 0) {
            where.push(`type = ANY($${values.length + 1})`);
            values.push(filter.types);
        }
        if (filter.since) {
            where.push(`ts >= $${values.length + 1}`);
            values.push(filter.since);
        }
        if (filter.until) {
            where.push(`ts <= $${values.length + 1}`);
            values.push(filter.until);
        }
        let sql = `SELECT * FROM events WHERE ${where.join(" AND ")} ORDER BY ts ASC, id ASC`;
        if (filter.limit) {
            sql += ` LIMIT ${filter.limit}`;
        }
        const res = await this.pool.query(sql, values);
        return res.rows.map(rowToEvent);
    }
}
exports.PostgresEventStore = PostgresEventStore;
function rowToEvent(row) {
    return {
        id: row.id,
        aggregateId: row.aggregate_id,
        type: row.type,
        timestamp: row.ts.toISOString(),
        payload: row.payload,
        meta: row.meta,
        tags: row.meta?.tags,
    };
}
