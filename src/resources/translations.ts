import { Command } from "commander";
import pc from "picocolors";
import { client, seg } from "../lib/client.js";
import { globalFlags } from "../lib/config.js";
import { CliError, handleError } from "../lib/errors.js";
import { log } from "../lib/logger.js";
import { output } from "../lib/output.js";

/**
 * Translation engine (Codex first pass, translator review, staff publication)
 * for every course resource: subtitles, handouts, teacher notes, Facilitator
 * Guides, slides, Thinkific lessons. Each command runs one tool of the FTO
 * registry (`POST /api/v1/tools/<name>`), the same as the MCP and the chat.
 */

const TYPES = [
  "SUBTITLES",
  "STUDENT_HANDOUT",
  "SUPPLEMENTAL_HANDOUT",
  "TEACHER_NOTES",
  "FACILITATOR_GUIDE",
  "SLIDES",
  "HOMEWORK",
  "THINKIFIC_LESSON",
] as const;
type ResourceType = (typeof TYPES)[number];

const STATUSES = [
  "NOT_STARTED",
  "QUEUED",
  "AI_TRANSLATING",
  "AI_DONE",
  "IN_REVIEW",
  "APPROVED",
  "PUBLISHED",
  "FAILED",
  "OUTDATED",
] as const;
type Status = (typeof STATUSES)[number];

/** Engine still working on it: `translations wait` keeps waiting. */
const RUNNING: Status[] = ["QUEUED", "AI_TRANSLATING"];

type Translation = {
  id: string;
  type: ResourceType;
  session: string;
  title: string | null;
  language: string;
  languageName: string;
  status: Status;
  assignee: { id: string; name: string; email: string } | null;
  deadline: string | null;
  overdue: boolean;
  urgent: boolean;
  draftUrl: string | null;
  reviewUrl: string | null;
  engine: string | null;
  error: string | null;
  job: { id: string; status: string; progress: number; currentStep: string | null } | null;
  queuePosition?: number | null;
};

type Overview = {
  counters: Record<string, number>;
  sessions: {
    code: string;
    schoolYear: number | null;
    resources: { id: string; type: ResourceType; title: string | null; translations: Translation[] }[];
  }[];
};

type Batch = {
  batch: { id: string; label: string | null; urgent: boolean; deadline: string | null; createdAt: string };
  totals: Partial<Record<Status, number>>;
  translations: Translation[];
};

type Label = { session: string; type: ResourceType; language: string };
type StartResult = {
  batch: { id: string; urgent: boolean };
  queued: (Label & { id: string })[];
  skipped: (Label & { reason: string })[];
  missing: { scope: string; type: ResourceType; reason: string }[];
};

type Preview = {
  items: (Label & { title: string | null; status: Status; queue: boolean; reason: string | null })[];
  missing: StartResult["missing"];
  totals: { queue: number; skip: number; missing: number };
};

type Discovery = {
  scope: string;
  accessible: boolean;
  created: number;
  updated: number;
  linkedTranslations: number;
  resources: unknown[];
  skipped: { path: string; name: string; reason: string }[];
  warnings: string[];
};

type EngineStatus = {
  lane: { state: string; quotaResetAt: string | null; lastError: string | null };
  queue: { queued: number; translating: number; failed: number };
  running: {
    session: string;
    type: string;
    language: string;
    job: { progress: number; currentStep: string | null } | null;
  } | null;
  last7Days: {
    completed: number;
    completedOnSubscription: number;
    completedOnApiKey: number;
    fallbacks: number;
    quotaWaits: number;
    failed: number;
    apiSpendUsd: number | null;
  };
};

const run = <T>(tool: string, input: Record<string, unknown> = {}) => client.post<T>(`/tools/${seg(tool)}`, input);

/** `student-handout`, `handouts`... -> STUDENT_HANDOUT; `all` -> every type. */
export const parseTypes = (values: string[] | undefined): ResourceType[] => {
  if (!values?.length) return ["SUBTITLES"];
  const list = values.flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
  if (list.some((v) => v.toLowerCase() === "all")) return [...TYPES];
  return list.map((value) => {
    // singular or plural: subtitle(s), student-handout(s), teacher-note(s)
    const key = value.toUpperCase().replace(/[-\s]/g, "_").replace(/S$/, "");
    const type = TYPES.find((t) => t.replace(/S$/, "") === key);
    if (!type) {
      throw new CliError(2, `Unknown resource type "${value}"`, `Use: ${TYPES.map((t) => t.toLowerCase().replace(/_/g, "-")).join(", ")} or all`);
    }
    return type;
  });
};

