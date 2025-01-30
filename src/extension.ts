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
    // Check for pubspec.yaml and verify it's a FlutterFlow project
    const pubspecPath = vscode.Uri.joinPath(rootUri, 'pubspec.yaml');
    const pubspecStat = await vscode.workspace.fs.stat(pubspecPath);
    if (!pubspecStat.size || pubspecStat.size === 0) {
      return false;
    }

    // Check for .vscode/ff_metadata.json and verify it's readable
    const metadataPath = vscode.Uri.joinPath(rootUri, '.vscode', 'ff_metadata.json');
    const metadataContent = await vscode.workspace.fs.readFile(metadataPath);
    const metadata = JSON.parse(new TextDecoder().decode(metadataContent));

    return !!(metadata.project_id); // Ensure we have a project ID
  } catch (error) {
    console.log('checkRequiredFiles error:', error);
    return false;
  }
}

/**
 * Extension activation point - called when extension is activated
 * Sets up commands, UI components, and file watchers
 */
export function activate(context: vscode.ExtensionContext): vscode.ExtensionContext {
  // Register UI components
  console.log('activating FlutterFlow Custom Code Editor extension');

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

  // Modify the initialization sequence
  checkRequiredFiles().then(async (isFlutterFlowProject) => {
    if (!isFlutterFlowProject) {
      return; // Exit if not a FlutterFlow project
    }

    try {
      const projectPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
      if (!projectPath) {
        throw new Error('No workspace folder found');
      }

      // Then handle initial file opening first
      const initialFile = await getInitialFile(projectPath);
      if (initialFile) {
        const fullPath = path.join(projectPath, initialFile);

        // Verify file exists before attempting to open
        if (fs.existsSync(fullPath)) {
          const doc = await vscode.workspace.openTextDocument(fullPath);
          await vscode.window.showTextDocument(doc);
        }
      }

      // Initialize the code editor
      await initCodeEditorFn();
    } catch (error) {
      console.error('Initialization error:', error);
      vscode.window.showErrorMessage(`Failed to initialize FlutterFlow project: ${error}`);
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

        const openProject = async () => {
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


            // Get download path from settings.
            // TODO: should we assume this download path or prompt the user for it like the normal download flow?
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

            // If project is already open in current workspace
            if (currentWorkspacePath === projectDownloadPath) {
              if (fileName) {
                const fullPath = path.join(projectDownloadPath, fileName);
                if (fs.existsSync(fullPath)) {
                  const doc = await vscode.workspace.openTextDocument(fullPath);
                  await vscode.window.showTextDocument(doc);
                }
              }
              // Ensure editor is initialized
              await initCodeEditorFn();
              return;
            }

            // Project exists but isn't open
            if (projectDownloadPathExists) {
              const choice = await vscode.window.showInformationMessage(
                'Project already exists locally. What would you like to do?',
                { modal: true },
                'Open Existing',
                'Download Fresh Copy'
              );

              if (choice === 'Open Existing') {
                if (fileName) {
                  await setInitialFile(projectDownloadPath, fileName);
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
              initialFile: fileName
            });

          } catch (err) {
            console.error('handleUri:openProject error', err);
            vscode.window.showErrorMessage(`Error opening project from URL: ${err}`);
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
