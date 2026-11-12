---
name: esm-fto-cli
description: "Operate Encounter's FTO app (ESM Operation Platform, Alugha video subtitle translation) with esm-fto-cli: list and edit videos, set translation statuses and deadlines, validate translations, download/upload SRT subtitles, run AI translation and the translation engine (batches, reviews, approval, publication of subtitles and course documents: handouts, teacher notes, Facilitator Guides, slides), voice-over and Alugha uploads, Drive sync, translator language assignments. Use whenever the user talks about FTO/ESM videos (codes like q1.c2.s3), subtitles, translations, voice-over or Alugha publishing through the FTO app."
category: "productivity"
---

# esm-fto-cli

CLI for Encounter's FTO app (ESM Operation Platform). Every command goes
through the app API (`<app-url>/api/v1`) and is authenticated with the user's
personal API key: it acts with that user's role (admin, staff,
english_reviewer, user) and language assignments, exactly like the web app. It
never calls the processing backend directly.

## Setup

```bash
esm-fto-cli auth test            # who am I, on which app
esm-fto-cli auth list            # profiles (* = active), URL, key owner
```

If no key is configured, ask the user to create one in the web app
(Account > API keys) and run it themselves (never paste a key in a chat):

```bash
esm-fto-cli auth set esm_xxx --profile prod --use   # https://fto.encounterschool.org
esm-fto-cli auth set esm_yyy --profile dev          # https://fto-dev.encounterschool.org
esm-fto-cli auth set esm_zzz --profile local        # http://localhost:3000
esm-fto-cli auth use dev                            # switch the active profile
```

`-p/--profile <name>` selects a profile for one command (`--env` is an alias).
Other names need `--url` once. `ESM_FTO_PROFILE`, `ESM_FTO_API_KEY` and
`ESM_FTO_API_URL` override the saved state (CI, agents). Keys live in
`~/.config/tokens/esm-fto-cli-<profile>.txt` (chmod 600), the rest in
`~/.config/esm-fto-cli/state.json`. Default profile: `prod`.

## References

- **Video**: code `q1.c2.s3` (quarter.class.session, case-insensitive), database id, or Alugha id.
- **Language**: ISO code `fr`, Alugha code `fra`, or name `french`.
- **Translation status flow** per language:
  `PENDING` -> `TRANSLATING` (AI/raw translation saved) -> `TRANSLATED` (human review saved)
  -> `VOICE_OVER_GENERATING` -> `COMPLETED` (published on Alugha).
- **Video status**: `TRANSCRIBING` (hidden from translators) / `TRANSCRIBED` (ready).
- **SRT convention**: Drive and Alugha files have display line breaks; `subtitles put` adds them unless `--no-line-breaks`.

## Working rules

- Use `--json` when you need to parse output. Read before writing: `videos get` / `lang get` first.
- Commands that write to Google Drive or Alugha are real and visible to the team:
  `subtitles put|import`, `translate --wait` (saves SRT), `jobs save`, `voice generate`,
  `voice reduck`, `alugha upload`, `sync start`. Confirm with the user before running them
  unless they explicitly asked for that action.
- `jobs save`, `subtitles import` and `translate --wait` refuse to overwrite a reviewed
  language (TRANSLATED or later) or an already-saved job. Only add `--force` when the user
  explicitly wants to overwrite the reviewed SRT.
- Destructive commands need `--yes`: `videos delete`, `lang remove`. Ask first.
- A 403 means the role or language assignment does not allow it: check `esm-fto-cli whoami`.
- Never print or paste the API key (`auth show` masks it; avoid `--raw`).

## Commands

### Account and reference data
| Command | Description |
|---|---|
| `esm-fto-cli whoami` | Key owner, role, assigned languages |
| `esm-fto-cli languages list` | Languages (ISO code, Alugha code, Drive folder) |
| `esm-fto-cli prompts list` | Default translation prompts per language pair |

