import fastify, { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { randomUUID } from "crypto";
import { join } from "path";
import { z } from "zod";
import { JsonFileEventStore, EventStore, InMemoryEventStore } from "../../../packages/event-store/src";
import { PostgresEventStore } from "../../../packages/event-store/src/postgresEventStore";
import { AuditLogger, AuditQueryService } from "../../../packages/audit/src";
import { PermissionEngine } from "../../../packages/permissions/src";
import { DomainEvent, TimelineCursor } from "../../../packages/shared/src";
import { sanitizeEventForTimeline, mapKind } from "../../../packages/shared/src/timeline";
import { Planner } from "../../../packages/planner/src/planner";
import { PlannerSnapshot } from "../../../packages/planner/src/types";
import {
  TrustService,
  TrustEvents,
  DEFAULT_TRUST_BY_DOMAIN,
  ACCEPT_DELTA,
  REJECT_DELTA,
  IMPLICIT_NO_ACTION_REPEAT_DELTA,
} from "../../../packages/trust/src";
import Redis from "ioredis";
import { Pool } from "pg";
import { RedisCache, RedisRateLimiter } from "./cache";
import { JobRepository } from "./jobs/jobRepo";
import { JobQueue } from "./jobs/queue";
import { JobRecord, JobStatus, jobTypeToPermission } from "../../../packages/shared/src/jobs";
import { getTool } from "../../../packages/tools/src";

const version = process.env.ORION_VERSION ?? "0.0.1";

const envSchema = z.object({
  ORION_API_PORT: z.coerce.number().int().positive().default(3000),
  ORION_STORAGE_PATH: z.string().default(join(process.cwd(), "data", "events.json")),
  ORION_ALLOWED_ORIGINS: z.string().default("*"),
  ORION_RATE_LIMIT: z.coerce.number().int().positive().default(120),
  ORION_RATE_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  ORION_LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),
  ORION_TENANT_WHITELIST: z.string().default("*"),
  ORION_DEV_AUTH_BYPASS: z.string().optional().default("true"),
  ORION_AUTH_TOKENS: z.string().optional(),
  ORION_AUTH_DEFAULT_ROLES: z.string().optional().default("admin"),
  ORION_AUTH_DEFAULT_USER: z.string().optional().default("api-user"),
  ORION_DB_URL: z.string().optional(),
  ORION_EVENTSTORE_ADAPTER: z.enum(["postgres", "json", "memory"]).optional(),
  ORION_REDIS_URL: z.string().optional(),
  ORION_CACHE_ENABLED: z.string().optional().default("true"),
  ORION_RATE_LIMIT_BACKEND: z.enum(["redis", "memory"]).optional(),
});

const actorSchema = z.object({
  userId: z.string().min(1),
  roles: z.array(z.string()).optional(),
  trustLevel: z.number().optional(),
  phase: z.string().optional(),
});

const metaSchema = z.object({
  actor: actorSchema,
  source: z.enum(["system", "user", "integration"]),
  decisionId: z.string().min(1),
  correlationId: z.string().optional(),
  causationId: z.string().optional(),
  phase: z.string().optional(),
  description: z.string().optional(),
  tenantId: z.string().min(1).optional(),
});

const domainEventSchema = z.object({
  id: z.string().uuid().optional(),
  aggregateId: z.string().min(1),
  type: z.string().min(1),
  timestamp: z.string().datetime().optional(),
  payload: z.record(z.any()).optional(),
  meta: metaSchema,
  tags: z.array(z.string()).optional(),
});

