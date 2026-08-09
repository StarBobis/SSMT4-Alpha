# GameType

This folder is the **single source of truth** for D3D11GameType definitions.
The hardcoded Rust registries (`src-tauri/src/gametype/type_*.rs`) have been removed.

## Runtime location

At runtime SSMT reads data types from the user config folder:

    %LOCALAPPDATA%\SSMT4GlobalConfigs\GameType

This is the same parent folder used by `Games`.

On every app start, the bundled copy shipped inside the installer
(`resources/GameType` next to the exe, which maps to this folder in the repo)
is synced into the user config folder:

- Files shipped with the new version **overwrite** same-named files, so users
  never keep old data types after installing an update.
- Extra JSON files a user added that are not in the bundle are **preserved**.

## Adding a type

1. Put one JSON file per type under `src-tauri/resources/GameType/<game>/`
   so the next build/install ships it.
2. Restart the app (or run `bun tauri dev` once) so the sync copies it into
   the user config folder.

Each subfolder is one game preset. Each .json file inside is one D3D11GameType.

File format:

{
  "D3D11ElementList": [
    {
      "SemanticName": "POSITION",
      "Format": "R32G32B32_FLOAT",
      "ExtractSlot": "vb0",
      "ExtractTechnique": "trianglelist",
      "Category": "Position",
      "DrawCategory": "Position",
      "ByteWidth": "12"
    }
  ]
}

Element fields:

- SemanticName
- Format
- ExtractSlot
- ExtractTechnique
- Category
- DrawCategory
- ByteWidth (optional; computed from Format when missing)

The file stem is used as GameTypeName unless GameTypeName is present in the JSON. Use a _2 suffix for same-name variants and set GameTypeName to the real name.

To add a new game: create a new folder under this directory and add JSON files.
The runtime scans folders by case-insensitive game name, so no Rust registry
change is required. IDENTITYV intentionally maps to the `IdentityV` folder.