### Videos
| Command | Description |
|---|---|
| `esm-fto-cli videos list [--search T] [--school-year Y1\|Y2\|Y3\|Other] [--quarter N] [--class N] [--status S] [--lang fr --lang-status S] [--archived false\|true\|all] [--limit N]` | List videos with school year and per-language statuses |
| `esm-fto-cli videos get <video>` | Video details + target languages |
| `esm-fto-cli videos add <code> --alugha-id ID [--title T] [--speaker S] [--video-url U]` | Add a video from its synced Drive session (staff/admin); school year from the quarter |
| `esm-fto-cli videos update <video> [--school-year Y1\|Y2\|Y3\|Other] [--title T] [--speaker S] [--name N] [--alugha-id ID] [--video-url U] [--prompt T \| --prompt-file F]` | Edit metadata; `""` clears a text field (staff/admin) |

**School year** (`schoolYear`, "School year" on the video edit page): Y1, Y2, Y3 or Other, stored as 1, 2, 3, 9 in the API. A new video gets it from its quarter (Q1-Q4 = Y1, Q5-Q8 = Y2, Q9+ = Y3); set Other for a video outside the three years. There is no recording-year field anymore: the old free-text `year` ("2020-2021") is no longer in the API.
| `esm-fto-cli videos status <video> TRANSCRIBING\|TRANSCRIBED\|AUTO` | Force status, or give it back to Drive sync (staff/admin) |
| `esm-fto-cli videos archive\|unarchive <video>` | Archive (staff/admin) |
| `esm-fto-cli videos sync <video>` | Rescan this video's Drive folder (staff/admin) |
| `esm-fto-cli videos source <video> [-o file]` | Source (English) SRT |
| `esm-fto-cli videos delete <video> --yes` | Remove from the platform, files kept (admin) |

### A video in one language
| Command | Description |
|---|---|
| `esm-fto-cli lang get <video> <lang>` | Status, deadline, validations, SRT path |
| `esm-fto-cli lang status <video> <lang> <STATUS>` | Set translation status (assigned translators, staff, admin) |
| `esm-fto-cli lang deadline <video> <lang> <YYYY-MM-DD\|none>` | Deadline (staff/admin) |
| `esm-fto-cli lang validate\|unvalidate <video> <lang>` | Add/withdraw your validation |
| `esm-fto-cli lang add <video> <lang> [--deadline D]` | Add a target language (staff/admin) |
| `esm-fto-cli lang remove <video> <lang> --yes` | Remove a target language (staff/admin) |

### Subtitles (Google Drive)
| Command | Description |
|---|---|
| `esm-fto-cli subtitles get <video> <lang> [-o file]` | Translated SRT currently in Drive |
| `esm-fto-cli subtitles put <video> <lang> -f file.srt [--stage reviewed\|translation] [--no-line-breaks] [--status S\|keep]` | Save an SRT to Drive; reviewed -> TRANSLATED |
| `esm-fto-cli subtitles import <video> <lang> -f tagged.txt [--dry-run] [--force]` | Import `<<1>> text <<2>> text` translation; validates tags, uses source timings, -> TRANSLATING |

`-f -` reads stdin.

### Pipeline
| Command | Description |
|---|---|
| `esm-fto-cli translate <video> <langs...> [--wait] [--no-save] [--force] [--voice] [--upload subtitles\|complete] [--no-confirm] [--model M] [--prompt-file F]` | AI translation; with `--wait` shows a progress bar, saves the SRT (TRANSLATING), optionally voice-over and Alugha, then waits for Alugha to confirm (`--no-confirm` skips that wait) |
| `esm-fto-cli voice status <video> <lang>` | Subtitles / voice track / final audio present in Drive |
| `esm-fto-cli voice generate <video> <lang> [--gain -17] [--test] [--wait] [--upload] [--no-confirm]` | ElevenLabs voice-over; `--upload` publishes subtitles + audio (COMPLETED) and waits for Alugha's confirmation |
| `esm-fto-cli voice reduck <video> <lang> --gain DB` | Remix voice over original audio with a new gain |
| `esm-fto-cli alugha upload <video> <lang> [--mode subtitles\|audio\|complete] [-f file.srt] [--wait]` | Publish on Alugha (`-f`: direct SRT, staff/admin); `--wait` blocks until Alugha confirms the subtitles / voice-over are added |

