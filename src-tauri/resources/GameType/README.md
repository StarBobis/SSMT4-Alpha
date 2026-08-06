# GameType

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

To add a new game: create a new folder under this directory and add JSON files. The runtime scans folders by case-insensitive game name, so no Rust registry change is required.
