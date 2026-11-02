/**
 * Profiles: one FTO app (prod, dev, local...) + one personal API key each.
 *
 * Same layout as growth-cli: the key sits alone in
 * `~/.config/tokens/esm-fto-cli-<profile>.txt`, everything else (app URL, key
 * owner, active profile) in a state file, so a key never shares a file with
 * data the CLI rewrites.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  API_PATH,
  APP_CLI,
  FALLBACK_PROFILE,
  globalFlags,
  KNOWN_APP_URLS,
  STATE_FILE,
  TOKEN_DIR,
} from "./config.js";
import { CliError } from "./errors.js";

export type ProfileMeta = {
  /** App origin, e.g. https://fto.encounterschool.org (no `/api/v1`). */
  url?: string;
  /** Key owner, cached by `auth set` / `auth test`. */
  user?: string;
  role?: string;
  verifiedAt?: number;
};

type State = {
  active?: string;
  profiles?: Record<string, ProfileMeta>;
};

const TOKEN_PREFIX = `${APP_CLI}-`;
const TOKEN_SUFFIX = ".txt";

/** Profile names become filenames, so restrict them to safe characters. */
export const sanitizeProfile = (profile: string) =>
  profile.trim().replace(/[^a-zA-Z0-9._-]/g, "_") || FALLBACK_PROFILE;

export const tokenPath = (profile: string) =>
  join(TOKEN_DIR, `${TOKEN_PREFIX}${sanitizeProfile(profile)}${TOKEN_SUFFIX}`);

export const readState = (): State => {
  if (!existsSync(STATE_FILE)) return {};
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as State;
  } catch {
    // Only preferences live here; the next write repairs a corrupt file.
    return {};
  }
};

const writeState = (state: State): void => {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  chmodSync(STATE_FILE, 0o600);
};

/** `ESM_FTO_PROFILE` wins over the saved active profile, so a shell can override. */
export const defaultProfile = (): string =>
  process.env.ESM_FTO_PROFILE?.trim() || readState().active?.trim() || FALLBACK_PROFILE;

/** Resolution order: explicit flag > already-resolved global > default. */
export const resolveProfile = (explicit?: string): string =>
  sanitizeProfile(explicit?.trim() || globalFlags.profile.trim() || defaultProfile());

export const profileMeta = (profile: string): ProfileMeta =>
  readState().profiles?.[sanitizeProfile(profile)] ?? {};

export const setActiveProfile = (profile: string): void => {
  writeState({ ...readState(), active: sanitizeProfile(profile) });
};

export const setProfileMeta = (profile: string, meta: ProfileMeta): void => {
  const state = readState();
  const name = sanitizeProfile(profile);
  writeState({
    ...state,
    profiles: { ...state.profiles, [name]: { ...state.profiles?.[name], ...meta } },
  });
};

export const forgetProfile = (profile: string): void => {
  const state = readState();
  const name = sanitizeProfile(profile);
  const profiles = { ...state.profiles };
  delete profiles[name];
  writeState({
    ...state,
    active: state.active === name ? undefined : state.active,
    profiles,
  });
};

/** Strips a trailing slash or `/api/v1` so both spellings of a URL work. */
export const normalizeUrl = (url: string): string =>
  url.trim().replace(/\/+$/, "").replace(new RegExp(`${API_PATH}$`), "");

/**
 * App origin for the selected profile: `ESM_FTO_API_URL` (legacy `ESM_API_URL`),
 * then the profile's saved URL, then the known URL of `prod` / `dev` / `local`.
 */
export const appUrl = (profile = resolveProfile()): string => {
  const url =
    process.env.ESM_FTO_API_URL?.trim() ||
    process.env.ESM_API_URL?.trim() ||
    profileMeta(profile).url ||
    KNOWN_APP_URLS[profile];
  if (!url) {
    throw new CliError(
      2,
      `Profile "${profile}" has no app URL.`,
      `Run: ${APP_CLI} auth set <key> --profile ${profile} --url https://<fto-app>`,
    );
  }
  return normalizeUrl(url);
};

export type StoredProfile = ProfileMeta & { name: string; active: boolean };

/** Every profile that has a key on disk, plus the active marker. */
export const listProfiles = (): StoredProfile[] => {
  if (!existsSync(TOKEN_DIR)) return [];
  const state = readState();
  const active = defaultProfile();

  return readdirSync(TOKEN_DIR)
    .filter((file) => file.startsWith(TOKEN_PREFIX) && file.endsWith(TOKEN_SUFFIX))
    .map((file) => file.slice(TOKEN_PREFIX.length, file.length - TOKEN_SUFFIX.length))
    .filter(Boolean)
    .sort()
    .map((name) => ({
      ...state.profiles?.[name],
      url: state.profiles?.[name]?.url ?? KNOWN_APP_URLS[name],
      name,
      active: name === active,
    }));
};
