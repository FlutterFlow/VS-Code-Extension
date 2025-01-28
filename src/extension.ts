// The module 'vscode' contains the VS Code extensibility API
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

import { FileErrorProvider } from "./ui/FileErrorsPanel";
import { getCurrentWebAppUrl, getApiKey, getCurrentApiUrl } from "./api/environment";
import { UpdateManager } from "./ffState/UpdateManager";
import { FFCustomCodeTreeProvider } from "./ui/ModifiedFilesPanel";
import { FfStatusBar } from "./ui/FfStatusBar";

import { DownloadCodeArgs, downloadCodeWithPrompt } from "./actions/downloadCode";
import { initializeCodeEditorWithVscode } from "./actions/initializeCodeEditor";
import { pushToFF } from "./actions/pushToFF";
import { performPullLatest } from "./actions/pullLatest";
import { createEditStream, FFProjectState, ProjectState } from "./ffState/FFProjectState";
import { FlutterFlowApiClient } from "./api/FlutterFlowApiClient";
import { FlutterFlowMetadata, getInitialFile, setInitialFile } from "./ffState/FlutterFlowMetadata";

// Pattern for watching custom code files
const kCustomFilePattern = `**/{pubspec.yaml,lib/custom_code/**,lib/flutter_flow/custom_functions.dart}`;

// Initialize UI components
const ffStatusBar: FfStatusBar = new FfStatusBar('unset project id', 'unset branch name');
const modifiedFileTreeProvider = new FFCustomCodeTreeProvider();
const fileErrorProvider = new FileErrorProvider(new Map(), vscode.workspace.workspaceFolders?.[0].uri.fsPath || "", new Map());

// Global state variables
let projectState: FFProjectState | null = null;
let watcher: vscode.FileSystemWatcher | null = null;
let projectMetadata: FlutterFlowMetadata | null = null;

async function checkRequiredFiles(): Promise<boolean> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) return false;

  const rootUri = workspaceFolders[0].uri;

  try {
    // Check for pubspec.yaml
    const pubspecPath = vscode.Uri.joinPath(rootUri, 'pubspec.yaml');
    await vscode.workspace.fs.stat(pubspecPath);

    // Check for .vscode/ff_metadata.json
    const metadataPath = vscode.Uri.joinPath(rootUri, '.vscode', 'ff_metadata.json');
    await vscode.workspace.fs.stat(metadataPath);

    return true;
  } catch (error) {
    return false;
  }
};

/**
 * Extension activation point - called when extension is activated
 * Sets up commands, UI components, and file watchers
 */
