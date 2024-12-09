import * as vscode from 'vscode';
import fs from 'fs';

import { FileInfo } from "../fileUtils/FileInfo";
import { FunctionInfo, parseTopLevelFunctions } from './dartParser';
import path from 'path';

// get list of functions from custom_functions.dart
export async function parseFunctionFile(filePath: string): Promise<FunctionInfo[]> {
    //TODO: implement
    const doc = await vscode.workspace.openTextDocument(filePath);
    return await parseTopLevelFunctions(doc.getText());
}

export async function readFileMap(projectRoot: string): Promise<Map<string, FileInfo>> {
    // read json file map into Map<string, FileInfo>
    const maxRetries = 3;
    const baseDelay = 100; // 0.1 seconds

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const fileMapData = await fs.promises.readFile(path.join(projectRoot, '.vscode', 'file_map.json'), 'utf-8');
            const obj = JSON.parse(fileMapData);
            const map = new Map<string, FileInfo>();
            Object.entries(obj).forEach(([key, value]) => {
                map.set(key, value as FileInfo);
            });
            return map;
        } catch (error) {
            if (attempt === maxRetries - 1) {
                console.error('Failed to parse file map after max retries:', error);
                throw error;
            }
            const delay = baseDelay * Math.pow(2, attempt);
            console.warn(`Error parsing file map (attempt ${attempt + 1}/${maxRetries}). Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    return new Map();
}

export function writeFileMap(projectRoot: string, fileMap: Map<string, FileInfo>): void {
    const vscodeDir = path.join(projectRoot, '.vscode');
    if (!fs.existsSync(vscodeDir)) {
        fs.mkdirSync(vscodeDir, { recursive: true });
    }
    fs.writeFileSync(path.join(vscodeDir, 'file_map.json'), JSON.stringify(Object.fromEntries(fileMap), null, 2), 'utf-8');
}
