import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { CodeType, FileInfo } from './FileInfo';

// Canonical custom code paths (project-root-relative, POSIX).
export const kActionsBarrelPath = 'lib/custom_code/actions/index.dart';
export const kWidgetsBarrelPath = 'lib/custom_code/widgets/index.dart';
export const kCustomFunctionsPath = 'lib/flutter_flow/custom_functions.dart';

export type ManifestEntry = {
    type: CodeType;
    identifierName: string;
};

// Keyed by project-root-relative POSIX path (e.g. 'lib/custom_code/actions/do_this.dart').
export type CustomCodeManifest = Map<string, ManifestEntry>;

export type ExportDirective = {
    uri: string;
    shownNames: string[];
};

export function toPosixPath(filePath: string): string {
    return filePath.split(path.sep).join(path.posix.sep);
}

export function fullPathFromKey(rootPath: string, relativeKey: string): string {
    return path.join(rootPath, ...relativeKey.split(path.posix.sep));
}

// Computes the SHA-256 checksum of a file as a hex string.
export function computeChecksum(filePath: string): string {
    const fileContent = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(fileContent).digest('hex');
}

// Converts a string to camel case. E.g. "hello_world" -> "helloWorld"
export function toCamelCase(str: string): string {
    return str.replace(/[-_](.)/g, (_, c) => c.toUpperCase());
}

// Converts a string to pascal case. E.g. "hello_world" -> "HelloWorld"
export function toPascalCase(str: string): string {
    return str
        .split('_')
        .map((word) =>
            word
                .replace(/(?:^\w|[A-Z]|\b\w)/g, (letter) => letter.toUpperCase())
                .replace(/[^a-zA-Z0-9]+/g, '')
        )
        .join('');
}

