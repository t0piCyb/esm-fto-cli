import { Command } from "commander";
import { client, seg } from "../lib/client.js";
import { globalFlags } from "../lib/config.js";
import { handleError } from "../lib/errors.js";
import { writeOutput } from "../lib/io.js";
import { type Job, waitForJob } from "../lib/jobs.js";
import { log } from "../lib/logger.js";
import { output } from "../lib/output.js";

export const jobsResource = new Command("jobs").description(
  "Background jobs you started (translation, voice-over, Alugha upload confirmation)",
);

const jobRow = (job: Job) => ({
  id: job.id,
  type: job.type,
  video: job.video,
  language: job.language,
  status: job.status,
  progress: job.progress,
  step: job.currentStep,
  createdAt: job.createdAt,
});

jobsResource
  .command("list")
  .description("List your jobs, newest first")
  .option("--active", "Only pending/running jobs")
  .option("--video <code>", "Only jobs of this video")
  .option("--limit <n>", "Max results", "20")
  .action(async (opts: { active?: boolean; video?: string; limit: string }) => {
    try {
      const { data } = await client.get<{ data: Job[] }>("/jobs", {
        active: opts.active ? "true" : undefined,
        video: opts.video,
        limit: opts.limit,
      });
      output(globalFlags.json ? data : data.map(jobRow));
    } catch (err) {
      handleError(err);
    }
  });

jobsResource
  .command("get")
  .description("Show a job (refreshed from the processing backend)")
  .argument("<id>", "Job id")
  .option("--content", "Print the raw translation (<<N>> tagged) of a completed translation job")
  .action(async (id: string, opts: { content?: boolean }) => {
    try {
      const { job } = await client.get<{ job: Job & { content?: string | null } }>(`/jobs/${seg(id)}`, {
        content: opts.content ? "true" : undefined,
      });
      if (opts.content && !globalFlags.json) {
        writeOutput(job.content ?? "");
        return;
      }
      output(job);
    } catch (err) {
      handleError(err);
    }
  });

jobsResource
  .command("wait")
  .description(
    "Wait until a job completes, with a progress bar (exit code 1 if it fails). An alugha job completes when Alugha confirms the subtitles / voice-over are added",
  )
  .argument("<id>", "Job id")
  .action(async (id: string) => {
    try {
      const job = await waitForJob(id);
      if (globalFlags.json) output(job);
    } catch (err) {
      handleError(err);
    }
  });

jobsResource
  .command("save")
  .description("Completed translation job: generate the SRT and save it to Drive (status TRANSLATING)")
  .argument("<id>", "Job id")
  .option("--force", "Overwrite even if already saved or the language was already reviewed")
  .action(async (id: string, opts: { force?: boolean }) => {
    try {
      const result = await client.post<{ path: string | null }>(`/jobs/${seg(id)}/save`, {
        force: Boolean(opts.force),
      });
      log.success(`SRT saved to Drive: ${result.path ?? ""}`);
      if (globalFlags.json) output(result);
    } catch (err) {
      handleError(err);
    }
  });

jobsResource
  .command("cancel")
  .description("Cancel a running voice-over job")
  .argument("<id>", "Job id")
  .action(async (id: string) => {
    try {
      const { job } = await client.post<{ job: Job }>(`/jobs/${seg(id)}/cancel`);
      log.success(`Job ${job.id}: ${job.status}`);
    } catch (err) {
      handleError(err);
    }
  });
