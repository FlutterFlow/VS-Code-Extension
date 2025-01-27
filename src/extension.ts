// The module 'vscode' contains the VS Code extensibility API
import * as vscode from "vscode";
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
import { FlutterFlowMetadata } from "./ffState/FlutterFlowMetadata";

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

/**
 * Extension activation point - called when extension is activated
 * Sets up commands, UI components, and file watchers
 */
export function activate(context: vscode.ExtensionContext): vscode.ExtensionContext {
  // Register UI components
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
    async (args: DownloadCodeArgs) => {
      try {
        const currentWorkspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
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
