---
name: esm-fto-cli
description: "Operate Encounter's FTO app (ESM Operation Platform, Alugha video subtitle translation) with esm-fto-cli: list and edit videos, set translation statuses and deadlines, validate translations, download/upload SRT subtitles, run AI translation, voice-over and Alugha uploads, Drive sync, translator language assignments. Use whenever the user talks about FTO/ESM videos (codes like q1.c2.s3), subtitles, translations, voice-over or Alugha publishing through the FTO app."
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
| `esm-fto-cli videos list [--search T] [--quarter N] [--class N] [--status S] [--lang fr --lang-status S] [--archived false\|true\|all] [--limit N]` | List videos with per-language statuses |
| `esm-fto-cli videos get <video>` | Video details + target languages |
| `esm-fto-cli videos add <code> --alugha-id ID [--title T] [--speaker S] [--year Y] [--video-url U]` | Add a video from its synced Drive session (staff/admin) |
| `esm-fto-cli videos update <video> [--title T] [--speaker S] [--year Y] [--name N] [--alugha-id ID] [--video-url U] [--prompt T \| --prompt-file F]` | Edit metadata; `""` clears a field (staff/admin) |
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
| `esm-fto-cli translate <video> <langs...> [--wait] [--no-save] [--force] [--voice] [--upload subtitles\|complete] [--model M] [--prompt-file F]` | AI translation; with `--wait` saves the SRT (TRANSLATING), optionally voice-over and Alugha |
| `esm-fto-cli voice status <video> <lang>` | Subtitles / voice track / final audio present in Drive |
| `esm-fto-cli voice generate <video> <lang> [--gain -17] [--test] [--wait] [--upload]` | ElevenLabs voice-over; `--upload` publishes subtitles + audio (COMPLETED) |
| `esm-fto-cli voice reduck <video> <lang> --gain DB` | Remix voice over original audio with a new gain |
| `esm-fto-cli alugha upload <video> <lang> [--mode subtitles\|audio\|complete] [-f file.srt]` | Publish on Alugha (`-f`: direct SRT, staff/admin) |

### Jobs (translation, voice-over)
| Command | Description |
|---|---|
| `esm-fto-cli jobs list [--active] [--video CODE]` | Your jobs |
| `esm-fto-cli jobs get <id> [--content]` | Refresh and show; `--content` prints the raw tagged translation |
| `esm-fto-cli jobs wait <id>` | Block until done (exit 1 on failure) |
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

# Voice-over and publish
esm-fto-cli voice generate q1.c2.s3 de --wait --upload  # -> COMPLETED

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
