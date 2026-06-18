import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodeType, FileInfo } from '../../fileUtils/FileInfo';
import {
    buildCustomCodeManifest,
    classifyRelativePath,
    computeChecksum,
    isFolderOrganizedFunctionsFile,
    isFolderOrganizedProject,
    parseExportDirectives,
    parseTopLevelFunctionName,
    reconcileFileMapWithManifest,
    resolveExportTarget,
} from '../../fileUtils/customCodeManifest';

const testDataDir = path.join(__dirname, '..', '..', '..', 'testdata');
const folderOrganizedRoot = path.join(testDataDir, 'folder_organized_project');
const legacyRoot = path.join(testDataDir, 'legacy_project');

function writeTempProject(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-test-'));
    for (const [relativePath, content] of Object.entries(files)) {
        const fullPath = path.join(root, ...relativePath.split('/'));
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content);
    }
    return root;
}

describe('parseExportDirectives', () => {
    it('parses absolute and relative exports with and without show clauses', () => {
        const directives = parseExportDirectives(`
// a comment
export '/custom_code/actions/do_this.dart' show doThis;
export 'my_action.dart' show myAction, otherAction;
export '/custom_code/functions/trim_string.dart';
`);
        assert.deepEqual(directives, [
            { uri: '/custom_code/actions/do_this.dart', shownNames: ['doThis'] },
            { uri: 'my_action.dart', shownNames: ['myAction', 'otherAction'] },
            { uri: '/custom_code/functions/trim_string.dart', shownNames: [] },
        ]);
    });

    it('ignores commented out exports', () => {
        const directives = parseExportDirectives(`
// export 'commented_out.dart' show commentedOut;
/* export 'block_commented.dart'; */
export 'real.dart' show real;
`);
        assert.deepEqual(directives, [{ uri: 'real.dart', shownNames: ['real'] }]);
    });
});

describe('resolveExportTarget', () => {
    it('resolves leading-slash URIs as lib-relative', () => {
        assert.equal(
            resolveExportTarget('/events/festival/my_func.dart', 'lib/flutter_flow/custom_functions.dart'),
            'lib/events/festival/my_func.dart'
        );
    });

    it('resolves bare URIs relative to the barrel directory', () => {
        assert.equal(
            resolveExportTarget('do_this.dart', 'lib/custom_code/actions/index.dart'),
            'lib/custom_code/actions/do_this.dart'
        );
    });
});

describe('isFolderOrganizedProject', () => {
    it('detects a folder-organized project', () => {
        assert.equal(isFolderOrganizedProject(folderOrganizedRoot), true);
    });

    it('detects a legacy project', () => {
        assert.equal(isFolderOrganizedProject(legacyRoot), false);
    });

    it('treats import statements and declarations as legacy', () => {
        assert.equal(isFolderOrganizedFunctionsFile(`import 'dart:convert';\n\nString f() { return ''; }`), false);
    });

    it('treats a pure export shim as folder-organized', () => {
        assert.equal(isFolderOrganizedFunctionsFile(`// comment\nexport '/custom_code/functions/a.dart';\n`), true);
    });
});

describe('parseTopLevelFunctionName', () => {
    it('parses the declared function name', () => {
        assert.equal(parseTopLevelFunctionName(`
import 'dart:convert';

String trimString(String input) {
  return input.trim();
}
`), 'trimString');
    });

    it('handles generic return types', () => {
        assert.equal(parseTopLevelFunctionName(`Future<List<String>> fetchAll() async {\n  return [];\n}`), 'fetchAll');
    });

    it('returns null when no declaration exists', () => {
        assert.equal(parseTopLevelFunctionName('// nothing here'), null);
    });

    it('prefers the name implied by the basename over a helper declared above it', () => {
        assert.equal(parseTopLevelFunctionName(`
String _helper(String input) {
  return input;
}

String trimString(String input) {
  return _helper(input).trim();
}
`, 'trimString'), 'trimString');
    });

    it('falls back to the first non-private function when the preferred name is absent', () => {
        assert.equal(parseTopLevelFunctionName(`
String _helper(String input) {
  return input;
}

String trimAll(String input) {
  return _helper(input).trim();
}
`, 'trimString'), 'trimAll');
    });

    it('returns null when only private functions are declared', () => {
        assert.equal(parseTopLevelFunctionName(`
String _helper(String input) {
  return input;
}
`, 'trimString'), null);
    });
});

