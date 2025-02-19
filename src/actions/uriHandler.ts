import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { getApiKey } from "../api/environment";
import { downloadCodeWithPrompt, verifyDownloadLocation } from "./downloadCode";
import { FF_METADATA_FILE_PATH, ffMetadataFromFile } from "../ffState/FlutterFlowMetadata";

export async function handleFlutterFlowUri(
    uri: vscode.Uri,
    context: vscode.ExtensionContext
): Promise<boolean> {

    console.log('opening project from URI ', uri);
    // Parse all parameters from query string
    // Expected format: vscode://flutterflow.custom-code-editor?projectId={projectId}&branchName={branchId}&fileName={fileName}
    const params = new URLSearchParams(uri.query);
    const projectId = params.get('projectId');
    if (!projectId) {
        vscode.window.showErrorMessage('Invalid FlutterFlow URI format: missing projectId');
        return false;
    }

    const branchName = params.get('branchName') || 'main';
    const fileName = params.get('fileName') || '';
    // Convert unix-style path separators to platform-specific separators
    const normalizedFileName = fileName.split('/').join(path.sep);

    try {
        // Check if API key is configured
        const apiKey = getApiKey();
        if (!apiKey) {
            const setApiKey = await vscode.window.showInformationMessage(
                'FlutterFlow API key not found. Would you like to set it now?',
                { modal: true },
                'Yes', 'No'
            );
            if (setApiKey === 'Yes') {
                const key = await vscode.window.showInputBox({
                    prompt: 'Enter your FlutterFlow API key',
                    password: true,
                    ignoreFocusOut: true
                });
                if (key) {
                    await vscode.workspace.getConfiguration('flutterflow').update('userApiToken', key, true);
                } else {
                    return false;
                }
            } else {
                return false;
            }
        }

        // Check if download location is configured
        const downloadLocation = vscode.workspace.getConfiguration('flutterflow').get<string>('downloadLocation');
        //check if the download location is valid
        if (!downloadLocation || !verifyDownloadLocation(downloadLocation)) {
            const setLocation = await vscode.window.showInformationMessage(
                'FlutterFlow download location not set. Would you like to set it now?',
                { modal: true },
                'Yes', 'No',
            );
            if (setLocation === 'Yes') {
                const uris = await vscode.window.showOpenDialog({
                    canSelectFiles: false,
                    canSelectFolders: true,
                    canSelectMany: false,
                    title: 'Select Download Location'
                });
                if (uris && uris[0]) {
                    await vscode.workspace.getConfiguration('flutterflow').update('downloadLocation', uris[0].fsPath, true);
                } else {
                    return false;
                }
            } else {
                return false;
            }
        }

        // Get download path from settings
        const downloadPath = vscode.workspace.getConfiguration("flutterflow").get<string>("downloadLocation") || "";

        //check if the download path is a valid directory
        if (!fs.existsSync(downloadPath)) {
            vscode.window.showErrorMessage(`Invalid download path. ${downloadPath} does not exist.`);
            return false;
        }

        // check if download path plus projectid exists
        const projectDownloadPath = path.join(downloadPath, projectId);
        const projectDownloadPathExists = fs.existsSync(projectDownloadPath);

        const currentWorkspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!projectDownloadPathExists) {
            // Project doesn't exist, so we need to download it
            await downloadCodeWithPrompt(context, {
                projectId,
                branchName,
                downloadLocation: downloadPath,
                initialFile: normalizedFileName
            });
            return true;
        }

        // Project exists but isn't open
        // check metadata file
        const metadataFilePath = path.join(projectDownloadPath, FF_METADATA_FILE_PATH);
        const currentMetadata = fs.existsSync(metadataFilePath) ? ffMetadataFromFile(metadataFilePath) : null;
        const currentBranchName = currentMetadata?.branch_name ? currentMetadata.branch_name : 'main';
        const uriBranchName = branchName ? branchName : 'main';

        const downloadFromFlutterFlowPrompt = `Download From FlutterFlow ${currentMetadata != null ? ` (branch = ${uriBranchName})` : ''}`;
        const overwriteProjectChoice = await vscode.window.showInformationMessage(
            `Project ${projectId} already exists locally ${currentMetadata != null ? ` with branch = ${currentBranchName}` : ''}. What would you like to do?`,
            { modal: true },
            'Open Existing',
            downloadFromFlutterFlowPrompt
        );
        if (overwriteProjectChoice === undefined) {
            return false;
        }

        if (overwriteProjectChoice === 'Open Existing') {
            if (currentWorkspacePath === projectDownloadPath) {
                // If project is already open in current workspace
                if (fileName) {
                    const fullPath = path.join(projectDownloadPath, normalizedFileName);
                    if (fs.existsSync(fullPath)) {
                        const doc = await vscode.workspace.openTextDocument(fullPath);
                        await vscode.window.showTextDocument(doc);
                    }
                }
                return false;
            } else {
                // If project is not open in current workspace, open it
                await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(projectDownloadPath));
                return false;
            }
        }

        if (overwriteProjectChoice === downloadFromFlutterFlowPrompt) {
            await downloadCodeWithPrompt(context, {
                projectId,
                branchName: uriBranchName,
                downloadLocation: downloadPath,
                initialFile: normalizedFileName
            });
            return true;
        }
    } catch (err) {
        console.error('handleUri error', err);
        vscode.window.showErrorMessage(`Error opening project from URL: ${err}`);
    }
    return false;
}
