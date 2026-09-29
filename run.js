// vim:set expandtab shiftwidth=4 filetype=javascript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/sync-repo-metadata.git
// ::: :/run.js
//
//

//
// [GitHub Action] Applies metadata to a repository according to :/.repo-metadata.jsonc
//

const fs    = require("node:fs");
const URL   = require("node:url").URL;
const path  = require("node:path");

const Ajv         = require("ajv");
const addFormats  = require("ajv-formats");
const jsoncParser = require("jsonc-parser");

// Single source of truth: the `$schema` pattern shipped alongside this file
const validSchemaPattern = new RegExp(require("./schema.json").properties.$schema.pattern, "u");

function validURL(url) {
    try{ new URL(url); return url; } catch { return false; }
}

function fmt(val) {
    return typeof val === 'string' ? val : JSON.stringify(val, null, 2);
}

function envParse(env) {
    const ghAPIURL = validURL(env.GITHUB_API_URL);
    if (!ghAPIURL) {
        console.error(
            "[FATAL] Environment variable missing or invalid: GITHUB_API_URL",
            `GITHUB_API_URL: ${env.GITHUB_API_URL}`
        );
        process.exit(1);
    }

    const token = env.GITHUB_TOKEN;
    if (!token) {
        console.error("[FATAL] Environment variable not set: GITHUB_TOKEN");
        process.exit(1);
    }

    const slug = env.GITHUB_REPOSITORY;
    if (!slug) {
        console.error("[FATAL] Environment variable not set: GITHUB_REPOSITORY");
        process.exit(1);
    }

    const metadataPath = env.METADATA_PATH  || ".repo-metadata.jsonc";
    const absolutePath = path.isAbsolute(metadataPath) ? metadataPath : path.join(process.cwd(), metadataPath);
    if (!fs.existsSync(absolutePath)) {
        console.log("[INFO] No metadata file found at:", absolutePath);
        process.exit(0);
    }
    const parseErrors = [];
    const metadata = jsoncParser.parse(fs.readFileSync(absolutePath, 'utf8'), parseErrors);
    if (parseErrors.length > 0) {
        console.error(
            `[FATAL] Failed to parse ${absolutePath}:`,
            parseErrors.map(e => `${jsoncParser.printParseErrorCode(e.error)} at offset ${e.offset} (length ${e.length})`).join(', ')
        );
        process.exit(1);
    }

    return {
        ghAPIURL:    ghAPIURL,
        token:       token,
        slug:        slug,
        metadata:    metadata,
        metadataDir: path.dirname(absolutePath),
    };
}

