import * as vscode from "vscode";

export class FfStatusBar extends vscode.Disposable {
    private syncButton: vscode.StatusBarItem;
    private pullStatusBarItem: vscode.StatusBarItem;
    private projectIdBarItem: vscode.StatusBarItem;


    constructor(projectId: string) {
        super(() => {
            this.syncButton.dispose();
            this.pullStatusBarItem.dispose();
            this.projectIdBarItem.dispose();
        });

        this.syncButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
        this.pullStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
        this.projectIdBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);

        // Initializes sync button in the status bar
        this.syncButton = vscode.window.createStatusBarItem();
        this.syncButton.text = "$(arrow-up) Push to FlutterFlow";
        this.syncButton.command = "extension.callApi";

        // Initializes pull latest button in the status bar
        this.pullStatusBarItem = vscode.window.createStatusBarItem();
        this.pullStatusBarItem.text = "$(cloud-download) FF: Pull Latest";
        this.pullStatusBarItem.tooltip = "Pull latest changes";
        this.pullStatusBarItem.command = "extension.pullLatest";

        this.projectIdBarItem = vscode.window.createStatusBarItem();
        this.projectIdBarItem.text = `$(project) Project ID: ${projectId}`;
        this.projectIdBarItem.tooltip = "Click to open FlutterFlow project";
        this.projectIdBarItem.command = "extension.openFlutterFlowProject";
    }

    public updateProjectId(projectId: string) {
        this.projectIdBarItem.text = `$(project) Project ID: ${projectId}`;
        this.show();
    }

    public show() {
        this.syncButton.show();
        this.pullStatusBarItem.show();
        this.projectIdBarItem.show();
    }


}