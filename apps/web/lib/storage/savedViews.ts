import { z } from "zod";

export const savedViewSchema = z.object({
  name: z.string().min(1),
  filters: z.object({
    correlationId: z.string().optional(),
    decisionId: z.string().optional(),
    domain: z.string().optional(),
    kind: z.string().optional(),
    types: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
  favorite: z.boolean().optional(),
  createdAt: z.string().optional(),
});

export type SavedView = z.infer<typeof savedViewSchema>;

const STORAGE_KEY = "orion-saved-views";
let memoryViews: SavedView[] = [];

export const loadSavedViews = (): SavedView[] => {
  if (typeof localStorage === "undefined") return memoryViews;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const array = z.array(savedViewSchema).safeParse(parsed);
    const views = array.success ? array.data : [];
    memoryViews = views;
    return views;
  } catch {
    return memoryViews;
  }
};

export const saveViews = (views: SavedView[]) => {
  memoryViews = views;
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
};

export const addSavedView = (view: SavedView) => {
  const existing = loadSavedViews();
  saveViews([{ ...view, createdAt: view.createdAt ?? new Date().toISOString() }, ...existing]);
};

export const deleteSavedView = (name: string) => {
  const existing = loadSavedViews();
  saveViews(existing.filter((v) => v.name !== name));
};