async function metaParse(meta, metadataDir) {
    // Validate JSONSchema URL
    if (!validSchemaPattern.test(meta.$schema)) throw new Error(
        `Failed to validate URL of metadata JSONschema: ${meta.$schema}\n` +
        `Must match: ${validSchemaPattern.source}\n` +
        "e.g. https://raw.githubusercontent.com/chewygumxx/sync-repo-metadata/refs/tags/v2/schema.json\n" +
        "  or https://raw.githubusercontent.com/chewygumxx/sync-repo-metadata/refs/tags/v2.0.0/schema.json"
    );

    // Fetch JSONschema
    const response = await fetch(meta.$schema);
    const text = await response.text();
    let schema;
    try { schema = text ? JSON.parse(text) : null; } catch { schema = text; }
    if (!response.ok) throw new Error([ 
        "Error returned when fetching metadata JSONschema:",
        `.repo-metadata.jsonc -> $schema: ${meta.$schema}`,
        `HTTP GET Response: [${response.status}] ${response.statusText}`,
        fmt(schema)
    ].join('\n'));

    // Validate
    const ajv      = new Ajv();
    addFormats(ajv);
    const validate = ajv.compile(schema);
    if (!validate(meta)) throw new Error([
        `Failed to validate metadata against: ${meta.$schema}`,
        fmt(validate.errors)
    ].join('\n'));
    console.log("[INFO] Validated metadata successfully");

    // Validate referenced license file exists
    if (meta.license && meta.license.filepath) {
        const licensePath = path.resolve(metadataDir, meta.license.filepath);
        if (!fs.statSync(licensePath, { throwIfNoEntry: false })?.isFile()) throw new Error(
            `License file not found: ${licensePath}\n` +
            `.repo-metadata.jsonc -> license.filepath: ${meta.license.filepath}`
        );
    }

    // Parse
    return {
        // PATCH /repos/{owner}/{repo}
        description:                 meta.description,
        homepage:                    meta.homepage,
        visibility:                  meta.visibility,
        archived:                    meta.archived,
        is_template:                 meta.is_template,
        has_issues:                  meta.has_issues,
        has_projects:                meta.has_projects,
        has_wiki:                    meta.has_wiki,
        has_pull_requests:           meta.has_pull_requests,
        allow_forking:               meta.allow_forking,
        allow_squash_merge:          meta.allow_squash_merge,
        allow_merge_commit:          meta.allow_merge_commit,
        allow_rebase_merge:          meta.allow_rebase_merge,
        allow_auto_merge:            meta.allow_auto_merge,
        delete_branch_on_merge:      meta.delete_branch_on_merge,
        allow_update_branch:         meta.allow_update_branch,
        squash_merge_commit_title:   meta.squash_merge_commit_title,
        squash_merge_commit_message: meta.squash_merge_commit_message,
        merge_commit_title:          meta.merge_commit_title,
        merge_commit_message:        meta.merge_commit_message,
        web_commit_signoff_required: meta.web_commit_signoff_required,

        // PUT /repos/{owner}/{repo}/topics
        topics: meta.topics,

        // PUT|DELETE /repos/{owner}/{repo}/immutable-releases
        immutable_releases: meta.immutable_releases
    }
};

async function ghFetch(env, apiPath, method = 'GET', body = null) {
    const headers = {
        'Authorization': `token ${env.token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'chewygumxx/sync-repo-metadata@v2'
    };
    if (body !== null) {
        headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(env.ghAPIURL + apiPath, {
        method,
        headers,
        body: body !== null ? JSON.stringify(body) : undefined
    });

    const text = await response.text();

    let json;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    if (!response.ok) {
        throw new Error([ 
            `Error returned when calling ${env.ghAPIURL}${apiPath}:`,
            `GitHub API: [${response.status}] ${response.statusText}`,
            fmt(json)
        ].join('\n'));
    }

    return json;
}

function log_update(key, val) {
    console.log(`[INFO] Updated repository ${key}:`, val);
}

async function main() {
    const env  =  envParse(process.env);

    let repo;
    try {
        repo = await metaParse(env.metadata, env.metadataDir);
    } catch (err) {
        console.error("[FATAL] Failed to parse metadata:", err.message || err);
        process.exit(1);
    }

    try {
        const { topics, immutable_releases, ...settings } = repo;

        // Update repository settings (PATCH /repos/{owner}/{repo})
        const settingsToApply = Object.entries(settings).filter(([, val]) => val !== undefined);
        if (settingsToApply.length > 0) {
            await ghFetch(env, `/repos/${env.slug}`, 'PATCH', Object.fromEntries(settingsToApply));
            for (const [key, val] of settingsToApply) log_update(key, val);
        }

        // Update topics (PUT /repos/{owner}/{repo}/topics)
        if (topics) {
            await ghFetch(env, `/repos/${env.slug}/topics`, 'PUT', { names: topics });
            log_update("topics", topics.join(', '));
        }

        // Update immutable releases (PUT to enable, DELETE to disable)
        if (immutable_releases !== undefined) {
            await ghFetch(env, `/repos/${env.slug}/immutable-releases`, immutable_releases ? 'PUT' : 'DELETE');
            log_update("immutable_releases", immutable_releases);
        }

        console.log("[NOTICE] Repository metadata update completed successfully.");
    } catch (err) {
        console.error("[FATAL] Failed to apply repository metadata:", err.message || err);
        process.exit(1);
    }
}

main();