/** `fr,es de` -> ["fr", "es", "de"] */
export const splitList = (values: string[] | undefined): string[] =>
  (values ?? []).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);

const requireLanguages = (values: string[] | undefined) => {
  const languages = splitList(values);
  if (!languages.length) throw new CliError(2, "Give at least one language", "Example: --lang fr es (or --lang fr,es)");
  return languages;
};

const typeLabel = (type: string) => type.toLowerCase().replace(/_/g, "-");

const translationRow = (t: Translation) => ({
  id: t.id,
  session: t.session,
  type: typeLabel(t.type),
  lang: t.language,
  status: t.status + (t.overdue ? " (overdue)" : ""),
  reviewer: t.assignee?.name ?? "",
  deadline: t.deadline?.slice(0, 10) ?? "",
  ...(t.queuePosition !== undefined && { queue: t.queuePosition ?? "" }),
  step: t.job && t.status === "AI_TRANSLATING" ? `${t.job.progress}% ${t.job.currentStep ?? ""}` : (t.error ?? ""),
});

const totalsLine = (totals: Partial<Record<Status, number>>) =>
  STATUSES.filter((s) => totals[s]).map((s) => `${s} ${totals[s]}`).join(" · ") || "nothing";

const batchInput = (sessions: string[], opts: { lang?: string[]; type?: string[]; force?: boolean }) => ({
  sessions,
  languages: requireLanguages(opts.lang),
  types: parseTypes(opts.type),
  force: Boolean(opts.force),
});

const printPreview = (preview: Preview) => {
  if (globalFlags.json) return output(preview);
  output(
    preview.items.map((i) => ({
      session: i.session,
      type: typeLabel(i.type),
      lang: i.language,
      status: i.status,
      action: i.queue ? pc.green("queue") : `skip: ${i.reason ?? ""}`,
    })),
  );
  for (const m of preview.missing) log.warn(`${m.scope} ${typeLabel(m.type)}: ${m.reason}`);
  log.info(
    `\n${pc.bold(String(preview.totals.queue))} to translate, ${preview.totals.skip} skipped, ${preview.totals.missing} missing`,
  );
};

const POLL_MS = 15_000;

const waitForBatch = async (id: string, timeoutMs: number) => {
  const started = Date.now();
  let last = "";
  for (;;) {
    const batch = await run<Batch>("get_translation_batch", { id });
    const line = totalsLine(batch.totals);
    const running = batch.translations.find((t) => t.status === "AI_TRANSLATING" && t.job);
    const detail = running?.job ? ` · ${running.session} ${running.language} ${running.job.progress}% ${running.job.currentStep ?? ""}` : "";
    if (`${line}${detail}` !== last) {
      log.info(`${pc.dim(new Date().toLocaleTimeString())} ${line}${detail}`);
      last = `${line}${detail}`;
    }
    if (!batch.translations.some((t) => RUNNING.includes(t.status))) return batch;
    if (Date.now() - started > timeoutMs) {
      throw new CliError(1, `Batch ${id} still running after ${Math.round(timeoutMs / 60000)} min`, `Follow it: esm-fto-cli translations wait ${id}`);
    }
    await Bun.sleep(POLL_MS);
  }
};

const finishWait = (batch: Batch) => {
  if (globalFlags.json) output(batch);
  else output(batch.translations.map(translationRow));
  const failed = batch.translations.filter((t) => t.status === "FAILED");
  if (failed.length) {
    throw new CliError(1, `${failed.length} translation(s) failed`, `Retry: esm-fto-cli translations retry ${failed[0]?.id ?? "<id>"}`);
  }
  log.success(`Batch ${batch.batch.id} done: ${totalsLine(batch.totals)}`);
};

export const translationsResource = new Command("translations")
  .alias("tr")
  .description("Translation engine: Codex first pass, review, publication of subtitles and course documents (staff)")
  .addHelpText(
    "after",
    `
Statuses: NOT_STARTED -> QUEUED -> AI_TRANSLATING -> AI_DONE / IN_REVIEW -> APPROVED -> PUBLISHED
          (+ FAILED: retry it, OUTDATED: the English source changed)
Types: ${TYPES.map(typeLabel).join(", ")}, or all

Examples:
  esm-fto-cli translations discover q1.c2
  esm-fto-cli translations preview q1.c2 --lang fr es --type subtitles student-handout
  esm-fto-cli translations start q1.c2 --lang fr es --type subtitles student-handout --wait
  esm-fto-cli translations reviews --lang fr
  esm-fto-cli translations approve <id>`,
  );

