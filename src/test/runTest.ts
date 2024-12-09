import * as path from 'path';
import * as cp from 'child_process';
import {
    downloadAndUnzipVSCode,
    resolveCliArgsFromVSCodeExecutablePath,
    runTests
} from '@vscode/test-electron';

enum TestType {
    Unit = 'unit',
    // eslint-disable-next-line no-unused-vars
    E2E = 'e2e',
    SMOKE = 'smoke'
}

async function main() {
    try {
        // Get test type from command line args, default to Unit
        const testType = process.argv[2] as TestType || TestType.Unit;
        if (!Object.values(TestType).includes(testType)) {
            throw new Error(`Invalid test type. Must be one of: ${Object.values(TestType).join(', ')}`);
        }

        // The folder containing the Extension Manifest package.json
        // Passed to `--extensionDevelopmentPath`
        const extensionDevelopmentPath = path.resolve(__dirname, '../../');

        // Determine test path based on test type
        const extensionTestsPath = path.resolve(
            __dirname,
            //testType === TestType.Unit ? './unit/.' : './e2e/.'
           `./${testType}/.` 
        );

        // Download VS Code, unzip it and run the integration test
        const vscodeExecutablePath = await downloadAndUnzipVSCode('stable');
        const [cliPath, ...args] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);

        // Use cp.spawn / cp.exec for custom setup
        await cp.spawnSync(cliPath, [...args, '--install-extension', 'Dart-Code.dart-code'], {
            encoding: 'utf-8',
            stdio: 'inherit'
        });

        // Run the extension test
        await runTests({
            vscodeExecutablePath,
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: ['--disable-extension', 'FlutterFlow.flutterflow-custom-code-editor']
        });
    } catch (err) {
        console.error('Failed to run tests: ', err);
        process.exit(1);
    }
}

void main();
