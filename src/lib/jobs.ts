import { client, seg } from "./client.js";
import { CliError } from "./errors.js";
import { log } from "./logger.js";

export type Job = {
  id: string;
  type: "TRANSLATION" | "VOICE_OVER" | "TRANSCRIPTION";
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  currentStep: string | null;
  video: string;
  language: string | null;
  error: string | null;
  outputPath: string | null;
  translationSuccess: boolean | null;
  createdAt: string;
  completedAt: string | null;
};

const POLL_INTERVAL_MS = 4000;
const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;

export async function getJob(id: string): Promise<Job> {
  const { job } = await client.get<{ job: Job }>(`/jobs/${seg(id)}`);
  return job;
}

/**
 * Poll a job until it ends. Progress lines go to stderr-like logs
 * (silenced with --json). Throws when the job fails or is cancelled.
 */
export async function waitForJob(id: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Job> {
  const startedAt = Date.now();
  let lastLine = "";

  while (Date.now() - startedAt < timeoutMs) {
    const job = await getJob(id);
    const line = `[${job.video}${job.language ? ` ${job.language}` : ""}] ${job.type.toLowerCase()} ${job.status} ${job.progress}%${job.currentStep ? ` - ${job.currentStep}` : ""}`;
    if (line !== lastLine) {
      log.info(line);
      lastLine = line;
    }

    if (job.status === "completed") return job;
    if (job.status === "failed" || job.status === "cancelled") {
      throw new CliError(1, `Job ${job.id} ${job.status}${job.error ? `: ${job.error}` : ""}`);
    }

    await Bun.sleep(POLL_INTERVAL_MS);
  }

  throw new CliError(
    1,
    `Timed out waiting for job ${id}`,
    `It keeps running on the server. Check it later: esm-fto-cli jobs get ${id}`,
  );
}
