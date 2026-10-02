# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A composite GitHub Action (`action.yaml`) that reads `.repo-metadata.jsonc` from the consuming repo and pushes repository settings — `description`, `homepage`, topics, visibility, merge/branch options, feature toggles, and immutable releases — to GitHub via the REST API. The entire implementation is `run.js`; there is no build step — it runs directly under Bun.

## Commands

- Install dependencies: `bun install`
- Lint: `bunx eslint .` (flat config in `eslint.config.mjs`; no `lint` script is defined in `package.json`)
- No test suite exists.
- Run the action's logic locally: `bun run.js`, with `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_API_URL` (e.g. `https://api.github.com`), and optionally `METADATA_PATH` set in the environment (see Runtime flow below).

## Architecture

Single-file Bun script (`run.js`) invoked by `action.yaml` as the composite action's only real step, run as `bun "$GITHUB_ACTION_PATH/run.js"` (after `oven-sh/setup-bun@v2` with Bun 1.4 and `bun install --production --frozen-lockfile --cwd "$GITHUB_ACTION_PATH"`). Flow in `main()`:

1. **`envParse(env)`** — reads `GITHUB_API_URL` (required, must be a valid URL — no inline default; `action.yaml` supplies it from `github.api_url` so it works on GitHub Enterprise Server too), `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, and `METADATA_PATH` (default `.repo-metadata.jsonc`, resolved against the working directory) from `process.env`. Exits `0` if no metadata file is present (this is treated as a no-op, not an error); exits `1` on missing/invalid required env vars or JSONC parse errors. Parses the metadata file with `jsonc-parser` and returns `{ ghAPIURL, token, slug, metadata, metadataDir }`.
2. **`metaParse(meta, metadataDir)`** — requires `meta.$schema` to match `validSchemaPattern`, which `run.js` builds from the `$schema` property's `pattern` in the local `schema.json` (the rolling major tag, e.g. `v2`, or any exact release under it, e.g. `v2.0.0`; anything else is rejected, including otherwise-valid URLs), then resolves it via **`resolveSchema(url)`**: the major-tag URL and the action's own release URL (both derived at load time from the bundled `schema.json`'s `$id`, which must be `…/refs/tags/vX.Y.Z/schema.json` or `run.js` throws on load) use the bundled schema with no network access; any other exact release is fetched over HTTP with a 10s timeout, must be a JSON object, and only warns if its `$id` differs from the URL (v2.0.1 and v2.1.0 shipped a stale `$id` under immutable tags). It then compiles the schema with `ajv` + `ajv-formats`, and validates the metadata object against it. If `license.filepath` is set, it must resolve (relative to `metadataDir`) to an existing file. Throws on any failure (`main()` exits `1`). Returns only the fields GitHub's API accepts: `description`, `homepage`, `topics`, `immutable_releases`, and the rest of the repository-settings fields (`visibility`, `archived`, `is_template`, `has_issues`, `has_projects`, `has_wiki`, `has_pull_requests`, `allow_forking`, the `allow_*_merge`/`delete_branch_on_merge`/`allow_update_branch` merge options, the `squash_merge_commit_*`/`merge_commit_*` enums, and `web_commit_signoff_required`) passed through as-is (`undefined` when absent from the metadata file, so unset keys are simply omitted rather than reset to a default).
3. **`ghFetch(env, apiPath, method, body)`** — thin wrapper around `fetch` for GitHub API calls, using `token` auth and `application/vnd.github+json`; throws on any non-2xx response.
4. `main()` splits the fields returned by `metaParse` into three calls: a single PATCH `/repos/{slug}` carrying every settings field that was actually present in the metadata (booleans set to `false` are still sent — only `undefined` fields are dropped), a PUT `/repos/{slug}/topics` for topics, and (since it isn't part of the repo PATCH body) a PUT `/repos/{slug}/immutable-releases` to enable or DELETE to disable, based on `immutable_releases`.

As of v2, the metadata schema (`schema.json`) lives in this repo and is version-pinned per release: `.repo-metadata.jsonc`'s `$schema` field points at `https://raw.githubusercontent.com/chewygumxx/sync-repo-metadata/refs/tags/<tag>/schema.json` (currently `v2`), and `metaParse` rejects any metadata file whose `$schema` doesn't match the `$schema` pattern in `schema.json` (major tag `v2` or an exact `v2.x.y` release). This replaces the pre-v2 design, where the schema was hosted externally (`https://schema.cgxx.dev/...`) and any syntactically valid URL was accepted.

**Cutting a release:** `schema.json`'s `$id` is how `run.js` knows which release it is, so **every** release, including code-only ones, must set `$id` to the new tag (e.g. `…/refs/tags/v2.2.0/schema.json`) and keep `package.json`'s `version` in step. Otherwise users who pin that exact tag in `$schema` get a network fetch and a `$id` mismatch warning instead of the bundled schema. Editing `schema.json` likewise requires a new release, since the URL is pinned to a git tag. To ship one: update `schema.json` (bump its `$id`; if the major version changes, also update its `$schema` pattern — `run.js` reads it from there — and `$schema` in `.repo-metadata.jsonc`), commit, then tag both the semver release (e.g. `v2.0.0`) and move the rolling major tag (e.g. `v2`) to point at it.

## Repo conventions

- Every source file opens with a `vim:` modeline, an SPDX license identifier comment, and a header block giving the file's canonical repo and in-repo path (e.g. `~chewygumxx/...` / `::: :/path/to/file`). Follow this header style in new files.
- Tabs/indentation: 4-space, `expandtab` (per the vim modelines).
- License is GPL-3.0-only (see `LICENSE`); keep new files' SPDX headers consistent with that.

