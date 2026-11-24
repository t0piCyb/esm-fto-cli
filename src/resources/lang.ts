import { Command } from "commander";
import { client, seg } from "../lib/client.js";
import { CliError, handleError } from "../lib/errors.js";
import { log } from "../lib/logger.js";
import { output } from "../lib/output.js";
import { targetLanguageRow, type TargetLanguage, type Video } from "../lib/types.js";

const STATUSES = ["PENDING", "TRANSLATING", "TRANSLATED", "VOICE_OVER_GENERATING", "COMPLETED"];

export const langResource = new Command("lang").description(
  "A video in one target language: status, deadline, validation, add/remove",
);

const langPath = (video: string, lang: string) => `/videos/${seg(video)}/languages/${seg(lang)}`;

langResource
  .command("get")
  .description("Show one target language of a video")
  .argument("<video>", "Video code (q1.c2.s3), id or Alugha id")
  .argument("<lang>", "Language: fr, fra, French...")
  .action(async (video: string, lang: string) => {
    try {
      const { targetLanguage } = await client.get<{ targetLanguage: TargetLanguage }>(langPath(video, lang));
      output(targetLanguageRow(targetLanguage));
    } catch (err) {
      handleError(err);
    }
  });

langResource
  .command("status")
  .description("Set the translation status (translators of the language, staff, admin)")
  .argument("<video>", "Video code, id or Alugha id")
  .argument("<lang>", "Language code")
  .argument("<status>", STATUSES.join(" | "))
  .addHelpText(
    "after",
    "\nFlow: PENDING -> TRANSLATING (auto translation saved) -> TRANSLATED (human review saved)\n      -> VOICE_OVER_GENERATING -> COMPLETED (published on Alugha)\n\nExample:\n  esm-fto-cli lang status q1.c2.s3 fr TRANSLATED",
  )
  .action(async (video: string, lang: string, status: string) => {
    try {
      const value = status.toUpperCase();
      if (!STATUSES.includes(value)) {
        throw new CliError(2, `Unknown status "${status}"`, `Use one of: ${STATUSES.join(", ")}`);
      }
      const { targetLanguage } = await client.patch<{ targetLanguage: TargetLanguage }>(langPath(video, lang), {
        status: value,
      });
      log.success(`${video} ${targetLanguage.language}: ${targetLanguage.status}`);
    } catch (err) {
      handleError(err);
    }
  });

langResource
  .command("deadline")
  .description("Set or clear the translation deadline (staff/admin)")
  .argument("<video>", "Video code, id or Alugha id")
  .argument("<lang>", "Language code")
  .argument("<date>", "ISO date (2026-11-30) or \"none\"")
  .action(async (video: string, lang: string, date: string) => {
    try {
      const deadline = date === "none" ? null : date;
      const { targetLanguage } = await client.patch<{ targetLanguage: TargetLanguage }>(langPath(video, lang), {
        deadline,
      });
      log.success(`${video} ${targetLanguage.language}: deadline ${targetLanguage.deadline ?? "cleared"}`);
    } catch (err) {
      handleError(err);
    }
  });

type Person = { id: string; name: string; email: string };

langResource
  .command("validate")
  .alias("approve")
  .description(
    "Approve the subtitles of a video in one language (same as translations approve). Translators approve their own review; staff approve from any status and, with --translator, FOR the translator who did it (sent by e-mail, done in Drive)",
  )
  .argument("<video>", "Video code, id or Alugha id")
  .argument("<lang>", "Language code")
  .option("--translator <user>", "Staff: credit this translator (e-mail, id or exact name); default you")
  .option("--note <text>", "Comment kept in the approval history")
  .action(async (video: string, lang: string, opts: { translator?: string; note?: string }) => {
    try {
      const result = await client.post<{ translator: Person; onBehalf: boolean; validatedBy: string }>(
        `${langPath(video, lang)}/validation`,
        { translator: opts.translator, note: opts.note },
      );
      log.success(
        result.onBehalf
          ? `${video} ${lang} approved for ${result.translator.name} by ${result.validatedBy}`
          : `${video} ${lang} approved by ${result.validatedBy}`,
      );
    } catch (err) {
      handleError(err);
    }
  });

langResource
  .command("unvalidate")
  .alias("revoke")
  .description("Withdraw the approval of the subtitles: back to review, language back to TRANSLATING (staff, or the translator credited)")
  .argument("<video>", "Video code, id or Alugha id")
  .argument("<lang>", "Language code")
  .option("--note <text>", "Why (kept in the history)")
  .action(async (video: string, lang: string, opts: { note?: string }) => {
    try {
      await client.post(`/tools/${seg("withdraw_validation")}`, { ref: video, lang, note: opts.note });
      log.success(`${video} ${lang}: approval withdrawn, back in review`);
    } catch (err) {
      handleError(err);
    }
  });

langResource
  .command("add")
  .description("Add a target language to a video (staff/admin)")
  .argument("<video>", "Video code, id or Alugha id")
  .argument("<lang>", "Language code")
  .option("--deadline <date>", "ISO date")
  .action(async (video: string, lang: string, opts: { deadline?: string }) => {
    try {
      const result = await client.post<{ video: Video }>(`/videos/${seg(video)}/languages`, {
        language: lang,
        deadline: opts.deadline,
      });
      log.success(`${result.video.code}: ${lang} added`);
      output(result.video.targetLanguages.map(targetLanguageRow));
    } catch (err) {
      handleError(err);
    }
  });

langResource
  .command("remove")
  .description("Remove a target language from a video; Drive files are kept (staff/admin)")
  .argument("<video>", "Video code, id or Alugha id")
  .argument("<lang>", "Language code")
  .requiredOption("--yes", "Confirm")
  .action(async (video: string, lang: string) => {
    try {
      await client.delete(langPath(video, lang));
      log.success(`${video}: ${lang} removed`);
    } catch (err) {
      handleError(err);
    }
  });
