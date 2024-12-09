import path from "path";
import * as vscode from "vscode";
import { CodeType, FileInfo } from "../fileUtils/FileInfo";
import { UpdateManager } from "../ffState/UpdateManager";

// This TreeView provider handles the "Modified Files" side panel in vscode.
// Users can double click flies to remove them from being synced. On saving a file,
// it will be added to "Modified Files".
class FFCustomCodeTreeProvider implements vscode.TreeDataProvider<FileItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<
        FileItem | undefined | null | void
    > = new vscode.EventEmitter<FileItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<
        FileItem | undefined | null | void
    > = this._onDidChangeTreeData.event;

    private fileItems: FileItem[] = [];
    private fileNames: Set<string> = new Set();

    constructor() { }

    public update(fullFilePath: string, fileInfo: FileInfo) {
        this.updateOrAddFromFileInfo(fullFilePath, fileInfo);
        this.refresh();
    }
    public subscribeToUpdates(updateManager: UpdateManager) {
        for (const [filename, fileInfo] of updateManager.fileMap.entries()) {
            // add each file to the tree if neccessary
            this.updateOrAddFromFileInfo(filename, fileInfo);
        }
        // subscribe to updates
        updateManager.onFileChange((filePath, fileInfo) => {
            this.updateOrAddFromFileInfo(filePath, fileInfo);
        });

    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: FileItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: FileItem): Thenable<FileItem[]> {
        if (element) {
            return Promise.resolve([]);
        } else {
            return Promise.resolve(
                this.fileItems
            );
        }
    }

    refreshFromFileMap(fileMap: Map<string, FileInfo>) {
        this.fileItems = [];
        this.fileNames.clear();
        for (const [filePath, fileInfo] of fileMap.entries()) {
            this.updateOrAddFromFileInfo(filePath, fileInfo);
        }
        this.refresh();
    }

    updateOrAddFromFileInfo(filePath: string, fileInfo: FileInfo) {
        let typeDesc = '';
        if (fileInfo.type === CodeType.WIDGET) {
            typeDesc = 'Widget ';
        } else if (fileInfo.type === CodeType.ACTION) {
            typeDesc = 'Action ';
        }
        if (fileInfo.is_deleted) {
            this.addModifiedFile(filePath, `Deleted ${typeDesc}${fileInfo.old_identifier_name}`, FileUpdateType.DELETED);
        } else if (!fileInfo.original_checksum) {
            this.addModifiedFile(filePath, `Added ${typeDesc}${fileInfo.old_identifier_name}`, FileUpdateType.ADDED);
        } else {
            if (fileInfo.current_checksum !== fileInfo.original_checksum) {
                if (fileInfo.old_identifier_name !== fileInfo.new_identifier_name) {
                    this.addModifiedFile(filePath, `Renamed ${typeDesc}from ${fileInfo.old_identifier_name} to ${typeDesc}${fileInfo.new_identifier_name}`, FileUpdateType.RENAMED);
                } else {
                    this.addModifiedFile(filePath, `Updated ${typeDesc}${fileInfo.old_identifier_name}`, FileUpdateType.MODIFIED);
                }
            }
        }
    }

    addModifiedFile(filePath: string, desc: string, updateType: FileUpdateType = FileUpdateType.MODIFIED) {
        if (this.fileNames.has(filePath)) {
            this.updateModifiedFile(filePath, desc, updateType);
        } else {
            this.fileItems.push(
                new FileItem(
                    path.basename(filePath),
                    vscode.TreeItemCollapsibleState.None,
                    filePath,
                    desc,
                    updateType
                )
            );
            this.fileNames.add(filePath);
        }

        this.refresh();
    }

    updateModifiedFile(filePath: string, desc: string, updateType: FileUpdateType = FileUpdateType.MODIFIED) {
        if (!this.fileNames.has(filePath)) return;
        const index = this.fileItems.findIndex((f) => f.label === path.basename(filePath));
        if (index !== -1) {
            // Only update if the new update type is higher priority than the current update type
            if (fileUpdateTypeOrder.indexOf(updateType) >= fileUpdateTypeOrder.indexOf(this.fileItems[index].updateType)) {
                this.fileItems[index].updateType = updateType;
                this.fileItems[index].description = desc;
                this.refresh();
            }
        }
    }
    removeModifiedFile(filePath: string) {
        if (!this.fileNames.has(filePath)) return;
        const index = this.fileItems.findIndex((f) => f.filePath === filePath);
        if (index !== -1) {
            this.fileItems.splice(index, 1);
            this.refresh();
        }
    }

    clearAllFiles() {
        this.fileItems = [];
        this.fileNames.clear();
        this.refresh();
    }
}

export enum FileUpdateType {
    ADDED,
    DELETED,
    RENAMED,
    MODIFIED,
}

// Define order of update types
const fileUpdateTypeOrder = [
    FileUpdateType.MODIFIED,
    FileUpdateType.RENAMED,
    FileUpdateType.ADDED,
    FileUpdateType.DELETED,
];

class FileItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode
            .TreeItemCollapsibleState.None,
        public readonly filePath?: string,
        public description?: string,
        public updateType: FileUpdateType = FileUpdateType.MODIFIED
    ) {
        super(label, collapsibleState);
        this.tooltip = `${path.basename(this.label)}`;
        this.description = description;
        this.command = {
            command: "modifiedFiles.onClick",
            title: "Open File",
            arguments: [this.filePath, this],
        };
        // Use file type icon for file names (e.g .dart, .json, .txt)
        this.resourceUri = vscode.Uri.file(this.label || "");
        this.iconPath = vscode.ThemeIcon.File;
        this.updateType = updateType;
    }
}

export { FFCustomCodeTreeProvider, FileItem };
