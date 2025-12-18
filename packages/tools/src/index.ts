import { DomainEvent } from "../../shared/src";
import { randomUUID } from "crypto";

export type ToolContext = {
  tenantId: string;
  decisionId?: string;
  correlationId?: string;
  actor?: { userId: string; roles?: string[] };
  eventSink: { append: (event: DomainEvent) => Promise<void> };
};

export type ToolExecuteInput = {
  tool: string;
  input: any;
};

export type ToolResult = {
  output: any;
  events?: DomainEvent[];
};

export interface Tool {
  name: string;
  execute(ctx: ToolContext, input: any): Promise<ToolResult>;
}

const safeString = (v: any, max = 200) => {
  if (!v) return "";
  const s = String(v);
  return s.length > max ? s.slice(0, max) + "…" : s;
};

const makeEvent = (name: string, ctx: ToolContext, payload: any): DomainEvent => ({
  id: randomUUID(),
  aggregateId: ctx.decisionId ?? ctx.correlationId ?? "tool",
  type: name,
  timestamp: new Date().toISOString(),
  payload,
  meta: {
    actor: { userId: ctx.actor?.userId ?? "tool" },
    source: "system",
    decisionId: ctx.decisionId ?? ctx.correlationId ?? "tool",
    correlationId: ctx.correlationId ?? ctx.decisionId ?? "tool",
    tenantId: ctx.tenantId,
  },
});

const echoTool: Tool = {
  name: "tool.echo",
  async execute(ctx, input) {
    const evt = makeEvent("tool.echoed", ctx, { echo: input });
    await ctx.eventSink.append(evt);
    return { output: { echo: input, summary: safeString(JSON.stringify(input)) }, events: [evt] };
  },
};

const noteTool: Tool = {
  name: "tool.create_note",
  async execute(ctx, input) {
    const note = {
      id: randomUUID(),
      title: safeString(input?.title ?? "Note"),
      body: safeString(input?.body ?? "", 500),
    };
    const evt = makeEvent("tool.note_created", ctx, note);
    await ctx.eventSink.append(evt);
    return { output: note, events: [evt] };
  },
};

const taskTool: Tool = {
  name: "tool.create_task_stub",
  async execute(ctx, input) {
    const task = {
      id: randomUUID(),
      title: safeString(input?.title ?? "Task"),
      due: input?.due ?? null,
      priority: input?.priority ?? "normal",
    };
    const evt = makeEvent("tool.task_stub_created", ctx, task);
    await ctx.eventSink.append(evt);
    return { output: task, events: [evt] };
  },
};

const draftTool: Tool = {
  name: "tool.generate_draft",
  async execute(ctx, input) {
    const content = safeString(input?.topic ?? "Draft") + " — draft generated.";
    const evt = makeEvent("tool.draft_generated", ctx, { content });
    await ctx.eventSink.append(evt);
    return { output: { content }, events: [evt] };
  },
};

const bundleTool: Tool = {
  name: "tool.export_bundle",
  async execute(ctx, input) {
    const bundle = {
      decisionId: ctx.decisionId,
      correlationId: ctx.correlationId,
      createdAt: new Date().toISOString(),
      note: safeString(input?.note ?? "", 300),
    };
    const evt = makeEvent("tool.bundle_exported", ctx, bundle);
    await ctx.eventSink.append(evt);
    return { output: bundle, events: [evt] };
  },
};

const tools: Record<string, Tool> = [echoTool, noteTool, taskTool, draftTool, bundleTool].reduce((acc, t) => {
  acc[t.name] = t;
  return acc;
}, {} as Record<string, Tool>);

export function getTool(name: string): Tool | undefined {
  return tools[name];
}
