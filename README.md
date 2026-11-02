# esm-fto-cli

CLI for Encounter's FTO app (ESM Operation Platform, Alugha video subtitle
translation), built with the [api2cli](https://api2cli.dev) structure. First of
the ESM CLIs: `esm-fto-cli`, `esm-alugha-cli`, `esm-thinkific-cli`.

It only talks to the FTO Next.js app (`<app-url>/api/v1`), authenticated with
a personal API key (Better Auth `apiKey` plugin): each command runs with your
role and language assignments, like the web app. It never calls the FastAPI
backend directly.

## Install

```bash
api2cli bundle esm-fto && api2cli link esm-fto   # build + link ~/.local/bin/esm-fto-cli
```

## Configure

Create a key in the web app: **Account > API keys** (shown once). Profiles work
like growth-cli: one key per profile, `prod`, `dev` and `local` know their URL.

```bash
esm-fto-cli auth set esm_xxx --profile prod --use
esm-fto-cli auth set esm_yyy --profile dev
esm-fto-cli -p dev videos list
esm-fto-cli auth list
```

Keys: `~/.config/tokens/esm-fto-cli-<profile>.txt` (chmod 600). State:
`~/.config/esm-fto-cli/state.json`. `ESM_FTO_PROFILE`, `ESM_FTO_API_KEY`,
`ESM_FTO_API_URL` override them.

## Usage

```bash
esm-fto-cli --help
esm-fto-cli videos list --lang fr --lang-status PENDING
esm-fto-cli videos update q1.c2.s3 --title "The Three Leavens"
esm-fto-cli lang status q1.c2.s3 fr TRANSLATED
esm-fto-cli translate q1.c2.s3 fr de --wait
esm-fto-cli subtitles get q1.c2.s3 fr -o fr.srt
esm-fto-cli subtitles put q1.c2.s3 fr -f fr.srt
esm-fto-cli voice generate q1.c2.s3 fr --wait --upload
```

See `skills/esm-fto-cli/SKILL.md` for every command (also used by AI agents).

## Layout

- `src/lib/` - config/profiles, auth, HTTP client (no retry on POST), output, jobs polling
- `src/commands/auth.ts` - API keys and profiles
- `src/resources/` - one file per resource (videos, lang, subtitles, pipeline, jobs, sync, srt, account)
