"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildServer = void 0;
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const crypto_1 = require("crypto");
const path_1 = require("path");
const zod_1 = require("zod");
const src_1 = require("../../../packages/event-store/src");
const postgresEventStore_1 = require("../../../packages/event-store/src/postgresEventStore");
const src_2 = require("../../../packages/audit/src");
const src_3 = require("../../../packages/permissions/src");
const timeline_1 = require("../../../packages/shared/src/timeline");
const planner_1 = require("../../../packages/planner/src/planner");
const src_4 = require("../../../packages/trust/src");
const ioredis_1 = __importDefault(require("ioredis"));
const pg_1 = require("pg");
const cache_1 = require("./cache");
const jobRepo_1 = require("./jobs/jobRepo");
const queue_1 = require("./jobs/queue");
const src_5 = require("../../../packages/tools/src");
const version = process.env.ORION_VERSION ?? "0.0.1";
const envSchema = zod_1.z.object({
    ORION_API_PORT: zod_1.z.coerce.number().int().positive().default(3000),
    ORION_STORAGE_PATH: zod_1.z.string().default((0, path_1.join)(process.cwd(), "data", "events.json")),
    ORION_ALLOWED_ORIGINS: zod_1.z.string().default("*"),
    ORION_RATE_LIMIT: zod_1.z.coerce.number().int().positive().default(120),
    ORION_RATE_WINDOW_MS: zod_1.z.coerce.number().int().positive().default(60000),
    ORION_LOG_LEVEL: zod_1.z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),
    ORION_TENANT_WHITELIST: zod_1.z.string().default("*"),
    ORION_DEV_AUTH_BYPASS: zod_1.z.string().optional().default("true"),
    ORION_AUTH_TOKENS: zod_1.z.string().optional(),
    ORION_AUTH_DEFAULT_ROLES: zod_1.z.string().optional().default("admin"),
    ORION_AUTH_DEFAULT_USER: zod_1.z.string().optional().default("api-user"),
    ORION_DB_URL: zod_1.z.string().optional(),
    ORION_EVENTSTORE_ADAPTER: zod_1.z.enum(["postgres", "json", "memory"]).optional(),
    ORION_REDIS_URL: zod_1.z.string().optional(),
    ORION_CACHE_ENABLED: zod_1.z.string().optional().default("true"),
    ORION_RATE_LIMIT_BACKEND: zod_1.z.enum(["redis", "memory"]).optional(),
});
const actorSchema = zod_1.z.object({
    userId: zod_1.z.string().min(1),
    roles: zod_1.z.array(zod_1.z.string()).optional(),
    trustLevel: zod_1.z.number().optional(),
    phase: zod_1.z.string().optional(),
});
const metaSchema = zod_1.z.object({
    actor: actorSchema,
    source: zod_1.z.enum(["system", "user", "integration"]),
    decisionId: zod_1.z.string().min(1),
    correlationId: zod_1.z.string().optional(),
    causationId: zod_1.z.string().optional(),
    phase: zod_1.z.string().optional(),
    description: zod_1.z.string().optional(),
    tenantId: zod_1.z.string().min(1).optional(),
});
const domainEventSchema = zod_1.z.object({
    id: zod_1.z.string().uuid().optional(),
    aggregateId: zod_1.z.string().min(1),
    type: zod_1.z.string().min(1),
    timestamp: zod_1.z.string().datetime().optional(),
    payload: zod_1.z.record(zod_1.z.any()).optional(),
    meta: metaSchema,
    tags: zod_1.z.array(zod_1.z.string()).optional(),
});
const eventQuerySchema = zod_1.z.object({
    aggregateId: zod_1.z.string().optional(),
    type: zod_1.z.string().optional(),
    decisionId: zod_1.z.string().optional(),
    correlationId: zod_1.z.string().optional(),
    limit: zod_1.z.coerce.number().int().positive().optional(),
});
const permissionRequestSchema = zod_1.z.object({
    actor: actorSchema,
    domain: zod_1.z.string().min(1),
    action: zod_1.z.string().min(1),
    resource: zod_1.z.string().optional(),
    context: zod_1.z.record(zod_1.z.any()).optional(),
    risk: zod_1.z.enum(["low", "medium", "high"]).optional(),
    riskReasons: zod_1.z.array(zod_1.z.string()).optional(),
    decisionId: zod_1.z.string().min(1),
    correlationId: zod_1.z.string().optional(),
});
const tenantRegex = /^[a-z0-9_-]{1,32}$/;
const toBool = (val) => val === "true" || val === "1" || val === "yes";
const splitCsv = (val) => (val ?? "").split(",").map((v) => v.trim()).filter(Boolean);
const ctxTenant = (request) => {
    const header = request.headers["x-tenant-id"]?.trim();
    return header && header.length > 0 ? header : "local";
};
const tenantScopedStore = (base, tenantId, defaultActor) => {
    const ensureMeta = (event) => ({
        ...event,
        meta: {
            ...event.meta,
            tenantId,
            actor: event.meta.actor ?? defaultActor ?? { userId: "unknown" },
            correlationId: event.meta.correlationId ?? event.meta.decisionId,
        },
    });
    return {
        append: async (event) => base.append(ensureMeta(event)),
        appendMany: async (events) => base.appendMany(events.map(ensureMeta)),
        getByAggregateId: async (aggregateId) => {
            const events = await base.getByAggregateId(aggregateId);
            return events.filter((evt) => evt.meta.tenantId === tenantId);
        },
        query: async (filter) => base.query({ ...filter, tenantId }),
    };
};
const normalizeCursor = (cursor) => cursor.replace(/-/g, "+").replace(/_/g, "/");
const decodeCursor = (cursor) => {
    const normalized = normalizeCursor(cursor);
    const pad = normalized.length % 4;
    const padded = normalized + (pad ? "=".repeat(4 - pad) : "");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf-8"));
};
const roleAllows = (roles, allowed) => {
    if (!allowed.length)
        return true;
    const set = new Set((roles ?? []).map((r) => r.toLowerCase()));
    return allowed.some((r) => set.has(r.toLowerCase()));
};
const safeSummary = (val, max = 180) => {
    if (val === null || val === undefined)
        return "";
    const s = typeof val === "string" ? val : JSON.stringify(val);
    return s.length > max ? `${s.slice(0, max)}…` : s;
};
const buildServer = (deps = {}) => {
    const env = envSchema.parse({ ...process.env, ...deps.envOverrides });
    const dbUrl = env.ORION_DB_URL;
    const adapter = env.ORION_EVENTSTORE_ADAPTER ?? (dbUrl ? "postgres" : "json");
    let eventStore;
    let pool = null;
    if (deps.eventStore) {
        eventStore = deps.eventStore;
    }
    else if (adapter === "postgres" && dbUrl) {
        pool = new pg_1.Pool({ connectionString: dbUrl });
        eventStore = new postgresEventStore_1.PostgresEventStore({ pool });
    }
    else if (adapter === "memory") {
        eventStore = new src_1.InMemoryEventStore();
    }
    else {
        eventStore = new src_1.JsonFileEventStore(env.ORION_STORAGE_PATH);
    }
    const baseAudit = deps.auditLogger ?? new src_2.AuditLogger(eventStore);
    const basePermission = deps.permissionEngine ?? new src_3.PermissionEngine(eventStore, baseAudit);
    const permissionRules = typeof basePermission.getRules === "function" ? basePermission.getRules() : [];
    const whitelistList = splitCsv(env.ORION_TENANT_WHITELIST);
    const allowAllTenants = whitelistList.length === 0 || whitelistList.includes("*");
    const tenantWhitelist = new Set(whitelistList.length ? whitelistList : ["local"]);
    const metrics = {
        startTime: Date.now(),
        requests: 0,
        errors: 0,
        perRoute: new Map(),
        jobs: { queued: 0, running: 0, failed: 0, succeeded: 0, dead_letter: 0 },
    };
    // TODO: replace in-memory limiter with shared backend (e.g., Redis) for multi-instance deploys
    const inMemoryRateLimiter = new Map();
    const redisUrl = env.ORION_REDIS_URL;
    const cacheEnabled = toBool(env.ORION_CACHE_ENABLED);
    const redisClient = redisUrl ? new ioredis_1.default(redisUrl) : null;
    const redisCache = deps.redisCache ?? (redisClient && cacheEnabled ? new cache_1.RedisCache(redisClient) : null);
    const rateBackend = env.ORION_RATE_LIMIT_BACKEND ?? (redisClient ? "redis" : "memory");
    const redisLimiter = deps.redisRateLimiter ??
        (redisClient && rateBackend === "redis" ? new cache_1.RedisRateLimiter(redisClient, env.ORION_RATE_LIMIT, env.ORION_RATE_WINDOW_MS) : null);
    const jobRepo = pool ? new jobRepo_1.JobRepository(pool) : null;
    const jobQueue = redisClient ? new queue_1.JobQueue(redisClient) : null;
    const app = (0, fastify_1.default)({
        logger: { level: env.ORION_LOG_LEVEL },
        disableRequestLogging: false,
        genReqId: () => (0, crypto_1.randomUUID)(),
    });
    app.register(cors_1.default, {
        origin: env.ORION_ALLOWED_ORIGINS === "*" ? true : env.ORION_ALLOWED_ORIGINS.split(",").map((o) => o.trim()),
        methods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: ["Content-Type", "If-None-Match", "X-Request-ID", "Authorization", "x-tenant-id"],
        maxAge: 86400,
    });
    const makeError = (request, code, message, details, statusCode = 400) => {
        const payload = { error: { code, message } };
        if (details)
            payload.error.details = details;
        payload.error.requestId = request.id;
        return { statusCode, payload };
    };
    const sendError = (request, reply, statusCode, code, message, details) => {
        const response = makeError(request, code, message, details, statusCode);
        reply.status(statusCode);
        return reply.send(response.payload);
    };
    const ensureRole = (request, reply, roles) => {
        const ctx = request.ctx;
        if (!ctx)
            return sendError(request, reply, 401, "unauthorized", "Missing auth context");
        if (!roleAllows(ctx.actor.roles, roles)) {
            return sendError(request, reply, 403, "forbidden", "Insufficient role");
        }
        return null;
    };
    app.addHook("onRequest", (request, reply, done) => {
        const now = Date.now();
        request._start = now;
        metrics.requests += 1;
        reply.header("X-Request-ID", request.id);
        reply.header("X-Frame-Options", "DENY");
        reply.header("X-Content-Type-Options", "nosniff");
        reply.header("Referrer-Policy", "no-referrer");
        const routeUrl = request.routeOptions?.url ?? request.routerPath ?? request.url.split("?")[0];
        const routeKey = `${ctxTenant(request)}:${request.ip}:${routeUrl}`;
        if (redisLimiter) {
            redisLimiter
                .hit(`rl:${routeKey}`)
                .then((res) => {
                if (!res.allowed) {
                    reply.header("Retry-After", res.retryAfter ?? Math.ceil(env.ORION_RATE_WINDOW_MS / 1000));
                    return reply
                        .status(429)
                        .send({ error: { code: "rate_limited", message: "Too many requests", requestId: request.id } });
                }
                done();
            })
                .catch(() => done());
            return;
        }
        else {
            const entry = inMemoryRateLimiter.get(routeKey);
            if (!entry || entry.resetAt < now) {
                inMemoryRateLimiter.set(routeKey, { count: 1, resetAt: now + env.ORION_RATE_WINDOW_MS });
            }
            else {
                entry.count += 1;
                if (entry.count > env.ORION_RATE_LIMIT) {
                    reply.header("Retry-After", Math.ceil((entry.resetAt - now) / 1000));
                    return reply
                        .status(429)
                        .send({ error: { code: "rate_limited", message: "Too many requests", requestId: request.id } });
                }
            }
        }
        const tenantHeader = request.headers["x-tenant-id"]?.trim();
        const tenantId = tenantHeader && tenantHeader.length > 0 ? tenantHeader : "local";
        if (!tenantRegex.test(tenantId)) {
            return sendError(request, reply, 400, "invalid_tenant", "Invalid tenant id");
        }
        if (!allowAllTenants && !tenantWhitelist.has(tenantId)) {
            return sendError(request, reply, 400, "tenant_not_allowed", "Tenant not whitelisted");
        }
        reply.header("x-tenant-id", tenantId);
        const bypass = toBool(env.ORION_DEV_AUTH_BYPASS);
        let actor = null;
        const isPublic = routeUrl === "/health";
        if (bypass || isPublic) {
            actor = bypass ? { userId: "dev", roles: ["admin"] } : { userId: "public", roles: ["public"] };
        }
        else {
            const auth = request.headers.authorization;
            const tokens = splitCsv(env.ORION_AUTH_TOKENS);
            if (!auth || !auth.startsWith("Bearer ")) {
                return sendError(request, reply, 401, "unauthorized", "Missing bearer token");
            }
            const token = auth.replace("Bearer ", "").trim();
            if (!tokens.includes(token)) {
                return sendError(request, reply, 401, "unauthorized", "Invalid token");
            }
            const tokenKey = token.replace(/[^a-zA-Z0-9]/g, "_");
            const roleEnv = process.env[`ORION_AUTH_TOKEN_ROLES_${tokenKey}`];
            const userEnv = process.env[`ORION_AUTH_TOKEN_USER_${tokenKey}`];
            const roles = splitCsv(roleEnv).length ? splitCsv(roleEnv) : splitCsv(env.ORION_AUTH_DEFAULT_ROLES ?? "admin");
            const userId = userEnv ?? env.ORION_AUTH_DEFAULT_USER ?? token;
            actor = { userId, roles };
        }
        request.ctx = { tenantId, actor };
        done();
    });
    app.addHook("preHandler", (request, reply, done) => {
        const bodyMeta = request.body?.meta;
        const correlationId = bodyMeta?.correlationId ??
            bodyMeta?.decisionId ??
            request.query?.correlationId ??
            request.query?.decisionId ??
            request.params?.decisionId;
        if (correlationId)
            reply.header("X-Correlation-ID", correlationId);
        const ctx = request.ctx;
        if (ctx) {
            request.log.info({ tenantId: ctx.tenantId, actor: ctx.actor?.userId, requestId: request.id }, "ctx");
        }
        done();
    });
    app.addHook("onResponse", (request, reply, done) => {
        const routeKey = request.routeOptions?.url ?? request.url;
        if (!metrics.perRoute.has(routeKey)) {
            metrics.perRoute.set(routeKey, { count: 0, errors: 0, statuses: {}, durationsMs: [] });
        }
        const perRoute = metrics.perRoute.get(routeKey);
        perRoute.count += 1;
        perRoute.statuses[reply.statusCode] = (perRoute.statuses[reply.statusCode] ?? 0) + 1;
        const duration = Date.now() - (request._start ?? Date.now());
        perRoute.durationsMs.push(duration);
        if (reply.statusCode >= 500) {
            metrics.errors += 1;
            perRoute.errors += 1;
        }
        done();
    });
    app.setErrorHandler((error, request, reply) => {
        const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
        request.log.error({ err: error, requestId: request.id }, "request failed");
        return sendError(request, reply, status, error.code ?? "internal_error", status === 500 ? "Internal server error" : error.message, error.validation ?? error.cause ?? error.message);
    });
    app.setNotFoundHandler((request, reply) => {
        return sendError(request, reply, 404, "not_found", "Route not found");
    });
    app.get("/health", async (request, reply) => {
        return reply.send({
            status: "ok",
            uptime: process.uptime(),
            version,
            timestamp: new Date().toISOString(),
        });
    });
    app.get("/metrics", async (request, reply) => {
        const guard = ensureRole(request, reply, ["admin"]);
        if (guard)
            return guard;
        reply.header("Cache-Control", "no-store");
        const summarized = Array.from(metrics.perRoute.entries()).map(([route, data]) => ({
            route,
            count: data.count,
            errors: data.errors,
            statuses: data.statuses,
            p95: percentile(data.durationsMs, 0.95),
            p99: percentile(data.durationsMs, 0.99),
        }));
        return reply.send({
            startedAt: new Date(metrics.startTime).toISOString(),
            uptime: process.uptime(),
            requests: metrics.requests,
            errors: metrics.errors,
            routes: summarized,
            jobs: metrics.jobs,
        });
    });
    const scopedDeps = (ctx) => {
        const store = tenantScopedStore(eventStore, ctx.tenantId, ctx.actor);
        const audit = new src_2.AuditLogger(store);
        const permissions = new src_3.PermissionEngine(store, audit, permissionRules);
        const trust = new src_4.TrustService({ eventStore: store });
        const planner = new planner_1.Planner({ eventStore: store, audit, permissions, trust });
        const auditQuery = new src_2.AuditQueryService(store);
        return { store, audit, permissions, trust, planner, auditQuery };
    };
    const emitJobEvent = async (ctx, type, job, payload = {}) => {
        const { store } = scopedDeps(ctx);
        const event = {
            id: (0, crypto_1.randomUUID)(),
            aggregateId: job.decisionId ?? job.id,
            type,
            timestamp: new Date().toISOString(),
            payload: {
                jobId: job.id,
                jobType: job.type,
                status: job.status,
                attempts: job.attempts,
                maxAttempts: job.maxAttempts,
                runAt: job.runAt,
                summarySafe: safeSummary(payload?.summarySafe ?? job.type),
                ...payload,
            },
            meta: {
                actor: ctx.actor ?? { userId: "system" },
                source: "system",
                decisionId: job.decisionId ?? job.id,
                correlationId: job.correlationId ?? job.decisionId ?? job.id,
                tenantId: ctx.tenantId,
            },
        };
        await store.append(event);
    };
    app.post("/events", async (request, reply) => {
        const guard = ensureRole(request, reply, ["member", "admin"]);
        if (guard)
            return guard;
        const ctx = request.ctx;
        const { store } = scopedDeps(ctx);
        const parsed = domainEventSchema.safeParse(request.body);
        if (!parsed.success) {
            return sendError(request, reply, 400, "invalid_event", "Invalid event payload", parsed.error.issues);
        }
        const body = parsed.data;
        const event = {
            id: body.id ?? (0, crypto_1.randomUUID)(),
            aggregateId: body.aggregateId,
            type: body.type,
            timestamp: body.timestamp ?? new Date().toISOString(),
            payload: body.payload ?? {},
            meta: {
                ...body.meta,
                correlationId: body.meta.correlationId ?? body.meta.decisionId,
                tenantId: ctx.tenantId,
            },
            tags: body.tags,
        };
        await store.append(event);
        return reply.status(201).send({ event });
    });
    app.get("/events", async (request, reply) => {
        const guard = ensureRole(request, reply, ["member", "admin"]);
        if (guard)
            return guard;
        const ctx = request.ctx;
        const { store } = scopedDeps(ctx);
        const parsed = eventQuerySchema.safeParse(request.query);
        if (!parsed.success) {
            return sendError(request, reply, 400, "invalid_query", "Invalid query", parsed.error.issues);
        }
        const query = parsed.data;
        const filter = {
            aggregateId: query.aggregateId,
            types: query.type ? [query.type] : undefined,
            decisionId: query.decisionId,
            correlationId: query.correlationId,
            limit: query.limit,
            tenantId: ctx.tenantId,
        };
        const events = await store.query(filter);
        return reply.send({ events });
    });
    app.get("/audit", async (request, reply) => {
        const guard = ensureRole(request, reply, ["admin"]);
        if (guard)
            return guard;
        reply.header("Cache-Control", "no-store");
        const ctx = request.ctx;
        const { auditQuery } = scopedDeps(ctx);
        const parsed = zod_1.z
            .object({
            decisionId: zod_1.z.string().optional(),
            correlationId: zod_1.z.string().optional(),
            limit: zod_1.z.coerce.number().int().positive().optional(),
        })
            .safeParse(request.query);
        if (!parsed.success) {
            return sendError(request, reply, 400, "invalid_query", "Invalid query", parsed.error.issues);
        }
        const filter = {
            decisionId: parsed.data.decisionId,
            correlationId: parsed.data.correlationId,
            limit: parsed.data.limit,
            tenantId: ctx.tenantId,
        };
        const events = await auditQuery.list(filter);
        return reply.send({ events });
    });
    app.post("/permissions/evaluate", async (request, reply) => {
        const guard = ensureRole(request, reply, ["member", "admin"]);
        if (guard)
            return guard;
        const ctx = request.ctx;
        const { permissions } = scopedDeps(ctx);
        const parsed = permissionRequestSchema.safeParse(request.body);
        if (!parsed.success) {
            return sendError(request, reply, 400, "invalid_permission_request", "Invalid permission payload", parsed.error.issues);
        }
        const input = parsed.data;
        const actor = input.actor ?? ctx.actor;
        const { decision, event } = await permissions.evaluate({
            actor,
            domain: input.domain,
            action: input.action,
            resource: input.resource,
            context: input.context,
            risk: input.risk,
            riskReasons: input.riskReasons,
            decisionId: input.decisionId,
            correlationId: input.correlationId ?? input.decisionId,
            tenantId: ctx.tenantId,
        });
        return reply.send({
            decisionId: input.decisionId,
            correlationId: input.correlationId ?? input.decisionId,
            decision,
            decisionEventId: event.id,
        });
    });
    app.post("/planner/decide", async (request, reply) => {
        const guard = ensureRole(request, reply, ["member", "admin"]);
        if (guard)
            return guard;
        const ctx = request.ctx;
        const { planner } = scopedDeps(ctx);
        const parsed = zod_1.z
            .object({
            intent: zod_1.z.object({
                type: zod_1.z.string(),
                payload: zod_1.z.record(zod_1.z.any()).optional(),
                domain: zod_1.z.string(),
                action: zod_1.z.string(),
                declaredRisk: zod_1.z.enum(["low", "medium", "high"]).optional(),
                declaredRiskReasons: zod_1.z.array(zod_1.z.string()).optional(),
            }),
            actor: actorSchema,
            decisionId: zod_1.z.string().optional(),
            correlationId: zod_1.z.string().optional(),
            context: zod_1.z
                .object({
                timeOfDay: zod_1.z.string().optional(),
                openTasks: zod_1.z.number().int().optional(),
                urgency: zod_1.z.enum(["low", "medium", "high"]).optional(),
                phase: zod_1.z.enum(["normal", "overloaded", "recovery", "build", "creative", "transition"]).optional(),
                energy: zod_1.z.enum(["low", "normal", "high"]).optional(),
                trust: zod_1.z.record(zod_1.z.number()).optional(),
            })
                .optional(),
        })
            .safeParse(request.body);
        if (!parsed.success) {
            return sendError(request, reply, 400, "invalid_planner_request", "Invalid planner payload", parsed.error.issues);
        }
        const body = parsed.data;
        const result = await planner.decide({
            intent: body.intent,
            actor: body.actor ?? ctx.actor,
            decisionId: body.decisionId,
            correlationId: body.correlationId,
            context: body.context,
            tenantId: ctx.tenantId,
        });
        return reply.send(result);
    });
    app.get("/decisions/:decisionId/snapshot", async (request, reply) => {
        const guard = ensureRole(request, reply, ["member", "admin"]);
        if (guard)
            return guard;
        const ctx = request.ctx;
        const { store } = scopedDeps(ctx);
        const decisionId = request.params.decisionId;
        if (!decisionId) {
            return sendError(request, reply, 400, "missing_decision_id", "Missing decisionId");
        }
        const finalTypes = ["decision.suggested", "decision.ready_to_execute", "system.no_action"];
        const finals = await store.query({ decisionId, types: finalTypes, limit: 50, tenantId: ctx.tenantId });
        const finalEvent = finals
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
        if (!finalEvent) {
            const partial = await store.query({
                decisionId,
                types: ["decision.created", "decision.optioned"],
                tenantId: ctx.tenantId,
            });
            if (partial.length === 0) {
                return sendError(request, reply, 404, "decision_not_found", "Decision not found");
            }
            return sendError(request, reply, 409, "decision_incomplete", "Decision incomplete");
        }
        const snapshot = finalEvent.payload?.snapshot;
        if (!snapshot) {
            return sendError(request, reply, 500, "snapshot_missing", "Snapshot missing in final event");
        }
        const etagRaw = finalEvent.id;
        const etag = `"${etagRaw}"`;
        const payloadKey = `snapshot:${ctx.tenantId}:${decisionId}:v:${etagRaw}`;
        if (redisCache) {
            const cached = await redisCache.get(payloadKey);
            if (cached) {
                reply.header("ETag", etag);
                reply.header("Cache-Control", "private, max-age=0, must-revalidate");
                return reply.send(cached);
            }
        }
        const ifNoneMatch = request.headers["if-none-match"];
        const normalizedIfNoneMatch = ifNoneMatch?.replace(/W\//, "").replace(/"/g, "");
        if (normalizedIfNoneMatch && normalizedIfNoneMatch === etagRaw) {
            reply.header("ETag", etag);
            reply.header("Cache-Control", "private, max-age=0, must-revalidate");
            return reply.status(304).send();
        }
        const payload = {
            decisionId,
            correlationId: finalEvent.meta.correlationId,
            snapshot,
            events: finals.map((e) => ({ id: e.id, type: e.type, timestamp: e.timestamp })),
            capabilities: { canExecute: false, v: "v0" },
            etag,
        };
        reply.header("ETag", etag);
        reply.header("Cache-Control", "private, max-age=0, must-revalidate");
        if (redisCache) {
            await redisCache.set(payloadKey, payload, 30);
        }
        return reply.send(payload);
    });
    app.get("/timeline", async (request, reply) => {
        const guard = ensureRole(request, reply, ["member", "admin"]);
        if (guard)
            return guard;
        const ctx = request.ctx;
        const { store } = scopedDeps(ctx);
        const parsed = zod_1.z
            .object({
            correlationId: zod_1.z.string().optional(),
            decisionId: zod_1.z.string().optional(),
            domain: zod_1.z.string().optional(),
            types: zod_1.z.string().optional(),
            kind: zod_1.z.enum(["decision", "trust", "system", "audit", "other"]).optional(),
            from: zod_1.z.string().datetime().optional(),
            to: zod_1.z.string().datetime().optional(),
            limit: zod_1.z.coerce.number().int().positive().max(200).optional(),
            cursor: zod_1.z.string().optional(),
        })
            .safeParse(request.query);
        if (!parsed.success) {
            return sendError(request, reply, 400, "invalid_timeline_query", "Invalid timeline query", parsed.error.issues);
        }
        const q = parsed.data;
        const limit = q.limit ?? 50;
        if (!q.correlationId && !q.decisionId && !q.domain && !q.types && !q.from && !q.to) {
            return sendError(request, reply, 400, "missing_filters", "Provide at least one filter or from/to for timeline");
        }
        let cursorObj = null;
        if (q.cursor) {
            try {
                cursorObj = decodeCursor(q.cursor);
            }
            catch {
                return sendError(request, reply, 400, "invalid_cursor", "Invalid cursor");
            }
        }
        const filterTypes = q.types ? q.types.split(",").map((t) => t.trim()).filter(Boolean) : undefined;
        const events = await store.query({
            decisionId: q.decisionId,
            correlationId: q.correlationId,
            types: filterTypes,
            since: q.from,
            until: q.to,
            limit: undefined,
            tenantId: ctx.tenantId,
        });
        const filtered = events
            .filter((evt) => {
            if (q.kind && (0, timeline_1.mapKind)(evt) !== q.kind)
                return false;
            if (q.domain) {
                const domain = (0, timeline_1.sanitizeEventForTimeline)(evt).domain;
                if (domain !== q.domain)
                    return false;
            }
            return true;
        })
            .sort((a, b) => {
            const ta = new Date(a.timestamp).getTime();
            const tb = new Date(b.timestamp).getTime();
            if (ta === tb)
                return a.id.localeCompare(b.id);
            return ta - tb;
        })
            .filter((evt) => {
            if (!cursorObj)
                return true;
            const ts = new Date(evt.timestamp).getTime();
            const cursorTs = new Date(cursorObj.ts).getTime();
            if (ts > cursorTs)
                return true;
            if (ts === cursorTs && evt.id > cursorObj.id)
                return true;
            return false;
        });
        const page = filtered.slice(0, limit);
        const nextItem = filtered[limit];
        const nextCursor = nextItem &&
            Buffer.from(JSON.stringify({
                ts: nextItem.timestamp,
                id: nextItem.id,
            }))
                .toString("base64")
                .replace(/\+/g, "-")
                .replace(/\//g, "_")
                .replace(/=+$/, "");
        const items = page.map((evt) => {
            const sanitized = (0, timeline_1.sanitizeEventForTimeline)(evt);
            return {
                id: evt.id,
                type: evt.type,
                timestamp: evt.timestamp,
                decisionId: evt.meta.decisionId,
                correlationId: evt.meta.correlationId,
                domain: sanitized.domain,
                kind: sanitized.kind,
                summary: sanitized.summary,
                payload: sanitized.payload,
            };
        });
        return reply.send({
            items,
            nextCursor: nextCursor ?? null,
            capabilities: { canExecute: false, v: "v0" },
        });
    });
    app.post("/decisions/:decisionId/feedback", async (request, reply) => {
        const guard = ensureRole(request, reply, ["member", "admin"]);
        if (guard)
            return guard;
        const ctx = request.ctx;
        const { store, trust } = scopedDeps(ctx);
        const decisionId = request.params.decisionId;
        const parsed = zod_1.z
            .object({
            accepted: zod_1.z.boolean().optional(),
            rejected: zod_1.z.boolean().optional(),
        })
            .superRefine((val, ctx2) => {
            const accepted = !!val.accepted;
            const rejected = !!val.rejected;
            if ((accepted && rejected) || (!accepted && !rejected)) {
                ctx2.addIssue({
                    code: "custom",
                    message: "Provide exactly one of accepted or rejected",
                });
            }
        })
            .safeParse(request.body);
        if (!parsed.success) {
            return sendError(request, reply, 400, "invalid_feedback", "Invalid feedback payload", parsed.error.issues);
        }
        if (!decisionId) {
            return sendError(request, reply, 400, "missing_decision_id", "Missing decisionId");
        }
        const feedback = parsed.data;
        const finals = await store.query({
            decisionId,
            types: ["decision.suggested", "decision.ready_to_execute", "system.no_action"],
            limit: 50,
            tenantId: ctx.tenantId,
        });
        const finalEvent = finals
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
        if (!finalEvent) {
            const partial = await store.query({ decisionId, types: ["decision.created", "decision.optioned"], tenantId: ctx.tenantId });
            if (partial.length === 0)
                return sendError(request, reply, 404, "decision_not_found", "Decision not found");
            return sendError(request, reply, 409, "decision_incomplete", "Decision incomplete");
        }
        const existingFeedback = await store.query({
            decisionId,
            types: ["decision.accepted", "decision.rejected"],
            limit: 10,
            tenantId: ctx.tenantId,
        });
        if (existingFeedback.length > 0) {
            const last = existingFeedback.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
            const payload = last.payload;
            const domain = payload.domain;
            const trustValue = trust.getTrust(domain);
            return reply.send({
                decisionId,
                correlationId: last.meta.correlationId,
                domain,
                feedback: last.type === "decision.accepted" ? "accepted" : "rejected",
                trust: { score: trustValue },
                capabilities: { canExecute: false, v: "v0" },
            });
        }
        const snapshot = finalEvent.payload?.snapshot;
        const domain = snapshot?.intent?.domain;
        if (!domain) {
            return sendError(request, reply, 500, "domain_missing", "Domain missing in snapshot");
        }
        const correlationId = finalEvent.meta.correlationId ?? decisionId;
        const feedbackType = feedback.accepted ? "decision.accepted" : "decision.rejected";
        const feedbackEvent = {
            id: (0, crypto_1.randomUUID)(),
            aggregateId: decisionId,
            type: feedbackType,
            timestamp: new Date().toISOString(),
            payload: {
                domain,
                feedback: feedbackType,
            },
            meta: {
                actor: snapshot?.intent?.actor ?? { userId: finalEvent.meta.actor?.userId ?? "unknown" },
                source: "user",
                decisionId,
                correlationId,
                tenantId: ctx.tenantId,
            },
        };
        await store.append(feedbackEvent);
        const updated = trust.applyFeedback({
            domain,
            decisionId,
            correlationId,
            accepted: !!feedback.accepted,
            rejected: !!feedback.rejected,
        });
        const trustEvent = {
            id: (0, crypto_1.randomUUID)(),
            aggregateId: decisionId,
            type: src_4.TrustEvents.TRUST_UPDATED_EVENT,
            timestamp: new Date().toISOString(),
            payload: updated,
            meta: {
                actor: { userId: snapshot?.meta?.actor?.userId ?? finalEvent.meta.actor?.userId ?? "system" },
                source: "system",
                decisionId,
                correlationId,
                tenantId: ctx.tenantId,
            },
            tags: ["trust"],
        };
        await store.append(trustEvent);
        if (redisCache) {
            await redisCache.del(`trust:${ctx.tenantId}:all`);
            await redisCache.del(`trust:${ctx.tenantId}:${domain}`);
        }
        return reply.send({
            decisionId,
            correlationId,
            domain,
            trust: { oldScore: updated.oldScore, newScore: updated.newScore },
            feedback: feedbackType === "decision.accepted" ? "accepted" : "rejected",
            capabilities: { canExecute: false, v: "v0" },
        });
    });
    const jobCreateSchema = zod_1.z.object({
        decisionId: zod_1.z.string().optional(),
        correlationId: zod_1.z.string().optional(),
        domain: zod_1.z.string().optional(),
        type: zod_1.z.string(),
        tool: zod_1.z.string().optional(),
        input: zod_1.z.record(zod_1.z.any()).default({}),
        priority: zod_1.z.number().int().optional(),
        runAt: zod_1.z.string().datetime().optional(),
        idempotencyKey: zod_1.z.string().optional(),
        maxAttempts: zod_1.z.number().int().optional(),
    });
    app.post("/jobs", async (request, reply) => {
        const guard = ensureRole(request, reply, ["member", "admin"]);
        if (guard)
            return guard;
        const ctx = request.ctx;
        if (!pool || !jobRepo) {
            return sendError(request, reply, 500, "jobs_unavailable", "Jobs require database backend");
        }
        const parsed = jobCreateSchema.safeParse(request.body);
        if (!parsed.success) {
            return sendError(request, reply, 400, "invalid_job", "Invalid job payload", parsed.error.issues);
        }
        const data = parsed.data;
        const type = data.tool ?? data.type;
        const tool = (0, src_5.getTool)(type);
        if (!tool) {
            return sendError(request, reply, 400, "unknown_tool", "Unknown tool");
        }
        const { job, created } = await jobRepo.createJob(ctx.tenantId, {
            decisionId: data.decisionId,
            correlationId: data.correlationId,
            domain: data.domain,
            type,
            input: data.input,
            priority: data.priority ?? 0,
            runAt: data.runAt,
            idempotencyKey: data.idempotencyKey,
            maxAttempts: data.maxAttempts,
        });
        metrics.jobs.queued += created ? 1 : 0;
        await emitJobEvent(ctx, "job.created", job);
        await emitJobEvent(ctx, "job.queued", job);
        if (jobQueue)
            await jobQueue.enqueue(job);
        return reply.status(created ? 201 : 200).send({ job });
    });
    app.get("/jobs", async (request, reply) => {
        const guard = ensureRole(request, reply, ["member", "admin"]);
        if (guard)
            return guard;
        const ctx = request.ctx;
        if (!jobRepo)
            return sendError(request, reply, 500, "jobs_unavailable", "Jobs require database backend");
        const parsed = zod_1.z
            .object({
            status: zod_1.z.enum(["queued", "running", "succeeded", "failed", "canceled", "dead_letter"]).optional(),
            decisionId: zod_1.z.string().optional(),
            correlationId: zod_1.z.string().optional(),
            domain: zod_1.z.string().optional(),
            type: zod_1.z.string().optional(),
            cursor: zod_1.z.string().optional(),
            limit: zod_1.z.coerce.number().int().positive().max(200).optional(),
        })
            .safeParse(request.query);
        if (!parsed.success)
            return sendError(request, reply, 400, "invalid_query", "Invalid jobs query", parsed.error.issues);
        let cursorObj;
        if (parsed.data.cursor) {
            try {
                const normalized = parsed.data.cursor.replace(/-/g, "+").replace(/_/g, "/");
                const pad = normalized.length % 4;
                const padded = normalized + (pad ? "=".repeat(4 - pad) : "");
                cursorObj = JSON.parse(Buffer.from(padded, "base64").toString("utf-8"));
            }
            catch {
                return sendError(request, reply, 400, "invalid_cursor", "Invalid cursor");
            }
        }
        const { jobs, nextCursor } = await jobRepo.listJobs(ctx.tenantId, {
            status: parsed.data.status,
            decisionId: parsed.data.decisionId,
            correlationId: parsed.data.correlationId,
            domain: parsed.data.domain,
            type: parsed.data.type,
        }, cursorObj, parsed.data.limit);
        return reply.send({ jobs, nextCursor });
    });
    app.get("/jobs/:jobId", async (request, reply) => {
        const guard = ensureRole(request, reply, ["member", "admin"]);
        if (guard)
            return guard;
        const ctx = request.ctx;
        if (!jobRepo)
            return sendError(request, reply, 500, "jobs_unavailable", "Jobs require database backend");
        const jobId = request.params.jobId;
        const job = await jobRepo.getJob(ctx.tenantId, jobId);
        if (!job)
            return sendError(request, reply, 404, "job_not_found", "Job not found");
        return reply.send({ job });
    });
    app.post("/jobs/:jobId/cancel", async (request, reply) => {
        const guard = ensureRole(request, reply, ["member", "admin"]);
        if (guard)
            return guard;
        const ctx = request.ctx;
        if (!jobRepo)
            return sendError(request, reply, 500, "jobs_unavailable", "Jobs require database backend");
        const jobId = request.params.jobId;
        const job = await jobRepo.getJob(ctx.tenantId, jobId);
        if (!job)
            return sendError(request, reply, 404, "job_not_found", "Job not found");
        await jobRepo.updateStatus(ctx.tenantId, jobId, { status: "canceled", lockedAt: null, lockedBy: null });
        if (jobQueue)
            await jobQueue.cancel(jobId);
        metrics.jobs.queued = Math.max(0, metrics.jobs.queued - 1);
        await emitJobEvent(ctx, "job.canceled", { ...job, status: "canceled" });
        return reply.send({ status: "canceled" });
    });
    app.post("/jobs/:jobId/retry", async (request, reply) => {
        const guard = ensureRole(request, reply, ["member", "admin"]);
        if (guard)
            return guard;
        const ctx = request.ctx;
        if (!jobRepo)
            return sendError(request, reply, 500, "jobs_unavailable", "Jobs require database backend");
        const jobId = request.params.jobId;
        const job = await jobRepo.getJob(ctx.tenantId, jobId);
        if (!job)
            return sendError(request, reply, 404, "job_not_found", "Job not found");
        const attempts = job.attempts < job.maxAttempts ? job.attempts : 0;
        const nextRun = new Date().toISOString();
        const updated = await jobRepo.updateStatus(ctx.tenantId, jobId, {
            status: "queued",
            attempts,
            runAt: nextRun,
            lockedAt: null,
            lockedBy: null,
        });
        if (updated && jobQueue)
            await jobQueue.enqueue(updated);
        await emitJobEvent(ctx, "job.retried", { ...(updated ?? job), status: "queued", attempts });
        return reply.send({ job: updated ?? job });
    });
    app.post("/decisions/:decisionId/execute", async (request, reply) => {
        const guard = ensureRole(request, reply, ["member", "admin"]);
        if (guard)
            return guard;
        const ctx = request.ctx;
        if (!jobRepo)
            return sendError(request, reply, 500, "jobs_unavailable", "Jobs require database backend");
        const decisionId = request.params.decisionId;
        if (!decisionId)
            return sendError(request, reply, 400, "missing_decision_id", "Missing decisionId");
        // simple mapping: use decisionId as idempotencyKey, tool echo snapshot intent
        const body = request.body ?? {};
        const tool = body.tool ?? "tool.echo";
        const input = body.input ?? {};
        const { job, created } = await jobRepo.createJob(ctx.tenantId, {
            decisionId,
            correlationId: body.correlationId ?? decisionId,
            domain: body.domain ?? "generic",
            type: tool,
            input,
            idempotencyKey: decisionId,
        });
        if (created) {
            await emitJobEvent(ctx, "job.created", job);
            await emitJobEvent(ctx, "job.queued", job);
            if (jobQueue)
                await jobQueue.enqueue(job);
        }
        return reply.status(created ? 201 : 200).send({ job });
    });
    app.get("/trust", async (request, reply) => {
        const guard = ensureRole(request, reply, ["admin"]);
        if (guard)
            return guard;
        const ctx = request.ctx;
        const { store, trust } = scopedDeps(ctx);
        const cacheKey = `trust:${ctx.tenantId}:all`;
        if (redisCache) {
            const cached = await redisCache.get(cacheKey);
            if (cached)
                return reply.send(cached);
        }
        const trustEvents = await store.query({ types: [src_4.TrustEvents.TRUST_UPDATED_EVENT], tenantId: ctx.tenantId });
        const scores = trust.recomputeFromEvents(trustEvents);
        const lastUpdated = {};
        trustEvents.forEach((evt) => {
            const domain = evt.payload.domain;
            if (!domain)
                return;
            const current = lastUpdated[domain];
            if (!current || new Date(evt.timestamp) > new Date(current)) {
                lastUpdated[domain] = evt.timestamp;
            }
        });
        const payload = {
            scoresByDomain: scores,
            defaultsByDomain: src_4.DEFAULT_TRUST_BY_DOMAIN,
            deltas: {
                accept: src_4.ACCEPT_DELTA,
                reject: src_4.REJECT_DELTA,
                implicitRepeatNoAction: src_4.IMPLICIT_NO_ACTION_REPEAT_DELTA,
            },
            lastUpdatedByDomain: lastUpdated,
            capabilities: { canExecute: false, v: "v0" },
        };
        if (redisCache)
            await redisCache.set(cacheKey, payload, 20);
        return reply.send(payload);
    });
    app.get("/trust/:domain", async (request, reply) => {
        const guard = ensureRole(request, reply, ["admin"]);
        if (guard)
            return guard;
        const ctx = request.ctx;
        const { store, trust } = scopedDeps(ctx);
        const domain = request.params.domain;
        const cacheKey = `trust:${ctx.tenantId}:${domain}`;
        if (redisCache) {
            const cached = await redisCache.get(cacheKey);
            if (cached)
                return reply.send(cached);
        }
        const trustEvents = await store.query({ types: [src_4.TrustEvents.TRUST_UPDATED_EVENT], tenantId: ctx.tenantId });
        const scores = trust.recomputeFromEvents(trustEvents);
        const score = scores[domain];
        if (score === undefined) {
            const defaultScore = src_4.DEFAULT_TRUST_BY_DOMAIN[domain] ?? src_4.DEFAULT_TRUST_BY_DOMAIN.generic ?? 0.5;
            const payload = {
                domain,
                score: defaultScore,
                fromDefault: true,
                capabilities: { canExecute: false, v: "v0" },
            };
            if (redisCache)
                await redisCache.set(cacheKey, payload, 20);
            return reply.send(payload);
        }
        const payload = {
            domain,
            score,
            fromDefault: false,
            capabilities: { canExecute: false, v: "v0" },
        };
        if (redisCache)
            await redisCache.set(cacheKey, payload, 20);
        return reply.send(payload);
    });
    return app;
};
exports.buildServer = buildServer;
if (require.main === module) {
    const server = (0, exports.buildServer)();
    const port = Number(process.env.PORT ?? process.env.ORION_API_PORT ?? 3000);
    server.listen({ port, host: "0.0.0.0" }).catch((err) => {
        server.log.error(err);
        process.exit(1);
    });
}
function percentile(values, p) {
    if (!values.length)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
    return sorted[idx];
}
