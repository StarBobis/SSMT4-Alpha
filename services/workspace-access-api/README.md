# SSMT Workspace Access API

This directory is the Cloudflare Worker control plane. It publishes metadata to GitHub and issues short-lived R2 URLs; it never proxies workspace archives or exposes R2/GitHub credentials to SSMT clients.

Before publishing a complete package, the Worker range-reads the stored `manifest.json` and ZIP central directory, then streams the R2 object through an incremental SHA-256 check. It rejects a missing v1 Manifest, unsafe central-directory paths, mismatched file summary, compression bombs, or content hash mismatch.

## Development isolation

`wrangler.toml` is deliberately development-only:

- use a dedicated development D1 database and R2 bucket;
- copy `.dev.vars.example` to `.dev.vars` for local secrets;
- do not put `.dev.vars`, PEM files, access keys, or production bucket names in Git;
- production configuration must live in a separate Wrangler environment/configuration with separately named D1 and R2 resources.

`wrangler.prod.toml.example` is a non-secret production template and must be reviewed before use.

Only inspect the variable names in `github_app.env` and `cloudflare_r2.env`; do not copy their values into source files or client configuration.

## Local checks

```powershell
cd services/workspace-access-api
npm test
npx wrangler d1 migrations apply ssmt-workspace-api-dev --local
npx wrangler dev --local
# Or, with no Worker already listening on port 8787, run the self-contained smoke check:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-local.ps1
```

The `--local` commands are the default validation path. Do not run `wrangler deploy`, remote D1 migrations, or publish changes to the public metadata repository without explicit approval.

## Public metadata repository

The GitHub repository uses this layout:

```text
schema/v1/
games/<GamePreset>/entries/<EntryId>/{metadata.json,status.json}
index/v1/{all.json,<GamePreset>.json}
scripts/{validate-entries.mjs,build-index.mjs}
```

Copy `schema/v1`, `scripts`, and `.github/workflows/validate-and-index.yml` from this service into the public metadata repository before enabling publishing. The workflow validates entry identities, regenerates indexes from `games/`, and opens a deduplicated review Issue for complete packages larger than 200 MiB; indexes are derived data and must never be accepted from upload clients.

## Failure recovery

- A failed GitHub publish after R2 completion remains `ready_to_publish`; call completion again with the same submission ID to retry publishing without a new Entry.
- Cancelling an `awaiting_upload`, `publishing`, or `ready_to_publish` submission releases its quota reservation. R2 multipart cancellation is attempted for active uploads, and a completed unpublished object is deleted before cancellation is acknowledged.
- Validate multipart URLs against the development R2 bucket before any production configuration. The SigV4 implementation is covered by syntax/unit tests, but requires a real dev-bucket multipart smoke test.
- The hourly Cron cancels stale multipart submissions after `UPLOAD_TTL_HOURS`. It also removes Entries only when their public `status.json` is `expired` and `deleteAfter` has passed; an R2 object is deleted only when no remaining metadata document references its object key.
