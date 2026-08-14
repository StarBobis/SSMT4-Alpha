# Deployment and Recovery Runbook

This runbook is intentionally command-oriented. It never requires putting a secret in `wrangler.toml`, the SSMT client, or the public metadata repository.

## Environments

Development uses `wrangler.toml`, D1 `ssmt-workspace-api-dev`, and R2 `ssmt-workspace-access-library-dev`. Production uses a separately reviewed copy of `wrangler.prod.toml.example` with a different D1 ID and R2 bucket. Never use `--remote` with the development configuration.

Required Worker secrets in both environments:

```text
RATE_LIMIT_SECRET
GITHUB_APP_ID
GITHUB_INSTALLATION_ID
GITHUB_APP_PRIVATE_KEY
R2_ENDPOINT
R2_BUCKET_NAME
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

Set them with Wrangler's secret store, using values supplied through the operator's secret manager. Do not pass PEM or access-key values as command-line arguments where shell history can retain them.

## First local run

```powershell
cd services/workspace-access-api
Copy-Item .dev.vars.example .dev.vars
# Replace placeholders in .dev.vars locally; never commit it.
npx wrangler d1 migrations apply ssmt-workspace-api-dev --local --config wrangler.toml
npx wrangler dev --local --config wrangler.toml
```

The local command must not include `--remote`. The scheduled handler can be exercised locally with Wrangler's local scheduled-event endpoint after the Worker is running; it must use only local D1/R2 bindings.

## Production order

1. Create production D1 and R2 resources with names distinct from development.
2. Review `wrangler.prod.toml.example`, replace only resource IDs/names, and keep the populated file outside Git.
3. Apply D1 migrations to production after a database backup/restore point is available.
4. Set the eight secrets through Wrangler's secret store.
5. Run a metadata-only request against the production URL and verify the GitHub commit appears at a new immutable Entry path.
6. Run one small complete-package multipart smoke test and verify the object is private before publication, central-directory validation succeeds, and it is downloadable only after publication.
7. Deploy the Worker and verify the scheduled trigger configuration.

Do not deploy until the public repository contains the reviewed contents of `public-library-template` and its Action has produced `index/v1/all.json`.

## Failure recovery

- Metadata-only GitHub failure: the Worker marks the submission `failed` and releases the daily reservation. Retry with a new idempotency key.
- R2 multipart interruption: reuse the `.ssmtws.upload-state.json` file. It contains no presigned URLs; missing parts receive fresh URLs. A stale upload is reclaimed by the hourly Cron.
- R2 completed but GitHub publish failed: the submission remains `ready_to_publish`; retry completion with the same submission ID. The Worker does not complete the multipart upload again, and revalidates the complete R2 object by streaming an incremental SHA-256 before publication. Do not initialize a second Entry for the same archive.
- User cancellation: call the client cancellation command for the archive. The Worker aborts the active multipart upload and releases the reservation.
- GitHub commit conflict: the publisher retries against the latest `main` ref. Persistent failure requires operator inspection, not force-push.
- Expired Entry cleanup failure: the Cron logs a stable error and leaves the current branch/object state for the next run; never delete an R2 object based only on a local timer.

## Rollback

Rollback means deploying the previous Worker version and restoring the previous D1 schema-compatible code. Do not roll back by rewriting Git history or force-pushing `main`. Public metadata commits are immutable history; correct a published Entry with a new Entry or an administrator-managed `status.json` change.
