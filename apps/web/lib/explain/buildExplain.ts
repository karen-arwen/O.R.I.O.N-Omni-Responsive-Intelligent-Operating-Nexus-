import { TimelineItem } from "../types";

type Snapshot = Record<string, any>;

export const buildExplain = ({
  snapshot,
  events,
}: {
  snapshot?: Snapshot;
  events: TimelineItem[];
}) => {
  const bullets: string[] = [];
  const mode = snapshot?.mode;
  const permission = snapshot?.permission;
  const risk = snapshot?.riskAssessment?.level;
  const trustValueRaw = snapshot?.trustUsed ? Object.values(snapshot.trustUsed)[0] : undefined;
  const trust = typeof trustValueRaw === "number" ? trustValueRaw : undefined;

  if (permission?.level === "deny") bullets.push("A política bloqueou esta ação (deny).");
  if (permission?.requiresApproval) bullets.push("Requer aprovação; apenas sugerindo.");
  if (risk) bullets.push(`Risco avaliado como ${risk}.`);
  if (trust !== undefined && trust < 0.4) bullets.push("Baixa confiança neste domínio; agindo com cautela.");
  if (mode === "no_action") bullets.push("Optou por silêncio controlado.");

  const hasRepeatNoAction = events.some((e) => e.type === "system.no_action");
  if (hasRepeatNoAction) bullets.push("Repetição de não-ação detectada no fluxo.");

  const explainOriginal: string[] = snapshot?.explain ?? [];
  explainOriginal.slice(0, 3).forEach((e) => bullets.push(e));

  const trace = events.map((e) => `${e.type} @ ${e.timestamp}`);

  return {
    narrativeTitle: "Por que isso aconteceu?",
    bullets: Array.from(new Set(bullets)).slice(0, 7),
    trace,
  };
};
