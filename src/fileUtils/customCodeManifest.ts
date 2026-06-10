import * as fs from 'fs';
import * as path from 'path';
import { CodeType } from './FileInfo';

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

// Parses the name of the first top-level function declaration in a Dart file.
// Generated custom function files declare exactly one top-level function at column 0.
export function parseTopLevelFunctionName(dartCode: string): string | null {
    const skipKeywords = /^(import|export|part|library|class|enum|extension|typedef|mixin|abstract|const|final|var|late)\b/;
    for (const line of stripComments(dartCode).split('\n')) {
        if (!/^[A-Za-z_$]/.test(line) || skipKeywords.test(line)) {
            continue;
        }
        const match = line.match(/^[\w$<>,?\s[\]]+?\s([a-zA-Z_$][\w$]*)\s*\(/);
        if (match) {
            return match[1];
        }
    }
    return null;
}

function functionIdentifierName(projectRoot: string, targetRelativePath: string, shownNames: string[]): string {
    if (shownNames.length > 0) {
        return shownNames[0];
    }
    const targetPath = fullPathFromKey(projectRoot, targetRelativePath);
    if (fs.existsSync(targetPath)) {
        const declaredName = parseTopLevelFunctionName(fs.readFileSync(targetPath, 'utf8'));
        if (declaredName) {
            return declaredName;
        }
    }
    return toCamelCase(path.posix.basename(targetRelativePath, '.dart'));
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
        const fallbackName = type === CodeType.WIDGET
            ? toPascalCase(path.posix.basename(target, '.dart'))
            : toCamelCase(path.posix.basename(target, '.dart'));
        manifest.set(target, {
            type,
            identifierName: directive.shownNames[0] ?? fallbackName,
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
    if (relativePath.startsWith('lib/custom_code/')) {
        if (relativePath.includes('actions')) {
            return CodeType.ACTION;
        }
        if (relativePath.includes('widgets')) {
            return CodeType.WIDGET;
        }
        if (folderOrganized && relativePath.startsWith('lib/custom_code/functions/')) {
            return CodeType.FUNCTION;
        }
    }
    return CodeType.OTHER;
}
