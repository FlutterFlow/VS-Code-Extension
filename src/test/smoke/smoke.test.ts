import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { DownloadCodeArgs } from '../../actions/downloadCode';

export async function switchWorkspaceInTest(targetPath: string): Promise<void> {
    // Create a workspace configuration
    const workspaceConfig = {
        folders: [{ path: targetPath }]
    };
    
    // Write temporary workspace file
    const workspaceFile = path.join(targetPath, 'test.code-workspace');
    fs.writeFileSync(workspaceFile, JSON.stringify(workspaceConfig));

    // Remove all existing workspace folders
    const folders = vscode.workspace.workspaceFolders;
    if (folders) {
        await vscode.workspace.updateWorkspaceFolders(0, folders.length);
    }

    // Add new workspace folder
    await vscode.workspace.updateWorkspaceFolders(0, 0, { uri: vscode.Uri.file(targetPath) });

    // Wait for workspace to update
    await new Promise(resolve => setTimeout(resolve, 1000));
}

suite('FlutterFlow Extension Tests', () => {
    let testWorkspacePath: string;
    let projectPath: string;
    const projectId = process.env.FF_TEST_PROJECT_ID || "vscode-test-03cgaf";
    const apiKey = process.env.FF_TEST_API_KEY || '';
    //const apiUrl = process.env.FF_TEST_API_URL || "https://api.flutterflow.io/v1/";
    const branchName = process.env.FF_TEST_BRANCH_NAME || "";

    if (!projectId || !apiKey) {
        throw new Error('FF_TEST_PROJECT_ID and FF_TEST_API_KEY must be set in environment variables');
    }

    suiteSetup(async function() {
        this.timeout(60000); // Increase timeout to 1 minute
        // Create a test workspace
        testWorkspacePath = path.join(__dirname, 'test-workspace');
        testWorkspacePath = fs.mkdtempSync(testWorkspacePath);
        if (!fs.existsSync(testWorkspacePath)) {
            fs.mkdirSync(testWorkspacePath, { recursive: true });
        }

        projectPath = path.join(testWorkspacePath, projectId);
        fs.mkdirSync(projectPath, { recursive: true });
        // Activate the extension
        
        const ext = vscode.extensions.getExtension('flutterflow.flutterflow-vscode');
        await ext?.activate();
        // change directory to test workspace in vscode
        await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(testWorkspacePath), false);
        // pause for 1 second
        await new Promise(resolve => setTimeout(resolve, 100000));

    });

    suiteTeardown(() => {
        // Clean up the test workspace
        fs.rmdirSync(testWorkspacePath, { recursive: true });
    });

    test('should download and open project', async function () {
        this.timeout(60000); // Increase timeout to 1 minute

        // Download the code
        await vscode.commands.executeCommand("flutterflow-download", {
            apiKey: apiKey,
            projectId: projectId,
            downloadLocation: testWorkspacePath,
            branchName: branchName,
            skipOpen: true
        } as DownloadCodeArgs);

        // Wait for download to complete
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Verify project directory was created
        assert.ok(fs.existsSync(projectPath), 'Project directory should exist after download');

        // Switch to the project workspace
        await switchWorkspaceInTest(projectPath);

        // Verify workspace switch
        const currentWorkspace = vscode.workspace.workspaceFolders?.[0];
        assert.ok(currentWorkspace, 'Workspace should be defined');
        assert.strictEqual(currentWorkspace.uri.fsPath, projectPath, 'Workspace should be set to project path');

        // Start code editing session
        await vscode.commands.executeCommand("flutterflow-run-custom-code-editor");
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Verify file_map.json exists and is valid
        const fileMapPath = path.join(projectPath, '.vscode', 'file_map.json');
        assert.ok(fs.existsSync(fileMapPath), 'file_map.json should exist');
        
        const fileMap = JSON.parse(fs.readFileSync(fileMapPath, 'utf-8'));
        assert.ok(fileMap, 'File map should be valid JSON');
        console.log('File map content:', JSON.stringify(fileMap, null, 2));
        // TODO: We need to extend this test do  something like:
        // take a list of projects and download them.
        // for each addand action, function, and widget, push then pull, then verify
        // edit all existing actions widgets and functions (maybe just with a comment), push pull and verify
        // delete the original added action, function, and widget, push pull and verify
        // -----
        // If we do this on a larg enough set of projects its 
    });
});