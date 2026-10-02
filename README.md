<!-- vim:set expandtab shiftwidth=4 filetype=markdown: -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

<!--
   -
   - ~chewygumxx/sync-repo-metadata.git
   - ::: :/README.md
   -
   -->

<!--
   - [GitHub Action] Applies metadata to a repository according to
   - :/.repo-metadata.jsonc
   -->

# sync-repo-metadata

A composite GitHub Action that reads `.repo-metadata.jsonc` from the consuming
repo and pushes repository settings including description, homepage, topics,
visibility, merge/branch options, feature toggles, and immutable releases to
GitHub via the REST API.

The metadata file is validated against the [JSON Schema](<./schema.json>)
fetched at runtime from its own `$schema` field. `$schema` may reference either
the floating major-version tag (`v2`) or an exact release tag (`v2.0.0`).

The action refuses a metadata file whose `slug` names another repository,
ignoring case, so a file copied from another repository or left over from a
rename cannot apply that repository's settings. A file without `slug` is not
checked.

## Usage

```yaml
- name: Apply Metadata
  uses: chewygumxx/sync-repo-metadata@v2
  with:
      metadata_path: .repo-metadata.jsonc     # Optional, this is the default
      token: ${{ secrets.SOME_ADMIN_TOKEN }}  # Required, see "Token permissions" below
```

If no metadata file is present at `metadata_path`, the action is a no-op.

### Inputs

| Input           | Required | Default                | Description                                        |
|-----------------|----------|------------------------|-----------------------------------------------------|
| `metadata_path` | No       | `.repo-metadata.jsonc` | Path to the JSONC metadata file to apply.          |
| `token`         | Yes      | -                      | Token used to authenticate against the GitHub API. |

### Token permissions

Every write this action makes including the repository-settings `PATCH`, the
topics `PUT`, and the immutable-releases `PUT`/`DELETE`, requires the
`Administration: write` repository permission, per
[GitHub's fine-grained permissions reference][gh-app-perms]. This isn't limited
to "admin-tier" fields like `visibility` or merge options: `PATCH
/repos/{owner}/{repo}` and `PUT /repos/{owner}/{repo}/topics` require
`Administration: write` for every field they accept, so even a metadata file
that only sets `description` or `topics` needs it.

`GITHUB_TOKEN` can never carry this permission `administration` isn't one of the
scopes exposed by a workflow's `permissions:` block, so no `permissions:`
configuration makes `${{ github.token }}` work here. This is why `token` has no
default and must always be supplied explicitly. The recommended approach is to
mint one from a GitHub App installed on the repo/org (see
[`.github/workflows/sync-repo-metadata.yaml`](.github/workflows/sync-repo-metadata.yaml)
for a full example using [`actions/create-github-app-token`][app-token]):

```yaml
- name: Mint App Installation Token
  id:   app-token
  uses: actions/create-github-app-token@v3
  with:
      client-id:   ${{    vars.METADATA_APP_CLIENT_ID   }}
      private-key: ${{ secrets.METADATA_APP_PRIVATE_KEY }}
      permission-administration: write

- uses: actions/checkout@v5

- name: Apply Metadata
  uses: chewygumxx/sync-repo-metadata@v2
  with:
      token: ${{ steps.app-token.outputs.token }}
```

[app-token]:     https://github.com/actions/create-github-app-token
[gh-app-perms]:  https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps

## `.repo-metadata.jsonc`

```jsonc
{
    // Required: $schema
    "$schema": "https://raw.githubusercontent.com/chewygumxx/sync-repo-metadata/refs/tags/v2/schema.json",
    "name":  "sync-repo-metadata",
    "owner": "chewygumxx",
    "slug":  "chewygumxx/sync-repo-metadata",
    "default_branch": "main",
    "category": "github-action",
    "topics": [ "github-action", "metadata", "repository" ],
    "description": "[GitHub Action] Applies metadata to a repository according to :/.repo-metadata.jsonc",
    "license": {
        "filepath": "./LICENSE",
        "spdx_id": "GPL-3.0-only",
        "full_name": "GNU General Public License v3.0 only",
        "url": "https://spdx.org/licenses/GPL-3.0-only"
    },
    "language": "javascript",
    "immutable_releases": true
}
```

Only the fields GitHub's API accepts are applied; everything else in the
schema exists for other consumers of the same metadata file. Of those:

- `description`, `homepage` are sent to `PATCH /repos/{owner}/{repo}`
- `topics` are sent to `PUT /repos/{owner}/{repo}/topics`
- `immutable_releases` is applied via `PUT` (enable) or `DELETE` (disable)
  to `/repos/{owner}/{repo}/immutable-releases`, since it isn't part of
  the repo PATCH body.
- The remaining repository-settings fields including, `visibility`,
  `archived`, `is_template`, `has_issues`, `has_projects`, `has_wiki`,
  `has_pull_requests`, `allow_forking`, the `allow_*_merge` /
  `delete_branch_on_merge` / `allow_update_branch` merge options, the
  `squash_merge_commit_*` / `merge_commit_*` enums, and
  `web_commit_signoff_required` are passed through as-is to the same
  `PATCH /repos/{owner}/{repo}` call.

A field omitted from the metadata file is left untouched on GitHub it is not
reset to a default. A boolean explicitly set to `false` is still sent.

## Development

```sh
bun install
bunx eslint .  # lint (flat config in eslint.config.mjs)
```

There is no build step; `run.js` runs directly under Bun. To run the
action's logic locally:

```sh
# GITHUB_TOKEN needs Administration: write — see "Token permissions" above
GITHUB_TOKEN=token \
GITHUB_REPOSITORY=owner/repo \
GITHUB_API_URL=https://api.github.com \
bun run.js
```

`METADATA_PATH` may also be set to override the default `.repo-metadata.jsonc`
path.

## License

[GNU General Public License v3.0 only](LICENSE)