translationsResource
  .command("overview")
  .alias("ls")
  .description("Every resource and language with its status (the translations dashboard)")
  .option("--year <n>", "School year: 1, 2, 3 or 9 (Other)")
  .option("--quarter <n>", "Quarter: 1-8, 9-11 = year 3 trimesters")
  .option("--lang <code>", "Only this language")
  .option("--type <type>", "Only this resource type")
  .option("--status <status>", STATUSES.join(" | "))
  .option("--assignee <who>", "Reviewer id or e-mail, or none")
  .option("--overdue", "Past their deadline and not approved")
  .option("--outdated", "English source changed since the translation")
  .option("--session <code>", "Only sessions whose code starts with this (q1.c2)")
  .action(async (opts) => {
    try {
      const status = opts.status?.toUpperCase();
      if (status && !STATUSES.includes(status)) throw new CliError(2, `Unknown status "${opts.status}"`, `Use: ${STATUSES.join(", ")}`);
      const overview = await run<Overview>("translation_overview", {
        year: opts.year ? Number(opts.year) : undefined,
        quarter: opts.quarter ? Number(opts.quarter) : undefined,
        language: opts.lang,
        type: opts.type ? parseTypes([opts.type])[0] : undefined,
        status,
        assignee: opts.assignee,
        overdue: opts.overdue ? "true" : undefined,
        outdated: opts.outdated ? "true" : undefined,
      });
      const prefix = opts.session?.toLowerCase();
      const sessions = prefix
        ? overview.sessions.filter((s) => s.code === prefix || s.code.startsWith(`${prefix}.`))
        : overview.sessions;
      if (globalFlags.json) return output({ counters: overview.counters, sessions });
      output(sessions.flatMap((s) => s.resources.flatMap((r) => r.translations.map(translationRow))));
      const c = overview.counters;
      log.info(
        pc.dim(
          `To review ${c.toReview ?? 0} · overdue ${c.overdue ?? 0} · outdated ${c.outdated ?? 0} · queued ${c.queued ?? 0} · translating ${c.translating ?? 0} · failed ${c.failed ?? 0}`,
        ),
      );
    } catch (err) {
      handleError(err);
    }
  });

translationsResource
  .command("preview")
  .description("What a batch would queue, skip and miss (dry run, nothing is queued)")
  .argument("<sessions...>", "Session codes: q1.c2.s3, q1.c2 (class) or q1 (quarter)")
  .requiredOption("--lang <codes...>", "Languages: fr es, fr,es, fra or French")
  .option("--type <types...>", "Resource types (default subtitles), or all")
  .option("--force", "Also redo reviewed / published translations")
  .action(async (sessions: string[], opts) => {
    try {
      printPreview(await run<Preview>("preview_translation_batch", batchInput(sessions, opts)));
    } catch (err) {
      handleError(err);
    }
  });

translationsResource
  .command("start")
  .description("Queue AI first-pass translations (Codex) for sessions x languages x types")
  .argument("<sessions...>", "Session codes: q1.c2.s3, q1.c2 (class) or q1 (quarter)")
  .requiredOption("--lang <codes...>", "Languages: fr es, fr,es, fra or French")
  .option("--type <types...>", "Resource types (default subtitles), or all")
  .option("--urgent", "First in the queue; may fall back to the OpenAI API key when the subscription is out of quota")
  .option("--refilm", "Refilmed session: before the backlog")
  .option("--force", "Also redo reviewed / published translations (replaces a translator's work with a new draft)")
  .option("--deadline <date>", "Review deadline, ISO date (2026-11-30)")
  .option("--label <text>", "Batch label")
  .option("--dry-run", "Only show what would be queued (same as preview)")
  .option("--wait", "Wait until the engine has translated everything, with progress")
  .option("--timeout <min>", "With --wait: give up after this many minutes", "240")
  .action(async (sessions: string[], opts) => {
    try {
      const input = batchInput(sessions, opts);
      if (opts.dryRun) return printPreview(await run<Preview>("preview_translation_batch", input));

      const result = await run<StartResult>("start_translation_batch", {
        ...input,
        urgent: Boolean(opts.urgent),
        refilm: Boolean(opts.refilm),
        deadline: opts.deadline,
        label: opts.label,
      });
      if (globalFlags.json && !opts.wait) return output(result);
      for (const s of result.skipped) log.info(pc.dim(`skip ${s.session} ${typeLabel(s.type)} ${s.language}: ${s.reason}`));
      for (const m of result.missing) log.warn(`${m.scope} ${typeLabel(m.type)}: ${m.reason}`);
      log.success(
        `Batch ${result.batch.id}: ${result.queued.length} queued, ${result.skipped.length} skipped, ${result.missing.length} missing`,
      );
      if (!opts.wait || !result.queued.length) {
        if (result.queued.length) log.info(pc.dim(`Follow it: esm-fto-cli translations wait ${result.batch.id}`));
        return;
      }
      finishWait(await waitForBatch(result.batch.id, Number(opts.timeout) * 60_000));
    } catch (err) {
      handleError(err);
    }
  });

