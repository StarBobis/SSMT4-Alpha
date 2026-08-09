---
name: zzmi-gametype-analysis
description: Check whether every IB buffer in a ZZZ 3Dmigoto FrameAnalysis folder can be parsed by the project's existing ZZMI data types (GameType JSON), identify which IB hashes are not parseable, derive their required vertex-buffer data type, and add the missing data type files following the project's conventions. Use when asked to verify IB parseability against ZZMI data types, find unsupported IB layouts in a FrameAnalysis extraction folder, add ZZMI GameType JSON files, or audit/update ZZMI data type coverage after new frame captures.
---

# ZZMI GameType Analysis

## Workflow

1. **Inventory the extraction folder** (K:/SSMT-Package-master/3Dmigoto/ZZZ/FrameAnalysis-<timestamp>):
   - IB txt files match NNNNNN-ib=<8-hex>-vs=<16-hex>-ps=<16-hex>.txt.
   - Top-level .buf/.txt entries are 0-byte shortcuts; real content lives in deduped/ and is resolved through the log.txt mapping.
   - Deduplicate by the 8-hex IB hash: parse topology and format (all files are DXGI_FORMAT_R16_UINT in practice).

2. **Run the checker script** from the project root:

        python <skill>/scripts/zzmi_ib_check.py "K:/SSMT-Package-master/3Dmigoto/ZZZ/FrameAnalysis-<timestamp>" --json report.json

   The script replicates get_possible_gametype_list_unity_vs (see [PROJECT-CONVENTIONS.md](references/PROJECT-CONVENTIONS.md)) and reports for each unique IB hash: pointlist index, trianglelist index list, and matched GameType names.

3. **Interpret results**:
   - Every IB hash has at least one matched type -> all IBs are parseable; no changes needed.
   - Any IB hash shows matched=[] -> that IB layout is unsupported. Investigate by opening the paired NNNNNN-vbN=... txt headers of its trianglelist/pointlist draws (element semantic/format/InputSlot/stride) and derive the required data type.

4. **Add missing data types** (one file per data type, project convention):
   - Create src-tauri/resources/GameType/ZZMI/<TYPE_NAME>.json containing only the D3D11ElementList (see references/PROJECT-CONVENTIONS.md for the format). The Rust registry was removed; JSON is the single source of truth.
   - Type name encodes the layout, e.g. GPU_P12_N12_TA16_C16_T8_T1-8_T2-8_T3-8_BW16_BI16_ (see the references file for the naming table). Use GameTypeName + a _2 file suffix for same-name variants.

5. **Verify**:
   - Re-run step 2; every IB hash must now match, and previously matched hashes must keep the same matches (no regressions).
   - Restart the app (or run `bun tauri dev`) so the bundle GameType is synced into `%LOCALAPPDATA%\SSMT4GlobalConfigs\GameType`.

## Pitfalls

- Always resolve frame filenames through the log.txt "Dumping Buffer ... -> deduped\..." map; top-level files are zero-byte symlinks.
- GPU types use the pointlist-index buffer for Position/Texcoord when a pointlist index exists; the pointlist index is derived from the log (IASetVertexBuffers slot 0 hash, last matching draw before the first trianglelist index).
- CPU types compute file size from the txt stride x vertex count; GPU types use the buf file size.
- A type may legitimately match multiple IB hashes, and one IB hash may match several GPU types (the extractor keeps all of them).
- At runtime the app reads from the user config GameType folder; the bundled JSON is synced there on every start (same-name files are overwritten, user-only files are preserved).

## Resources

- scripts/zzmi_ib_check.py - the match checker (Python 3, stdlib only).
- references/PROJECT-CONVENTIONS.md - type-name encoding, JSON format, matching algorithm details, and add-type checklist.
