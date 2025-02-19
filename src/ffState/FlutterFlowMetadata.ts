import * as fs from 'fs';
import * as path from 'path';

export type FlutterFlowMetadata = {
    flutterFlowFlutterVersion?: {
        value: string;
        lastUpdated: number;
    };
    project_id: string;
    branch_name: string;
    initial_file?: string;
}

export const FF_METADATA_FILE_PATH = path.join('.vscode', 'ff_metadata.json');

export function ffMetadataFromFile(filePath: string): FlutterFlowMetadata {
    if (!fs.existsSync(filePath)) {
        return { project_id: "", branch_name: "" };
    }
    const fileContents = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(fileContents);
}
export async function ffMetadataToFile(filePath: string, metadata: FlutterFlowMetadata): Promise<void> {
    const targetDir = path.dirname(filePath);
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }
    await fs.promises.writeFile(filePath, JSON.stringify(metadata, null, 2));
}

export async function setInitialFile(projectPath: string, activeFilePath: string) {
    const metadata = ffMetadataFromFile(path.join(projectPath, FF_METADATA_FILE_PATH));
    metadata.initial_file = activeFilePath;
    await ffMetadataToFile(path.join(projectPath, FF_METADATA_FILE_PATH), metadata);
}

export async function getInitialFile(projectPath: string) {
    const metadata = ffMetadataFromFile(path.join(projectPath, FF_METADATA_FILE_PATH));
    const initialFile = metadata.initial_file;
    // clear the initial file
    metadata.initial_file = undefined;
    await ffMetadataToFile(path.join(projectPath, FF_METADATA_FILE_PATH), metadata);
    return initialFile;
}