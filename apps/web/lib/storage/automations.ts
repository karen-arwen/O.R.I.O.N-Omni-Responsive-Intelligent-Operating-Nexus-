import { z } from "zod";

export const automationSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean().default(true),
  condition: z.object({
    kind: z.string().optional(),
    type: z.string().optional(),
    domain: z.string().optional(),
    riskAbove: z.number().optional(),
    trustBelow: z.number().optional(),
  }),
  action: z.enum(["alert", "save_view", "open_mission", "notify"]).default("alert"),
  createdAt: z.string().optional(),
});

export type Automation = z.infer<typeof automationSchema>;

const KEY = "orion-automations";

export const loadAutomations = (): Automation[] => {
  const raw = typeof window !== "undefined" ? localStorage.getItem(KEY) : null;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const res = z.array(automationSchema).safeParse(parsed);
    return res.success ? res.data : [];
  } catch {
    return [];
  }
};

export const saveAutomations = (items: Automation[]) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(items));
};
