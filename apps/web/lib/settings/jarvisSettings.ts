import { z } from "zod";

const settingsSchema = z.object({
  hud: z.boolean().default(true),
  compact: z.boolean().default(false),
  voice: z.boolean().default(false),
});

export type JarvisSettings = z.infer<typeof settingsSchema>;

const KEY = "orion-jarvis-settings";

export const loadJarvisSettings = (): JarvisSettings => {
  const raw = typeof window !== "undefined" ? localStorage.getItem(KEY) : null;
  if (!raw) return settingsSchema.parse({});
  try {
    const parsed = JSON.parse(raw);
    const result = settingsSchema.safeParse(parsed);
    return result.success ? result.data : settingsSchema.parse({});
  } catch {
    return settingsSchema.parse({});
  }
};

export const saveJarvisSettings = (settings: JarvisSettings) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(settings));
};
