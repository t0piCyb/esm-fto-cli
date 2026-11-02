import { Command } from "commander";
import pc from "picocolors";
import { client, seg } from "../lib/client.js";
import { globalFlags } from "../lib/config.js";
import { CliError, handleError } from "../lib/errors.js";
import { readInput, writeOutput } from "../lib/io.js";
import { log } from "../lib/logger.js";
import { output } from "../lib/output.js";
import { targetLanguageRow, videoRow, type Video } from "../lib/types.js";

export const videosResource = new Command("videos").description(
  "Videos: list, inspect, add from Drive, edit metadata, status, archive",
);

/** Print a video: full JSON with --json, readable summary otherwise. */
export function printVideo(video: Video): void {
  if (globalFlags.json || globalFlags.format !== "text") {
    output(video);
    return;
  }
  const { targetLanguages, ...rest } = video;
  output({
    code: rest.code,
    title: rest.title,
    speaker: rest.speaker,
    year: rest.year,
    status: `${rest.status}${rest.statusManuallySet ? " (forced)" : ""}`,
    archived: rest.archived,
    alughaId: rest.alughaId,
    videoUrl: rest.videoUrl,
    customPrompt: rest.customPrompt ? `${rest.customPrompt.slice(0, 60)}...` : null,
    sourceSrtPath: rest.sourceSrtPath,
    id: rest.id,
  });
  console.log(pc.bold("\n  Target languages"));
  output(targetLanguages.map(targetLanguageRow));
}

videosResource
  .command("list")
  .description("List videos")
  .option("--search <text>", "Search code, name, title, speaker or Alugha id")
  .option("--quarter <n>", "Quarter number")
  .option("--class <n>", "Class number")
  .option("--status <status>", "TRANSCRIBING | TRANSCRIBED")
  .option("--lang <code>", "Only videos translated into this language (fr, de, ...)")
  .option("--lang-status <status>", "With --lang: PENDING | TRANSLATING | TRANSLATED | VOICE_OVER_GENERATING | COMPLETED")
  .option("--archived <mode>", "false (default) | true | all", "false")
  .option("--limit <n>", "Max results", "100")
  .addHelpText(
    "after",
    "\nExamples:\n  esm-fto-cli videos list --quarter 1\n  esm-fto-cli videos list --lang fr --lang-status TRANSLATING\n  esm-fto-cli videos list --search \"Three Leavens\" --json",
  )
  .action(async (opts) => {
    try {
      const { data, total } = await client.get<{ data: Video[]; total: number }>("/videos", {
        search: opts.search,
        quarter: opts.quarter,
        classNumber: opts.class,
        status: opts.status?.toUpperCase(),
        language: opts.lang,
        languageStatus: opts.langStatus?.toUpperCase(),
        archived: opts.archived,
        limit: opts.limit,
      });
      output(globalFlags.json ? data : data.map(videoRow));
      if (total > data.length) log.info(pc.dim(`(${total} matching, showing ${data.length}; raise --limit)`));
    } catch (err) {
      handleError(err);
    }
  });

videosResource
  .command("get")
  .description("Show a video and its target languages")
  .argument("<video>", "Video code (q1.c2.s3), id or Alugha id")
  .addHelpText("after", "\nExample:\n  esm-fto-cli videos get q1.c2.s3")
  .action(async (ref: string) => {
    try {
      const { video } = await client.get<{ video: Video }>(`/videos/${seg(ref)}`);
      printVideo(video);
    } catch (err) {
      handleError(err);
    }
  });

videosResource
  .command("add")
  .description("Add a video from its synced Drive session and link it to Alugha (staff/admin)")
  .argument("<code>", "Video code, e.g. q1.c2.s3")
  .requiredOption("--alugha-id <id>", "Alugha video id")
  .option("--title <title>", "Title")
  .option("--speaker <name>", "Speaker")
  .option("--year <year>", "Year, e.g. 2021-2022")
  .option("--video-url <url>", "Direct video URL for the web player")
  .addHelpText(
    "after",
    "\nTarget languages and Drive paths are copied from the Drive session (run `esm-fto-cli sync start --wait` first if needed).\n\nExample:\n  esm-fto-cli videos add q1.c2.s3 --alugha-id 6a1b... --title \"The Three Leavens\"",
  )
  .action(async (code: string, opts) => {
    try {
      const { video } = await client.post<{ video: Video }>("/videos", {
        code,
        alughaId: opts.alughaId,
        title: opts.title,
        speaker: opts.speaker,
        year: opts.year,
        videoUrl: opts.videoUrl,
      });
      log.success(`Video ${video.code} added`);
      printVideo(video);
    } catch (err) {
      handleError(err);
    }
  });

