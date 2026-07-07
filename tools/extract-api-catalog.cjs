/* Static analysis only: never loads or executes the original application. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const source = path.resolve(root, process.argv[2] || 'original/package.nw');
const output = path.join(root, 'docs/api/catalog.json');
function findParser() {
  if (process.env.TYPESCRIPT_PATH) return process.env.TYPESCRIPT_PATH;
  try { return require.resolve('typescript'); } catch {}
  const locations = [process.env.LOCALAPPDATA, path.join(require('node:os').homedir(), 'AppData/Local')].filter(Boolean);
  for (const location of locations) {
    const code = path.join(location, 'Programs/Microsoft VS Code');
    if (!fs.existsSync(code)) continue;
    for (const directory of ['', ...fs.readdirSync(code).sort().reverse()]) {
      const candidate = path.join(code, directory, 'resources/app/extensions/node_modules/typescript/lib/typescript.js');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw Error('Set TYPESCRIPT_PATH to typescript/lib/typescript.js (the VS Code copy is supported).');
}
const ts = require(findParser());
const hash = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const relative = p => path.relative(source, p).split(path.sep).join('/');
const apiName = /^SYNO\.(?:NoteStation\.|API\.|Entry\.|Core\.)/;
function allFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name, 'en')).flatMap(entry => {
    if (entry.name === 'scripts.modified') return [];
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? allFiles(filename) : [filename];
  });
}
function value(node) {
  if (!node) return undefined;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(node)) {
    const v = value(node.operand);
    if (v !== undefined && node.operator === ts.SyntaxKind.ExclamationToken) return !v;
    if (typeof v === 'number' && node.operator === ts.SyntaxKind.MinusToken) return -v;
  }
  if (ts.isArrayLiteralExpression(node)) {
    const result = node.elements.map(value);
    if (result.every(v => v !== undefined)) return result;
  }
  return undefined;
}
function alternatives(node) {
  const v = value(node);
  if (v !== undefined) return [v];
  if (node && ts.isConditionalExpression(node)) return [...new Set([...alternatives(node.whenTrue), ...alternatives(node.whenFalse)])];
  if (node && ts.isBinaryExpression(node) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) return [...new Set([...alternatives(node.left), ...alternatives(node.right)])];
  return [];
}
function name(node) {
  if (!node) return undefined;
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
}
function props(node) {
  const result = new Map();
  if (node && ts.isObjectLiteralExpression(node)) {
    for (const p of node.properties) if (ts.isPropertyAssignment(p)) result.set(name(p.name), p.initializer);
  }
  return result;
}
function scope(node) {
  for (let p = node.parent; p; p = p.parent) if (ts.isFunctionLike(p) || ts.isSourceFile(p)) return p;
}
function resolveIdentifier(node, seen) {
  if (!node || !ts.isIdentifier(node) || seen.has(node.text)) return node;
  const owner = scope(node);
  let binding;
  function visit(p) {
    if (p !== owner && ts.isFunctionLike(p)) return;
    if (p.getStart() >= node.getStart()) return;
    if (ts.isVariableDeclaration(p) && name(p.name) === node.text && p.initializer) binding = p.initializer;
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(p.left) && p.left.text === node.text) binding = p.right;
    ts.forEachChild(p, visit);
  }
  if (owner) visit(owner);
  return binding || node;
}
function fields(node, seen = new Set(), depth = 0) {
  if (!node || depth > 8) return { fields: {}, unresolved: true };
  const resolved = resolveIdentifier(node, seen);
  if (resolved !== node) {
    const next = new Set(seen); next.add(node.text);
    const result = fields(resolved, next, depth + 1);
    // Include conditionally assigned request keys before this use. Values remain unknown.
    const owner = scope(node);
    function visit(p) {
      if (p !== owner && ts.isFunctionLike(p)) return;
      if (p.getStart() >= node.getStart()) return;
      if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(p.left) && ts.isIdentifier(p.left.expression) && p.left.expression.text === node.text) {
        result.fields[p.left.name.text] = { type: 'dynamic', conditional: true };
      }
      ts.forEachChild(p, visit);
    }
    if (owner) visit(owner);
    return result;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const result = { fields: {}, unresolved: false };
    for (const property of node.properties) {
      if (ts.isSpreadAssignment(property)) { result.unresolved = true; continue; }
      const key = name(property.name);
      if (!key || (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property))) { result.unresolved = true; continue; }
      const v = ts.isPropertyAssignment(property) ? property.initializer : property.name;
      const literal = value(v);
      const description = { type: literal === undefined ? 'dynamic' : Array.isArray(literal) ? 'array' : literal === null ? 'null' : typeof literal };
      if (literal !== undefined) description.literal = literal;
      if (ts.isObjectLiteralExpression(v)) { description.type = 'object'; description.shape = fields(v, seen, depth + 1); }
      if (ts.isArrayLiteralExpression(v)) description.type = 'array';
      result.fields[key] = description;
    }
    return result;
  }
  if (ts.isCallExpression(node)) {
    const callee = node.expression.getText();
    if (['Ext.copyTo','Ext.apply','Ext.applyIf'].includes(callee)) {
      const result = fields(node.arguments[0], seen, depth + 1);
      if (callee === 'Ext.copyTo') {
        const keys = value(node.arguments[2]);
        if (typeof keys === 'string') for (const key of keys.split(',').map(s => s.trim()).filter(Boolean)) {
          if (!(key in result.fields)) result.fields[key] = { type: 'dynamic', copied: true };
        }
        else result.unresolved = true;
      } else {
        for (const argument of node.arguments.slice(1)) {
          const more = fields(argument, seen, depth + 1);
          for (const [key, description] of Object.entries(more.fields)) {
            // Merge only observed keys; do not guess runtime precedence or requiredness.
            if (!(key in result.fields)) result.fields[key] = description;
          }
          result.unresolved ||= more.unresolved;
        }
      }
      return result;
    }
  }
  return { fields: {}, unresolved: true };
}
function context(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isPropertyAssignment(p) && p.initializer && ts.isFunctionLike(p.initializer)) return name(p.name) || 'anonymous';
    if (ts.isCallExpression(p) && p.expression.getText() === 'Ext.define') return value(p.arguments[0]) || 'Ext.define';
    if (ts.isFunctionDeclaration(p) && p.name) return p.name.text;
  }
  return 'module';
}
function location(node, filename, sf) {
  const offset = node.getStart(sf);
  const position = sf.getLineAndCharacterOfPosition(offset);
  return { file: relative(filename), line: position.line + 1, column: position.character + 1, offset_utf16: offset, context: context(node) };
}
const manifestBuffer = fs.readFileSync(path.join(source, 'manifest.json'));
const manifest = JSON.parse(manifestBuffer);
const sources = [{ file: 'manifest.json', bytes: manifestBuffer.length, sha256: hash(manifestBuffer), parse_errors: [] }];
const calls = [], dynamic = [], errorMappings = [], references = new Map(), urls = new Map();
let scannedJs = 0;
for (const filename of allFiles(source)) {
  if (!filename.endsWith('.js')) continue;
  scannedJs++;
  const buffer = fs.readFileSync(filename), text = buffer.toString('utf8');
  if (!/["']SYNO\.(?:NoteStation\.|API\.(?:Auth|Info|Encryption)|Entry\.|Core\.)/.test(text)) continue;
  const sf = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  sources.push({ file: relative(filename), bytes: buffer.length, sha256: hash(buffer), parse_errors: sf.parseDiagnostics.map(d => ({ code:d.code, offset_utf16:d.start, message:ts.flattenDiagnosticMessageText(d.messageText,' ') })) });
  function visit(node) {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && node.left.getText(sf) === 'SYNO.SDS.NoteStation.ErrorString' && ts.isObjectLiteralExpression(node.right)) {
      for (const property of node.right.properties) {
        if (!ts.isPropertyAssignment(property) || !/^\d+$/.test(name(property.name) || '')) continue;
        const expression = property.initializer;
        const mapping = { code:Number(name(property.name)), source:location(property,filename,sf) };
        if (ts.isCallExpression(expression)) mapping.localization_keys = expression.arguments.map(value);
        else mapping.literal = value(expression);
        errorMappings.push(mapping);
      }
    }
    if (ts.isStringLiteralLike(node)) {
      if (apiName.test(node.text) && /^[A-Za-z0-9_.]+$/.test(node.text)) {
        const list = references.get(node.text) || []; list.push(location(node,filename,sf)); references.set(node.text,list);
      }
      if (/\/(?:webapi|webman)\//.test(node.text) && node.text.length < 180 && !/[<>\n]/.test(node.text)) {
        const list = urls.get(node.text) || []; list.push(location(node,filename,sf)); urls.set(node.text,list);
      }
    }
    if (ts.isObjectLiteralExpression(node)) {
      const properties = props(node), apiNode = properties.get('api');
      if (apiNode && properties.has('method')) {
        const api = value(apiNode), method = properties.get('method');
        const parameterNode = properties.get('params') || properties.get('baseParams');
        // Some raw Ext.Ajax request objects flatten API routing and parameters.
        let parameters = parameterNode ? fields(parameterNode) : fields(node);
        let layout = properties.has('params') ? 'params' : properties.has('baseParams') ? 'baseParams' : 'flat';
        if (properties.has('extend') || properties.has('action')) {
          layout = 'offline_action_declaration'; parameters = { fields:{}, unresolved:true };
        } else if (properties.has('uploadData') || value(properties.get('html5upload')) === true) {
          layout = 'multipart'; parameters.unresolved = true;
        } else if (!parameterNode && ['appWindow','listeners','reader','xtype','success','failure'].some(k => properties.has(k))) {
          layout = 'ui_configuration'; parameters = { fields:{}, unresolved:true };
        }
        if (!parameterNode) {
          for (const key of ['api','method','version','callback','scope','cgi','url','timeout','async','encryption','isUpload','html5upload','uploadData','form','progress','baseParams']) delete parameters.fields[key];
        }
        const record = {
          api: typeof api === 'string' ? api : null,
          methods: alternatives(method).filter(v => typeof v === 'string'),
          versions: alternatives(properties.get('version')).filter(v => typeof v === 'number'),
          method_is_dynamic: value(method) === undefined,
          parameters,
          parameter_layout: layout,
          source: location(node, filename, sf)
        };
        if (typeof api === 'string' && apiName.test(api)) calls.push(record);
        else if (api === undefined) dynamic.push(record);
      }
    }
    if (ts.isCallExpression(node) && /^synowebapi(?:\.promises)?\.auth$/.test(node.expression.getText()) && node.arguments.length) {
      const argument = resolveIdentifier(node.arguments[0], new Set());
      const properties = props(argument), method = properties.get('method');
      const parameters = fields(node.arguments[0]);
      for (const key of ['api','method','version']) delete parameters.fields[key];
      const record = { api:'SYNO.API.Auth', methods:alternatives(method).filter(v => typeof v === 'string'), versions:alternatives(properties.get('version')).filter(v => typeof v === 'number'), method_is_dynamic:value(method) === undefined, parameters, parameter_layout:'auth_helper', source:location(node,filename,sf) };
      calls.push(record);
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
}
const namespaces = [...references.entries()].sort(([a],[b]) => a.localeCompare(b,'en')).map(([api, evidence]) => ({
  api, evidence, calls: calls.filter(c => c.api === api),
  note: calls.some(c => c.api === api) ? 'Static request/declaration observed; not a server contract.' : 'String reference only; may be an SDK symbol rather than a remote API.'
}));
const catalog = {
  schema_version: 1,
  client: { name:manifest.name, version:manifest.version, build_year:manifest.buildYear },
  scope: 'Static observations from the supplied client, not all APIs provided by a NAS.',
  source_root: 'original/package.nw',
  excluded: ['scripts.modified/', 'all profiles, logs, and files outside package.nw'],
  extractor: { parser:'TypeScript', parser_version:ts.version, scanned_js_files:scannedJs, parsed_js_files:sources.length - 1 },
  sources,
  stats: { namespaces:namespaces.length, request_declarations:calls.length, unresolved_api_declarations:dynamic.length },
  namespaces,
  client_error_mappings: errorMappings,
  unresolved_api_declarations: dynamic,
  endpoint_literals: [...urls.entries()].sort(([a],[b]) => a.localeCompare(b,'en')).map(([text,evidence]) => ({text,evidence}))
};
if (sources.some(s => s.parse_errors.length)) throw Error('Parse errors found; refusing to publish an incomplete catalog.');
fs.mkdirSync(path.dirname(output), { recursive:true });
fs.writeFileSync(output, JSON.stringify(catalog, null, 2) + '\n');
console.log(JSON.stringify({ client:catalog.client, extractor:catalog.extractor, stats:catalog.stats, output:path.relative(root,output) },null,2));
