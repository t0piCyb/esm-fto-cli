import { Command } from "commander";
import { client, seg } from "../lib/client.js";
import { globalFlags } from "../lib/config.js";
import { CliError, handleError } from "../lib/errors.js";
import { log } from "../lib/logger.js";
import { output } from "../lib/output.js";

type Language = { id: string; code: string; alughaCode: string; name: string; drivePathName: string };

export const whoamiCommand = new Command("whoami")
  .description("Who the API key belongs to, role and assigned languages")
  .action(async () => {
    try {
      const { user } = await client.get<{
        user: { id: string; name: string; email: string; role: string | null; languages: Language[] };
      }>("/me");
      output(globalFlags.json ? user : { ...user, languages: user.languages.map((l) => l.code).join(", ") || null });
    } catch (err) {
      handleError(err);
    }
  });

export const languagesResource = new Command("languages").description("Languages of the platform");

languagesResource
  .command("list")
  .description("List languages (ISO code, Alugha code, Drive folder)")
  .action(async () => {
    try {
      const { data } = await client.get<{ data: Language[] }>("/languages");
      output(data);
    } catch (err) {
      handleError(err);
    }
  });

export const promptsResource = new Command("prompts").description("Default translation prompts (Google Sheets)");

promptsResource
  .command("list")
  .description("Show the default prompt of each language pair")
  .action(async () => {
    try {
      output(await client.get("/prompts"));
    } catch (err) {
      handleError(err);
    }
  });

type User = { id: string; name: string; email: string; role: string | null; banned: boolean; languages: Language[] };

export const usersResource = new Command("users").description("Users and translator languages (admin)");

usersResource
  .command("list")
  .description("List users with role and assigned languages")
  .option("--search <text>", "Filter by name or e-mail")
  .action(async (opts: { search?: string }) => {
    try {
      const { data } = await client.get<{ data: User[] }>("/users", { search: opts.search });
      output(
        globalFlags.json
          ? data
          : data.map((user) => ({
              email: user.email,
              name: user.name,
              role: user.role ?? "user",
              languages: user.languages.map((l) => l.code).join(", "),
              banned: user.banned,
            })),
      );
    } catch (err) {
      handleError(err);
    }
  });

usersResource
  .command("assign")
  .description("Assign a translation language to a user")
  .argument("<user>", "User e-mail or id")
  .argument("<lang>", "Language code")
  .action(async (user: string, lang: string) => {
    try {
      await client.post(`/users/${seg(user)}/languages`, { language: lang });
      log.success(`${user} can now translate ${lang}`);
    } catch (err) {
      handleError(err);
    }
  });

usersResource
  .command("unassign")
  .description("Remove a translation language from a user")
  .argument("<user>", "User e-mail or id")
  .argument("<lang>", "Language code")
  .action(async (user: string, lang: string) => {
    try {
      const result = await client.delete<{ unassigned: boolean }>(`/users/${seg(user)}/languages/${seg(lang)}`);
      log.success(result.unassigned ? `${lang} removed from ${user}` : `${user} was not assigned to ${lang}`);
    } catch (err) {
      handleError(err);
    }
  });

/**
 * Escape hatch: any /api/v1 endpoint, authenticated with the same key.
 */
export const apiCommand = new Command("api")
  .description("Call any /api/v1 endpoint directly")
  .argument("<method>", "GET | POST | PUT | PATCH | DELETE")
  .argument("<path>", "Path under /api/v1, e.g. /videos/q1.c2.s3")
  .option("-d, --data <json>", "JSON body")
  .addHelpText("after", "\nExample:\n  esm-fto-cli api GET /videos/q1.c2.s3/languages/fr\n  esm-fto-cli api PATCH /videos/q1.c2.s3 -d '{\"year\":\"2021-2022\"}'")
  .action(async (method: string, path: string, opts: { data?: string }) => {
    try {
      let body: Record<string, unknown> | undefined;
      if (opts.data) {
        try {
          body = JSON.parse(opts.data) as Record<string, unknown>;
        } catch {
          throw new CliError(2, "--data is not valid JSON");
        }
      }
      const normalizedPath = path.startsWith("/") ? path : `/${path}`;
      const verb = method.toUpperCase();
      const result =
        verb === "GET"
          ? await client.get(normalizedPath)
          : verb === "POST"
            ? await client.post(normalizedPath, body)
            : verb === "PUT"
              ? await client.put(normalizedPath, body)
              : verb === "PATCH"
                ? await client.patch(normalizedPath, body)
                : verb === "DELETE"
                  ? await client.delete(normalizedPath)
                  : (() => {
                      throw new CliError(2, `Unknown method "${method}"`);
                    })();
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      handleError(err);
    }
  });