videosResource
  .command("update")
  .description("Edit video metadata (staff/admin)")
  .argument("<video>", "Video code, id or Alugha id")
  .option("--title <title>", "Title (\"\" to clear)")
  .option("--speaker <name>", "Speaker (\"\" to clear)")
  .option("--year <year>", "Year (\"\" to clear)")
  .option("--name <name>", "Internal name")
  .option("--alugha-id <id>", "Alugha video id")
  .option("--video-url <url>", "Direct video URL (\"\" to clear)")
  .option("--prompt <text>", "Custom translation prompt (\"\" to clear)")
  .option("--prompt-file <path>", "Custom translation prompt from a file")
  .addHelpText(
    "after",
    "\nExamples:\n  esm-fto-cli videos update q1.c2.s3 --title \"The Three Leavens\" --speaker \"Fr. Mathias Thelen\"\n  esm-fto-cli videos update q1.c2.s3 --prompt-file prompt.txt",
  )
  .action(async (ref: string, opts) => {
    try {
      const nullable = (value: string | undefined) => (value === undefined ? undefined : value === "" ? null : value);
      const prompt = opts.promptFile ? await readInput(opts.promptFile) : opts.prompt;
      const body = Object.fromEntries(
        Object.entries({
          title: nullable(opts.title),
          speaker: nullable(opts.speaker),
          year: nullable(opts.year),
          name: opts.name,
          alughaId: opts.alughaId,
          videoUrl: nullable(opts.videoUrl),
          customPrompt: nullable(prompt),
        }).filter(([, value]) => value !== undefined),
      );
      if (Object.keys(body).length === 0) {
        throw new CliError(2, "Nothing to update", "Pass at least one option, e.g. --title");
      }
      const { video } = await client.patch<{ video: Video }>(`/videos/${seg(ref)}`, body);
      log.success(`Video ${video.code} updated`);
      printVideo(video);
    } catch (err) {
      handleError(err);
    }
  });

for (const [name, archived] of [
  ["archive", true],
  ["unarchive", false],
] as const) {
  videosResource
    .command(name)
    .description(`${archived ? "Archive" : "Unarchive"} a video (staff/admin)`)
    .argument("<video>", "Video code, id or Alugha id")
    .action(async (ref: string) => {
      try {
        const { video } = await client.patch<{ video: Video }>(`/videos/${seg(ref)}`, { archived });
        log.success(`Video ${video.code} ${archived ? "archived" : "unarchived"}`);
      } catch (err) {
        handleError(err);
      }
    });
}

videosResource
  .command("status")
  .description("Force the transcription status, or give it back to the Drive sync (staff/admin)")
  .argument("<video>", "Video code, id or Alugha id")
  .argument("<status>", "TRANSCRIBING | TRANSCRIBED | AUTO")
  .addHelpText(
    "after",
    "\nTRANSCRIBED makes the video visible to translators. AUTO lets Drive syncs set it again.\n\nExample:\n  esm-fto-cli videos status q1.c2.s3 TRANSCRIBED",
  )
  .action(async (ref: string, status: string) => {
    try {
      const { video } = await client.put<{ video: Video }>(`/videos/${seg(ref)}/status`, {
        status: status.toUpperCase(),
      });
      log.success(`${video.code}: ${video.status}${video.statusManuallySet ? " (forced)" : " (auto from Drive)"}`);
    } catch (err) {
      handleError(err);
    }
  });

videosResource
  .command("sync")
  .description("Rescan the Drive folder of one video (staff/admin)")
  .argument("<video>", "Video code, id or Alugha id")
  .action(async (ref: string) => {
    try {
      const { video } = await client.post<{ video: Video }>(`/videos/${seg(ref)}/sync`);
      log.success(`${video.code} synced from Drive`);
      printVideo(video);
    } catch (err) {
      handleError(err);
    }
  });

videosResource
  .command("source")
  .description("Print or save the source (English) SRT from Drive")
  .argument("<video>", "Video code, id or Alugha id")
  .option("-o, --out <file>", "Write to a file instead of stdout")
  .addHelpText("after", "\nExample:\n  esm-fto-cli videos source q1.c2.s3 -o q1.c2.s3_source.srt")
  .action(async (ref: string, opts: { out?: string }) => {
    try {
      const result = await client.get<{ path: string | null; content: string }>(`/videos/${seg(ref)}/source`);
      if (globalFlags.json) return output(result);
      writeOutput(result.content, opts.out);
    } catch (err) {
      handleError(err);
    }
  });

videosResource
  .command("delete")
  .description("Remove a video from the platform; Drive and Alugha files are kept (admin)")
  .argument("<video>", "Video code, id or Alugha id")
  .requiredOption("--yes", "Confirm the deletion")
  .action(async (ref: string) => {
    try {
      await client.delete(`/videos/${seg(ref)}`);
      log.success(`Video ${ref} deleted`);
    } catch (err) {
      handleError(err);
    }
  });
