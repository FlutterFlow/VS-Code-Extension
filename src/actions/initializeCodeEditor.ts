import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { exec } from 'child_process';

import { ffMetadataFromFile, FlutterFlowMetadata } from "../ffState/FlutterFlowMetadata";
import { initializeCodeFolder } from "./downloadCode";
import { deserializeUpdateManager, UpdateManager } from "../ffState/UpdateManager";
import { installFlutterIfNeeded } from "../ffState/manage_flutter_version";
import { FlutterFlowApiClient } from "../api/FlutterFlowApiClient";
import { getCurrentApiUrl, getApiKey } from "../api/environment";

export async function initializeCode(projectDirectory: string): Promise<{ metadata: FlutterFlowMetadata, updateManager: UpdateManager }> {
    await initializeCodeFolder(projectDirectory);
    const metadata = ffMetadataFromFile(path.join(projectDirectory, ".vscode", "ff_metadata.json"));
    if (!metadata) {
        throw new Error("No ff_metadata.json found, make sure you are in the root directory of your FlutterFlow project downloaded with the FlutterFlow extension.");
    }
    // setup update manager
    const updateManager = await deserializeUpdateManager(projectDirectory);

    return { metadata, updateManager };
}

async function initializeFlutter(projectPath: string, apiClient: FlutterFlowApiClient, getFlutterVersionFn: () => Promise<{ flutterVersion: string, defaultSdkPath: string }>): Promise<void> {
    const targetVersion = await apiClient.getFlutterFlowFlutterVersion();
    const { flutterVersion } = await getFlutterVersionFn();
    if (flutterVersion === targetVersion) {
        console.log("target flutter version is already installed");
        return;
    }
    console.log(`target flutter version: "${targetVersion}" current flutter version: "${flutterVersion}"`);
    // detect if fvm is installed correctly
    const fvmInstallPromise = new Promise<void>((resolve, reject) => {
        exec(`fvm use ${targetVersion} -f`, { cwd: projectPath }, (error, stdout, stderr) => {
            if (!error) {
                // fvm is installed
                console.log('fvm Stdout: ', stdout);
                resolve();
            } else {
                console.log('fvm Error: ', error);
                console.log('fvm Stdout: ', stdout);
                console.log('fvm Stderr: ', stderr);
                reject();
            }
        });
    });
    try {
        await fvmInstallPromise;
    } catch (error) {
        console.log('error trying to use fvm: ', error);
        await installFlutterIfNeeded(targetVersion, getFlutterVersionFn);
    }
}

export async function initializeCodeEditorWithVscode(): Promise<{ metadata: FlutterFlowMetadata, updateManager: UpdateManager } | null> {

    const workspacePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!workspacePath) {
        vscode.window.showErrorMessage("No workspace folder found.");
        return null;
    }


    const { metadata, updateManager } = await initializeCode(workspacePath);
    if (!metadata) {
        vscode.window.showErrorMessage("Error initializing FlutterFlow Project. Could not find metadata.");
        return null;
    }
    const flutterFlowApiClient = new FlutterFlowApiClient(getApiKey(), getCurrentApiUrl(), metadata.project_id, metadata.branch_name);
    //get workspace folder
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const getFlutterVersionFn = async () => {
        let flutterSdkPath = vscode.workspace.getConfiguration("dart").get<string>("flutterSdkPath");
        if (!flutterSdkPath) {
            console.log("no flutter sdk path found via dart extension, looking for it in settings.json");
            // This is a backup that honestly shouldn't be needed
            if (workspaceFolder) {
                // read the settings file to get the flutter sdk path
                const settingsFilePath = path.join(workspaceFolder.uri.fsPath, ".vscode", "settings.json");
                const settingsFileContents = fs.readFileSync(settingsFilePath, "utf8");
                const settings = JSON.parse(settingsFileContents);
                flutterSdkPath = settings["dart.flutterSdkPath"];
            }
        }

        if (!flutterSdkPath) {
            return {
                flutterVersion: "",
                defaultSdkPath: ""
            };
        }
        if (!path.isAbsolute(flutterSdkPath)) {
            flutterSdkPath = path.join(workspaceFolder?.uri.fsPath || "", flutterSdkPath);
        }
        // look at version file in flutter sdk path
        const versionFilePath = path.join(flutterSdkPath, "version");
        const versionFileContents = fs.readFileSync(versionFilePath, "utf8");
        const currentFlutterVersion = versionFileContents.trim();
        return {
            flutterVersion: currentFlutterVersion,
            defaultSdkPath: flutterSdkPath
        };
    };
    await initializeFlutter(workspacePath, flutterFlowApiClient, getFlutterVersionFn);

    // get packages 
    if (workspaceFolder) {
        try {
            await vscode.commands.executeCommand('dart.getPackages', workspaceFolder.uri);
        } catch (error) {
            vscode.window.showErrorMessage('Error getting flutter packages: ' + (error as Error).message);
        }
    } else {
        vscode.window.showErrorMessage('No workspace folder found when getting flutter packages.');
    }


    vscode.window.showInformationMessage("FlutterFlow Project initialized.");
    await updateManager.serializeUpdateManager(workspacePath);
    console.log("initialized code editor");
    return { metadata, updateManager };
}