function stripComments(dartCode: string): string {
    return dartCode.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

export function parseExportDirectives(dartCode: string): ExportDirective[] {
    const exportPattern = /export\s+['"]([^'"]+)['"]\s*(?:show\s+([\w$][\w$\s,]*?))?\s*;/g;
    const directives: ExportDirective[] = [];
    for (const match of stripComments(dartCode).matchAll(exportPattern)) {
        directives.push({
            uri: match[1],
            shownNames: match[2]
                ? match[2].split(',').map((name) => name.trim()).filter((name) => name.length > 0)
                : [],
        });
    }
    return directives;
}

// Resolves an export URI to a project-root-relative POSIX path. A leading '/' means
// lib-relative (e.g. '/custom_code/actions/do_this.dart' -> 'lib/custom_code/actions/do_this.dart');
// otherwise the URI is relative to the barrel file's directory.
export function resolveExportTarget(exportUri: string, barrelRelativePath: string): string {
    if (exportUri.startsWith('/')) {
        return path.posix.join('lib', exportUri.slice(1));
    }
    return path.posix.normalize(path.posix.join(path.posix.dirname(barrelRelativePath), exportUri));
}

// Resolved export targets are tracked, overwritten, and deleted on pull, so any
// target escaping lib/ (via '..' segments) must be rejected. Both branches of
// resolveExportTarget normalize, so escaping paths no longer start with 'lib/'.
export function isExportTargetWithinLib(target: string): boolean {
    return target.startsWith('lib/');
}

// A folder-organized custom_functions.dart is a pure export shim: nothing but
// export directives, comments, and whitespace. Legacy files always contain imports
// and (possibly) function declarations.
export function isFolderOrganizedFunctionsFile(dartCode: string): boolean {
    const stripped = stripComments(dartCode).trim();
    if (stripped.length === 0) {
        return true;
    }
    const statements = stripped.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
    return statements.every((s) => /^export\s+['"][^'"]+['"](\s+show\s+[\w$][\w$\s,]*)?$/.test(s));
}

export function isFolderOrganizedProject(projectRoot: string): boolean {
    const functionsPath = fullPathFromKey(projectRoot, kCustomFunctionsPath);
    if (!fs.existsSync(functionsPath)) {
        return false;
    }
    return isFolderOrganizedFunctionsFile(fs.readFileSync(functionsPath, 'utf8'));
}

// Parses the name of the custom function declared in a Dart file. Files may also
// contain private helpers, so prefer `preferredName` (the name implied by the file's
// basename) when declared, then the first non-private top-level function.
export function parseTopLevelFunctionName(dartCode: string, preferredName?: string): string | null {
    const skipKeywords = /^(import|export|part|library|class|enum|extension|typedef|mixin|abstract|const|final|var|late)\b/;
    const declaredNames: string[] = [];
    for (const line of stripComments(dartCode).split('\n')) {
        if (!/^[A-Za-z_$]/.test(line) || skipKeywords.test(line)) {
            continue;
        }
        const match = line.match(/^[\w$<>,?\s[\]]+?\s([a-zA-Z_$][\w$]*)\s*\(/);
        if (match) {
            declaredNames.push(match[1]);
        }
    }
    if (preferredName && declaredNames.includes(preferredName)) {
        return preferredName;
    }
    return declaredNames.find((name) => !name.startsWith('_')) ?? null;
}

function functionIdentifierName(projectRoot: string, targetRelativePath: string, shownNames: string[]): string {
    const impliedName = toCamelCase(path.posix.basename(targetRelativePath, '.dart'));
    if (shownNames.length > 0) {
        return shownNames[0];
    }
    const targetPath = fullPathFromKey(projectRoot, targetRelativePath);
    if (fs.existsSync(targetPath)) {
        const declaredName = parseTopLevelFunctionName(fs.readFileSync(targetPath, 'utf8'), impliedName);
        if (declaredName) {
            return declaredName;
        }
    }
    return impliedName;
}

function addBarrelEntries(
    manifest: CustomCodeManifest,
    projectRoot: string,
    barrelRelativePath: string,
    type: CodeType
) {
    const barrelPath = fullPathFromKey(projectRoot, barrelRelativePath);
    if (!fs.existsSync(barrelPath)) {
        return;
    }
    for (const directive of parseExportDirectives(fs.readFileSync(barrelPath, 'utf8'))) {
        if (directive.uri.includes(':')) {
            continue;
        }
        const target = resolveExportTarget(directive.uri, barrelRelativePath);
        if (!isExportTargetWithinLib(target)) {
            console.error('Ignoring barrel export that escapes lib/:', directive.uri);
            continue;
        }
        const fallbackName = type === CodeType.WIDGET
            ? toPascalCase(path.posix.basename(target, '.dart'))
            : toCamelCase(path.posix.basename(target, '.dart'));
        manifest.set(target, {
            type,
            identifierName: directive.shownNames[0] ?? fallbackName,
        });
    }
}

// Standalone custom code files are generated flat under lib/custom_code/ (never in a
// user-facing subfolder), so the directory is scanned non-recursively. Their identifier
// name is the basename including the .dart extension, matching the server's
// FFCustomCodeFile.identifier.name.
function addCustomCodeFileEntries(manifest: CustomCodeManifest, projectRoot: string) {
    const customCodeDir = fullPathFromKey(projectRoot, kCustomCodeDir);
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(customCodeDir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.dart') || entry.name === 'index.dart') {
            continue;
        }
        manifest.set(path.posix.join(kCustomCodeDir, entry.name), {
            type: CodeType.CODE_FILE,
            identifierName: entry.name,
        });
    }
}

// Builds a manifest of all custom code files by parsing the three barrel files.
// In folder-organized mode each custom function gets its own entry; in legacy mode
// the monolithic custom_functions.dart is the single function entry.
export function buildCustomCodeManifest(projectRoot: string): CustomCodeManifest {
    const manifest: CustomCodeManifest = new Map();
    addBarrelEntries(manifest, projectRoot, kActionsBarrelPath, CodeType.ACTION);
    addBarrelEntries(manifest, projectRoot, kWidgetsBarrelPath, CodeType.WIDGET);
    addCustomCodeFileEntries(manifest, projectRoot);

    const functionsPath = fullPathFromKey(projectRoot, kCustomFunctionsPath);
    if (!fs.existsSync(functionsPath)) {
        return manifest;
    }
    const functionsCode = fs.readFileSync(functionsPath, 'utf8');
    if (isFolderOrganizedFunctionsFile(functionsCode)) {
        for (const directive of parseExportDirectives(functionsCode)) {
            if (directive.uri.includes(':')) {
                continue;
            }
            const target = resolveExportTarget(directive.uri, kCustomFunctionsPath);
            if (!isExportTargetWithinLib(target)) {
                console.error('Ignoring barrel export that escapes lib/:', directive.uri);
                continue;
            }
            manifest.set(target, {
                type: CodeType.FUNCTION,
                identifierName: functionIdentifierName(projectRoot, target, directive.shownNames),
            });
        }
    } else {
        manifest.set(kCustomFunctionsPath, { type: CodeType.FUNCTION, identifierName: 'CustomFunctions' });
    }
    return manifest;
}

// Classifies a project-root-relative POSIX path: manifest lookup first, then the
// legacy heuristics for paths under lib/custom_code/ so brand-new files created in
// the canonical folders still classify. Files elsewhere cannot be safely classified.
export function classifyRelativePath(
    relativePath: string,
    manifest: CustomCodeManifest,
    folderOrganized: boolean
): CodeType {
    const entry = manifest.get(relativePath);
    if (entry) {
        return entry.type;
    }
    if (relativePath === 'pubspec.yaml') {
        return CodeType.DEPENDENCIES;
    }
    if (!relativePath.endsWith('.dart') || path.posix.basename(relativePath) === 'index.dart') {
        return CodeType.OTHER;
    }
    if (!folderOrganized && relativePath === kCustomFunctionsPath) {
        return CodeType.FUNCTION;
    }
    if (relativePath.startsWith('lib/custom_code/actions/')) {
        return CodeType.ACTION;
    }
    if (relativePath.startsWith('lib/custom_code/widgets/')) {
        return CodeType.WIDGET;
    }
    if (folderOrganized && relativePath.startsWith('lib/custom_code/functions/')) {
        return CodeType.FUNCTION;
    }
    // A standalone custom code file lives directly under lib/custom_code/ (no further
    // subdirectory). Deeper paths are handled by the actions/widgets/functions checks above.
    if (isCustomCodeFilePath(relativePath)) {
        return CodeType.CODE_FILE;
    }
    return CodeType.OTHER;
}

const kCustomCodeDir = 'lib/custom_code/';

// True iff the path is exactly lib/custom_code/<name>.dart (flat, not in a subfolder,
// and not the index.dart barrel). Callers must already have ruled out the
// actions/widgets/functions subdirectories.
function isCustomCodeFilePath(relativePath: string): boolean {
    if (!relativePath.startsWith(kCustomCodeDir) || !relativePath.endsWith('.dart')) {
        return false;
    }
    const remainder = relativePath.slice(kCustomCodeDir.length);
    return !remainder.includes('/') && remainder !== 'index.dart';
}

/**
 * Fixes up file maps written by older extension versions: entries migrated from
 * basename keys may point at the canonical folders while the file actually lives in a
 * user folder, folder-organized projects must not track the monolithic functions file,
 * and manifest entries the old map never knew about (e.g. per-file functions) must be
 * backfilled so edits to them are tracked.
 */
export function reconcileFileMapWithManifest(
    fileMap: Map<string, FileInfo>,
    manifest: CustomCodeManifest,
    folderOrganized: boolean,
    projectRoot: string
): Map<string, FileInfo> {
    const reconciled = new Map<string, FileInfo>();
    for (const [key, fileInfo] of fileMap.entries()) {
        if (folderOrganized && key === kCustomFunctionsPath && fileInfo.type === CodeType.FUNCTION) {
            continue;
        }
        if (!manifest.has(key) && (fileInfo.type === CodeType.ACTION || fileInfo.type === CodeType.WIDGET)) {
            const baseName = path.posix.basename(key);
            const candidates = Array.from(manifest.entries())
                .filter(([manifestKey, entry]) => entry.type === fileInfo.type && path.posix.basename(manifestKey) === baseName);
            if (candidates.length === 1 && !fileMap.has(candidates[0][0])) {
                reconciled.set(candidates[0][0], fileInfo);
                continue;
            }
            // The reconstructed path is stale (no file on disk) and the manifest knows a
            // same-named file elsewhere; drop it and let the backfill below take over.
            if (candidates.length > 0 && !fs.existsSync(fullPathFromKey(projectRoot, key))) {
                continue;
            }
        }
        reconciled.set(key, fileInfo);
    }
    for (const [key, entry] of manifest.entries()) {
        if (reconciled.has(key)) {
            continue;
        }
        const fileInfo: FileInfo = {
            old_identifier_name: entry.identifierName,
            new_identifier_name: entry.identifierName,
            type: entry.type,
            is_deleted: false,
        };
        const fullPath = fullPathFromKey(projectRoot, key);
        if (fs.existsSync(fullPath)) {
            const checksum = computeChecksum(fullPath);
            fileInfo.original_checksum = checksum;
            fileInfo.current_checksum = checksum;
        }
        reconciled.set(key, fileInfo);
    }
    return reconciled;
}
