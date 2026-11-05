import { homedir } from "os";
import { join } from "path";
import pkg from "../../package.json";

/** Application name */
export const APP_NAME = "esm-fto";

/** CLI binary name */
export const APP_CLI = "esm-fto-cli";

/**
 * Sent as `x-cli-version: esm-fto-cli/<version>`: the FTO app answers 426
 * below its minimum (frontend/src/features/api-v1/cli-version.ts). Bump it in
 * package.json with every breaking API change.
 */
export const APP_VERSION = pkg.version;

/** API path on the FTO (ESM) Next.js app (never the FastAPI backend directly). */
export const API_PATH = "/api/v1";

/**
 * Known environments: `auth set <key> --profile prod` needs no --url.
 * Any other profile name needs --url once.
 */
export const KNOWN_APP_URLS: Record<string, string> = {
  prod: "https://fto.encounterschool.org",
  dev: "https://fto-dev.encounterschool.org",
  local: "http://localhost:3000",
};

/** Profile used when nothing else selects one. */
export const FALLBACK_PROFILE = "prod";

/**
 * Same layout as growth-cli: one key per profile in
 * `~/.config/tokens/esm-fto-cli-<profile>.txt` (chmod 600), everything else
 * (app URL, key owner, active profile) in a state file.
 * ESM_FTO_API_KEY / ESM_FTO_API_URL / ESM_FTO_PROFILE override them (agents, CI).
 */
export const TOKEN_DIR = join(homedir(), ".config", "tokens");
export const STATE_FILE = join(homedir(), ".config", APP_CLI, "state.json");

/** Global state for output flags (set by root command) */
export const globalFlags = {
  json: false,
  format: "text" as "text" | "json" | "csv" | "yaml",
  verbose: false,
  noColor: false,
  noHeader: false,
  /** Resolved once by the root preAction hook: flag > env > active > fallback. */
  profile: "",
};
