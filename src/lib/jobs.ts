import pc from "picocolors";
import { client, seg } from "./client.js";
import { CliError } from "./errors.js";
import { log } from "./logger.js";

export type JobType = "TRANSLATION" | "VOICE_OVER" | "TRANSCRIPTION" | "ALUGHA_UPLOAD";

export type Job = {
  id: string;
  type: JobType;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  currentStep: string | null;
  video: string;
  language: string | null;
  error: string | null;
  outputPath: string | null;
  translationSuccess: boolean | null;
  /** Subtitle numbers whose <<N>> tag is missing / duplicated in the AI output */
  translationErrors?: { missing?: number[]; duplicates?: number[] } | null;
  /** Translation: when the SRT was saved to Drive */
  savedAt?: string | null;
  /** Alugha upload: dates Alugha gives once it confirmed the upload */
  subtitlesAddedAt?: string | null;
  voiceOverAddedAt?: string | null;
  createdAt: string;
  completedAt: string | null;
};

const POLL_INTERVAL_MS = 4000;
const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;
const BAR_WIDTH = 20;
const MAX_CONSECUTIVE_FAILURES = 5;

const TYPE_LABELS: Record<JobType, string> = {
  TRANSLATION: "translation",
  VOICE_OVER: "voice-over",
  TRANSCRIPTION: "transcription",
  ALUGHA_UPLOAD: "alugha",
};

export async function getJob(id: string): Promise<Job> {
  const { job } = await client.get<{ job: Job }>(`/jobs/${seg(id)}`);
  return job;
}

const jobLabel = (job: Job) =>
  `[${job.video}${job.language ? ` ${job.language}` : ""}] ${TYPE_LABELS[job.type] ?? job.type.toLowerCase()}`;

/** "[q1.c2.s3 fr] translation [########------------]  40% Translating chunk 2/4..." */
export const formatProgressLine = (job: Job) => {
  const percent = Math.max(0, Math.min(100, Math.round(job.progress)));
  const filled = Math.round((percent / 100) * BAR_WIDTH);
  const bar = `${"#".repeat(filled)}${"-".repeat(BAR_WIDTH - filled)}`;
  const step = job.currentStep ?? job.status;
  return `${jobLabel(job)} ${pc.cyan(`[${bar}]`)} ${String(percent).padStart(3)}% ${step}`;
};

/** [1, 2, 3, 7, 9, 10] -> "1-3, 7, 9-10" */
export const formatRanges = (numbers: number[]) => {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i] as number;
    let end = start;
    while (sorted[i + 1] === end + 1) end = sorted[++i] as number;
    ranges.push(start === end ? `${start}` : `${start}-${end}`);
  }
  return ranges.join(", ");
};

const localTime =(iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : null);

/** What "done" means for this job, in one line */
export const formatDoneLine = (job: Job) => {
  if (job.type === "ALUGHA_UPLOAD") {
    const added = [
      job.subtitlesAddedAt && `subtitles added ${localTime(job.subtitlesAddedAt)}`,
      job.voiceOverAddedAt && `voice-over added ${localTime(job.voiceOverAddedAt)}`,
    ].filter(Boolean);
    return `${jobLabel(job)} confirmed: ${added.join(", ") || "added"}`;
  }
  if (job.type === "TRANSLATION" && job.translationSuccess === false) {
    const missing = job.translationErrors?.missing ?? [];
    const duplicates = job.translationErrors?.duplicates ?? [];
    const detail = [
      missing.length > 0 && `${missing.length} missing (${formatRanges(missing)})`,
      duplicates.length > 0 && `${duplicates.length} duplicated (${formatRanges(duplicates)})`,
    ]
      .filter(Boolean)
      .join(", ");
    return `${jobLabel(job)} finished with misaligned subtitles${detail ? `: ${detail}` : ""} (not saveable, run it again)`;
  }
  return `${jobLabel(job)} finished 100%${job.outputPath ? `: ${job.outputPath}` : ""}`;
};

/**
 * Poll a job until it ends, printing a progress bar line each time the
 * progress or step changes (silenced with --json). Throws when the job
 * fails or is cancelled.
 */
export async function waitForJob(id: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Job> {
  const startedAt = Date.now();
  let lastLine = "";

  let failures = 0;

  while (Date.now() - startedAt < timeoutMs) {
    let job: Job;
    try {
      job = await getJob(id);
      failures = 0;
    } catch (err) {
      // A network blip or a 5xx must not abort a long wait (the job keeps
      // running on the server); 4xx (unknown job, auth) stops at once
      const status = err instanceof CliError ? err.code : 0;
      failures += 1;
      if ((status >= 400 && status < 500) || failures > MAX_CONSECUTIVE_FAILURES) throw err;
      log.warn(`Could not read job ${id} (${(err as Error).message}), retrying...`);
      await Bun.sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (job.status === "completed") {
      // A misaligned translation is finished but not usable: no green tick
      if (job.translationSuccess === false) log.warn(formatDoneLine(job));
      else log.success(formatDoneLine(job));
      return job;
    }
    if (job.status === "failed" || job.status === "cancelled") {
      throw new CliError(1, `${jobLabel(job)} ${job.status}${job.error ? `: ${job.error}` : ""}`);
    }

    const line = formatProgressLine(job);
    if (line !== lastLine) {
      log.info(line);
      lastLine = line;
    }

    await Bun.sleep(POLL_INTERVAL_MS);
  }

  throw new CliError(
    1,
    `Timed out waiting for job ${id}`,
    `It keeps running on the server. Check it later: esm-fto-cli jobs get ${id}`,
  );
}
