import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as https from "https";
import * as extract from "extract-zip";

async function selectFlutterSdkDownloadLocation(): Promise<string> {
    const options: vscode.OpenDialogOptions = {
        defaultUri: vscode.Uri.file(vscode.workspace.getConfiguration("flutterflow").get<string>("downloadLocation") || ""),
        canSelectMany: false,
        openLabel: 'Select Flutter SDK Parent Folder',
        title: 'Select Flutter SDK Parent Folder',
        canSelectFiles: false,
        canSelectFolders: true,
    };
    const folderUri = await vscode.window.showOpenDialog(options);
    if (folderUri && folderUri[0]) {
        const selectedPath = folderUri[0].fsPath;
        return selectedPath;
    }
    return "";
}

export async function installFlutterIfNeeded(targetVersion: string, getVersionFn: () => Promise<{ flutterVersion: string, defaultSdkPath: string }>) {
    const { flutterVersion: currentFlutterVersion, defaultSdkPath: currentSdkPath } = await getVersionFn();
    if (currentFlutterVersion === targetVersion) {
        console.log(`default flutter version ${currentFlutterVersion} matches ${targetVersion} already installed`);
        setFlutterExtensionSdkPath(currentSdkPath);
        return;
    }

    // Trigger a blocking dialog to ask the user if they want to proceed with the installation
    const installPromptResult = await vscode.window.showInformationMessage(
        `FlutterFlow needs to install Flutter SDK Version ${targetVersion} in order to run correctly.\n Proceed?`,
        { modal: true },
        "Yes",
        "No"
    );
    if (installPromptResult !== "Yes") {
        return;
    }
    const downloadLocation = vscode.workspace.getConfiguration('flutterflow').get<string>("downloadLocation");

    let flutterSdkPath = path.join(downloadLocation || "", "ff_flutter_sdk");
    if (!downloadLocation) {
        const selectedPath = await selectFlutterSdkDownloadLocation();
        if (selectedPath) {
            flutterSdkPath = path.join(selectedPath, "ff_flutter_sdk");
        } else {
            // error message shown to vscode user
            vscode.window.showErrorMessage("No folder selected. Cancelling flutter sdk installation.");
            return;
        }
    } else {
        const downloadPromptResult = await vscode.window.showInformationMessage(
            `Flutter SDK will be installed to ${downloadLocation}${path.sep}ff_flutter_sdk Proceed?`,
            { modal: true },
            "Yes",
            "Select Different Download Location",
        );
        if (!downloadPromptResult) {
            return;
        }
        if (downloadPromptResult === "Select Different Download Location") {
            const selectedPath = await selectFlutterSdkDownloadLocation();
            if (selectedPath) {
                flutterSdkPath = path.join(selectedPath, "ff_flutter_sdk");
            } else {
                // error message shown to vscode user
                vscode.window.showErrorMessage("No folder selected. Cancelling flutter sdk installation.");
                return;
            }
        }
    }
    vscode.window.showInformationMessage(
        `Flutter SDK download location set to: ${flutterSdkPath}`
    );
    // remove the flutter sdk folder if it exists
    if (fs.existsSync(flutterSdkPath)) {
        fs.rmSync(flutterSdkPath, { recursive: true, force: true });
    }
    // Create the project folder
    fs.mkdirSync(flutterSdkPath, { recursive: true });

    console.log(`installing flutter version ${targetVersion}`);
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Installing Flutter SDK",
        cancellable: false
    }, async (progress) => {
        try {
            progress.report({ increment: -1 });
            await installFlutterVersion(targetVersion, flutterSdkPath);
        } catch (error) {
            console.error(`Failed to install Flutter SDK: ${error}`);
            vscode.window.showErrorMessage(`Failed to install Flutter SDK: ${error}`);
        }
    });
}
// install target flutter version
export async function installFlutterVersion(targetVersion: string, customFlutterPath: string) {
    const platformName = process.platform === 'darwin' ? 'macos' : 'windows';
    const platformArch = process.platform === 'darwin' && process.arch === 'arm64' ? 'arm64_' : '';
    const flutterDownloadUrl = `https://storage.googleapis.com/flutter_infra_release/releases/stable/${platformName}/flutter_${platformName}_${platformArch}${targetVersion}-stable.zip`;

    console.log(`Flutter download URL: ${flutterDownloadUrl}`);
    // Function to download the Flutter SDK
    const downloadFlutterSDK = (url: string, targetPath: string): Promise<void> => {
        return new Promise((resolve, reject) => {
            const tempFile = path.join(targetPath, 'flutter.zip');
            const file = fs.createWriteStream(tempFile);

            https.get(url, (response) => {
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    console.log('Download completed');
                    resolve();
                });
            }).on('error', (err) => {
                fs.unlink(tempFile, () => { }); // Delete the file async. (But we don't check the result)
                reject(err);
            });
        });
    };

    // Function to extract the downloaded ZIP file
    const extractFlutterSDK = async (zipPath: string, targetPath: string): Promise<void> => {
        try {
            await extract.default(zipPath, { dir: targetPath });
            console.log('Extraction complete');
            // Delete the ZIP file after extraction
            fs.unlinkSync(zipPath);
        } catch (err) {
            console.error('Extraction failed:', err);
            throw err;
        }
    };

    // Main function to download and extract Flutter SDK
    const downloadAndExtractFlutterSDK = async (downloadUrl: string, targetPath: string): Promise<void> => {
        try {
            await downloadFlutterSDK(downloadUrl, targetPath);
            const zipPath = path.join(targetPath, 'flutter.zip');
            await extractFlutterSDK(zipPath, targetPath);
            console.log('Flutter SDK downloaded and extracted successfully');
        } catch (error) {
            console.error('Error downloading or extracting Flutter SDK:', error);
            throw error;
        }
    };

    // Use the function
    await downloadAndExtractFlutterSDK(flutterDownloadUrl, customFlutterPath)
        .catch((error) => {
            console.error('Failed to install Flutter SDK:', error);
            vscode.window.showErrorMessage(`Failed to install Flutter SDK: ${error.message}`);
        });
    setFlutterExtensionSdkPath(path.join(customFlutterPath, "flutter"));
}

// set vscode flutter extension sdk path to the flutter sdk path
// update settings.json file to set flutter sdk path.
export function setFlutterExtensionSdkPath(flutterSdkPath: string) {
    vscode.workspace.getConfiguration('dart', vscode.workspace.workspaceFolders?.[0]).update("flutterSdkPath", flutterSdkPath);
    console.log(`flutter sdk path set to: ${flutterSdkPath}`);
}


export function SetFvmConfig(projectPath: string, targetVersion: string) {
    const fvmConfigPath = path.join(projectPath, '.fvmrc');
    const fvmrcJSON = `{
  "flutter": "${targetVersion}",
  "updateVscodeSettings": true,
  "updateGitIgnore": true,
  "runPubGetOnSdkChanges": true
}`
    fs.writeFileSync(fvmConfigPath, fvmrcJSON);
}
