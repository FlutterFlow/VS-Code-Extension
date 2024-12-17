import { FlutterFlowApiClient } from "../api/FlutterFlowApiClient";
import { insertCustomFunctionBoilerplate } from "../fileUtils/addBoilerplate";
import { ffMetadataFromFile, ffMetadataToFile } from "../ffState/FlutterFlowMetadata";
import { deserializeUpdateManager, UpdateManager } from "../ffState/UpdateManager";
import { getCurrentApiUrl } from "../api/environment";
import * as path from "path";
import * as vscode from "vscode";
import * as fs from "fs";

export async function downloadCode(destDir: string, apiClient: FlutterFlowApiClient): Promise<UpdateManager> {
    console.log(`Downloading code from FlutterFlow to ${destDir}, project ID: ${apiClient.projectId}, branch: ${apiClient.branchName}`);
    await apiClient.pullCode(destDir);
    const metadata = ffMetadataFromFile(path.join(destDir, ".vscode", "ff_metadata.json"));
    metadata.project_id = apiClient.projectId;
    metadata.branch_name = apiClient.branchName;
    await ffMetadataToFile(path.join(destDir, ".vscode", "ff_metadata.json"), metadata);
    await initializeCodeFolder(destDir);
    const updateManager = await deserializeUpdateManager(destDir);
    await updateManager.serializeFileMap(destDir);
    return updateManager;
}


export async function initializeCodeFolder(destDir: string) {
    // Create or update settings.json with read-only access for non-custom code files
    const settingsPath = path.join(destDir, ".vscode", "settings.json");
    const settings = {
        "files.readonlyInclude": {
            "**": true,
        },
        "files.readonlyExclude": {
            [`lib/custom_code/**`]: true,
            [`lib/flutter_flow/custom_functions.dart`]: true,
            "pubspec.yaml": true,
            [`lib/flutter_flow/function_changes.json`]: true,
            [`.vscode/settings.json`]: true,
        },
    };
    // make directory if it doesn't exist
    if (!fs.existsSync(path.join(destDir, ".vscode"))) {
        fs.mkdirSync(path.join(destDir, ".vscode"), { recursive: true });
    }
    // if the file does exist read it and merge the settings
    if (fs.existsSync(settingsPath)) {
        const existingSettings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
        const mergedSettings = { ...existingSettings, ...settings };
        await fs.promises.writeFile(settingsPath, JSON.stringify(mergedSettings, null, 2));
    } else {
        await fs.promises.writeFile(settingsPath, JSON.stringify(settings, null, 2));
    }

    const customCodePath = path.join(destDir, "lib", "custom_code");
    const functionsPath = path.join(
        destDir,
        "lib",
        "flutter_flow",
        "custom_functions.dart"
    );
    const actionsPath = path.join(customCodePath, "actions");
    const widgetsPath = path.join(customCodePath, "widgets");

    // TODO (make this a function)
    if (!fs.existsSync(customCodePath)) {
        fs.mkdirSync(customCodePath, { recursive: true });
        fs.mkdirSync(actionsPath);
        await fs.promises.writeFile(path.join(actionsPath, "index.dart"), "");
        fs.mkdirSync(widgetsPath);
        await fs.promises.writeFile(path.join(widgetsPath, "index.dart"), "");
    } else {
        if (!fs.existsSync(actionsPath)) {
            fs.mkdirSync(actionsPath);
            await fs.promises.writeFile(path.join(actionsPath, "index.dart"), "");
        }
        if (!fs.existsSync(widgetsPath)) {
            fs.mkdirSync(widgetsPath);
            await fs.promises.writeFile(path.join(widgetsPath, "index.dart"), "");
        }
    }
    if (!fs.existsSync(functionsPath)) {
        const customFunctionBoilerplate =
            insertCustomFunctionBoilerplate();
        await fs.promises.writeFile(functionsPath, customFunctionBoilerplate);
    }

}

export interface DownloadCodeArgs {
    projectId?: string;
    downloadLocation?: string;
    branchName?: string;
    skipOpen?: boolean;
}

