# SSMT Workspace Access Library v1

This is a local, reviewable template for the public metadata repository. It is intentionally separate from the Worker source and contains no entries or credentials.

Before synchronizing it to `Perxenic-Acid/SSMT-WorkSpace_Access-Library`:

1. Review the v1 schemas and paths.
2. Add the first validated `games/<GamePreset>/entries/<EntryId>/metadata.json` and `status.json` fixtures.
3. Run `node scripts/validate-entries.mjs .` and `node scripts/build-index.mjs .` from this directory.
4. Ask for explicit approval before committing or pushing to the public repository.

The `games/` and `index/v1/` directories are created by the index builder when entries are present.
