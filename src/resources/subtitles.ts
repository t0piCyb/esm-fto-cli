import { Command } from "commander";
import { client, seg } from "../lib/client.js";
import { globalFlags } from "../lib/config.js";
import { handleError } from "../lib/errors.js";
import { readInput, writeOutput } from "../lib/io.js";
import { log } from "../lib/logger.js";
import { output } from "../lib/output.js";

export const subtitlesResource = new Command("subtitles").description(
  "Translated subtitles in Google Drive: download, upload, import a translation",
);

const subtitlesPath = (video: string, lang: string) =>
  `/videos/${seg(video)}/languages/${seg(lang)}/subtitles`;

subtitlesResource
  .command("get")
  .description("Print or save the translated SRT currently in Drive")
  .argument("<video>", "Video code (q1.c2.s3), id or Alugha id")
  .argument("<lang>", "Language code")
  .option("-o, --out <file>", "Write to a file instead of stdout")
  .addHelpText("after", "\nExample:\n  esm-fto-cli subtitles get q1.c2.s3 fr -o q1.c2.s3_fra.srt")
  .action(async (video: string, lang: string, opts: { out?: string }) => {
    try {
      const result = await client.get<{ path: string | null; content: string }>(subtitlesPath(video, lang));
      if (globalFlags.json) return output(result);
      writeOutput(result.content, opts.out);
    } catch (err) {
      handleError(err);
    }
  });

subtitlesResource
  .command("put")
  .description("Save an SRT file to Drive for this language (like the review editor)")
  .argument("<video>", "Video code, id or Alugha id")
  .argument("<lang>", "Language code")
  .requiredOption("-f, --file <path>", "SRT file, or - for stdin")
  .option("--stage <stage>", "reviewed (human-corrected, status TRANSLATED) | translation (raw, status TRANSLATING)", "reviewed")
  .option("--no-line-breaks", "Save as-is, without adding display line breaks")
  .option("--status <status>", "Status to set after saving, or \"keep\" to leave it unchanged")
  .addHelpText(
    "after",
    "\nExamples:\n  esm-fto-cli subtitles put q1.c2.s3 fr -f fixed.srt\n  esm-fto-cli subtitles put q1.c2.s3 de -f raw.srt --stage translation --status keep",
  )
  .action(async (video: string, lang: string, opts: { file: string; stage: string; lineBreaks: boolean; status?: string }) => {
    try {
      const content = await readInput(opts.file);
      const result = await client.put<{ path: string | null; status: string | null }>(subtitlesPath(video, lang), {
        content,
        stage: opts.stage,
        addLineBreaks: opts.lineBreaks,
        ...(opts.status && { status: opts.status === "keep" ? null : opts.status.toUpperCase() }),
      });
      if (globalFlags.json) return output(result);
      log.success(`Saved to Drive: ${result.path ?? "(path unknown)"}${result.status ? `, status ${result.status}` : ""}`);
    } catch (err) {
      handleError(err);
    }
  });

subtitlesResource
  .command("import")
  .description("Import a translation in the after-DeepL format (<<1>> text <<2>> text ...)")
  .argument("<video>", "Video code, id or Alugha id")
  .argument("<lang>", "Language code")
  .requiredOption("-f, --file <path>", "Tagged translation file, or - for stdin")
  .option("--dry-run", "Validate and print the generated SRT without saving")
  .option("--force", "Overwrite even if the language was already reviewed (TRANSLATED or later)")
  .addHelpText(
    "after",
    "\nTags must match the source subtitles one to one; the SRT gets the source timings.\nWithout --dry-run it is saved to Drive and the status becomes TRANSLATING.\n\nExample:\n  esm-fto-cli subtitles import q1.c2.s3 fr -f after_deepl_fr.txt",
  )
  .action(async (video: string, lang: string, opts: { file: string; dryRun?: boolean; force?: boolean }) => {
    try {
      const content = await readInput(opts.file);
      const result = await client.post<{ saved: boolean; path?: string | null; subtitleCount: number; content?: string }>(
        `${subtitlesPath(video, lang)}/import`,
        { content, save: !opts.dryRun, force: Boolean(opts.force) },
      );
      if (globalFlags.json) return output(result);
      if (!result.saved && result.content) {
        writeOutput(result.content);
        return;
      }
      log.success(`${result.subtitleCount} subtitles saved to Drive: ${result.path ?? ""} (status TRANSLATING)`);
    } catch (err) {
      handleError(err);
    }
  });