export async function downloadCodeWithPrompt(context: vscode.ExtensionContext, args: DownloadCodeArgs = {}) {
    // Read project id from existing data and prompt user if not found.
    let projectId;
    if (args.projectId) {
        projectId = args.projectId;
    } else {
        const defaultProjectId = vscode.workspace.getConfiguration("flutterflow").get<string>("projectId") || "";
        projectId = await vscode.window.showInputBox({
            prompt: "Enter your project ID",
            placeHolder: "e.g. PROJECT-123",
            value: defaultProjectId,
            ignoreFocusOut: true,
        });
    }
    if (projectId) {
        vscode.window.showInformationMessage(
            `Project ID saved: ${projectId}`
        );
    } else {
        return;
    }

    const token =
        process.env.FLUTTERFLOW_API_TOKEN ||
        vscode.workspace.getConfiguration("flutterflow").get("userApiToken");

    let branchName: string | undefined;
    if (args.branchName !== undefined) {
        branchName = args.branchName;
    } else {
        branchName =
            process.env.FLUTTERFLOW_BRANCH_NAME ||
            vscode.workspace.getConfiguration("flutterflow").get("branchName");
        const branchNameInput = await vscode.window.showInputBox({
            prompt: "Enter the desired branch name (leave blank for main)",
            placeHolder: "e.g. mybranch",
            value: branchName || "",
            ignoreFocusOut: true,
        });
        if (branchNameInput) {
            // Save the branch name
            branchName = branchNameInput;
            vscode.window.showInformationMessage(
                `Branch name saved: ${branchNameInput}`
            );
        }
    }
    let downloadLocation: string | undefined;
    let folderUri: vscode.Uri[] | undefined;
    if (args.downloadLocation) {
        downloadLocation = args.downloadLocation;
        folderUri = [
            vscode.Uri.file(downloadLocation)
        ];
    } else {
        downloadLocation =
            process.env.FLUTTERFLOW_DOWNLOAD_LOCATION ||
            vscode.workspace.getConfiguration("flutterflow").get("downloadLocation");
        const options: vscode.OpenDialogOptions = {
            defaultUri: vscode.Uri.file(vscode.workspace.getConfiguration("flutterflow").get<string>("downloadLocation") || ""),
            canSelectMany: false,
            openLabel: "Select Download Location",
            canSelectFiles: false,
            canSelectFolders: true,
        };
        folderUri = await vscode.window.showOpenDialog(options);
    }
    let projectPath = "";
    if (folderUri && folderUri[0]) {
        const selectedPath = folderUri[0].fsPath;
        projectPath = path.join(selectedPath, projectId);

        // Create the project folder
        fs.mkdirSync(projectPath, { recursive: true });

        vscode.window.showInformationMessage(
            `Download location set to: ${selectedPath}`
        );
    } else {
        vscode.window.showInformationMessage("Download cancelled.");
        return "";
    }
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Downloading FlutterFlow Project",
        cancellable: false
    }, async (progress) => {
        try {
            // Indeterminate progress
            progress.report({ increment: -1 });
            if (token === "" || token === undefined) {
                vscode.window.showErrorMessage(
                    "Your FlutterFlow API token is not set. Please set in vscode settings."
                );
                const err = "FlutterFlow API token not set";
                throw err;
            }
            if (projectId === "" || projectId === undefined) {
                vscode.window.showErrorMessage("Please set project ID to download.");
            }
            if (branchName === "" || branchName === undefined) {
                branchName = "";
            }

            const updateManager = await downloadCode(projectPath, new FlutterFlowApiClient(token, getCurrentApiUrl(), projectId, branchName));

            // context.globalState.update("downloadsPath", projectPath);
            // context.globalState.update("projectId", projectId);
            // context.globalState.update("branchName", branchName);
            context.workspaceState.update("updateManager", updateManager);

            if (!args.skipOpen) {
                await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(projectPath));
            }
            vscode.window.showInformationMessage("Code download successful");
        } catch (error) {
            vscode.window.showErrorMessage(`Error downloading project: ${(error as Error).message}`);
        }
    });
    return [projectId, projectPath];
};