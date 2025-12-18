import { loadAuthSettings } from "../settings/authSettings";

// In production, set NEXT_PUBLIC_ORION_API_BASE_URL to the gateway/API origin.
const runtimeBase = typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:3000";
const baseUrl = process.env.NEXT_PUBLIC_ORION_API_BASE_URL ?? runtimeBase;

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  requestId?: string;

  constructor(params: { status: number; code: string; message: string; details?: unknown; requestId?: string }) {
    super(params.message);
    this.status = params.status;
    this.code = params.code;
    this.details = params.details;
    this.requestId = params.requestId;
  }
}

export const apiFetch = async (path: string, init?: RequestInit) => {
  const url = `${baseUrl ?? ""}${path}`;
  const auth = loadAuthSettings();
  const authHeaders: Record<string, string> = { "Content-Type": "application/json" };
  if (auth.tenantId) authHeaders["x-tenant-id"] = auth.tenantId;
  if (auth.token) authHeaders["Authorization"] = `Bearer ${auth.token}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        ...authHeaders,
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    throw new ApiError({
      status: 0,
      code: "network_error",
      message: "Falha de rede ao chamar API",
      details: err,
    });
  }

  if (!res.ok && res.status !== 304) {
    let parsed: any = null;
    try {
      parsed = await res.json();
    } catch {
      // ignore parse failures
    }
    const envelope = parsed?.error;
    throw new ApiError({
      status: res.status,
      code: envelope?.code ?? "api_error",
      message: envelope?.message ?? `API error ${res.status}`,
      details: envelope?.details,
      requestId: envelope?.requestId,
    });
  }
  return res;
};
