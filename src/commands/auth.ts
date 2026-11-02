import { Command } from "commander";
import { getAppUrl, getToken, hasToken, maskToken, removeToken, setToken } from "../lib/auth.js";
import { client } from "../lib/client.js";
import { globalFlags, KNOWN_APP_URLS, STATE_FILE } from "../lib/config.js";
import { handleError } from "../lib/errors.js";
import { log } from "../lib/logger.js";
import { output } from "../lib/output.js";
import {
  listProfiles,
  normalizeUrl,
  readState,
  resolveProfile,
  setActiveProfile,
  setProfileMeta,
} from "../lib/profiles.js";

type Me = { user: { name: string; email: string; role: string | null } };

/**
 * Points every later call in this process at `profile`. The HTTP client reads
 * the profile from `globalFlags`, so auth subcommands that target a specific
 * profile have to move it before they call the API.
 */
const useProfileForThisRun = (profile?: string): string => {
  const name = resolveProfile(profile);
  globalFlags.profile = name;
  return name;
};

/** Calls /me and caches the key owner on the profile. */
const verifyProfile = async (profile: string): Promise<Me["user"]> => {
  const { user } = await client.get<Me>("/me");
  setProfileMeta(profile, {
    user: `${user.name} <${user.email}>`,
    role: user.role ?? "user",
    verifiedAt: Date.now(),
  });
  return user;
};

export const authCommand = new Command("auth").description(
  "Manage API keys (one profile per FTO app: prod, dev, local...)",
);

authCommand
  .command("set")
  .description("Save an API key (create it in the FTO app: Account > API keys)")
  .argument("<key>", "API key (esm_...)")
  .option("--profile <name>", "Profile: prod, dev, local or any name with --url")
  .option("--url <url>", "App URL (only needed for profiles other than prod, dev, local)")
  .option("--use", "Also make this profile the active one")
  .addHelpText(
    "after",
    `\nExamples:\n  esm-fto-cli auth set esm_xxx --profile prod --use\n  esm-fto-cli auth set esm_yyy --profile dev\n  esm-fto-cli auth set esm_zzz --profile staging --url https://staging.example.org\n\nKnown URLs: ${Object.entries(KNOWN_APP_URLS)
      .map(([name, url]) => `${name}=${url}`)
      .join(", ")}`,
  )
  .action(async (key: string, opts: { profile?: string; url?: string; use?: boolean }) => {
    try {
      const profile = useProfileForThisRun(opts.profile);
      if (opts.url) setProfileMeta(profile, { url: normalizeUrl(opts.url) });
      setToken(key, profile);
      log.success(`API key saved for profile "${profile}" (${getAppUrl()})`);

      // The first profile becomes active on its own, so a single-app setup
      // never has to think about profiles at all.
      const isFirst = !readState().active && listProfiles().length === 1;
      if (opts.use || isFirst) {
        setActiveProfile(profile);
        log.success(`Active profile is now "${profile}"`);
      }

      // Best effort: a wrong URL or no network must not lose the key.
      try {
        const user = await verifyProfile(profile);
        log.success(`Key valid for ${user.name} <${user.email}> (role: ${user.role ?? "user"})`);
      } catch (err) {
        log.warn(`Key saved but could not be verified: ${err instanceof Error ? err.message : String(err)}`);
      }
    } catch (err) {
      handleError(err);
    }
  });

authCommand
  .command("use")
  .description("Switch the active profile used by all commands")
  .argument("<profile>", "Profile name")
  .addHelpText("after", "\nExample:\n  esm-fto-cli auth use dev")
  .action((profile: string) => {
    try {
      if (!hasToken(profile)) {
        const known = listProfiles().map((entry) => entry.name);
        throw new Error(
          `No key stored for profile "${profile}".${known.length > 0 ? ` Known profiles: ${known.join(", ")}` : ""}`,
        );
      }
      setActiveProfile(profile);
      log.success(`Active profile is now "${profile}"`);
    } catch (err) {
      handleError(err);
    }
  });

authCommand
  .command("list")
  .alias("ls")
  .description("List stored profiles (* = active)")
  .action(() => {
    const profiles = listProfiles();
    if (profiles.length === 0 && !globalFlags.json) {
      log.warn("No profiles yet. Run: esm-fto-cli auth set <key> --profile prod");
      return;
    }
    output(
      profiles.map((entry) => ({
        active: entry.active ? "*" : "",
        profile: entry.name,
        url: entry.url ?? "-",
        user: entry.user ?? "-",
        role: entry.role ?? "-",
      })),
    );
    if (!globalFlags.json && (process.env.ESM_FTO_API_KEY ?? process.env.ESM_API_KEY)?.trim()) {
      log.warn("ESM_FTO_API_KEY (or ESM_API_KEY) is set in this shell and overrides every profile above.");
    }
  });

authCommand
  .command("show")
  .description("Show the selected profile (key masked by default)")
  .option("--raw", "Show the full unmasked key")
  .action((opts: { raw?: boolean }) => {
    try {
      const profile = resolveProfile();
      if (!hasToken(profile)) {
        log.warn(`No API key for profile "${profile}". Run: esm-fto-cli auth set <key> --profile ${profile}`);
        return;
      }
      const token = getToken(profile);
      output({
        profile,
        url: getAppUrl(),
        key: opts.raw ? token : maskToken(token),
        state: STATE_FILE,
      });
    } catch (err) {
      handleError(err);
    }
  });

authCommand
  .command("remove")
  .description("Delete the selected profile's key (use --profile <name>)")
  .action(() => {
    const profile = resolveProfile();
    removeToken(profile);
    log.success(`Profile "${profile}" removed`);
  });

authCommand
  .command("test")
  .description("Check the API key against the app and show who it belongs to")
  .action(async () => {
    try {
      const profile = resolveProfile();
      const user = await verifyProfile(profile);
      log.success(
        `Key valid for ${user.name} <${user.email}> (role: ${user.role ?? "user"}) on ${getAppUrl()} [${profile}]`,
      );
    } catch (err) {
      handleError(err);
    }
  });
