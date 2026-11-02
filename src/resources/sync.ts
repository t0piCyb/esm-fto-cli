import { Command } from "commander";
import { client } from "../lib/client.js";
import { globalFlags } from "../lib/config.js";
import { CliError, handleError } from "../lib/errors.js";
import { log } from "../lib/logger.js";
import { output } from "../lib/output.js";

type SyncProgress = {
  status: "idle" | "running" | "completed" | "failed";
  current: number;
  total: number;
  message: string;
  step?: string;
  sessionCount: number;
};

const POLL_INTERVAL_MS = 3000;

export const syncResource = new Command("sync").description("Google Drive sync (staff/admin)");

syncResource
  .command("status")
  .description("Progress of the Drive sync")
  .action(async () => {
    try {
      output(await client.get<SyncProgress>("/sync"));
    } catch (err) {
      handleError(err);
    }
  });

syncResource
  .command("start")
  .description("Scan Google Drive in the background")
  .option("--wait", "Wait for the scan, then store the result (sessions, statuses)")
  .option("--no-force", "Reuse the backend cache when possible")
  .addHelpText("after", "\nExample:\n  esm-fto-cli sync start --wait")
  .action(async (opts: { wait?: boolean; force: boolean }) => {
    try {
      const started = await client.post<{ job_id?: string; message?: string }>("/sync", { force: opts.force });
      log.info(`Drive sync started${started.job_id ? ` (${started.job_id})` : ""}`);
      if (!opts.wait) {
        log.info("Follow with: esm-fto-cli sync status, then esm-fto-cli sync save");
        return;
      }

      let lastLine = "";
      for (;;) {
        await Bun.sleep(POLL_INTERVAL_MS);
        const progress = await client.get<SyncProgress>("/sync");
        const line = `${progress.status} ${progress.current}/${progress.total} ${progress.message}`;
        if (line !== lastLine) {
          log.info(line);
          lastLine = line;
        }
        if (progress.status === "failed") throw new CliError(1, `Drive sync failed: ${progress.message}`);
        if (progress.status === "completed") break;
      }

      const saved = await client.post<{ sessionsCount: number }>("/sync/save");
      log.success(`Drive sync stored: ${saved.sessionsCount} sessions`);
      if (globalFlags.json) output(saved);
    } catch (err) {
      handleError(err);
    }
  });

syncResource
  .command("save")
  .description("Store the result of a completed Drive sync")
  .action(async () => {
    try {
      const saved = await client.post<{ sessionsCount: number }>("/sync/save");
      log.success(`Drive sync stored: ${saved.sessionsCount} sessions`);
    } catch (err) {
      handleError(err);
    }
  });

export const driveResource = new Command("drive").description("Google Drive sessions from the last sync");

type DriveSession = {
  code: string;
  videoId: string | null;
  sourceStatus: string;
  hasAudio: boolean;
  hasSourceSrt: boolean;
  languages: { language: string; status: string; hasSrt: boolean; hasVoiceTrack: boolean }[];
};

driveResource
  .command("sessions")
  .description("List Drive sessions and what was found for each language")
  .option("--quarter <n>", "Quarter number")
  .option("--unlinked", "Only sessions not yet added as a video (candidates for `videos add`)")
  .option("--limit <n>", "Max results", "200")
  .action(async (opts: { quarter?: string; unlinked?: boolean; limit: string }) => {
    try {
      const { data, lastSyncedAt } = await client.get<{ data: DriveSession[]; lastSyncedAt: string | null }>(
        "/drive/sessions",
        { quarter: opts.quarter, linked: opts.unlinked ? "false" : undefined, limit: opts.limit },
      );
      if (globalFlags.json) return output({ data, lastSyncedAt });
      output(
        data.map((session) => ({
          code: session.code,
          linked: session.videoId !== null,
          source: session.sourceStatus,
          languages: session.languages.map((l) => `${l.language}:${l.status}`).join(" "),
        })),
      );
      log.info(`Last Drive sync: ${lastSyncedAt ?? "never"}`);
    } catch (err) {
      handleError(err);
    }
  });
