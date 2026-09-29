# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A composite GitHub Action (`action.yaml`) that reads `.repo-metadata.jsonc` from the consuming repo and pushes repository settings — `description`, `homepage`, topics, visibility, merge/branch options, feature toggles, and immutable releases — to GitHub via the REST API. The entire implementation is `run.js`; there is no build step — it runs directly under Node.js.

## Commands

- Install dependencies: `npm install`
- Lint: `npx eslint .` (flat config in `eslint.config.mjs`; no `lint` script is defined in `package.json`)
- No test suite exists.
- Run the action's logic locally: `node run.js`, with `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_API_URL` (e.g. `https://api.github.com`), and optionally `METADATA_PATH` set in the environment (see Runtime flow below).

## Architecture

Single-file Node script (`run.js`) invoked by `action.yaml` as the composite action's only real step, run as `node "$GITHUB_ACTION_PATH/run.js"` (after `actions/setup-node@v7` with Node.js 24 and `npm ci --omit=dev --prefix "$GITHUB_ACTION_PATH"`). Flow in `main()`:

1. **`envParse(env)`** — reads `GITHUB_API_URL` (required, must be a valid URL — no inline default; `action.yaml` supplies it from `github.api_url` so it works on GitHub Enterprise Server too), `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, and `METADATA_PATH` (default `.repo-metadata.jsonc`, resolved against the working directory) from `process.env`. Exits `0` if no metadata file is present (this is treated as a no-op, not an error); exits `1` on missing/invalid required env vars or JSONC parse errors. Parses the metadata file with `jsonc-parser` and returns `{ ghAPIURL, token, slug, metadata, metadataDir }`.
2. **`metaParse(meta, metadataDir)`** — requires `meta.$schema` to match `validSchemaPattern`, which `run.js` builds from the `$schema` property's `pattern` in the local `schema.json` (the rolling major tag, e.g. `v2`, or any exact release under it, e.g. `v2.0.0`; anything else is rejected, including otherwise-valid URLs), fetches that JSON Schema over HTTP (so validation uses the schema at the referenced tag, not the local `schema.json`), compiles it with `ajv` + `ajv-formats`, and validates the metadata object against it. If `license.filepath` is set, it must resolve (relative to `metadataDir`) to an existing file. Throws on any failure (`main()` exits `1`). Returns only the fields GitHub's API accepts: `description`, `homepage`, `topics`, `immutable_releases`, and the rest of the repository-settings fields (`visibility`, `archived`, `is_template`, `has_issues`, `has_projects`, `has_wiki`, `has_pull_requests`, `allow_forking`, the `allow_*_merge`/`delete_branch_on_merge`/`allow_update_branch` merge options, the `squash_merge_commit_*`/`merge_commit_*` enums, and `web_commit_signoff_required`) passed through as-is (`undefined` when absent from the metadata file, so unset keys are simply omitted rather than reset to a default).
3. **`ghFetch(env, apiPath, method, body)`** — thin wrapper around `fetch` for GitHub API calls, using `token` auth and `application/vnd.github+json`; throws on any non-2xx response.
4. `main()` splits the fields returned by `metaParse` into three calls: a single PATCH `/repos/{slug}` carrying every settings field that was actually present in the metadata (booleans set to `false` are still sent — only `undefined` fields are dropped), a PUT `/repos/{slug}/topics` for topics, and (since it isn't part of the repo PATCH body) a PUT `/repos/{slug}/immutable-releases` to enable or DELETE to disable, based on `immutable_releases`.

As of v2, the metadata schema (`schema.json`) lives in this repo and is version-pinned per release: `.repo-metadata.jsonc`'s `$schema` field points at `https://raw.githubusercontent.com/chewygumxx/sync-repo-metadata/refs/tags/<tag>/schema.json` (currently `v2`), and `metaParse` rejects any metadata file whose `$schema` doesn't match the `$schema` pattern in `schema.json` (major tag `v2` or an exact `v2.x.y` release). This replaces the pre-v2 design, where the schema was hosted externally (`https://schema.cgxx.dev/...`) and any syntactically valid URL was accepted.

**Cutting a schema change:** editing `schema.json` requires a new release, since the URL is pinned to a git tag. To ship one: update `schema.json` (bump its `$id`; if the major version changes, also update its `$schema` pattern — `run.js` reads it from there — and `$schema` in `.repo-metadata.jsonc`), commit, then tag both the semver release (e.g. `v2.0.0`) and move the rolling major tag (e.g. `v2`) to point at it.

## Repo conventions

- Every source file opens with a `vim:` modeline, an SPDX license identifier comment, and a header block giving the file's canonical repo and in-repo path (e.g. `~chewygumxx/...` / `::: :/path/to/file`). Follow this header style in new files.
- Tabs/indentation: 4-space, `expandtab` (per the vim modelines).
- License is GPL-3.0-only (see `LICENSE`); keep new files' SPDX headers consistent with that.