export function activate(context: vscode.ExtensionContext): vscode.ExtensionContext {
  // Register UI components
  console.log('RYANDEBUG:activating extension');


  context.subscriptions.push(ffStatusBar);
  vscode.window.registerTreeDataProvider("fileListTreeView", modifiedFileTreeProvider);
  const treeView = vscode.window.createTreeView("fileListTreeView", {
    treeDataProvider: modifiedFileTreeProvider,
    showCollapseAll: false,
  });
  context.subscriptions.push(treeView);

  // Register command to open FlutterFlow project in browser
  vscode.commands.registerCommand('extension.openFlutterFlowProject', () => {
    if (projectMetadata?.project_id) {
      const url = `https://${getCurrentWebAppUrl()}/project/${projectMetadata.project_id}`;
      vscode.env.openExternal(vscode.Uri.parse(url));
    } else {
      vscode.window.showErrorMessage('No FlutterFlow project ID found.');
    }
  });

  // Register FlutterFlow problems panel
  vscode.window.registerTreeDataProvider("fileErrors", fileErrorProvider);

  // Register command to open files from problems panel
  vscode.commands.registerCommand("fileErrors.openFile", (filePath: string) => {
    vscode.workspace.openTextDocument(filePath).then(
      (doc) => {
        vscode.window.showTextDocument(doc);
      },
      (err) => {
        vscode.window.showErrorMessage(`Failed to open file: ${err}`);
      }
    );
  });

  // Register command to download code from FlutterFlow
  const runDownloadCode = vscode.commands.registerCommand(
    "flutterflow-download",
    async (args: DownloadCodeArgs = {}) => {
      try {
        const currentWorkspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        // RYANDEBUG test
        args.initialFile = path.join('lib', 'custom_code', 'actions', 'index.dart');
        const projectConfigs = await downloadCodeWithPrompt(context, args);
        if (!projectConfigs) {
          return;
        }

        // Check if project path matches current workspace and it is already initialized
        if (projectConfigs.projectPath === currentWorkspacePath && projectState?.updateManager) {
          // If project path matches current workspace, initialize the coding session. 
          // A common reason for this is that the user has already downloaded the code and is trying to download it again
          // or the user is switching branches.
          await initCodeEditorFn();
        }
      } catch (error) {
        console.log('download error: ', error);
        throw error;
      }
    }
  );

  // Initialize code editor function
  const initCodeEditorFn = async () => {
    const initResult = await initializeCodeEditorWithVscode();
    if (!initResult) {
      return;
    }
    const { metadata, updateManager } = initResult;
    projectMetadata = metadata;
    ffStatusBar.updateProjectAndBranch(metadata.project_id, metadata.branch_name);

    if (!projectState) {
      const projectDirectory = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
      if (!projectDirectory) {
        vscode.window.showErrorMessage("No project directory found.");
        return;
      }
      // Setup file system watcher
      watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(projectDirectory, kCustomFilePattern)
      );

      // Initialize project state
      modifiedFileTreeProvider.refreshFromFileMap(updateManager.fileMap);
      projectState = new FFProjectState(createEditStream(watcher), updateManager);
      projectState.setState(ProjectState.EDITING);
      projectState.onUpdate((updateEvent) => {
        modifiedFileTreeProvider.update(updateEvent.editEvent.filePath, updateEvent.fileInfo);
      });
    }
  };

  // Register command to start custom code editor
  const startCodeEditor = vscode.commands.registerCommand(
    "flutterflow-run-custom-code-editor",
    initCodeEditorFn
  );

  checkRequiredFiles().then((result) => {
    // check to see if the extension has been activated in a flutterflow project.
    // If so, initialize the code editor
    if (result) {
      getInitialFile(vscode.workspace.workspaceFolders?.[0].uri.fsPath || "").then((initialFile) => {
        if (initialFile) {

          const projectPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath || "";
          if (projectPath == "") return;

          vscode.workspace.openTextDocument(path.join(projectPath, initialFile)).then((doc) => {
            vscode.window.showTextDocument(doc);
          });
        }
      }).then(initCodeEditorFn);
    }
  });

  // Register command to pull latest code from Flutterflow. All local unsynced changes will be overwritten.
  const pullLatest = vscode.commands.registerCommand(
    "extension.pullLatest",
    async () => {
      try {
        if (projectState) {
          projectState.setState(ProjectState.PULLING);
        }
        // Download the new code to the temp directory
        if (!projectMetadata) {
          vscode.window.showErrorMessage("Error pulling latest FlutterFlow code. Be sure to start a coding session first.");
          return;
        }
        // Pull latest code
        const pullSuccess = await performPullLatest(projectMetadata);
        if (!pullSuccess) {
          if (projectState) {
            projectState.setState(ProjectState.EDITING);
          }
          return;
        }
        // Refresh state after pull
        await projectState?.updateManager.refresh();
        await projectState?.updateManager.serializeUpdateManager();
        modifiedFileTreeProvider.clearAllFiles();
        fileErrorProvider.setFileErrorsMap(new Map(), new Map(), vscode.workspace.workspaceFolders?.[0].uri.fsPath || "");
      } catch (error) {
        console.error(`Error pulling latest code: ${error}`);
        vscode.window.showErrorMessage(`Error pulling latest code: ${error}`);
        return;
      } finally {
        if (projectState) {
          projectState.setState(ProjectState.EDITING);
        }
      }
    }
  );

  // sync with Flutterflow - if sync successful, reset modified files list
  const syncWithFF = vscode.commands.registerCommand(
    "extension.callApi",
    async () => {
      const currentUpdateManager = projectState?.updateManager;
      if (!currentUpdateManager) {
        vscode.window.showErrorMessage(
          "Please start custom code editor first."
        );
        return;
      }

      // Show progress during sync
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Syncing with FlutterFlow",
        cancellable: false
      }, async (progress) => {
        progress.report({ increment: -1 });
        const projectRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        if (!projectRoot) {
          vscode.window.showErrorMessage("No project root found.");
          return;
        }

        // Push changes to FlutterFlow
        const projectId = projectMetadata?.project_id || "";
        const branchName = projectMetadata?.branch_name || "";
        const requestId = crypto.randomUUID();
        const apiClient = new FlutterFlowApiClient(getApiKey(), getCurrentApiUrl(), projectId, branchName);
        const syncCodeResult = await pushToFF(apiClient, projectRoot, currentUpdateManager, requestId);


        // Handle sync results
        if (syncCodeResult.error) {
          vscode.window.showErrorMessage(syncCodeResult.error.message);
        }
        fileErrorProvider.setFileErrorsMap(syncCodeResult.fileWarnings, currentUpdateManager.fileMap, projectRoot);
        const hasCriticalErrors = Array.from(syncCodeResult.fileWarnings?.values() || []).some(warnings => warnings.some(warning => warning.isCritical));
        if (!hasCriticalErrors) {
          await currentUpdateManager.setToSynced();
          modifiedFileTreeProvider.clearAllFiles();
          vscode.window.showInformationMessage("Push to FlutterFlow completed.");
        } else {
          vscode.window.showErrorMessage("Push to FlutterFlow failed. View FlutterFlow warnings panel for details.");
        }
      });
    }
  );

  // Register command to open modified files
  vscode.commands.registerCommand(
    "modifiedFiles.onClick",
    (filePath: string) => {
      vscode.workspace.openTextDocument(encodeURI(filePath)).then(
        (doc) => {
          vscode.window.showTextDocument(doc);
        },
        (err) => {
          vscode.window.showErrorMessage(`Failed to open file: ${err}`);
        }
      );
    }
  );

  // Register URI handler
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri: vscode.Uri): vscode.ProviderResult<void> {
        console.log('RYANDEBUG:handleUri', uri);
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

        //get download path from settings
        const downloadPath = vscode.workspace.getConfiguration("flutterflow").get<string>("downloadLocation") || "";
        console.log('RYANDEBUG:downloadPath', downloadPath);

        //check if the download path is a valid directory
        if (!fs.existsSync(downloadPath)) {
          vscode.window.showErrorMessage(`Invalid download path. ${downloadPath} does not exist.`);
          return;
        }
        // check if download path plus projectid exists
        const projectDownloadPath = path.join(downloadPath, projectId);
        const projectDownloadPathExists = fs.existsSync(projectDownloadPath);

        const openProject = async () => {
          try {
            if (!projectDownloadPathExists) {
              // download the project
              await downloadCodeWithPrompt(context, {
                projectId,
                branchName: branchName,
                downloadLocation: downloadPath,
                initialFile: fileName
              });
            }
            // add a popup asking the user to confirm the download or if they just want to open the project directory
            const confirmDownload = await vscode.window.showInformationMessage('Download and overwrite existing project? Or just open the project directory?', 'Download and overwrite', 'Open Project Directory');
            if (confirmDownload === 'Download and overwrite') {
              // Execute the download command with the parsed parameters
              // download the project
              await downloadCodeWithPrompt(context, {
                projectId,
                branchName: branchName,
                downloadLocation: downloadPath,
                initialFile: fileName
              });

            } else {
              const currentWorkspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
              if (currentWorkspacePath == projectDownloadPath) {
                // if the project is already open, just open the initial file
                vscode.workspace.openTextDocument(path.join(projectDownloadPath, fileName)).then((doc) => {
                  vscode.window.showTextDocument(doc);
                });
              } else {
                await setInitialFile(projectDownloadPath, fileName)
                // open the project directory
                await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(projectDownloadPath));
              }
            }
          } catch (err) {
            console.error('handleUrif:openProject error', err);
            vscode.window.showErrorMessage(`Error opening project from URL. ${err}`);
          }
        };

        // unawaited promise to open the project
        return openProject();
      }
    })
  );

  // Handle file rename events
  const renameDisposable = vscode.workspace.onDidRenameFiles(
    async (e: vscode.FileRenameEvent) => {
      for (const file of e.files) {
        const oldName = file.oldUri.fsPath;
        const newName = file.newUri.fsPath;
        const updateManager = context.workspaceState.get<UpdateManager>("updateManager");
        if (updateManager) {
          await updateManager.renameFile(oldName, newName);
        }
      }
    }
  );

  // Register all disposables
  context.subscriptions.push(
    runDownloadCode,
    syncWithFF,
    startCodeEditor,
    pullLatest,
    renameDisposable,
  );
  return context;
}

// Extension deactivation point
export function deactivate() { }
