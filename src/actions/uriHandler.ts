import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { getApiKey } from "../api/environment";
import { downloadCodeWithPrompt } from "./downloadCode";
import { initializeCodeEditorWithVscode } from "./initializeCodeEditor";
import { ffMetadataFromFile, setInitialFile } from "../ffState/FlutterFlowMetadata";

export async function handleFlutterFlowUri(
    uri: vscode.Uri,
    context: vscode.ExtensionContext
): Promise<void> {

    console.log('opening project from URI ', uri);
    // Parse all parameters from query string
    // Expected format: vscode://flutterflow.custom-code-editor?projectId={projectId}&branchName={branchId}&fileName={fileName}
    const params = new URLSearchParams(uri.query);
    const projectId = params.get('projectId');
    if (!projectId) {
        vscode.window.showErrorMessage('Invalid FlutterFlow URI format: missing projectId');
        return;
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
                    return;
                }
            } else {
                return;
            }
        }

        // Check if download location is configured
        const downloadLocation = vscode.workspace.getConfiguration('flutterflow').get<string>('downloadLocation');
        if (!downloadLocation) {
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
                    return;
                }
            } else {
                return;
            }
        }

        // Get download path from settings
        const downloadPath = vscode.workspace.getConfiguration("flutterflow").get<string>("downloadLocation") || "";

        //check if the download path is a valid directory
        if (!fs.existsSync(downloadPath)) {
            vscode.window.showErrorMessage(`Invalid download path. ${downloadPath} does not exist.`);
            return;
        }

        // check if download path plus projectid exists
        const projectDownloadPath = path.join(downloadPath, projectId);
        const projectDownloadPathExists = fs.existsSync(projectDownloadPath);

        const currentWorkspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

        // Project exists but isn't open
        if (projectDownloadPathExists) {
            // check metadata file
            const metadataFilePath = path.join(projectDownloadPath, 'ff_metadata.json');
            const metadataFileExists = fs.existsSync(metadataFilePath);
            if (metadataFileExists) {
                const metadata = ffMetadataFromFile(metadataFilePath);
                if (metadata.branch_name !== branchName) {
                    // currently downloaded branch is different than the branch name in the uri
                    // so we need to download the project again
                    const branchChoice = await vscode.window.showInformationMessage(
                        'Local branch is different than the branch name in the uri. Would you like to overwrite the project directory with code from branch ' + branchName + '?',
                        { modal: true },
                        'Yes',
                        'No'
                    );
                    if (branchChoice === 'Yes') {
                        await downloadCodeWithPrompt(context, {
                            projectId,
                            branchName,
                            downloadLocation: downloadPath,
                            initialFile: normalizedFileName
                        });
                        return;
                    } else {
                        return;
                    }
                }
            }

            const choice = await vscode.window.showInformationMessage(
                'Project already exists locally. What would you like to do?',
                { modal: true },
                'Open Existing',
                'Download From FlutterFlow'
            );

            if (choice === 'Open Existing') {
                // If project is already open in current workspace
                if (currentWorkspacePath === projectDownloadPath) {
                    if (fileName) {
                        const fullPath = path.join(projectDownloadPath, normalizedFileName);
                        if (fs.existsSync(fullPath)) {
                            const doc = await vscode.workspace.openTextDocument(fullPath);
                            await vscode.window.showTextDocument(doc);
                        }
                    }
                    // Ensure editor is initialized
                    await initializeCodeEditorWithVscode();
                    return;
                }
                // if the project is not open in the current workspace, open it
                if (fileName) {
                    await setInitialFile(projectDownloadPath, normalizedFileName);
                }
                await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(projectDownloadPath));
                return;
            } else if (!choice) {
                return; // User cancelled
            }
        }

        // Download new copy
        await downloadCodeWithPrompt(context, {
            projectId,
            branchName,
            downloadLocation: downloadPath,
            initialFile: normalizedFileName
        });

    } catch (err) {
        console.error('handleUri error', err);
        vscode.window.showErrorMessage(`Error opening project from URL: ${err}`);
    }
}
