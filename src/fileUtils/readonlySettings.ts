import * as fs from "fs";
import * as path from "path";

/**
 * Manages the `files.readonlyInclude` / `files.readonlyExclude` entries the
 * extension adds to a FlutterFlow project's `.vscode/settings.json`.
 *
 * The extension records exactly which keys it added in
 * `.vscode/ff_readonly.json`, so it can:
 *  - merge into a user's existing read-only rules instead of replacing them, and
 *  - remove only its own entries later (re-download, or the
 *    "FlutterFlow: Unlock Read-only Files" command), leaving user settings intact.
 */

export const READONLY_INCLUDE_KEY = "files.readonlyInclude";
export const READONLY_EXCLUDE_KEY = "files.readonlyExclude";
export const MANAGED_FILE_NAME = "ff_readonly.json";

export type GlobMap = Record<string, boolean>;
export type Settings = Record<string, unknown>;

export interface ManagedReadonlyKeys {
    include: string[];
    exclude: string[];
}

const EMPTY_MANAGED: ManagedReadonlyKeys = { include: [], exclude: [] };

/**
 * Globs written by extension versions before ff_readonly.json existed. Used to
 * clean up projects downloaded with an older version (no record of what was added).
 */
export const LEGACY_INCLUDE_GLOBS = ["**"];
export const LEGACY_EXCLUDE_GLOBS = [
    "lib/custom_code/**",
    "lib/flutter_flow/custom_functions.dart",
    "pubspec.yaml",
    "lib/flutter_flow/function_changes.json",
    ".vscode/settings.json",
];

/** Best guess at what an older extension version added, if its signature `"**": true` is present. */
export function legacyManagedKeys(settings: Settings): ManagedReadonlyKeys {
    const include = asGlobMap(settings[READONLY_INCLUDE_KEY]);
    if (include["**"] !== true) {
        return EMPTY_MANAGED;
    }
    const exclude = asGlobMap(settings[READONLY_EXCLUDE_KEY]);
    return {
        include: LEGACY_INCLUDE_GLOBS,
        exclude: LEGACY_EXCLUDE_GLOBS.filter((glob) => glob in exclude),
    };
}

function asGlobMap(value: unknown): GlobMap {
    return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as GlobMap) } : {};
}

/**
 * Adds the extension's read-only globs to `settings` without overwriting any
 * glob the user already configured. Returns the new settings and the keys that
 * were actually added (and are therefore owned by the extension).
 */
export function applyReadonlyGlobs(
    settings: Settings,
    include: GlobMap,
    exclude: GlobMap
): { settings: Settings; added: ManagedReadonlyKeys } {
    const nextInclude = asGlobMap(settings[READONLY_INCLUDE_KEY]);
    const nextExclude = asGlobMap(settings[READONLY_EXCLUDE_KEY]);
    const added: ManagedReadonlyKeys = { include: [], exclude: [] };

    for (const [glob, value] of Object.entries(include)) {
        if (!(glob in nextInclude)) {
            nextInclude[glob] = value;
            added.include.push(glob);
        }
    }
    for (const [glob, value] of Object.entries(exclude)) {
        if (!(glob in nextExclude)) {
            nextExclude[glob] = value;
            added.exclude.push(glob);
        }
    }

    return {
        settings: { ...settings, [READONLY_INCLUDE_KEY]: nextInclude, [READONLY_EXCLUDE_KEY]: nextExclude },
        added,
    };
}

/**
 * Removes only the globs the extension added. Drops the read-only keys entirely
 * when nothing user-defined is left in them.
 */
export function removeReadonlyGlobs(settings: Settings, managed: ManagedReadonlyKeys): Settings {
    const next: Settings = { ...settings };
    const prune = (key: string, globs: string[]) => {
        if (!(key in next)) {
            return;
        }
        const map = asGlobMap(next[key]);
        for (const glob of globs) {
            delete map[glob];
        }
        if (Object.keys(map).length === 0) {
            delete next[key];
        } else {
            next[key] = map;
        }
    };
    prune(READONLY_INCLUDE_KEY, managed.include);
    prune(READONLY_EXCLUDE_KEY, managed.exclude);
    return next;
}

function readJson(filePath: string): Settings | undefined {
    if (!fs.existsSync(filePath)) {
        return {};
    }
    const raw = fs.readFileSync(filePath, "utf8");
    if (raw.trim() === "") {
        return {};
    }
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
    } catch {
        // settings.json may contain comments (JSONC). Don't rewrite a file we can't parse safely.
        return undefined;
    }
}

function readManaged(vscodeDir: string, settings: Settings): ManagedReadonlyKeys {
    const managedPath = path.join(vscodeDir, MANAGED_FILE_NAME);
    if (!fs.existsSync(managedPath)) {
        return legacyManagedKeys(settings);
    }
    const data = readJson(managedPath);
    if (!data) {
        return EMPTY_MANAGED;
    }
    return {
        include: Array.isArray(data.include) ? (data.include as string[]) : [],
        exclude: Array.isArray(data.exclude) ? (data.exclude as string[]) : [],
    };
}

/**
 * Writes the extension's read-only rules into `<projectDir>/.vscode/settings.json`.
 * Entries added by a previous run are replaced, user entries are preserved.
 * Returns false (and leaves the file untouched) if settings.json can't be parsed.
 */
export async function writeReadonlySettings(projectDir: string, include: GlobMap, exclude: GlobMap): Promise<boolean> {
    const vscodeDir = path.join(projectDir, ".vscode");
    const settingsPath = path.join(vscodeDir, "settings.json");
    fs.mkdirSync(vscodeDir, { recursive: true });

    const existing = readJson(settingsPath);
    if (existing === undefined) {
        console.warn(`Could not parse ${settingsPath}; leaving read-only settings unchanged.`);
        return false;
    }
    const withoutOld = removeReadonlyGlobs(existing, readManaged(vscodeDir, existing));
    const { settings, added } = applyReadonlyGlobs(withoutOld, include, exclude);

    await fs.promises.writeFile(settingsPath, JSON.stringify(settings, null, 2));
    await fs.promises.writeFile(path.join(vscodeDir, MANAGED_FILE_NAME), JSON.stringify(added, null, 2));
    return true;
}

/**
 * Removes the extension's read-only rules from `<projectDir>/.vscode/settings.json`.
 * Returns true if anything was removed.
 */
export async function clearReadonlySettings(projectDir: string): Promise<boolean> {
    const vscodeDir = path.join(projectDir, ".vscode");
    const managedPath = path.join(vscodeDir, MANAGED_FILE_NAME);
    const settingsPath = path.join(vscodeDir, "settings.json");
    if (!fs.existsSync(settingsPath)) {
        return false;
    }
    const existing = readJson(settingsPath);
    if (existing === undefined) {
        return false;
    }
    const managed = readManaged(vscodeDir, existing);
    if (managed.include.length === 0 && managed.exclude.length === 0) {
        return false;
    }
    await fs.promises.writeFile(settingsPath, JSON.stringify(removeReadonlyGlobs(existing, managed), null, 2));
    if (fs.existsSync(managedPath)) {
        await fs.promises.unlink(managedPath);
    }
    return true;
}