translationsResource
  .command("batch")
  .description("A batch with each translation's status and queue position")
  .argument("<id>", "Batch id")
  .action(async (id: string) => {
    try {
      const batch = await run<Batch>("get_translation_batch", { id });
      if (globalFlags.json) return output(batch);
      log.info(`${pc.bold(batch.batch.label ?? batch.batch.id)}${batch.batch.urgent ? pc.red(" urgent") : ""}  ${totalsLine(batch.totals)}`);
      output(batch.translations.map(translationRow));
    } catch (err) {
      handleError(err);
    }
  });

translationsResource
  .command("wait")
  .description("Wait until the engine has translated every translation of a batch (exit code 1 if one failed)")
  .argument("<id>", "Batch id")
  .option("--timeout <min>", "Give up after this many minutes", "240")
  .action(async (id: string, opts: { timeout: string }) => {
    try {
      finishWait(await waitForBatch(id, Number(opts.timeout) * 60_000));
    } catch (err) {
      handleError(err);
    }
  });

translationsResource
  .command("reviews")
  .description("AI drafts waiting for your review (staff: --all for every pending review)")
  .option("--all", "Staff: every pending review")
  .option("--lang <code>", "Only this language")
  .action(async (opts: { all?: boolean; lang?: string }) => {
    try {
      const result = await run<{ data?: Translation[] } | Translation[]>("list_my_reviews", {
        all: opts.all ? "true" : "false",
        language: opts.lang,
      });
      const rows = Array.isArray(result) ? result : (result.data ?? []);
      if (globalFlags.json) return output(rows);
      output(rows.map((t) => ({ ...translationRow(t), open: t.reviewUrl ?? t.draftUrl ?? "" })));
    } catch (err) {
      handleError(err);
    }
  });

translationsResource
  .command("approve")
  .description("Approve a reviewed translation (it goes to the translation memory; subtitles become TRANSLATED)")
  .argument("<id>", "Translation id (from overview, reviews or batch)")
  .action(async (id: string) => {
    try {
      const result = await run<{ translation?: Translation }>("approve_translation", { id });
      if (globalFlags.json) return output(result);
      log.success(`Approved${result.translation ? `: ${result.translation.session} ${typeLabel(result.translation.type)} ${result.translation.language}` : ""}`);
    } catch (err) {
      handleError(err);
    }
  });

translationsResource
  .command("publish")
  .description("Publish an APPROVED translation (staff). Subtitles go to Alugha: viewers see them")
  .argument("<id>", "Translation id")
  .option("--yes", "Confirm: required, publication is visible to viewers")
  .action(async (id: string, opts: { yes?: boolean }) => {
    try {
      if (!opts.yes) throw new CliError(2, "Publishing is visible to viewers (subtitles go to Alugha)", `Confirm with: esm-fto-cli translations publish ${id} --yes`);
      const result = await run<{ published: string; todo?: string; upload?: { job?: { id: string } } | null }>("publish_translation", { id });
      if (globalFlags.json) return output(result);
      log.success(`Published: ${result.published}`);
      if (result.todo) log.warn(result.todo);
      if (result.upload?.job?.id) log.info(pc.dim(`Alugha confirmation: esm-fto-cli jobs wait ${result.upload.job.id}`));
    } catch (err) {
      handleError(err);
    }
  });

