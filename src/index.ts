#!/usr/bin/env bun
import { Command } from "commander";
import { selfUpdateCommand } from "./commands/self-update.js";
import { authCommand } from "./commands/auth.js";
import { APP_VERSION, globalFlags } from "./lib/config.js";
import { notifyUpdate } from "./lib/update.js";
import { defaultProfile } from "./lib/profiles.js";
import {
  apiCommand,
  languagesResource,
  promptsResource,
  usersResource,
  whoamiCommand,
} from "./resources/account.js";
import { jobsResource } from "./resources/jobs.js";
import { langResource } from "./resources/lang.js";
import { alughaResource, translateCommand, voiceResource } from "./resources/pipeline.js";
import { srtResource } from "./resources/srt.js";
import { subtitlesResource } from "./resources/subtitles.js";
import { driveResource, syncResource } from "./resources/sync.js";
import { toolsResource } from "./resources/tools.js";
import { translationsResource } from "./resources/translations.js";
import { videosResource } from "./resources/videos.js";

// `esm-fto-cli subtitles get ... | head` closes stdout early: exit quietly.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

const program = new Command();

program
  .name("esm-fto-cli")
  .description(
    "FTO (ESM Operation Platform) CLI: videos, translations, subtitles, voice-over, Alugha.\nGoes through the ESM web app API (/api/v1), authenticated with your API key.",
  )
  .version(APP_VERSION)
  .option("-p, --profile <name>", "Profile: prod, dev, local... (default: ESM_FTO_PROFILE, then the active profile)")
  .option("--env <name>", "Alias of --profile")
  .option("--json", "Output as JSON", false)
  .option("--format <fmt>", "Output format: text, json, csv, yaml", "text")
  .option("--verbose", "Enable debug logging", false)
  .option("--no-color", "Disable colored output")
  .option("--no-header", "Omit table/csv headers (for piping)")
  .addHelpText(
    "after",
    `
Videos are referenced by code (q1.c2.s3), id or Alugha id; languages by fr, fra or name.

Quick start:
  esm-fto-cli auth set esm_xxx --profile prod
  esm-fto-cli videos list --lang fr --lang-status PENDING
  esm-fto-cli translations start q1.c2 --lang fr es --type subtitles student-handout --wait
  esm-fto-cli subtitles get q1.c2.s3 fr -o fr.srt
  esm-fto-cli subtitles put q1.c2.s3 fr -f fr.srt
  esm-fto-cli lang validate q1.c2.s3 fr
  esm-fto-cli voice generate q1.c2.s3 fr --wait --upload`,
  )
  .hook("preAction", (_thisCmd, actionCmd) => {
    const root = actionCmd.optsWithGlobals();
    globalFlags.json = root.json ?? false;
    globalFlags.format = root.format ?? "text";
    globalFlags.verbose = root.verbose ?? false;
    globalFlags.noColor = root.color === false;
    globalFlags.noHeader = root.header === false;
    globalFlags.profile = root.profile ?? root.env ?? defaultProfile();
    if (actionCmd.name() !== "self-update") notifyUpdate();
  });

program.addCommand(authCommand);
program.addCommand(whoamiCommand);
program.addCommand(videosResource);
program.addCommand(langResource);
program.addCommand(subtitlesResource);
program.addCommand(translateCommand);
program.addCommand(voiceResource);
program.addCommand(alughaResource);
program.addCommand(jobsResource);
program.addCommand(syncResource);
program.addCommand(driveResource);
program.addCommand(srtResource);
program.addCommand(languagesResource);
program.addCommand(promptsResource);
program.addCommand(usersResource);
program.addCommand(translationsResource);
program.addCommand(toolsResource);
program.addCommand(apiCommand);
program.addCommand(selfUpdateCommand);

program.parse();
