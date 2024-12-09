import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

import { downloadCode } from '../../actions/downloadCode';
import { initializeCode } from '../../actions/initializeCodeEditor';
import { FlutterFlowApiClient } from '../../api/FlutterFlowApiClient';
import AdmZip from 'adm-zip';
import { readFileMap } from '../../fileUtils/fileParsing';
import { CodeType } from '../../fileUtils/FileInfo';
import { FFProjectState, EditEvent, ProjectState } from '../../ffState/FFProjectState';
import { pushToFF } from '../../actions/pushToFF';

suite('FlutterFlow Extension Integration Test', () => {
	// create a test directory that cleans up after itself

	let testWorkspacePath: string = "unsetpath";

	//const projectId = process.env.FF_TEST_PROJECT_ID || "test-amo1o4";
	const projectId = process.env.FF_TEST_PROJECT_ID || "vscode-test-03cgaf";
	const apiKey = process.env.FF_TEST_API_KEY || '';
	const apiUrl = process.env.FF_TEST_API_URL || "https://api.flutterflow.io/v1/";
	const branchName = process.env.FF_TEST_BRANCH_NAME || "";

	const testDataPath = path.join(__dirname, '../../../testdata');

	if (!projectId || !apiKey) {
		throw new Error('FF_TEST_PROJECT_ID and FF_TEST_API_KEY must be set in environment variables');
	}

	suiteSetup(async () => {
		// Create a test workspace
		testWorkspacePath = path.join(__dirname, 'test-workspace');
		testWorkspacePath = fs.mkdtempSync(testWorkspacePath);
		console.log('tmpDir created', testWorkspacePath);
		if (!fs.existsSync(testWorkspacePath)) {
			fs.mkdirSync(testWorkspacePath, { recursive: true });
		}

	});

	suiteTeardown(() => {
		// Clean up the test workspace
		fs.rmdirSync(testWorkspacePath, { recursive: true });
	});

	test('test download code', async function () {
		this.timeout(15000); // Increase timeout to 15 seconds

		// Download code
		await downloadCode(testWorkspacePath, new FlutterFlowApiClient(apiKey, apiUrl, projectId, branchName));

		// Assert that the necessary directories and files are created
		try {
			assert.strictEqual(fs.existsSync(path.join(testWorkspacePath, 'lib', 'custom_code', 'actions')), true, 'Custom code actions directory does not exist');
			assert.strictEqual(fs.existsSync(path.join(testWorkspacePath, 'lib', 'custom_code', 'widgets')), true, 'Custom code widgets directory does not exist');
			assert.strictEqual(fs.existsSync(path.join(testWorkspacePath, 'lib', 'flutter_flow', 'custom_functions.dart')), true, 'Custom functions file does not exist');
			assert.strictEqual(fs.existsSync(path.join(testWorkspacePath, 'pubspec.yaml')), true, 'pubspec.yaml file does not exist');
		} catch (e) {
			// Log the directory structure of the test workspace
			console.log('Test workspace directory structure:');
			console.log(fs.readdirSync(testWorkspacePath, { recursive: true, withFileTypes: true })
				.map(dirent => path.relative(testWorkspacePath, path.join(dirent.path, dirent.name)))
				.join('\n'));

			// Print ls in the test workspace
			console.log('ls output of test workspace:');
			console.log(fs.readdirSync(testWorkspacePath).join('\n'));

			throw e;
		}
	});

	test('test example coding session', async function () {
		this.timeout(45000); // Increase timeout to 45 seconds

		// create test workspace
		const testProjectPath = path.join(testWorkspacePath, 'test-project');
		if (fs.existsSync(testProjectPath)) {
			// remove directory and all files
			fs.rmSync(testProjectPath, { recursive: true, force: true });
		}
		fs.mkdirSync(testProjectPath, { recursive: true });
		// copy directory from ../data/test-project
		// unzip ../data/vscode-test-03cgaf.zip into testProjectPath	
		const zipFilePath = path.join(testDataPath, 'vscode-test-03cgaf.zip');
		// check if zip file exists
		if (!fs.existsSync(zipFilePath)) {
			throw new Error('project zip file does not exist at path: ' + zipFilePath);
		}
		const zip = new AdmZip(zipFilePath);

		// Extract all files to tempDir
		await zip.extractAllToAsync(testProjectPath, true, undefined, (error) => {
			if (error) {
				throw error;
			}
		});

		const workspaceFolderName = path.join(testProjectPath, 'vscode-test-03cgaf');
		//open the workspace folder in vscode by opening pubspec.yaml
		// await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(workspaceFolderName, 'pubspec.yaml')));
		// //wait for the workspace to be ready
		await new Promise(resolve => setTimeout(resolve, 7000));

		const { metadata, updateManager } = await initializeCode(workspaceFolderName);
		assert.ok(metadata);
		assert.ok(updateManager);


		const eventEmitter = new vscode.EventEmitter<EditEvent>();
		// send a test edit event
		//eventEmitter.fire({ filePath: 'test-file.dart', editType: 'add' });
		const projectState = new FFProjectState(eventEmitter, updateManager);
		assert.ok(projectState);


		const inMemoryFileMap = updateManager.fileMap;
		const onDiskFileMap = await readFileMap(workspaceFolderName);

		assert.deepEqual(inMemoryFileMap, onDiskFileMap);
		projectState.setState(ProjectState.EDITING);

		// make an edit to a action file new_custom_action_a.dart
		const actionPath = path.join(workspaceFolderName, 'lib', 'custom_code', 'actions', 'new_custom_action_a.dart');
		await fs.promises.writeFile(actionPath, 'Future<void> newCustomActionA() async {print("Hello from e2e test");}');
		eventEmitter.fire({ filePath: actionPath, editType: 'update' });
		// Create a promise that resolves when onFileChange is called
		const fileChangePromise = new Promise<void>(resolve => {

			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			projectState.updateManager.onFileChange((changedFilePath, changedFileInfo) => {
				resolve();
			});
		});

		// Wait for the file change callback to be triggered
		await fileChangePromise;

		const modifiedActionFileInfo = updateManager.fileMap.get('new_custom_action_a.dart');
		// check if the file map is updated
		assert.strictEqual(modifiedActionFileInfo?.original_checksum, inMemoryFileMap.get('new_custom_action_a.dart')?.original_checksum, 'original checksum mismatch on action modified');
		assert.strictEqual(modifiedActionFileInfo?.current_checksum !== modifiedActionFileInfo?.original_checksum, true, 'current checksum should not match original checksum on action modified');

		// check that the map was serialized
		const serializedFileMap = await readFileMap(workspaceFolderName);
		assert.deepEqual(updateManager.fileMap, serializedFileMap, 'file map should match serialized file map');

		// test add a new action file
		const newActionPath = path.join(workspaceFolderName, 'lib', 'custom_code', 'actions', 'new_custom_action_c.dart');
		await fs.promises.writeFile(newActionPath, '');
		eventEmitter.fire({ filePath: newActionPath, editType: 'add' });

		const fileCreatedPromise = new Promise<void>(resolve => {
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			projectState.updateManager.onFileChange((changedFilePath, changedFileInfo) => {
				resolve();
			});
		});


		// Wait for the file change callback to be triggered from the file creation
		await fileCreatedPromise;

		// Adding an empty file should trigger a boilerplate insertion and an update event
		eventEmitter.fire({ filePath: newActionPath, editType: 'update' });
		const boilerplateInsertedPromise = new Promise<void>(resolve => {
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			projectState.updateManager.onFileChange((changedFilePath, changedFileInfo) => {
				resolve();
			});
		});


		// Wait for the file change callback to be triggered from the boilerplate insertion
		await boilerplateInsertedPromise;

		// check if the file map is updated
		const newActionFileInfo = updateManager.fileMap.get('new_custom_action_c.dart');


		assert.ok(newActionFileInfo, 'New action file info should exist in file map');
		assert.ok(newActionFileInfo?.current_checksum, `New action file should have a current checksum \n${newActionFileInfo}`);
		assert.strictEqual(newActionFileInfo?.current_checksum !== newActionFileInfo?.original_checksum, true, 'Current checksum should not match original checksum for new action file');
		assert.strictEqual(newActionFileInfo?.original_checksum, undefined, 'Original checksum should be undefined for new action file');
		assert.strictEqual(newActionFileInfo?.is_deleted, false, 'New action file should not be marked as deleted');
		assert.strictEqual(newActionFileInfo?.type, CodeType.ACTION, 'New file should have ACTION type');

		// test file deletion
		const fileInfoBeforeDelete = updateManager.fileMap.get('new_custom_action_b.dart');
		await vscode.workspace.fs.delete(vscode.Uri.file(path.join(workspaceFolderName, 'lib', 'custom_code', 'actions', 'new_custom_action_b.dart')));
		eventEmitter.fire({ filePath: path.join(workspaceFolderName, 'lib', 'custom_code', 'actions', 'new_custom_action_b.dart'), editType: 'delete' });
		// wait for changes to be processed
		await new Promise(resolve => setTimeout(resolve, 1000));

		const fileInfoAfterDelete = updateManager.fileMap.get('new_custom_action_b.dart');
		assert.strictEqual(fileInfoAfterDelete?.is_deleted, true, 'File should be marked as deleted');
		// assert that the file info before delete is the same as the file info after delete except for the is_deleted field
		assert.strictEqual(fileInfoBeforeDelete?.original_checksum, fileInfoAfterDelete?.original_checksum, 'Original checksum should match before and after delete');
		assert.strictEqual(fileInfoBeforeDelete?.current_checksum, fileInfoAfterDelete?.current_checksum, 'Current checksum should match before and after delete');
		assert.strictEqual(fileInfoBeforeDelete?.type, fileInfoAfterDelete?.type, 'File type should match before and after delete');

		// test function changes

		// 		const expectedOriginalFunctionCode =
		// 			`import 'dart:convert';
		// import 'dart:math' as math;

		// import 'package:flutter/material.dart';
		// import 'package:google_fonts/google_fonts.dart';
		// import 'package:intl/intl.dart';
		// import 'package:timeago/timeago.dart' as timeago;
		// import 'lat_lng.dart';
		// import 'place.dart';
		// import 'uploaded_file.dart';

		// String ? newCustomFunctionA() {
		// 	return 'a';
		// }

		// String ? newCustomFunctionB(int aNumber) {
		// 	return 'b';
		// }`;
		const expectedOriginalFunctionCode = fs.readFileSync(path.join(workspaceFolderName, 'lib', 'flutter_flow', 'custom_functions.dart'), 'utf8');
		assert.strictEqual(updateManager.functionsCode, expectedOriginalFunctionCode, 'Original function code should match expected code');

		const modifiedFunctionAResult =
			`import 'dart:convert';
		import 'dart:math' as math;

		import 'package:flutter/material.dart';
		import 'package:google_fonts/google_fonts.dart';
		import 'package:intl/intl.dart';
		import 'package:timeago/timeago.dart' as timeago;
		import 'lat_lng.dart';
		import 'place.dart';
		import 'uploaded_file.dart';

		String ? newCustomFunctionA(String suffix) {
			return 'a' + suffix;
		}

		String ? newCustomFunctionB(int aNumber) {
			return 'b';
		}`;
		const customFunctionsPath = path.join(workspaceFolderName, 'lib', 'flutter_flow', 'custom_functions.dart');
		await vscode.workspace.fs.writeFile(vscode.Uri.file(customFunctionsPath), new TextEncoder().encode(modifiedFunctionAResult));

		eventEmitter.fire({ filePath: customFunctionsPath, editType: 'update' });
		const customFunctionsUpdatedPromise = new Promise<void>(resolve => {
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			projectState.updateManager.onFileChange((changedFilePath, changedFileInfo) => {
				resolve();
			});
		});


		// Wait for the file change callback to be triggered from the custom functions update
		await customFunctionsUpdatedPromise;

		assert.strictEqual(updateManager.functionsCode, modifiedFunctionAResult, 'Modified function code should match expected code');
		const modifiedFunctionFileInfo = updateManager.fileMap.get('custom_functions.dart');
		assert.strictEqual(modifiedFunctionFileInfo?.current_checksum !== modifiedFunctionFileInfo?.original_checksum, true, 'Current checksum should not match original checksum on function modified');
		const functionChange = await updateManager.functionChange();
		// modifications shouldn't need to be recorded explicitly in the function change object
		const expectedFunctionChange = {
			functions_to_rename: [],
			functions_to_delete: [],
			functions_to_add: [],
		};
		assert.deepEqual(functionChange, expectedFunctionChange, 'Function change should match expected change');
		// TODO: test widget changes, these are almost the same as the action changes so the tests should be very similar

		// test sync
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const mockFetchFn = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
			const body = JSON.parse(init?.body as string);

			// Basic request validation
			assert.strictEqual(body.project_id, projectId, 'Project ID should match');
			assert.ok(body.zipped_custom_code.length > 0, 'Zipped custom code should not be empty');
			assert.strictEqual(body.uid, requestId, 'Request ID should match');
			assert.strictEqual(body.branch_name, branchName, 'Branch name should match');

			// Validate file_map
			const fileMap = JSON.parse(body.file_map);
			assert.ok(fileMap['new_custom_action_a.dart'], 'Modified action should be in file map');
			assert.ok(fileMap['new_custom_action_c.dart'], 'New action should be in file map');
			assert.ok(fileMap['new_custom_action_b.dart']?.is_deleted, 'Deleted action should be marked as deleted');
			assert.ok(fileMap['custom_functions.dart'], 'Custom functions file should be in file map');

			// Validate functions_map
			const functionsMap = JSON.parse(body.functions_map);
			assert.deepStrictEqual(functionsMap, {
				functions_to_rename: [],
				functions_to_delete: [],
				functions_to_add: [],
			}, 'Functions map should match expected structure');

			// Validate serialized_yaml exists
			assert.ok(body.serialized_yaml, 'Serialized YAML should exist');

			return new Response(JSON.stringify({ value: JSON.stringify({}) }));
		};
		const requestId = '123l';
		const apiClient = new FlutterFlowApiClient(apiKey, apiUrl, projectId, branchName, mockFetchFn);
		const syncCodeResult = await pushToFF(apiClient, workspaceFolderName, updateManager, requestId);
		assert.strictEqual(syncCodeResult.error, null, 'Sync should not return an error, but got: ' + syncCodeResult.error);
	});
});