### Translation engine (Codex, every course resource, staff)
The engine translates subtitles and course documents (student and
supplemental handouts, teacher notes, Facilitator Guides, slides, homework,
Thinkific lessons) in a queue, on the Codex subscription, then translators
review and staff publish. `translate` above is the older direct OpenAI
translation of one video's subtitles; the engine is the default way.

Flow: `NOT_STARTED -> QUEUED -> AI_TRANSLATING -> AI_DONE / IN_REVIEW -> APPROVED -> PUBLISHED`
(`FAILED`: retry; `OUTDATED`: the English source changed). Sessions are
`q1.c2.s3`, `q1.c2` (class) or `q1` (quarter); types are `subtitles`,
`student-handout`, `supplemental-handout`, `teacher-notes`,
`facilitator-guide`, `slides`, `homework`, `thinkific-lesson` or `all`.
`tr` is an alias of `translations`.

| Command | Description |
|---|---|
| `esm-fto-cli translations overview [--quarter N] [--lang fr] [--type T] [--status S] [--assignee E\|none] [--overdue] [--outdated] [--session q1.c2]` | Every resource x language with its status (the dashboard) |
| `esm-fto-cli translations discover <q1\|q1.c2\|q1.c2.s1>` | Register the course documents from the curriculum Drive (read only, safe to rerun); existing `[XX]` translations are linked as APPROVED |
| `esm-fto-cli translations preview <sessions...> --lang fr es [--type T...] [--force]` | Dry run: what would be queued, skipped (why) and missing |
| `esm-fto-cli translations start <sessions...> --lang fr es [--type T...] [--urgent] [--refilm] [--force] [--deadline D] [--label L] [--dry-run] [--wait]` | Queue the batch; `--wait` follows it until translated (exit 1 if one failed) |
| `esm-fto-cli translations batch <id>` / `wait <id>` | A batch's translations, queue positions / wait for it |
| `esm-fto-cli translations reviews [--all] [--lang fr]` | Drafts waiting for review, with their link |
| `esm-fto-cli translations approve <id>` | Translator validation -> APPROVED (+ translation memory) |
| `esm-fto-cli translations publish <id> --yes` | Staff: subtitles go to Alugha (viewers see them), other types are only marked published |
| `esm-fto-cli translations retry <id> [--urgent]` | FAILED / OUTDATED -> queued again |
| `esm-fto-cli translations cancel <id>` / `cancel --batch <id>` | Stop a queued or translating translation (or what is left of a batch): the engine stops within seconds, delivers nothing; back to its status before the queue |
| `esm-fto-cli translations assign <id> <email\|none>` | Give the review to one person / back to every translator of the language |
| `esm-fto-cli translations register <type> <session> [--drive-file ID] [--tab English] [--thinkific-lesson ID]` | Register one document by hand |
| `esm-fto-cli translations engine` | Subscription lane, queue, running job, last 7 days |

Sessions come before the options (`--lang` and `--type` take several values).
Rules: always `preview` (or `start --dry-run`) and show the user the totals
before `start` on more than one session; `--force` replaces a translator's
reviewed work, `--urgent` may spend the OpenAI API key, `publish` is public:
ask first for each. Tests only on `q99` (`q99.c99.s99`, test curriculum).

### Jobs (translation, voice-over, Alugha confirmation)
Every job has `progress` (0-100) and `currentStep`. An upload to Alugha starts
an `ALUGHA_UPLOAD` job: Alugha has no webhook, so the app reads the video on
Alugha until the new subtitles are published and the voice-over is processed.
`completed` = Alugha confirmed (`subtitlesAddedAt`, `voiceOverAddedAt`);
`failed` = Alugha reported an error or did not confirm within 30 min.

| Command | Description |
|---|---|
| `esm-fto-cli jobs list [--active] [--video CODE]` | Your jobs |
| `esm-fto-cli jobs get <id> [--content]` | Refresh and show; `--content` prints the raw tagged translation |
| `esm-fto-cli jobs wait <id>` | Block until done with a progress bar line per change (exit 1 on failure) |
| `esm-fto-cli jobs save <id> [--force]` | Completed translation -> SRT in Drive (TRANSLATING) |
| `esm-fto-cli jobs cancel <id>` | Cancel a voice-over job |

