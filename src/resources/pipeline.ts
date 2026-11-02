import { Command } from "commander";
import { client, seg } from "../lib/client.js";
import { globalFlags } from "../lib/config.js";
import { CliError, handleError } from "../lib/errors.js";
import { readInput } from "../lib/io.js";
import { type Job, waitForJob } from "../lib/jobs.js";
import { log } from "../lib/logger.js";
import { output } from "../lib/output.js";

const langPath = (video: string, lang: string) => `/videos/${seg(video)}/languages/${seg(lang)}`;

type UploadMode = "subtitles" | "audio" | "complete";

async function uploadToAlugha(video: string, lang: string, mode: UploadMode) {
  const result = await client.post<{ message: string }>(`${langPath(video, lang)}/alugha`, { mode });
  log.success(`[${video} ${lang}] Alugha ${mode}: ${result.message}`);
  return result;
}

async function generateVoice(
  video: string,
  lang: string,
  opts: { gain?: string; test?: boolean; wait?: boolean },
): Promise<Job | { id: string }> {
  const { job } = await client.post<{ job: { id: string } }>(`${langPath(video, lang)}/voice`, {
    ...(opts.gain !== undefined && { gain: Number(opts.gain) }),
    isTest: Boolean(opts.test),
  });
  log.info(`[${video} ${lang}] voice-over job ${job.id} started`);
  if (!opts.wait) return job;
  const done = await waitForJob(job.id);
  log.success(`[${video} ${lang}] voice-over ready: ${done.outputPath ?? ""}`);
  return done;
}

// ---------------------------------------------------------------------------
// translate
// ---------------------------------------------------------------------------

export const translateCommand = new Command("translate")
  .description("AI-translate a video into one or more languages")
  .argument("<video>", "Video code (q1.c2.s3), id or Alugha id")
  .argument("<langs...>", "Language codes, e.g. fr de es")
  .option("--wait", "Wait for the translation, then save the SRT to Drive (status TRANSLATING)")
  .option("--no-save", "With --wait: do not save the SRT to Drive")
  .option("--force", "With --wait: save even if the language was already reviewed (overwrites the SRT)")
  .option("--voice", "With --wait: then generate the voice-over")
  .option("--upload <mode>", "With --wait: then publish on Alugha: subtitles | complete (subtitles + voice-over)")
  .option("--model <model>", "OpenAI model", "gpt-5.2")
  .option("--prompt-file <path>", "Prompt overriding the video/default prompt")
  .addHelpText(
    "after",
    `
Without --wait it starts the jobs and prints their ids (follow with: esm-fto-cli jobs wait <id>).

Examples:
  esm-fto-cli translate q1.c2.s3 fr --wait
  esm-fto-cli translate q1.c2.s3 fr de es --wait
  esm-fto-cli translate q1.c2.s3 fr --wait --voice --upload complete`,
  )
  .action(async (video: string, langs: string[], opts) => {
    try {
      if ((opts.voice || opts.upload) && !opts.wait) {
        throw new CliError(2, "--voice and --upload need --wait");
      }
      if (opts.upload && !["subtitles", "complete"].includes(opts.upload)) {
        throw new CliError(2, `Unknown upload mode "${opts.upload}"`, "Use subtitles or complete");
      }
      if (opts.upload === "complete" && !opts.voice) {
        log.warn("--upload complete uses the voice-over already in Drive (add --voice to regenerate it)");
      }

      const prompt = opts.promptFile ? await readInput(opts.promptFile) : undefined;

      const started = await Promise.all(
        langs.map(async (lang) => {
          const { job } = await client.post<{ job: { id: string } }>(`${langPath(video, lang)}/translate`, {
            model: opts.model,
            ...(prompt && { prompt }),
          });
          log.info(`[${video} ${lang}] translation job ${job.id} started`);
          return { lang, jobId: job.id };
        }),
      );

      if (!opts.wait) {
        output(started);
        return;
      }

      const results = await Promise.allSettled(
        started.map(async ({ lang, jobId }) => {
          await waitForJob(jobId);
          const steps: Record<string, unknown> = { lang, jobId, translated: true };

          if (opts.save) {
            const saved = await client.post<{ path: string | null }>(`/jobs/${seg(jobId)}/save`, {
              force: Boolean(opts.force),
            });
            log.success(`[${video} ${lang}] SRT saved to Drive: ${saved.path ?? ""}`);
            steps.srt = saved.path;
          }
          if (opts.voice) {
            const voiceJob = await generateVoice(video, lang, { wait: true });
            steps.voice = "outputPath" in voiceJob ? voiceJob.outputPath : voiceJob.id;
          }
          if (opts.upload) {
            await uploadToAlugha(video, lang, opts.upload as UploadMode);
            steps.alugha = opts.upload;
          }
          return steps;
        }),
      );

      const summary = results.map((result, index) =>
        result.status === "fulfilled"
          ? { ...result.value, ok: true }
          : { lang: started[index]?.lang, ok: false, error: (result.reason as Error).message },
      );
      output(summary);
      if (summary.some((item) => !item.ok)) process.exit(1);
    } catch (err) {
      handleError(err);
    }
  });

