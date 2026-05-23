import { readFile } from "node:fs/promises";
import { atomicWriteJson } from "./registry.ts";

export class AuthSnapshotError extends Error {}

export type AuthSnapshot = Record<string, unknown> & {
  tokens: Record<string, unknown>;
};

export type AuthMetadata = {
  email: string;
  chatgptAccountId: string;
  planType: string;
};

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;

  try {
    const decoded = Buffer.from(parts[1], "base64url").toString("utf8");
    const value = JSON.parse(decoded) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function collectObjects(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(collectObjects);
  if (!value || typeof value !== "object") return [];
  const objectValue = value as Record<string, unknown>;
  return [objectValue, ...Object.values(objectValue).flatMap(collectObjects)];
}

function collectTokenStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectTokenStrings);
  if (!value || typeof value !== "object") return [];
  return Object.values(value as Record<string, unknown>).flatMap(collectTokenStrings);
}

function findFirst(objects: Record<string, unknown>[], keys: string[]): string {
  for (const key of keys) {
    for (const objectValue of objects) {
      const value = objectValue[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
  }
  return "unknown";
}

export function normalizeAuthSnapshot(value: unknown): AuthSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuthSnapshotError("auth snapshot must be a JSON object");
  }

  const obj = value as Record<string, unknown>;

  // Already has a tokens wrapper — validate as-is
  if (obj.tokens && typeof obj.tokens === "object" && !Array.isArray(obj.tokens)) {
    validateAuthSnapshot(obj);
    return obj as AuthSnapshot;
  }

  // Flat format: id_token / access_token / refresh_token at top level — wrap into tokens
  if (typeof obj.id_token === "string" || typeof obj.access_token === "string" || typeof obj.refresh_token === "string") {
    const { id_token, access_token, refresh_token, account_id, ...rest } = obj;
    const tokens: Record<string, unknown> = {};
    if (id_token !== undefined) tokens.id_token = id_token;
    if (access_token !== undefined) tokens.access_token = access_token;
    if (refresh_token !== undefined) tokens.refresh_token = refresh_token;
    if (account_id !== undefined) tokens.account_id = account_id;

    const normalized: Record<string, unknown> = { ...rest, auth_mode: "chatgpt", tokens };
    validateAuthSnapshot(normalized);
    return normalized as AuthSnapshot;
  }

  throw new AuthSnapshotError("auth snapshot does not contain tokens");
}

export function validateAuthSnapshot(value: unknown): asserts value is AuthSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuthSnapshotError("auth snapshot must be a JSON object");
  }

  const auth = value as Record<string, unknown>;
  if (auth.auth_mode !== undefined && auth.auth_mode !== "chatgpt") {
    throw new AuthSnapshotError("only ChatGPT auth snapshots are supported");
  }

  if (!auth.tokens || typeof auth.tokens !== "object" || Array.isArray(auth.tokens) || Object.keys(auth.tokens).length === 0) {
    throw new AuthSnapshotError("auth snapshot does not contain tokens");
  }
}

export async function readAuthSnapshot(authPath: string): Promise<AuthSnapshot> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(authPath, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new AuthSnapshotError(`auth snapshot not found: ${authPath}`);
    }
    throw new AuthSnapshotError(`auth snapshot is invalid JSON: ${authPath}`);
  }

  validateAuthSnapshot(parsed);
  return parsed;
}

export async function writeAuthSnapshot(authPath: string, auth: unknown): Promise<void> {
  validateAuthSnapshot(auth);
  await atomicWriteJson(authPath, auth, 0o600);
}

export function extractMetadata(auth: unknown): AuthMetadata {
  if (!auth || typeof auth !== "object") {
    return { email: "unknown", chatgptAccountId: "unknown", planType: "unknown" };
  }

  const tokens = (auth as Record<string, unknown>).tokens;
  const payloads = collectTokenStrings(tokens).flatMap((token) => {
    const payload = decodeJwtPayload(token);
    return payload ? collectObjects(payload) : [];
  });

  return {
    email: findFirst(payloads, ["email", "preferred_username"]),
    chatgptAccountId: findFirst(payloads, ["chatgpt_account_id", "account_id", "sub"]),
    planType: findFirst(payloads, ["plan_type", "plan", "subscription_plan"]),
  };
}
