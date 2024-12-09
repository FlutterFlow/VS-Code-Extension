import * as vscode from 'vscode';
import * as fs from 'fs';
import { FileInfo } from '../fileUtils/FileInfo';
import { deserializeUpdateManager, UpdateManager } from './UpdateManager';

// Interface defining the structure of edit events that occur in the project
export interface EditEvent {
    filePath: string;  // Path of the file being edited
    editType: 'add' | 'delete' | 'update';  // Type of edit operation
}

// Interface combining edit events with file information
interface FFUpdateEvent {
    editEvent: EditEvent;  // The edit event that occurred
    fileInfo: FileInfo;    // Information about the file being edited
}

// Enum representing different states of the project
export enum ProjectState {
    UNINITIALIZED = "UNINITIALIZED",  // Initial state before project setup
    EDITING = "EDITING",               // Active editing state
    PULLING = "PULLING",               // Pulling changes from FlutterFlow
    PUSHING = "PUSHING",               // Pushing changes to FlutterFlow
    ERROR = "ERROR"                    // Error state
}

// Main class managing the state of a FlutterFlow project
export class FFProjectState {
    // Event emitter for project edits
    private _editStream: vscode.EventEmitter<EditEvent> = new vscode.EventEmitter();

    // Event emitter for project updates
    private _updateStream: vscode.EventEmitter<FFUpdateEvent> = new vscode.EventEmitter();
    onUpdate: vscode.Event<FFUpdateEvent> = this._updateStream.event;

    // Current state of the project
    private _state: ProjectState = ProjectState.UNINITIALIZED;
    private _updateManager: UpdateManager;

    // Getter for the update manager instance
    get updateManager(): UpdateManager {
        return this._updateManager;
    }

    constructor(editStream: vscode.EventEmitter<EditEvent>, updateManager: UpdateManager) {
        this._state = ProjectState.UNINITIALIZED;
        this._editStream = editStream;
        this._updateManager = updateManager;

        // Subscribe to edit events and process them
        this._editStream.event(async (edit) => {
            // Only process edits when in EDITING state
            if (this._state !== ProjectState.EDITING) {
                return;
            }
            const isDirectory = await fs.promises.lstat(edit.filePath).then((stats) => stats.isDirectory()).catch(() => false);
            if (isDirectory) {
                return;
            }
            let fileInfo: FileInfo | null = null;
            // Handle different types of edits
            if (edit.editType === 'add') {
                fileInfo = await this._updateManager.addFile(edit.filePath);
            } else if (edit.editType === 'delete') {
                fileInfo = await this._updateManager.deleteFile(edit.filePath);
            } else if (edit.editType === 'update') {
                fileInfo = await this._updateManager.updateFile(edit.filePath);
            }
            // If file info was updated, emit update event and serialize changes
            if (fileInfo) {
                this._updateStream.fire({ editEvent: edit, fileInfo: fileInfo });
                await this._updateManager.serializeUpdateManager();
            }
        });
    }

    // Set the current state of the project
    public setState(state: ProjectState) {
        this._state = state;
    }

    // Refresh the update manager instance
    public async refreshUpdateManager() {
        this._updateManager = await deserializeUpdateManager(this._updateManager.rootPath);
    }
}

// Create and configure a file system watcher for edit events
export function createEditStream(fileWatcher: vscode.FileSystemWatcher): vscode.EventEmitter<EditEvent> {
    const editStream = new vscode.EventEmitter<EditEvent>();

    // Watch for file changes
    fileWatcher.onDidChange(async (event) => {
        editStream.fire({ filePath: event.fsPath, editType: 'update' });
    });

    // Watch for file creation
    fileWatcher.onDidCreate(async (event) => {
        editStream.fire({ filePath: event.fsPath, editType: 'add' });
    });

    // Watch for file deletion
    fileWatcher.onDidDelete(async (event) => {
        editStream.fire({ filePath: event.fsPath, editType: 'delete' });
    });

    return editStream;
}
