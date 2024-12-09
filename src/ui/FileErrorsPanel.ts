import * as vscode from "vscode";
import * as path from "path";
import { FileWarning } from "../api/FlutterFlowApiClient";
import { FileInfo, getRelativePath } from "../fileUtils/FileInfo";


// FileErrorItem class for displaying file errors in the Flutterflow Problems panel
class FileErrorItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly filePath?: string,
        public readonly fileType?: string,
        public readonly errorMessage?: string,
        public readonly isCritical?: boolean
    ) {
        super(label, collapsibleState);

        if (this.errorMessage) {
            this.tooltip = this.errorMessage;
            this.command = {
                command: "fileErrors.openFile",
                title: "Open File",
                arguments: [this.filePath],
            };
            if (!isCritical) {
                this.iconPath = new vscode.ThemeIcon(
                    "warning",
                    new vscode.ThemeColor("editorWarning.foreground")
                );
            } else {
                this.iconPath = new vscode.ThemeIcon(
                    "error",
                    new vscode.ThemeColor("editorError.foreground")
                );
            }
        } else {
            // Use file type icon for file names (e.g .dart, .json, .txt)
            this.resourceUri = vscode.Uri.file(this.filePath || "");
            this.iconPath = vscode.ThemeIcon.File;
        }
    }
}

// FileErrorProvider allows panel to be dynamically updated with errors
export class FileErrorProvider implements vscode.TreeDataProvider<FileErrorItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<
        FileErrorItem | undefined | null | void
    > = new vscode.EventEmitter<FileErrorItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<
        FileErrorItem | undefined | null | void
    > = this._onDidChangeTreeData.event;

    private fileErrors: Map<string, FileWarning[]>;
    private rootPath: string;
    private fileMap: Map<string, FileInfo>;

    constructor(fileErrors: Map<string, FileWarning[]>, rootPath: string, fileMap: Map<string, FileInfo>) {
        this.fileErrors = fileErrors;
        this.rootPath = rootPath;
        this.fileMap = fileMap;
    }

    getTreeItem(element: FileErrorItem): vscode.TreeItem {
        return element;
    }

    setFileErrorsMap(fileErrors: Map<string, FileWarning[]>, fileMap: Map<string, FileInfo>, rootPath: string) {
        this.fileErrors = fileErrors;
        this.fileMap = fileMap;
        this.rootPath = rootPath;
        this.refresh();
    }

    getChildren(element?: FileErrorItem): Thenable<FileErrorItem[]> {
        if (!element) {
            // Root level, return file names
            return Promise.resolve(
                Array.from(this.fileErrors.keys()).map(
                    (fileName) => {
                        const fileInfo = this.fileMap.get(fileName);
                        const filePath = fileInfo ? path.join(this.rootPath, getRelativePath(fileName, fileInfo)) : fileName;
                        return new FileErrorItem(
                            fileName,
                            vscode.TreeItemCollapsibleState.Collapsed,
                            filePath,
                        );
                    }
                )
            );
        } else {
            // Child level, return errors for the file
            const errors = this.fileErrors.get(element.label || "") || [];
            console.log(errors);
            return Promise.resolve(
                errors.map(
                    (error) =>
                        new FileErrorItem(
                            error.errorMessage,
                            vscode.TreeItemCollapsibleState.None,
                            element.filePath,
                            error.fileType,
                            error.errorMessage,
                            error.isCritical
                        )
                )
            );
        }
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }
}