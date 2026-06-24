import * as path from 'path';
import type { FunctionChange } from './functionSimilarity';

export type FileInfo = {
    old_identifier_name: string;
    new_identifier_name: string;
    type: CodeType;
    is_deleted: boolean;
    original_checksum?: string;
    current_checksum?: string;
}

export enum CodeType {
    ACTION = 'A',
    WIDGET = 'W',
    FUNCTION = 'F',
    // eslint-disable-next-line no-unused-vars
    CODE_FILE = 'C',
    DEPENDENCIES = 'D',
    OTHER = 'O',
}

// Reconstructs the legacy (pre folder-organized support) location of a file that
// was tracked by basename only. Only valid for basename keys from old file maps.
export function getRelativePath(filePath: string, fileInfo: FileInfo): string {
    if (fileInfo.type === CodeType.ACTION) {
        return path.posix.join('lib', 'custom_code', 'actions', filePath);
    }
    if (fileInfo.type === CodeType.WIDGET) {
        return path.posix.join('lib', 'custom_code', 'widgets', filePath);
    }
    if (fileInfo.type === CodeType.FUNCTION) {
        return path.posix.join('lib', 'flutter_flow', filePath);
    }
    if (fileInfo.type === CodeType.CODE_FILE) {
        return path.posix.join('lib', 'custom_code', filePath);
    }
    if (fileInfo.type === CodeType.DEPENDENCIES) {
        return filePath;
    }
    throw new Error(`Unknown file type: ${fileInfo.type}`);
}

// Older versions of the extension keyed the file map by basename. Re-key those
// entries to project-root-relative POSIX paths using the legacy canonical locations.
export function migrateLegacyFileMapKeys(fileMap: Map<string, FileInfo>): Map<string, FileInfo> {
    const migrated = new Map<string, FileInfo>();
    for (const [key, fileInfo] of fileMap.entries()) {
        if (key.includes('/')) {
            migrated.set(key, fileInfo);
            continue;
        }
        try {
            migrated.set(getRelativePath(key, fileInfo), fileInfo);
        } catch {
            migrated.set(key, fileInfo);
        }
    }
    return migrated;
}

// Derives the functions map for folder-organized projects from per-file FUNCTION
// entries, mirroring the shape produced by the legacy snapshot-based mechanism.
export function functionChangeFromFileMap(fileMap: Map<string, FileInfo>): FunctionChange {
    const functionChange: FunctionChange = {
        functions_to_rename: [],
        functions_to_delete: [],
        functions_to_add: [],
    };
    for (const fileInfo of fileMap.values()) {
        if (fileInfo.type !== CodeType.FUNCTION) continue;
        if (fileInfo.is_deleted) {
            // A function that was added and deleted without ever syncing never existed remotely.
            if (fileInfo.original_checksum) {
                functionChange.functions_to_delete.push(fileInfo.old_identifier_name);
            }
            continue;
        }
        if (!fileInfo.original_checksum) {
            functionChange.functions_to_add.push(fileInfo.new_identifier_name);
            continue;
        }
        if (fileInfo.old_identifier_name !== fileInfo.new_identifier_name) {
            functionChange.functions_to_rename.push({
                old_function_name: fileInfo.old_identifier_name,
                new_function_name: fileInfo.new_identifier_name,
                renamed_by_symbol: false,
            });
        }
    }
    return functionChange;
}

export function isNew(fileInfo: FileInfo): boolean {
    return fileInfo.original_checksum === undefined;
}
