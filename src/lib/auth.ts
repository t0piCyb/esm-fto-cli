import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { APP_CLI, TOKEN_DIR } from "./config.js";
import { CliError } from "./errors.js";
import { appUrl, forgetProfile, resolveProfile, tokenPath } from "./profiles.js";

/** `ESM_FTO_API_KEY` (legacy `ESM_API_KEY`) overrides every profile. */
const keyFromEnv = (): string | undefined =>
  process.env.ESM_FTO_API_KEY?.trim() || process.env.ESM_API_KEY?.trim() || undefined;

export function hasToken(profile?: string): boolean {
  return Boolean(keyFromEnv()) || existsSync(tokenPath(resolveProfile(profile)));
}

/** API key for this command. Throws if not configured. */
export function getToken(profile?: string): string {
  const fromEnv = keyFromEnv();
  if (fromEnv) return fromEnv;
  const name = resolveProfile(profile);
  if (!existsSync(tokenPath(name))) {
    throw new CliError(
      2,
      `No API key configured for profile "${name}".`,
      `Create a key in the FTO app (Account > API keys), then: ${APP_CLI} auth set <key> --profile ${name}`,
    );
  }
  return readFileSync(tokenPath(name), "utf-8").trim();
}

/** Save a key to disk with restricted permissions (chmod 600). */
export function setToken(token: string, profile?: string): void {
  const path = tokenPath(resolveProfile(profile));
  mkdirSync(TOKEN_DIR, { recursive: true });
  writeFileSync(path, token.trim(), { mode: 0o600 });
  // Ensure permissions even if file existed
  chmodSync(path, 0o600);
}

/** Delete the stored key and drop the profile from the saved state. */
export function removeToken(profile?: string): void {
  const name = resolveProfile(profile);
  const path = tokenPath(name);
  if (existsSync(path)) unlinkSync(path);
  forgetProfile(name);
}

/** App URL (origin) for this command. */
export function getAppUrl(): string {
  return appUrl();
}

/** Mask a key for display: "esm_abcd...wxyz" */
export function maskToken(token: string): string {
  if (token.length <= 12) return "****";
  return `${token.slice(0, 8)}...${token.slice(-4)}`;
}

/** The FTO API reads the key from `x-api-key`. */
export function buildAuthHeaders(): Record<string, string> {
  return { "x-api-key": getToken() };
}
