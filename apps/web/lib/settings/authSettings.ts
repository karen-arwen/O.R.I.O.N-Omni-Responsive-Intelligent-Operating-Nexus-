export type AuthSettings = {
  tenantId: string;
  token?: string;
  userId?: string;
  roles?: string[];
};

const key = "orion-auth-settings";

const defaultAuth: AuthSettings = { tenantId: "local", roles: ["admin"] };
let authCache: AuthSettings = defaultAuth;

export const loadAuthSettings = (): AuthSettings => {
  const hasStorage = typeof localStorage !== "undefined";
  if (!hasStorage) return authCache;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return authCache;
    const parsed = JSON.parse(raw) as AuthSettings;
    authCache = { ...defaultAuth, ...parsed, roles: parsed.roles ?? defaultAuth.roles };
    return authCache;
  } catch {
    return authCache;
  }
};

export const saveAuthSettings = (value: AuthSettings) => {
  authCache = { ...defaultAuth, ...value, roles: value.roles ?? defaultAuth.roles };
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key, JSON.stringify(authCache));
};
