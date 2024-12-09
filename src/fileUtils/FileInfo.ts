import * as path from 'path';

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
    DEPENDENCIES = 'D',
    OTHER = 'O',
}

export function modifiedFiles(fileMap: Map<string, FileInfo>): string[] {

    const modifiedFiles: string[] = [];
    for (const [filePath, fileInfo] of fileMap.entries()) {
        if (fileInfo.is_deleted || fileInfo.current_checksum === fileInfo.original_checksum) continue;
        modifiedFiles.push(getRelativePath(filePath, fileInfo));
    }
    return modifiedFiles;
}

export function deletedFiles(fileMap: Map<string, FileInfo>): string[] {
    const deletedFiles: string[] = [];
    for (const [filePath, fileInfo] of fileMap.entries()) {
        if (fileInfo.is_deleted) {
            deletedFiles.push(getRelativePath(filePath, fileInfo));
        }
    }
    return deletedFiles;
}

export function getRelativePath(filePath: string, fileInfo: FileInfo): string {
    if (fileInfo.type === CodeType.ACTION) {
        return path.join('lib', 'custom_code', 'actions', filePath);
    }
    if (fileInfo.type === CodeType.WIDGET) {
        return path.join('lib', 'custom_code', 'widgets', filePath);
    }
    if (fileInfo.type === CodeType.FUNCTION) {
        return path.join('lib', 'flutter_flow', filePath);
    }
    throw new Error(`Unknown file type: ${fileInfo.type}`);
}

export function pathToCodeType(filePath: string): CodeType {
    if (!path.basename(filePath).endsWith('.dart') || filePath.endsWith('index.dart')) {
        return CodeType.OTHER;
    }
    if (filePath.includes('actions')) {
        return CodeType.ACTION;
    } else if (filePath.includes('widgets')) {
        return CodeType.WIDGET;
    } else if (filePath.endsWith('custom_functions.dart')) {
        return CodeType.FUNCTION;
    }
    return CodeType.OTHER;
}

export function isNew(fileInfo: FileInfo): boolean {
    return fileInfo.original_checksum === undefined;
}