const eventQuerySchema = z.object({
  aggregateId: z.string().optional(),
  type: z.string().optional(),
  decisionId: z.string().optional(),
  correlationId: z.string().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

const permissionRequestSchema = z.object({
  actor: actorSchema,
  domain: z.string().min(1),
  action: z.string().min(1),
  resource: z.string().optional(),
  context: z.record(z.any()).optional(),
  risk: z.enum(["low", "medium", "high"]).optional(),
  riskReasons: z.array(z.string()).optional(),
  decisionId: z.string().min(1),
  correlationId: z.string().optional(),
});

type RequestContext = {
  tenantId: string;
  actor: z.infer<typeof actorSchema>;
};

type JobRepoPort = {
  createJob: (tenantId: string, input: any) => Promise<{ job: JobRecord; created: boolean }>;
  getJob: (tenantId: string, jobId: string) => Promise<JobRecord | null>;
  listJobs: (
    tenantId: string,
    filters: { status?: JobStatus; decisionId?: string; correlationId?: string; domain?: string; type?: string },
    cursor?: { runAt: string; id: string },
    limit?: number
  ) => Promise<{ jobs: JobRecord[]; nextCursor: string | null }>;
  updateStatus: (tenantId: string, jobId: string, patch: Partial<JobRecord>) => Promise<JobRecord | null>;
};

type JobQueuePort = {
  enqueue: (job: JobRecord) => Promise<void>;
  cancel: (jobId: string) => Promise<void>;
};

export type ServerDeps = {
  eventStore?: EventStore;
  auditLogger?: AuditLogger;
  permissionEngine?: PermissionEngine;
  trustService?: TrustService;
  redisCache?: RedisCache | null;
  redisRateLimiter?: RedisRateLimiter | null;
  envOverrides?: Partial<z.infer<typeof envSchema>>;
  jobRepo?: JobRepoPort | null;
  jobQueue?: JobQueuePort | null;
};

const tenantRegex = /^[a-z0-9_-]{1,32}$/;

const toBool = (val?: string) => val === "true" || val === "1" || val === "yes";
const splitCsv = (val?: string) => (val ?? "").split(",").map((v) => v.trim()).filter(Boolean);
const ctxTenant = (request: FastifyRequest) => {
  const header = (request.headers["x-tenant-id"] as string | undefined)?.trim();
  return header && header.length > 0 ? header : "local";
};

const tenantScopedStore = (base: EventStore, tenantId: string, defaultActor?: z.infer<typeof actorSchema>): EventStore => {
  const ensureMeta = (event: DomainEvent) => ({
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
    getByAggregateId: async (aggregateId: string) => {
      const events = await base.getByAggregateId(aggregateId);
      return events.filter((evt) => evt.meta.tenantId === tenantId);
    },
    query: async (filter) => base.query({ ...filter, tenantId }),
  };
};

const normalizeCursor = (cursor: string) => cursor.replace(/-/g, "+").replace(/_/g, "/");
const decodeCursor = (cursor: string): TimelineCursor => {
  const normalized = normalizeCursor(cursor);
  const pad = normalized.length % 4;
  const padded = normalized + (pad ? "=".repeat(4 - pad) : "");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf-8")) as TimelineCursor;
};

const roleAllows = (roles: string[] | undefined, allowed: string[]) => {
  if (!allowed.length) return true;
  const set = new Set((roles ?? []).map((r) => r.toLowerCase()));
  return allowed.some((r) => set.has(r.toLowerCase()));
};

const safeSummary = (val: any, max = 180) => {
  if (val === null || val === undefined) return "";
  const s = typeof val === "string" ? val : JSON.stringify(val);
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

export const buildServer = (deps: ServerDeps = {}): FastifyInstance => {
  const env = envSchema.parse({ ...process.env, ...deps.envOverrides });
  const dbUrl = env.ORION_DB_URL;
  const adapter = env.ORION_EVENTSTORE_ADAPTER ?? (dbUrl ? "postgres" : "json");
  let eventStore: EventStore;
  let pool: Pool | null = null;
  if (deps.eventStore) {
    eventStore = deps.eventStore;
  } else if (adapter === "postgres" && dbUrl) {
    pool = new Pool({ connectionString: dbUrl });
    eventStore = new PostgresEventStore({ pool });
  } else if (adapter === "memory") {
    eventStore = new InMemoryEventStore();
  } else {
    eventStore = new JsonFileEventStore(env.ORION_STORAGE_PATH);
  }
  const baseAudit = deps.auditLogger ?? new AuditLogger(eventStore);
  const basePermission = deps.permissionEngine ?? new PermissionEngine(eventStore, baseAudit);
  const permissionRules = typeof (basePermission as any).getRules === "function" ? (basePermission as any).getRules() : [];
  const whitelistList = splitCsv(env.ORION_TENANT_WHITELIST);
  const allowAllTenants = whitelistList.length === 0 || whitelistList.includes("*");
  const tenantWhitelist = new Set(whitelistList.length ? whitelistList : ["local"]);

  const metrics = {
    startTime: Date.now(),
    requests: 0,
    errors: 0,
    perRoute: new Map<
      string,
      { count: number; errors: number; statuses: Record<string, number>; durationsMs: number[] }
    >(),
    jobs: { queued: 0, running: 0, failed: 0, succeeded: 0, dead_letter: 0 },
  };
  // TODO: replace in-memory limiter with shared backend (e.g., Redis) for multi-instance deploys
  const inMemoryRateLimiter = new Map<string, { count: number; resetAt: number }>();
  const redisUrl = env.ORION_REDIS_URL;
  const cacheEnabled = toBool(env.ORION_CACHE_ENABLED);
  const redisClient = redisUrl ? new Redis(redisUrl) : null;
  const redisCache = deps.redisCache ?? (redisClient && cacheEnabled ? new RedisCache(redisClient) : null);
  const rateBackend = env.ORION_RATE_LIMIT_BACKEND ?? (redisClient ? "redis" : "memory");
  const redisLimiter =
    deps.redisRateLimiter ??
    (redisClient && rateBackend === "redis" ? new RedisRateLimiter(redisClient, env.ORION_RATE_LIMIT, env.ORION_RATE_WINDOW_MS) : null);
  const jobRepo: JobRepoPort | null = deps.jobRepo ?? (pool ? new JobRepository(pool) : null);
  const jobQueue: JobQueuePort | null = deps.jobQueue ?? (redisClient ? new JobQueue(redisClient) : null);

  const app = fastify({
    logger: { level: env.ORION_LOG_LEVEL },
    disableRequestLogging: false,
    genReqId: () => randomUUID(),
  });

  app.register(cors, {
    origin: env.ORION_ALLOWED_ORIGINS === "*" ? true : env.ORION_ALLOWED_ORIGINS.split(",").map((o) => o.trim()),
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "If-None-Match", "X-Request-ID", "Authorization", "x-tenant-id"],
    maxAge: 86400,
  });

  const makeError = (
    request: FastifyRequest,
    code: string,
    message: string,
    details?: unknown,
    statusCode = 400
  ) => {
    const payload: any = { error: { code, message } };
    if (details) payload.error.details = details;
    payload.error.requestId = request.id;
    return { statusCode, payload };
  };

  const sendError = (
    request: FastifyRequest,
    reply: FastifyReply,
    statusCode: number,
    code: string,
    message: string,
    details?: unknown
  ) => {
    const response = makeError(request, code, message, details, statusCode);
    reply.status(statusCode);
    return reply.send(response.payload);
  };

  const ensureRole = (request: FastifyRequest, reply: FastifyReply, roles: string[]) => {
    const ctx: RequestContext | undefined = (request as any).ctx;
    if (!ctx) return sendError(request, reply, 401, "unauthorized", "Missing auth context");
    if (!roleAllows(ctx.actor.roles, roles)) {
      return sendError(request, reply, 403, "forbidden", "Insufficient role");
    }
    return null;
  };

  app.addHook("onRequest", (request, reply, done) => {
    const now = Date.now();
    (request as any)._start = now;
    metrics.requests += 1;

    reply.header("X-Request-ID", request.id as string);
    reply.header("X-Frame-Options", "DENY");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");

    const routeUrl = request.routeOptions?.url ?? (request as any).routerPath ?? request.url.split("?")[0];
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
    } else {
      const entry = inMemoryRateLimiter.get(routeKey);
      if (!entry || entry.resetAt < now) {
        inMemoryRateLimiter.set(routeKey, { count: 1, resetAt: now + env.ORION_RATE_WINDOW_MS });
      } else {
        entry.count += 1;
        if (entry.count > env.ORION_RATE_LIMIT) {
          reply.header("Retry-After", Math.ceil((entry.resetAt - now) / 1000));
          return reply
            .status(429)
            .send({ error: { code: "rate_limited", message: "Too many requests", requestId: request.id } });
        }
      }
    }

    const tenantHeader = (request.headers["x-tenant-id"] as string | undefined)?.trim();
    const tenantId = tenantHeader && tenantHeader.length > 0 ? tenantHeader : "local";
    if (!tenantRegex.test(tenantId)) {
      return sendError(request, reply, 400, "invalid_tenant", "Invalid tenant id");
    }
    if (!allowAllTenants && !tenantWhitelist.has(tenantId)) {
      return sendError(request, reply, 400, "tenant_not_allowed", "Tenant not whitelisted");
    }
    reply.header("x-tenant-id", tenantId);

    const bypass = toBool(env.ORION_DEV_AUTH_BYPASS);
    let actor: z.infer<typeof actorSchema> | null = null;
    const isPublic = routeUrl === "/health";
    if (bypass || isPublic) {
      actor = bypass ? { userId: "dev", roles: ["admin"] } : { userId: "public", roles: ["public"] };
    } else {
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

    (request as any).ctx = { tenantId, actor } satisfies RequestContext;
    done();
  });

  app.addHook("preHandler", (request, reply, done) => {
    const bodyMeta = (request.body as any)?.meta;
    const correlationId =
      bodyMeta?.correlationId ??
      bodyMeta?.decisionId ??
      (request.query as any)?.correlationId ??
      (request.query as any)?.decisionId ??
      (request.params as any)?.decisionId;
    if (correlationId) reply.header("X-Correlation-ID", correlationId);
    const ctx: RequestContext | undefined = (request as any).ctx;
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
    const perRoute = metrics.perRoute.get(routeKey)!;
    perRoute.count += 1;
    perRoute.statuses[reply.statusCode] = (perRoute.statuses[reply.statusCode] ?? 0) + 1;
    const duration = Date.now() - ((request as any)._start ?? Date.now());
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
    return sendError(
      request,
      reply,
      status,
      (error as any).code ?? "internal_error",
      status === 500 ? "Internal server error" : error.message,
      (error as any).validation ?? (error as any).cause ?? error.message
    );
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
    if (guard) return guard;
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

  const scopedDeps = (ctx: RequestContext) => {
    const store = tenantScopedStore(eventStore, ctx.tenantId, ctx.actor);
    const audit = new AuditLogger(store);
    const permissions = new PermissionEngine(store, audit, permissionRules);
    const trust = new TrustService({ eventStore: store });
    const planner = new Planner({ eventStore: store, audit, permissions, trust });
    const auditQuery = new AuditQueryService(store);
    return { store, audit, permissions, trust, planner, auditQuery };
  };

  const emitJobEvent = async (
    ctx: RequestContext,
    type: string,
    job: JobRecord,
    payload: Record<string, unknown> = {}
  ) => {
    const { store } = scopedDeps(ctx);
    const perm = jobTypeToPermission(job.type);
    const domain = job.domain ?? perm.domain;
    const event: DomainEvent = {
      id: randomUUID(),
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
        domain,
        action: perm.action,
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
    if (guard) return guard;
    const ctx = (request as any).ctx as RequestContext;
    const { store } = scopedDeps(ctx);
    const parsed = domainEventSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(request, reply, 400, "invalid_event", "Invalid event payload", parsed.error.issues);
    }

    const body = parsed.data;
    const event: DomainEvent = {
      id: body.id ?? randomUUID(),
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
    if (guard) return guard;
    const ctx = (request as any).ctx as RequestContext;
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
    if (guard) return guard;
    reply.header("Cache-Control", "no-store");
    const ctx = (request as any).ctx as RequestContext;
    const { auditQuery } = scopedDeps(ctx);
    const parsed = z
      .object({
        decisionId: z.string().optional(),
        correlationId: z.string().optional(),
        limit: z.coerce.number().int().positive().optional(),
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
    if (guard) return guard;
    const ctx = (request as any).ctx as RequestContext;
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
    if (guard) return guard;
    const ctx = (request as any).ctx as RequestContext;
    const { planner } = scopedDeps(ctx);
    const parsed = z
      .object({
        intent: z.object({
          type: z.string(),
          payload: z.record(z.any()).optional(),
          domain: z.string(),
          action: z.string(),
          declaredRisk: z.enum(["low", "medium", "high"]).optional(),
          declaredRiskReasons: z.array(z.string()).optional(),
        }),
        actor: actorSchema,
        decisionId: z.string().optional(),
        correlationId: z.string().optional(),
        context: z
          .object({
            timeOfDay: z.string().optional(),
            openTasks: z.number().int().optional(),
            urgency: z.enum(["low", "medium", "high"]).optional(),
            phase: z.enum(["normal", "overloaded", "recovery", "build", "creative", "transition"]).optional(),
            energy: z.enum(["low", "normal", "high"]).optional(),
            trust: z.record(z.number()).optional(),
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
    if (guard) return guard;
    const ctx = (request as any).ctx as RequestContext;
    const { store } = scopedDeps(ctx);
    const decisionId = (request.params as { decisionId: string }).decisionId;
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

    const snapshot = (finalEvent.payload as any)?.snapshot;
    if (!snapshot) {
      return sendError(request, reply, 500, "snapshot_missing", "Snapshot missing in final event");
    }

    const etagRaw = finalEvent.id;
    const etag = `"${etagRaw}"`;
    const payloadKey = `snapshot:${ctx.tenantId}:${decisionId}:v:${etagRaw}`;
    if (redisCache) {
      const cached = await redisCache.get<any>(payloadKey);
      if (cached) {
        reply.header("ETag", etag);
        reply.header("Cache-Control", "private, max-age=0, must-revalidate");
        return reply.send(cached);
      }
    }
    const ifNoneMatch = request.headers["if-none-match"];
    const normalizedIfNoneMatch = (ifNoneMatch as string | undefined)?.replace(/W\//, "").replace(/"/g, "");
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
    if (guard) return guard;
    const ctx = (request as any).ctx as RequestContext;
    const { store } = scopedDeps(ctx);
    const parsed = z
      .object({
        correlationId: z.string().optional(),
        decisionId: z.string().optional(),
        domain: z.string().optional(),
        types: z.string().optional(),
        kind: z.enum(["decision", "trust", "system", "audit", "other"]).optional(),
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
        limit: z.coerce.number().int().positive().max(200).optional(),
        cursor: z.string().optional(),
      })
      .safeParse(request.query);
    if (!parsed.success) {
      return sendError(request, reply, 400, "invalid_timeline_query", "Invalid timeline query", parsed.error.issues);
    }
    const q = parsed.data;

    const limit = q.limit ?? 50;
    if (!q.correlationId && !q.decisionId && !q.domain && !q.types && !q.from && !q.to) {
      return sendError(
        request,
        reply,
        400,
        "missing_filters",
        "Provide at least one filter or from/to for timeline"
      );
    }

    let cursorObj: TimelineCursor | null = null;
    if (q.cursor) {
      try {
        cursorObj = decodeCursor(q.cursor);
      } catch {
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
        if (q.kind && mapKind(evt) !== q.kind) return false;
        if (q.domain) {
          const domain = sanitizeEventForTimeline(evt).domain;
          if (domain !== q.domain) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const ta = new Date(a.timestamp).getTime();
        const tb = new Date(b.timestamp).getTime();
        if (ta === tb) return a.id.localeCompare(b.id);
        return ta - tb;
      })
      .filter((evt) => {
        if (!cursorObj) return true;
        const ts = new Date(evt.timestamp).getTime();
        const cursorTs = new Date(cursorObj.ts).getTime();
        if (ts > cursorTs) return true;
        if (ts === cursorTs && evt.id > cursorObj.id) return true;
        return false;
      });

    const page = filtered.slice(0, limit);
    const nextItem = filtered[limit];
    const nextCursor =
      nextItem &&
      Buffer.from(
        JSON.stringify({
          ts: nextItem.timestamp,
          id: nextItem.id,
        })
      )
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

    const items = page.map((evt) => {
      const sanitized = sanitizeEventForTimeline(evt);
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
    if (guard) return guard;
    const ctx = (request as any).ctx as RequestContext;
    const { store, trust } = scopedDeps(ctx);
    const decisionId = (request.params as { decisionId: string }).decisionId;
    const parsed = z
      .object({
        accepted: z.boolean().optional(),
        rejected: z.boolean().optional(),
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
      if (partial.length === 0) return sendError(request, reply, 404, "decision_not_found", "Decision not found");
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
      const payload = last.payload as any;
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

    const snapshot = (finalEvent.payload as any)?.snapshot;
    const domain = snapshot?.intent?.domain;
    if (!domain) {
      return sendError(request, reply, 500, "domain_missing", "Domain missing in snapshot");
    }
    const correlationId = finalEvent.meta.correlationId ?? decisionId;

    const feedbackType = feedback.accepted ? "decision.accepted" : "decision.rejected";
    const feedbackEvent: DomainEvent = {
      id: randomUUID(),
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

    const trustEvent: DomainEvent = {
      id: randomUUID(),
      aggregateId: decisionId,
      type: TrustEvents.TRUST_UPDATED_EVENT,
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

  const jobCreateSchema = z.object({
    decisionId: z.string().optional(),
    correlationId: z.string().optional(),
    domain: z.string().optional(),
    type: z.string(),
    tool: z.string().optional(),
    input: z.record(z.any()).default({}),
    priority: z.number().int().optional(),
    runAt: z.string().datetime().optional(),
    idempotencyKey: z.string().optional(),
    maxAttempts: z.number().int().optional(),
  });

  app.post("/jobs", async (request, reply) => {
    const guard = ensureRole(request, reply, ["member", "admin"]);
    if (guard) return guard;
    const ctx = (request as any).ctx as RequestContext;
    if (!pool || !jobRepo) {
      return sendError(request, reply, 500, "jobs_unavailable", "Jobs require database backend");
    }
    const parsed = jobCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(request, reply, 400, "invalid_job", "Invalid job payload", parsed.error.issues);
    }
    const data = parsed.data;
    const type = data.tool ?? data.type;
    const tool = getTool(type);
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
    if (jobQueue) await jobQueue.enqueue(job);
    return reply.status(created ? 201 : 200).send({ job });
  });

  app.get("/jobs", async (request, reply) => {
    const guard = ensureRole(request, reply, ["member", "admin"]);
    if (guard) return guard;
    const ctx = (request as any).ctx as RequestContext;
    if (!jobRepo) return sendError(request, reply, 500, "jobs_unavailable", "Jobs require database backend");
    const parsed = z
      .object({
        status: z.enum(["queued", "running", "succeeded", "failed", "canceled", "dead_letter"]).optional(),
        decisionId: z.string().optional(),
        correlationId: z.string().optional(),
        domain: z.string().optional(),
        type: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.coerce.number().int().positive().max(200).optional(),
      })
      .safeParse(request.query);
    if (!parsed.success) return sendError(request, reply, 400, "invalid_query", "Invalid jobs query", parsed.error.issues);
    let cursorObj: { runAt: string; id: string } | undefined;
    if (parsed.data.cursor) {
      try {
        const normalized = parsed.data.cursor.replace(/-/g, "+").replace(/_/g, "/");
        const pad = normalized.length % 4;
        const padded = normalized + (pad ? "=".repeat(4 - pad) : "");
        cursorObj = JSON.parse(Buffer.from(padded, "base64").toString("utf-8"));
      } catch {
        return sendError(request, reply, 400, "invalid_cursor", "Invalid cursor");
      }
    }
    const { jobs, nextCursor } = await jobRepo.listJobs(
      ctx.tenantId,
      {
        status: parsed.data.status as JobStatus | undefined,
        decisionId: parsed.data.decisionId,
        correlationId: parsed.data.correlationId,
        domain: parsed.data.domain,
        type: parsed.data.type,
      },
      cursorObj,
      parsed.data.limit
    );
    return reply.send({ jobs, nextCursor });
  });

  app.get("/jobs/:jobId", async (request, reply) => {
    const guard = ensureRole(request, reply, ["member", "admin"]);
    if (guard) return guard;
    const ctx = (request as any).ctx as RequestContext;
    if (!jobRepo) return sendError(request, reply, 500, "jobs_unavailable", "Jobs require database backend");
    const jobId = (request.params as any).jobId as string;
    const job = await jobRepo.getJob(ctx.tenantId, jobId);
    if (!job) return sendError(request, reply, 404, "job_not_found", "Job not found");
    return reply.send({ job });
  });

  app.post("/jobs/:jobId/cancel", async (request, reply) => {
    const guard = ensureRole(request, reply, ["member", "admin"]);
    if (guard) return guard;
    const ctx = (request as any).ctx as RequestContext;
    if (!jobRepo) return sendError(request, reply, 500, "jobs_unavailable", "Jobs require database backend");
    const jobId = (request.params as any).jobId as string;
    const job = await jobRepo.getJob(ctx.tenantId, jobId);
    if (!job) return sendError(request, reply, 404, "job_not_found", "Job not found");
    await jobRepo.updateStatus(ctx.tenantId, jobId, { status: "canceled", lockedAt: null, lockedBy: null });
    if (jobQueue) await jobQueue.cancel(jobId);
    metrics.jobs.queued = Math.max(0, metrics.jobs.queued - 1);
    await emitJobEvent(ctx, "job.canceled", { ...job, status: "canceled" });
    return reply.send({ status: "canceled" });
  });

  app.post("/jobs/:jobId/retry", async (request, reply) => {
    const guard = ensureRole(request, reply, ["member", "admin"]);
    if (guard) return guard;
    const ctx = (request as any).ctx as RequestContext;
    if (!jobRepo) return sendError(request, reply, 500, "jobs_unavailable", "Jobs require database backend");
    const jobId = (request.params as any).jobId as string;
    const job = await jobRepo.getJob(ctx.tenantId, jobId);
    if (!job) return sendError(request, reply, 404, "job_not_found", "Job not found");
    const attempts = job.attempts < job.maxAttempts ? job.attempts : 0;
    const nextRun = new Date().toISOString();
    const updated = await jobRepo.updateStatus(ctx.tenantId, jobId, {
      status: "queued",
      attempts,
      runAt: nextRun,
      lockedAt: null,
      lockedBy: null,
    });
    if (updated && jobQueue) await jobQueue.enqueue(updated);
    await emitJobEvent(ctx, "job.retried", { ...(updated ?? job), status: "queued", attempts });
    return reply.send({ job: updated ?? job });
  });

  const deriveJobSpecFromSnapshot = (snapshot: PlannerSnapshot) => {
    const intent = snapshot.intent ?? { domain: "generic", action: "execute", type: "generic" };
    const intentType = intent.type ?? "generic";
    const intentAction = intent.action ?? "execute";
    const domain = intent.domain ?? "generic";
    const mode = snapshot.recommendedOption?.mode ?? snapshot.mode;

    const byIntent = () => {
      if (intentType.includes("export")) return "tool.export_bundle";
      if (intentType.includes("draft") || intentAction === "draft" || domain === "messaging") return "tool.generate_draft";
      if (intentType.includes("note") || domain === "notes") return "tool.create_note";
      if (intentType.startsWith("tasks.") || domain === "tasks") return "tool.create_task_stub";
      return "tool.echo";
    };
    const type = mode === "act" ? byIntent() : byIntent();
    const priority = snapshot.riskAssessment?.level === "high" ? 10 : snapshot.riskAssessment?.level === "medium" ? 5 : 1;
    const maxAttempts = snapshot.riskAssessment?.level === "high" ? 2 : 3;
    return { type, domain, priority, maxAttempts };
  };

  const buildJobInput = (snapshot: PlannerSnapshot, ctx: RequestContext) => {
    const recommended = snapshot.recommendedOption;
    return {
      intent: snapshot.intent
        ? {
          type: snapshot.intent.type,
          domain: snapshot.intent.domain,
          action: snapshot.intent.action,
        }
        : undefined,
      recommendedOption: recommended
        ? { optionId: recommended.optionId, title: recommended.title, mode: recommended.mode }
        : undefined,
      explain: (snapshot.explain ?? []).slice(0, 5),
      actor: { userId: ctx.actor.userId, roles: ctx.actor.roles },
    };
  };

  app.post("/decisions/:decisionId/execute", async (request, reply) => {
    const guard = ensureRole(request, reply, ["member", "admin"]);
    if (guard) return guard;
    const ctx = (request as any).ctx as RequestContext;
    const { store } = scopedDeps(ctx);
    if (!jobRepo) return sendError(request, reply, 500, "jobs_unavailable", "Jobs require database backend");
    const decisionId = (request.params as any).decisionId as string;
    if (!decisionId) return sendError(request, reply, 400, "missing_decision_id", "Missing decisionId");

    const finalTypes = ["decision.ready_to_execute", "decision.suggested", "system.no_action"];
    const finals = await store.query({ decisionId, types: finalTypes, limit: 50, tenantId: ctx.tenantId });
    const finalEvent = finals.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

    if (!finalEvent) {
      const partial = await store.query({
        decisionId,
        types: ["decision.created", "decision.optioned"],
        tenantId: ctx.tenantId,
      });
      if (partial.length === 0) return sendError(request, reply, 404, "decision_not_found", "Decision not found");
      return sendError(request, reply, 409, "not_executable", "Decision not ready to execute");
    }
    if (finalEvent.type !== "decision.ready_to_execute") {
      return sendError(request, reply, 409, "not_executable", "Decision not ready to execute");
    }

    const snapshot: PlannerSnapshot | undefined = (finalEvent.payload as any)?.snapshot;
    if (!snapshot) return sendError(request, reply, 500, "snapshot_missing", "Snapshot missing in final event");

    const correlationId = finalEvent.meta.correlationId ?? decisionId;
    const spec = deriveJobSpecFromSnapshot(snapshot);
    const input = buildJobInput(snapshot, ctx);
    const { job, created } = await jobRepo.createJob(ctx.tenantId, {
      decisionId,
      correlationId,
      domain: spec.domain,
      type: spec.type,
      input,
      runAt: new Date().toISOString(),
      idempotencyKey: decisionId,
      maxAttempts: spec.maxAttempts,
      priority: spec.priority,
    });

    if (created) {
      metrics.jobs.queued += 1;
      await emitJobEvent(ctx, "job.created", job);
      await emitJobEvent(ctx, "job.queued", job);
      if (jobQueue) await jobQueue.enqueue(job);
    }

    return reply.status(created ? 201 : 200).send({
      jobId: job.id,
      status: job.status,
      decisionId: job.decisionId ?? decisionId,
      correlationId: job.correlationId ?? correlationId,
      capabilities: { canExecute: false, v: "v0" },
    });
  });

  app.get("/trust", async (request, reply) => {
    const guard = ensureRole(request, reply, ["admin"]);
    if (guard) return guard;
    const ctx = (request as any).ctx as RequestContext;
    const { store, trust } = scopedDeps(ctx);
    const cacheKey = `trust:${ctx.tenantId}:all`;
    if (redisCache) {
      const cached = await redisCache.get<any>(cacheKey);
      if (cached) return reply.send(cached);
    }
    const trustEvents = await store.query({ types: [TrustEvents.TRUST_UPDATED_EVENT], tenantId: ctx.tenantId });
    const scores = trust.recomputeFromEvents(trustEvents);
    const lastUpdated: Record<string, string> = {};
    trustEvents.forEach((evt) => {
      const domain = (evt.payload as any).domain;
      if (!domain) return;
      const current = lastUpdated[domain];
      if (!current || new Date(evt.timestamp) > new Date(current)) {
        lastUpdated[domain] = evt.timestamp;
      }
    });

    const payload = {
      scoresByDomain: scores,
      defaultsByDomain: DEFAULT_TRUST_BY_DOMAIN,
      deltas: {
        accept: ACCEPT_DELTA,
        reject: REJECT_DELTA,
        implicitRepeatNoAction: IMPLICIT_NO_ACTION_REPEAT_DELTA,
      },
      lastUpdatedByDomain: lastUpdated,
      capabilities: { canExecute: false, v: "v0" },
    };
    if (redisCache) await redisCache.set(cacheKey, payload, 20);
    return reply.send(payload);
  });

  app.get("/trust/:domain", async (request, reply) => {
    const guard = ensureRole(request, reply, ["admin"]);
    if (guard) return guard;
    const ctx = (request as any).ctx as RequestContext;
    const { store, trust } = scopedDeps(ctx);
    const domain = (request.params as { domain: string }).domain;
    const cacheKey = `trust:${ctx.tenantId}:${domain}`;
    if (redisCache) {
      const cached = await redisCache.get<any>(cacheKey);
      if (cached) return reply.send(cached);
    }
    const trustEvents = await store.query({ types: [TrustEvents.TRUST_UPDATED_EVENT], tenantId: ctx.tenantId });
    const scores = trust.recomputeFromEvents(trustEvents);
    const score = scores[domain];
    if (score === undefined) {
      const defaultScore = DEFAULT_TRUST_BY_DOMAIN[domain] ?? DEFAULT_TRUST_BY_DOMAIN.generic ?? 0.5;
      const payload = {
        domain,
        score: defaultScore,
        fromDefault: true,
        capabilities: { canExecute: false, v: "v0" },
      };
      if (redisCache) await redisCache.set(cacheKey, payload, 20);
      return reply.send(payload);
    }
    const payload = {
      domain,
      score,
      fromDefault: false,
      capabilities: { canExecute: false, v: "v0" },
    };
    if (redisCache) await redisCache.set(cacheKey, payload, 20);
    return reply.send(payload);
  });

  return app;
};

if (require.main === module) {
  const server = buildServer();
  const port = Number(process.env.PORT ?? process.env.ORION_API_PORT ?? 3000);
  server.listen({ port, host: "0.0.0.0" }).catch((err) => {
    server.log.error(err);
    process.exit(1);
  });
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}
