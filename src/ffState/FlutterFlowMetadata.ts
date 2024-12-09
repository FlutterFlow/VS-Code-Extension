import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export type FlutterFlowMetadata = {
    flutterFlowFlutterVersion?: {
        value: string;
        lastUpdated: number;
    };
    project_id: string;
    branch_name: string;
}


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

export async function writeFFMetadataFromContext(context: vscode.ExtensionContext): Promise<void> {
    const metadata = {
        project_id: context.globalState.get("projectId") as string,
        branch_name: context.globalState.get("branchName") as string
    };
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
        const projectPath = workspaceFolders[0].uri.fsPath;
        await ffMetadataToFile(path.join(projectPath, "ff_metadata.json"), metadata);
    }
}