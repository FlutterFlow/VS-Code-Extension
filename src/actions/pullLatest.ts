import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

import { FlutterFlowApiClient } from "../api/FlutterFlowApiClient";
import { getCurrentApiUrl, getApiKey } from "../api/environment";
import { initializeCodeFolder } from "./downloadCode";
import { FlutterFlowMetadata } from "../ffState/FlutterFlowMetadata";


export async function performPullLatest(
    projectMetadata: FlutterFlowMetadata,
    waitForUserConfirmation: boolean = true
): Promise<boolean> {
    try {
        // Utilize the temporary directory to perform pull.
        const tempDir = await fs.promises.mkdtemp(
            path.join(os.tmpdir(), "vscode-extension-")
        );
        const projectPath = vscode.workspace.workspaceFolders?.[0];

        if (!projectPath) {
            vscode.window.showErrorMessage("Please download code first.");
            return false;
        }

        if (waitForUserConfirmation) {
            const userConfirmation = await vscode.window.showInformationMessage(
                "Are you sure you want to pull the latest version from Flutterflow? Unsynced local changes will be overwritten.",
                { modal: true },
                "Yes",
                "No"
            );
            if (userConfirmation !== "Yes") {
                vscode.window.showInformationMessage("Aborting Pull.");
                return false;
            }
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Pulling latest FlutterFlow code",
            cancellable: false
        }, async (progress) => {
            try {
                // Indeterminate progress
                progress.report({ increment: -1 });
                const flutterFlowApiClient = new FlutterFlowApiClient(getApiKey(), getCurrentApiUrl(), projectMetadata.project_id, projectMetadata.branch_name);
                await flutterFlowApiClient.pullCode(tempDir);
                await initializeCodeFolder(tempDir);
                // Copy from temp dir to project path
                await updateSpecificCode(projectPath.uri.fsPath, tempDir);
                // report success
                vscode.window.showInformationMessage("Successfully pulled latest FlutterFlow code.");
                // get packages
                await vscode.commands.executeCommand('dart.getPackages', vscode.workspace.workspaceFolders?.[0].uri);
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Error updating code: ${(error as Error).message}`
                );
            } finally {
                // Clean up: remove the temp directory
                await fs.promises.rm(tempDir, { recursive: true, force: true });
            }
        });
    } catch (error) {
        vscode.window.showErrorMessage(
            `Error updating code: ${(error as Error).message}`
        );
        return false;
    }
    return true;
}

async function updateSpecificCode(
    originalPath: string,
    tmpPath: string,
): Promise<void> {
    await fs.promises.rm(path.join(originalPath, 'lib', 'custom_code', 'actions'), { recursive: true, force: true });
    await fs.promises.rm(path.join(originalPath, 'lib', 'custom_code', 'widgets'), { recursive: true, force: true });

    // remove the .vscode folder from the tmp path so that it doesn't override the user's settings
    await fs.promises.rm(path.join(tmpPath, '.vscode'), { recursive: true, force: true });

    // TODO support .flutterflowignore
    await copyDirectory(tmpPath, originalPath, false);
}

/**
 * Recursively copies files and directories from the source directory to the destination directory.
 * @param src - The source directory path.
 * @param dest - The destination directory path.
 * @param clean - Whether to clear the destination directory before copying.
 */
async function copyDirectory(src: string, dest: string, clearDest: boolean = true): Promise<void> {
    // Clean the destination directory if it exists
    // We need to do this so remote deletion is respected. e.g if a user deletes a component in FF, then pulls latest, the component is deleted locally.
    if (clearDest) {
        await fs.promises.rm(dest, { recursive: true, force: true });
    }
    // Ensure destination directory exists
    await fs.promises.mkdir(dest, { recursive: true });

    // Read entries of the source directory
    const entries = await fs.promises.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            // Recursively copy subdirectories
            await copyDirectory(srcPath, destPath);
        } else if (entry.isFile()) {
            // Copy files
            await fs.promises.copyFile(srcPath, destPath);
        } else if (entry.isSymbolicLink()) {
            // Copy symbolic links
            const symlink = await fs.promises.readlink(srcPath);
            await fs.promises.symlink(symlink, destPath);
        }
        // Additional file types like sockets, FIFOs, etc., can be handled here if needed
    }
}