describe('buildCustomCodeManifest', () => {
    it('builds a manifest for a folder-organized project', () => {
        const manifest = buildCustomCodeManifest(folderOrganizedRoot);
        assert.deepEqual(manifest.get('lib/custom_code/actions/do_this.dart'), { type: CodeType.ACTION, identifierName: 'doThis' });
        assert.deepEqual(manifest.get('lib/events/festival/plan_festival.dart'), { type: CodeType.ACTION, identifierName: 'planFestival' });
        assert.deepEqual(manifest.get('lib/custom_code/widgets/fancy_button.dart'), { type: CodeType.WIDGET, identifierName: 'FancyButton' });
        // Function identifiers come from the declared function name in the target file
        assert.deepEqual(manifest.get('lib/custom_code/functions/trim_string.dart'), { type: CodeType.FUNCTION, identifierName: 'trimString' });
        assert.deepEqual(manifest.get('lib/events/festival/festival_date.dart'), { type: CodeType.FUNCTION, identifierName: 'festivalDate' });
        // Falls back to the camelCase basename when no declaration can be parsed
        assert.deepEqual(manifest.get('lib/custom_code/functions/odd_one.dart'), { type: CodeType.FUNCTION, identifierName: 'oddOne' });
        // Standalone custom code files are tracked by their basename (including .dart)
        assert.deepEqual(manifest.get('lib/custom_code/my_helper.dart'), { type: CodeType.CODE_FILE, identifierName: 'my_helper.dart' });
        assert.equal(manifest.has('lib/flutter_flow/custom_functions.dart'), false);
        assert.equal(manifest.size, 7);
    });

    it('builds a manifest for a legacy project', () => {
        const manifest = buildCustomCodeManifest(legacyRoot);
        assert.deepEqual(manifest.get('lib/custom_code/actions/my_action.dart'), { type: CodeType.ACTION, identifierName: 'myAction' });
        assert.deepEqual(manifest.get('lib/custom_code/widgets/my_widget.dart'), { type: CodeType.WIDGET, identifierName: 'MyWidget' });
        assert.deepEqual(manifest.get('lib/flutter_flow/custom_functions.dart'), { type: CodeType.FUNCTION, identifierName: 'CustomFunctions' });
        assert.deepEqual(manifest.get('lib/custom_code/my_helper.dart'), { type: CodeType.CODE_FILE, identifierName: 'my_helper.dart' });
        assert.equal(manifest.size, 4);
    });

    it('rejects export targets that escape lib/', () => {
        const root = writeTempProject({
            'pubspec.yaml': 'name: traversal_test\n',
            'lib/flutter_flow/custom_functions.dart': [
                "export '/../../outside_func.dart';",
                "export '/custom_code/functions/good.dart';",
                '',
            ].join('\n'),
            'lib/custom_code/functions/good.dart': 'String good() {\n  return "";\n}\n',
            'lib/custom_code/actions/index.dart': [
                "export '../../../evil.dart' show evil;",
                "export 'fine.dart' show fine;",
                '',
            ].join('\n'),
            'lib/custom_code/actions/fine.dart': 'Future fine() async {}\n',
        });
        try {
            const manifest = buildCustomCodeManifest(root);
            assert.deepEqual(Array.from(manifest.keys()).sort(), [
                'lib/custom_code/actions/fine.dart',
                'lib/custom_code/functions/good.dart',
            ]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('classifyRelativePath', () => {
    it('classifies via the manifest first', () => {
        const manifest = buildCustomCodeManifest(folderOrganizedRoot);
        assert.equal(classifyRelativePath('lib/events/festival/plan_festival.dart', manifest, true), CodeType.ACTION);
        assert.equal(classifyRelativePath('lib/events/festival/festival_date.dart', manifest, true), CodeType.FUNCTION);
    });

    it('falls back to heuristics under lib/custom_code', () => {
        const manifest = buildCustomCodeManifest(folderOrganizedRoot);
        assert.equal(classifyRelativePath('lib/custom_code/actions/brand_new.dart', manifest, true), CodeType.ACTION);
        assert.equal(classifyRelativePath('lib/custom_code/widgets/brand_new.dart', manifest, true), CodeType.WIDGET);
        assert.equal(classifyRelativePath('lib/custom_code/functions/brand_new.dart', manifest, true), CodeType.FUNCTION);
        // Per-file functions don't exist in legacy mode
        assert.equal(classifyRelativePath('lib/custom_code/functions/brand_new.dart', manifest, false), CodeType.OTHER);
        assert.equal(classifyRelativePath('lib/custom_code/actions/index.dart', manifest, true), CodeType.OTHER);
    });

    it('classifies by exact canonical folder, not substring', () => {
        const manifest = buildCustomCodeManifest(folderOrganizedRoot);
        // 'transactions' contains 'actions'; the file is still a function
        assert.equal(classifyRelativePath('lib/custom_code/functions/get_transactions.dart', manifest, true), CodeType.FUNCTION);
        assert.equal(classifyRelativePath('lib/custom_code/functions/my_widgets_list.dart', manifest, true), CodeType.FUNCTION);
        // Files directly under lib/custom_code/ are standalone custom code files
        assert.equal(classifyRelativePath('lib/custom_code/actions_helper.dart', manifest, true), CodeType.CODE_FILE);
        // A file nested in an arbitrary subfolder of lib/custom_code/ is not classifiable
        assert.equal(classifyRelativePath('lib/custom_code/extractions/foo.dart', manifest, true), CodeType.OTHER);
    });

    it('classifies standalone custom code files but not the canonical subfolders', () => {
        const manifest = buildCustomCodeManifest(folderOrganizedRoot);
        assert.equal(classifyRelativePath('lib/custom_code/my_helper.dart', manifest, true), CodeType.CODE_FILE);
        assert.equal(classifyRelativePath('lib/custom_code/brand_new.dart', manifest, false), CodeType.CODE_FILE);
        // Regression guard: files in the actions/widgets/functions subfolders keep their
        // existing classification and must not be captured as standalone code files
        assert.equal(classifyRelativePath('lib/custom_code/actions/do_this.dart', manifest, true), CodeType.ACTION);
        assert.equal(classifyRelativePath('lib/custom_code/widgets/brand_new.dart', manifest, true), CodeType.WIDGET);
        assert.equal(classifyRelativePath('lib/custom_code/functions/brand_new.dart', manifest, true), CodeType.FUNCTION);
        // The barrel index file itself is never a standalone code file
        assert.equal(classifyRelativePath('lib/custom_code/index.dart', manifest, true), CodeType.OTHER);
    });

    it('cannot safely classify new files in arbitrary user folders', () => {
        const manifest = buildCustomCodeManifest(folderOrganizedRoot);
        assert.equal(classifyRelativePath('lib/events/festival/brand_new.dart', manifest, true), CodeType.OTHER);
        assert.equal(classifyRelativePath('lib/app_state.dart', manifest, true), CodeType.OTHER);
    });

    it('classifies the monolithic functions file and pubspec', () => {
        const manifest = buildCustomCodeManifest(legacyRoot);
        assert.equal(classifyRelativePath('lib/flutter_flow/custom_functions.dart', manifest, false), CodeType.FUNCTION);
        assert.equal(classifyRelativePath('pubspec.yaml', manifest, false), CodeType.DEPENDENCIES);
        // In folder-organized mode the shim itself is not a tracked custom code file
        assert.equal(classifyRelativePath('lib/flutter_flow/custom_functions.dart', buildCustomCodeManifest(folderOrganizedRoot), true), CodeType.OTHER);
    });
});

describe('reconcileFileMapWithManifest', () => {
    function fileInfo(overrides: Partial<FileInfo> & { type: CodeType }): FileInfo {
        return {
            old_identifier_name: 'name',
            new_identifier_name: 'name',
            is_deleted: false,
            ...overrides,
        };
    }

    it('backfills manifest entries missing from older file maps with on-disk checksums', () => {
        const manifest = buildCustomCodeManifest(folderOrganizedRoot);
        const saved = new Map<string, FileInfo>([
            ['lib/custom_code/actions/do_this.dart', fileInfo({
                type: CodeType.ACTION,
                old_identifier_name: 'doThis',
                new_identifier_name: 'doThis',
                original_checksum: 'saved-checksum',
                current_checksum: 'saved-checksum',
            })],
            ['pubspec.yaml', fileInfo({ type: CodeType.DEPENDENCIES })],
        ]);
        const reconciled = reconcileFileMapWithManifest(saved, manifest, true, folderOrganizedRoot);

        const backfilled = reconciled.get('lib/custom_code/functions/trim_string.dart');
        assert.ok(backfilled);
        assert.equal(backfilled.type, CodeType.FUNCTION);
        assert.equal(backfilled.old_identifier_name, 'trimString');
        assert.equal(backfilled.is_deleted, false);
        const diskChecksum = computeChecksum(path.join(folderOrganizedRoot, 'lib', 'custom_code', 'functions', 'trim_string.dart'));
        assert.equal(backfilled.original_checksum, diskChecksum);
        assert.equal(backfilled.current_checksum, diskChecksum);
        assert.ok(reconciled.has('lib/events/festival/festival_date.dart'));
        // Saved entries keep their checksums
        assert.equal(reconciled.get('lib/custom_code/actions/do_this.dart')?.original_checksum, 'saved-checksum');
        assert.ok(reconciled.has('pubspec.yaml'));
    });

    it('drops the monolithic functions entry in folder-organized projects', () => {
        const manifest = buildCustomCodeManifest(folderOrganizedRoot);
        const saved = new Map<string, FileInfo>([
            ['lib/flutter_flow/custom_functions.dart', fileInfo({ type: CodeType.FUNCTION })],
        ]);
        const reconciled = reconcileFileMapWithManifest(saved, manifest, true, folderOrganizedRoot);
        assert.ok(!reconciled.has('lib/flutter_flow/custom_functions.dart'));
    });

    it('relocates a uniquely-named legacy entry to its manifest path', () => {
        const manifest = buildCustomCodeManifest(folderOrganizedRoot);
        const saved = new Map<string, FileInfo>([
            ['lib/custom_code/actions/plan_festival.dart', fileInfo({
                type: CodeType.ACTION,
                old_identifier_name: 'planFestival',
                new_identifier_name: 'planFestival',
                original_checksum: 'saved-checksum',
                current_checksum: 'saved-checksum',
            })],
        ]);
        const reconciled = reconcileFileMapWithManifest(saved, manifest, true, folderOrganizedRoot);
        assert.ok(!reconciled.has('lib/custom_code/actions/plan_festival.dart'));
        assert.equal(reconciled.get('lib/events/festival/plan_festival.dart')?.original_checksum, 'saved-checksum');
    });

    it('drops a stale legacy entry when the manifest tracks a same-named file elsewhere', () => {
        const manifest = buildCustomCodeManifest(folderOrganizedRoot);
        const saved = new Map<string, FileInfo>([
            // Stale reconstructed path: no such file on disk
            ['lib/custom_code/actions/plan_festival.dart', fileInfo({
                type: CodeType.ACTION,
                original_checksum: 'stale-checksum',
                current_checksum: 'stale-checksum',
            })],
            // The real location is already tracked, so relocation cannot apply
            ['lib/events/festival/plan_festival.dart', fileInfo({
                type: CodeType.ACTION,
                old_identifier_name: 'planFestival',
                new_identifier_name: 'planFestival',
                original_checksum: 'real-checksum',
                current_checksum: 'real-checksum',
            })],
        ]);
        const reconciled = reconcileFileMapWithManifest(saved, manifest, true, folderOrganizedRoot);
        assert.ok(!reconciled.has('lib/custom_code/actions/plan_festival.dart'));
        assert.equal(reconciled.get('lib/events/festival/plan_festival.dart')?.original_checksum, 'real-checksum');
    });
});