### Drive sync and tools
| Command | Description |
|---|---|
| `esm-fto-cli sync start [--wait]` | Full Drive scan; `--wait` also stores the result (staff/admin) |
| `esm-fto-cli sync status` / `sync save` | Progress / store a completed scan |
| `esm-fto-cli drive sessions [--unlinked] [--quarter N]` | Drive sessions; `--unlinked` = not yet added as videos |
| `esm-fto-cli srt renumber\|add-line-breaks\|remove-line-breaks -f in.srt [-o out.srt]` | SRT toolbox (no Drive change) |

### Admin
| Command | Description |
|---|---|
| `esm-fto-cli users list [--search T]` | Users, roles, languages |
| `esm-fto-cli users assign\|unassign <email> <lang>` | Translator language assignment |

### Every tool by name (same tools as the FTO MCP)
The app declares each operation once as a tool and publishes them at
`/api/v1/tools`, filtered by your role. These commands read that list, so a
tool added to the app is usable here at once, even without a dedicated command:

| Command | Description |
|---|---|
| `esm-fto-cli tools list [--category C] [--access read\|write]` | Tools your role can use (`write!` = overwrites or publishes) |
| `esm-fto-cli tools describe <name>` | What it does, its inputs, types, defaults |
| `esm-fto-cli tools run <name> key=value ... [-i json\|@file\|-] [--file key=path] [--raw field [-o file]]` | Run it; values are JSON (`limit=5`, `force=true`) unless the input is text |

```bash
esm-fto-cli tools run list_videos language=fr languageStatus=PENDING limit=5
esm-fto-cli tools run get_subtitles ref=q1.c2.s3 lang=fr --raw content -o fr.srt
esm-fto-cli tools run save_subtitles ref=q1.c2.s3 lang=fr --file content=fr.srt
```

Prefer the dedicated commands above when one exists (`--wait`, files,
tables); use `tools` for anything else. Confirm with the user before a
`write!` tool.

### Escape hatch
`esm-fto-cli api <GET|POST|PUT|PATCH|DELETE> <path> [-d json]` calls any `/api/v1` endpoint,
e.g. `esm-fto-cli api GET /videos/q1.c2.s3/languages/fr`.

## Recipes

```bash
# What still needs French work?
esm-fto-cli videos list --lang fr --lang-status PENDING --json

# Rename a video
esm-fto-cli videos update q1.c2.s3 --title "The Three Leavens" --speaker "Fr. Mathias Thelen"

# Translate German, save to Drive, then review locally and upload the corrected SRT
esm-fto-cli translate q1.c2.s3 de --wait
esm-fto-cli subtitles get q1.c2.s3 de -o de.srt
#   (edit de.srt)
esm-fto-cli subtitles put q1.c2.s3 de -f de.srt        # -> TRANSLATED
esm-fto-cli lang validate q1.c2.s3 de

# Voice-over and publish, until Alugha confirms both are added
esm-fto-cli voice generate q1.c2.s3 de --wait --upload  # -> COMPLETED

# Publish subtitles only and wait for Alugha's confirmation
esm-fto-cli alugha upload q1.c2.s3 de --wait

# Add a new video found in Drive
esm-fto-cli sync start --wait
esm-fto-cli drive sessions --unlinked
esm-fto-cli videos add q5.c1.s1 --alugha-id <id> --title "..."
esm-fto-cli videos status q5.c1.s1 TRANSCRIBED
```

## Output and exit codes

`--json` prints `{ "ok": true, "data": ... }`; errors print
`{ "ok": false, "error": { "code": 403, "message": "...", "suggestion": "..." } }`.
`subtitles get`, `videos source` and `srt *` print raw SRT (pipeable) unless `--json`.
Exit codes: 0 success, 1 API error, 2 usage error.

## Updates

Once a day esm-fto-cli checks GitHub for a newer version. When a command prints
**Update available** on stderr (or `meta.update` in `--json` output), or an
error says the CLI is too old: tell the user, run `esm-fto-cli self-update`, re-read
this skill (it is updated with the CLI), then run the command again.
`esm-fto-cli self-update --check` checks right away.
