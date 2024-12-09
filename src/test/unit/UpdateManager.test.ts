/* eslint-disable @typescript-eslint/no-unused-expressions */
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as fs from 'fs';
import * as assert from 'assert';
import * as os from 'os';
import * as crypto from 'crypto';

import { describe, it, beforeEach, afterEach } from 'mocha';
import { UpdateManager, deserializeUpdateManager, computeChecksum } from '../../ffState/UpdateManager';
import * as path from 'path';
import { FileInfo } from '../../fileUtils/FileInfo';
import { mockFiles } from '../util/mockFiles';
import { FunctionChange } from '../../fileUtils/functionSimilarity';

let updateManager: UpdateManager;
// let fileMap: Map<string, FileInfo>;
// let actionIndex: Map<string, string[]>;
// let widgetIndex: Map<string, string[]>;
// let functionsCode: string;

async function createBaseTempDir() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'UpdateManager-test-'));
    for (const [file, content] of mockFiles) {
        const filePath = path.join(tempDir, file);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(filePath, content);
    }
    return tempDir;
}
describe('UpdateManager', () => {
    let tempDir: string;


    beforeEach(async () => {
        tempDir = await createBaseTempDir();

        updateManager = await deserializeUpdateManager(tempDir);
        //updateManager = new UpdateManager(new Map(), tempDir, new Map(), new Map(), '', '');
    });

    afterEach(() => {
        if (tempDir) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('should add an action file correctly', async () => {
        updateManager = await deserializeUpdateManager(tempDir);
        const filePath = path.join(tempDir, 'lib/custom_code/actions/test_action_a.dart');
        await updateManager.insertBoilerplate(filePath);
        const result = await updateManager.addFile(filePath);
        assert.ok(result);
        assert.deepEqual(result, {
            is_deleted: false,
            new_identifier_name: 'testActionA',
            old_identifier_name: 'testActionA',
            type: 'A',
        });

        const fileMap: Map<string, FileInfo> = (updateManager as any).fileMap;
        const actionIndex: Map<string, string[]> = (updateManager as any).actionIndex;
        assert.ok(fileMap.has('test_action_a.dart'));
        assert.ok(actionIndex.has('test_action_a.dart'));
    });

    it('should add a widget file correctly', async () => {
        const filePath = path.join(tempDir, 'lib/custom_code/widgets/test_widget_a.dart');
        await updateManager.insertBoilerplate(filePath);
        const result = await updateManager.addFile(filePath);
        assert.ok(result);
        assert.deepEqual(result, {
            is_deleted: false,
            new_identifier_name: 'TestWidgetA',
            old_identifier_name: 'TestWidgetA',
            type: 'W',
        });
        const fileMap: Map<string, FileInfo> = (updateManager as any).fileMap;
        const widgetIndex: Map<string, string[]> = (updateManager as any).widgetIndex;
        assert.ok(fileMap.has('test_widget_a.dart'));
        assert.ok(widgetIndex.has('test_widget_a.dart'));
    });

    // TODO: add test for non-dart files
    // TODO: add test for custom functions

    it('should update an action file correctly', async () => {

        const filePath = path.join(tempDir, 'lib/custom_code/actions/my_action.dart');
        const originalChecksum = computeChecksum(filePath);
        const originalContent = fs.readFileSync(filePath, 'utf8');
        await fs.promises.writeFile(filePath, originalContent + '\n//test comment addition');
        const currentChecksum = computeChecksum(filePath);
        const result = await updateManager.updateFile(filePath);
        assert.ok(result);
        assert.deepEqual(result, {
            is_deleted: false,
            new_identifier_name: 'myAction',
            old_identifier_name: 'myAction',
            type: 'A',
            original_checksum: originalChecksum,
            current_checksum: currentChecksum,
        });
        const actionIndex: Map<string, string[]> = (updateManager as any).actionIndex;
        assert.deepEqual(actionIndex.get('my_action.dart'), ['myAction']);
    });

    it('should delete an action file correctly', async () => {

        const filePath = path.join(tempDir, 'lib/custom_code/actions/my_action.dart');
        const originalChecksum = computeChecksum(filePath);

        const result = await updateManager.deleteFile(filePath);
        assert.ok(result);
        assert.deepEqual(result, {
            is_deleted: true,
            new_identifier_name: 'myAction',
            old_identifier_name: 'myAction',
            type: 'A',
            original_checksum: originalChecksum,
            current_checksum: originalChecksum,
        });
        const actionIndex: Map<string, string[]> = (updateManager as any).actionIndex;
        assert.ok(!actionIndex.has('my_action.dart'));
    });

    it('should generate function changes correctly', async () => {

        const functionImports = `// Automatic FlutterFlow imports
import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import 'package:timeago/timeago.dart' as timeago;
import '/flutter_flow/lat_lng.dart';
import '/flutter_flow/place.dart';
import '/flutter_flow/uploaded_file.dart';
import '/flutter_flow/custom_functions.dart';
`;
        const testCases: { initialFunctionsCode: string, currentFunctionsCode: string, expectedFunctionChanges: FunctionChange }[] = [
            {
                initialFunctionsCode: functionImports, // empty
                currentFunctionsCode: functionImports + `

void testFunctionA() {
    print('testFunctionA');
}
`,
                expectedFunctionChanges: {
                    functions_to_rename: [],
                    functions_to_delete: [],
                    functions_to_add: ['testFunctionA'],
                },
            },
            {
                initialFunctionsCode: functionImports + `
void testFunctionA() {
    print('testFunctionA');
}
`,
                currentFunctionsCode: functionImports + `

void testFunctionANew() {
    print('testFunctionA');
}

void testFunctionB() {
    // test comment addition
    print('testFunctionB');
}
`,
                expectedFunctionChanges: {
                    functions_to_rename: [
                        {
                            old_function_name: 'testFunctionA',
                            new_function_name: 'testFunctionANew',
                            renamed_by_symbol: false,
                        },
                    ],
                    functions_to_delete: [],
                    functions_to_add: ['testFunctionB'],
                },
            },
            {
                initialFunctionsCode: functionImports + `
void testFunctionA() {
    print('testFunctionA');
}

void testFunctionB() {
    // test comment addition
    print('testFunctionB');
}

void testFunctionC() {
    // test comment addition
    print('testFunctionC');
}
`,
                currentFunctionsCode: functionImports + `

void testFunctionA() {
    print('testFunctionA');
}

void testFunctionC() {
    // test comment addition
    print('testFunctionC');
}
`,
                expectedFunctionChanges: {
                    functions_to_rename: [],
                    functions_to_delete: ['testFunctionB'],
                    functions_to_add: [],
                },
            },
            {
                initialFunctionsCode: functionImports + `
void testFunctionA() {
    print('testFunctionA');
}
`,
                currentFunctionsCode: functionImports, // empty
                expectedFunctionChanges: {
                    functions_to_rename: [],
                    functions_to_delete: ['testFunctionA'],
                    functions_to_add: [],
                },
            },
        ];

        for (const [index, testCase] of testCases.entries()) {
            // generate checksums
            const initialChecksum = crypto.createHash('sha256').update(testCase.initialFunctionsCode).digest('hex');
            const currentChecksum = crypto.createHash('sha256').update(testCase.currentFunctionsCode).digest('hex');
            const initialFileMap = new Map();
            initialFileMap.set('flutter_flow/custom_functions.dart', {
                name: 'custom_functions.dart',
                is_deleted: false,
                original_checksum: initialChecksum,
                current_checksum: currentChecksum,
            });
            updateManager = new UpdateManager(initialFileMap, tempDir, new Map(), new Map(), testCase.currentFunctionsCode, testCase.initialFunctionsCode);
            const functionChanges = await updateManager.functionChange();
            assert.deepEqual(functionChanges, testCase.expectedFunctionChanges, `function changes should match expected for test case ${index}`);
        }
    });
});

// Other test cases (deleteFile, updateFile, etc.) would be converted similarly