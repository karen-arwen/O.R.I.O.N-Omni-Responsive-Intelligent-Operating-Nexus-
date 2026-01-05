export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled"
  | "dead_letter"
  | "awaiting_approval";

export type JobRecord = {
  id: string;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
  decisionId?: string | null;
  correlationId?: string | null;
  domain?: string | null;
  type: string;
  status: JobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  runAt: string;
  lockedAt?: string | null;
  lockedBy?: string | null;
  idempotencyKey?: string | null;
  input: any;
  output?: any;
  error?: JobErrorSafe | null;
  traceEventIds?: string[] | null;
  etag?: string | null;
};

export type JobErrorSafe = { code: string; message: string; details?: any };
export type JobOutputSafe = any;

export type JobCreateInput = {
  decisionId?: string;
  correlationId?: string;
  domain?: string;
  type: string;
  status?: JobStatus;
  priority?: number;
  maxAttempts?: number;
  runAt?: string;
  idempotencyKey?: string;
  input: any;
};

export type JobUpdatePatch = Partial<
  Pick<
    JobRecord,
    | "status"
    | "attempts"
    | "maxAttempts"
    | "runAt"
    | "output"
    | "error"
    | "lockedAt"
    | "lockedBy"
    | "etag"
    | "traceEventIds"
    | "domain"
  >
>;

export type JobPermission = { domain: string; action: string };

export const jobTypeToPermission = (jobType: string | undefined): JobPermission => {
  switch (jobType) {
    case "tool.echo":
      return { domain: "messaging", action: "draft" };
    case "tool.create_note":
      return { domain: "tasks", action: "create" };
    case "tool.create_task_stub":
      return { domain: "tasks", action: "create" };
    case "tool.generate_draft":
      return { domain: "messaging", action: "draft" };
    case "tool.export_bundle":
      return { domain: "system", action: "export" };
    default:
      return { domain: "generic", action: "execute" };
  }
};