// ---------------------------------------------------------------------------
// voice
// ---------------------------------------------------------------------------

export const voiceResource = new Command("voice").description("Voice-over (ElevenLabs): status, generate, re-duck");

voiceResource
  .command("status")
  .description("What exists in Drive: subtitles, voice track, final audio")
  .argument("<video>", "Video code, id or Alugha id")
  .argument("<lang>", "Language code")
  .action(async (video: string, lang: string) => {
    try {
      output(await client.get(`${langPath(video, lang)}/voice`));
    } catch (err) {
      handleError(err);
    }
  });

voiceResource
  .command("generate")
  .description("Generate the voice-over from the subtitles in Drive")
  .argument("<video>", "Video code, id or Alugha id")
  .argument("<lang>", "Language code")
  .option("--gain <db>", "Gain applied to the original audio under the voice", "-17")
  .option("--test", "Short sample only")
  .option("--wait", "Wait until the audio is ready")
  .option("--upload", "With --wait: publish subtitles + voice-over on Alugha (status COMPLETED)")
  .addHelpText("after", "\nExample:\n  esm-fto-cli voice generate q1.c2.s3 fr --wait --upload")
  .action(async (video: string, lang: string, opts: { gain: string; test?: boolean; wait?: boolean; upload?: boolean }) => {
    try {
      if (opts.upload && !opts.wait) throw new CliError(2, "--upload needs --wait");
      const job = await generateVoice(video, lang, opts);
      if (opts.upload) await uploadToAlugha(video, lang, "complete");
      if (globalFlags.json || !opts.wait) output(job);
    } catch (err) {
      handleError(err);
    }
  });

voiceResource
  .command("reduck")
  .description("Remix the existing voice track with a new gain (no regeneration)")
  .argument("<video>", "Video code, id or Alugha id")
  .argument("<lang>", "Language code")
  .requiredOption("--gain <db>", "Gain applied to the original audio, e.g. -20")
  .action(async (video: string, lang: string, opts: { gain: string }) => {
    try {
      const result = await client.post<{ outputPath: string | null }>(`${langPath(video, lang)}/voice/reduck`, {
        gain: Number(opts.gain),
      });
      log.success(`Re-ducked audio: ${result.outputPath ?? ""}`);
    } catch (err) {
      handleError(err);
    }
  });

// ---------------------------------------------------------------------------
// alugha
// ---------------------------------------------------------------------------

export const alughaResource = new Command("alugha").description("Publish subtitles and voice-over on Alugha");

alughaResource
  .command("upload")
  .description("Upload to Alugha from Drive, or a local SRT with --file (staff/admin)")
  .argument("<video>", "Video code, id or Alugha id")
  .argument("<lang>", "Language code")
  .option("--mode <mode>", "subtitles | audio | complete (subtitles + audio, status COMPLETED)", "subtitles")
  .option("-f, --file <path>", "Upload this SRT directly instead of the Drive file")
  .addHelpText(
    "after",
    "\nExamples:\n  esm-fto-cli alugha upload q1.c2.s3 fr\n  esm-fto-cli alugha upload q1.c2.s3 fr --mode complete\n  esm-fto-cli alugha upload q1.c2.s3 fr --file final_fr.srt",
  )
  .action(async (video: string, lang: string, opts: { mode: string; file?: string }) => {
    try {
      if (opts.file) {
        const content = await readInput(opts.file);
        const result = await client.post<{ message: string }>(`${langPath(video, lang)}/alugha`, { mode: "srt", content });
        log.success(`[${video} ${lang}] Alugha SRT: ${result.message}`);
        return;
      }
      if (!["subtitles", "audio", "complete"].includes(opts.mode)) {
        throw new CliError(2, `Unknown mode "${opts.mode}"`, "Use subtitles, audio or complete");
      }
      await uploadToAlugha(video, lang, opts.mode as UploadMode);
    } catch (err) {
      handleError(err);
    }
  });
