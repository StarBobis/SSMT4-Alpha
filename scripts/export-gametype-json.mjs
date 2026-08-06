import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const gametypeDir = path.join(root, 'src-tauri', 'src', 'gametype');
const constantsDir = path.join(root, 'src-tauri', 'src', 'constants');
const outputRoot = path.join(root, 'src-tauri', 'resources', 'GameType');

const sourceModules = {
  'type_ailimit.rs': ['AILIMIT'],
  'type_apmi.rs': ['APMI'],
  'type_doav.rs': ['DOAV'],
  'type_efmi.rs': ['EFMI'],
  'type_gf2.rs': ['GF2'],
  'type_gimi.rs': ['GIMI'],
  'type_himi.rs': ['HIMI'],
  'type_hok.rs': ['HOK'],
  'type_identityv.rs': ['IdentityV'],
  'type_identityv2.rs': ['IdentityV2'],
  'type_miside.rs': ['MiSide'],
  'type_naraka.rs': ['Naraka'],
  'type_narakam.rs': ['NarakaM'],
  'type_neirr.rs': ['NeirR'],
  'type_nioh2.rs': ['Nioh2'],
  'type_ntemi.rs': ['NTEMI'],
  'type_snowbreak.rs': ['SnowBreak'],
  'type_srmi.rs': ['SRMI'],
  'type_theoutcast.rs': ['TheOutcast'],
  'type_wwmi.rs': ['WuWa', 'WWMI'],
  'type_yysls.rs': ['YYSLS'],
  'type_zzmi.rs': ['ZZMI'],
  'type_zzmidx12.rs': ['ZZMIDX12'],
};

const constantFiles = {
  CategoryName: 'gametype_category_name.rs',
  ElementName: 'gametype_element_name.rs',
  ExtractSlot: 'gametype_extract_slot.rs',
  ExtractTechnique: 'gametype_extract_technique.rs',
  DxgiFormat: 'gametype_format.rs',
};

function stripComments(source) {
  let output = '';
  let inString = false;
  let quote = '';

  for (let i = 0; i < source.length; i += 1) {
    const current = source[i];
    const next = source[i + 1];

    if (inString) {
      output += current;
      if (current === '\\' && next) {
        output += next;
        i += 1;
      } else if (current === quote) {
        inString = false;
      }
      continue;
    }

    if (current === '"' || current === "'") {
      inString = true;
      quote = current;
      output += current;
      continue;
    }

    if (current === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }

    if (current === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }

    output += current;
  }

  return output;
}

function matchingParenBody(source, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, i);
    }
  }
  throw new Error('Unbalanced call at index ' + openIndex);
}

function splitTopLevel(value) {
  const parts = [];
  let current = '';
  let depth = 0;

  for (const char of value) {
    if (char === '(' || char === '[' || char === '{') depth += 1;
    if (char === ')' || char === ']' || char === '}') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function loadConstantValues() {
  const values = {};
  for (const [moduleName, fileName] of Object.entries(constantFiles)) {
    const source = fs.readFileSync(path.join(constantsDir, fileName), 'utf8');
    const pattern = /pub const ([A-Za-z0-9_]+): &'static str = "([^"]*)"/g;
    let match;
    while ((match = pattern.exec(source))) {
      values[moduleName + '::' + match[1]] = match[2];
    }
  }
  return values;
}

function resolveToken(token, constantValues) {
  const value = token.trim();
  if (!value) return '';
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
  if (constantValues[value] != null) return constantValues[value];
  throw new Error('Unresolved Rust token: ' + value);
}

function parseElementCalls(body, constantValues) {
  const needle = 'D3D11Element::new';
  const elements = [];
  let search = 0;

  while (true) {
    const index = body.indexOf(needle, search);
    if (index < 0) break;
    const open = body.indexOf('(', index + needle.length);
    const elementBody = matchingParenBody(body, open);
    const args = splitTopLevel(elementBody).map((token) => resolveToken(token, constantValues));
    if (args.length !== 7) throw new Error('Expected 7 args, got ' + args.length);
    elements.push({
      SemanticName: args[0],
      Format: args[1],
      ExtractSlot: args[2],
      ExtractTechnique: args[3],
      Category: args[4],
      DrawCategory: args[5],
      ByteWidth: args[6],
    });
    search = index + needle.length;
  }

  return elements;
}

function firstString(body) {
  const start = body.indexOf('"');
  if (start < 0) return null;
  const end = body.indexOf('"', start + 1);
  if (end < 0) return null;
  return body.slice(start + 1, end);
}

function parseSourceFile(fileName, constantValues) {
  const source = stripComments(fs.readFileSync(path.join(gametypeDir, fileName), 'utf8'));
  const needle = 'D3D11GameType::from_parts';
  const types = [];
  let search = 0;

  while (true) {
    const index = source.indexOf(needle, search);
    if (index < 0) break;
    const open = source.indexOf('(', index + needle.length);
    const body = matchingParenBody(source, open);
    const name = firstString(body);
    if (!name) throw new Error('Missing game type name in ' + fileName);
    types.push({
      name,
      elements: parseElementCalls(body, constantValues),
    });
    search = index + needle.length;
  }

  return types;
}

function uniqueFileStem(usedStems, desiredStem) {
  if (!usedStems.has(desiredStem)) {
    usedStems.add(desiredStem);
    return desiredStem;
  }
  let suffix = 2;
  let candidate = desiredStem + '_' + suffix;
  while (usedStems.has(candidate)) {
    suffix += 1;
    candidate = desiredStem + '_' + suffix;
  }
  usedStems.add(candidate);
  return candidate;
}
function writeGameTypeFiles(types, outputDirs) {
  const usedStemsByDir = new Map();
  let totalFiles = 0;
  for (const type of types) {
    for (const outputDir of outputDirs) {
      const dir = path.join(outputRoot, outputDir);
      fs.mkdirSync(dir, { recursive: true });
      if (!usedStemsByDir.has(dir)) {
        usedStemsByDir.set(dir, new Set());
      }
      const usedStems = usedStemsByDir.get(dir);
      const fileStem = uniqueFileStem(usedStems, type.name);
      const payload =
        fileStem === type.name
          ? { D3D11ElementList: type.elements }
          : { GameTypeName: type.name, D3D11ElementList: type.elements };
      fs.writeFileSync(
        path.join(dir, fileStem + '.json'),
        JSON.stringify(payload, null, 2) + '\n',
        'utf8',
      );
      totalFiles += 1;
    }
  }
  return totalFiles;
}
function main() {
  // export all D3D11GameType entries from the Rust source registry
  const constantValues = loadConstantValues();
  const summary = {};
  const duplicates = {};
  let totalFiles = 0;
  let totalTypes = 0;

  for (const [fileName, outputDirs] of Object.entries(sourceModules)) {
    const types = parseSourceFile(fileName, constantValues);
    summary[fileName] = types.length;
    totalTypes += types.length;
    totalFiles += writeGameTypeFiles(types, outputDirs);

    const nameCounts = new Map();
    for (const type of types) {
      nameCounts.set(type.name, (nameCounts.get(type.name) || 0) + 1);
    }
    for (const [name, count] of nameCounts) {
      if (count > 1) {
        if (!duplicates[fileName]) duplicates[fileName] = [];
        duplicates[fileName].push({ name, count });
      }
    }
  }

  console.log('total_types=' + totalTypes);
  console.log('total_files=' + totalFiles);
  console.log(JSON.stringify(summary, null, 2));
  console.log('duplicates=' + JSON.stringify(duplicates));
}

main();