translationsResource
  .command("retry")
  .description("Queue a FAILED or OUTDATED translation again")
  .argument("<id>", "Translation id")
  .option("--urgent", "First in the queue")
  .action(async (id: string, opts: { urgent?: boolean }) => {
    try {
      const result = await run<unknown>("retry_translation", { id, urgent: opts.urgent });
      if (globalFlags.json) return output(result);
      log.success("Queued again");
    } catch (err) {
      handleError(err);
    }
  });

translationsResource
  .command("assign")
  .description("Give the review to one translator, or back to every translator of the language (none)")
  .argument("<id>", "Translation id")
  .argument("<user>", "User id or e-mail, or none")
  .action(async (id: string, user: string) => {
    try {
      const result = await run<unknown>("assign_review", { id, user: user.toLowerCase() === "none" ? null : user });
      if (globalFlags.json) return output(result);
      log.success(user.toLowerCase() === "none" ? "Review open to every translator of the language" : `Review assigned to ${user}`);
    } catch (err) {
      handleError(err);
    }
  });

translationsResource
  .command("discover")
  .description("Register the course documents of a quarter, class or session from the curriculum Drive (read only, safe to run again)")
  .argument("<scope>", "q1 (quarter), q1.c2 (class) or q1.c2.s1 (session); q99 = test curriculum")
  .action(async (scope: string) => {
    try {
      const result = await run<Discovery>("discover_resources", { scope });
      if (globalFlags.json) return output(result);
      if (!result.accessible) throw new CliError(1, result.warnings[0] ?? `${scope}: the Drive folder is not shared with FTO`);
      log.success(
        `${scope}: ${result.created} new, ${result.updated} updated, ${result.linkedTranslations} existing translations linked`,
      );
      for (const w of result.warnings) log.warn(w);
      if (result.skipped.length) log.info(pc.dim(`${result.skipped.length} file(s) skipped (--json to see them)`));
    } catch (err) {
      handleError(err);
    }
  });

translationsResource
  .command("register")
  .description("Register one document by hand (Drive file or Thinkific lesson)")
  .argument("<type>", "student-handout, supplemental-handout, teacher-notes, facilitator-guide, slides, homework, thinkific-lesson")
  .argument("<session>", "Session code q1.c2.s3 (s0 = class level)")
  .option("--drive-file <id>", "Google Drive file id")
  .option("--tab <name>", "Google Docs tab (Facilitator Guides: English)")
  .option("--thinkific-lesson <id>", "Thinkific lesson id")
  .option("--title <text>", "Title")
  .action(async (type: string, session: string, opts) => {
    try {
      const resourceType = parseTypes([type])[0];
      if (resourceType === "SUBTITLES") throw new CliError(2, "Subtitles are registered from the videos, not by hand");
      const result = await run<unknown>("register_resource", {
        type: resourceType,
        session,
        title: opts.title,
        driveFileId: opts.driveFile,
        driveTab: opts.tab,
        thinkificLessonId: opts.thinkificLesson,
      });
      if (globalFlags.json) return output(result);
      log.success(`${session} ${typeLabel(resourceType as string)} registered`);
    } catch (err) {
      handleError(err);
    }
  });

translationsResource
  .command("engine")
  .description("Engine state: Codex subscription, queue, running job, last 7 days")
  .action(async () => {
    try {
      const status = await run<EngineStatus>("engine_status");
      if (globalFlags.json) return output(status);
      const { lane, queue, running, last7Days: week } = status;
      output({
        subscription: lane.state + (lane.quotaResetAt ? ` until ${lane.quotaResetAt}` : ""),
        lastError: lane.lastError ?? "",
        queued: queue.queued,
        translating: queue.translating,
        failed: queue.failed,
        running: running
          ? `${running.session} ${typeLabel(running.type)} ${running.language} ${running.job?.progress ?? 0}% ${running.job?.currentStep ?? ""}`.trim()
          : "-",
        "last 7 days": `${week.completed} done (${week.completedOnSubscription} subscription, ${week.completedOnApiKey} API key), ${week.fallbacks} fallbacks, ${week.quotaWaits} quota waits, ${week.failed} failed`,
        "API spend": week.apiSpendUsd === null ? "unknown" : `$${week.apiSpendUsd.toFixed(2)}`,
      });
    } catch (err) {
      handleError(err);
    }
  });
