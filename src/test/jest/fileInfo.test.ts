import * as assert from 'assert';
import { CodeType, FileInfo, functionChangeFromFileMap, migrateLegacyFileMapKeys } from '../../fileUtils/FileInfo';

function fileInfo(overrides: Partial<FileInfo> & { type: CodeType }): FileInfo {
    return {
        old_identifier_name: 'name',
        new_identifier_name: 'name',
        is_deleted: false,
        ...overrides,
    };
}

describe('migrateLegacyFileMapKeys', () => {
    it('migrates basename keys to legacy canonical relative paths', () => {
        const legacyMap = new Map<string, FileInfo>([
            ['do_this.dart', fileInfo({ type: CodeType.ACTION })],
            ['my_widget.dart', fileInfo({ type: CodeType.WIDGET })],
            ['custom_functions.dart', fileInfo({ type: CodeType.FUNCTION })],
            ['pubspec.yaml', fileInfo({ type: CodeType.DEPENDENCIES })],
        ]);
        const migrated = migrateLegacyFileMapKeys(legacyMap);
        assert.deepEqual(Array.from(migrated.keys()), [
            'lib/custom_code/actions/do_this.dart',
            'lib/custom_code/widgets/my_widget.dart',
            'lib/flutter_flow/custom_functions.dart',
            'pubspec.yaml',
        ]);
        assert.equal(migrated.get('lib/custom_code/actions/do_this.dart'), legacyMap.get('do_this.dart'));
    });

    it('leaves path keys untouched', () => {
        const pathKeyed = new Map<string, FileInfo>([
            ['lib/events/festival/plan_festival.dart', fileInfo({ type: CodeType.ACTION })],
            ['lib/custom_code/functions/trim_string.dart', fileInfo({ type: CodeType.FUNCTION })],
            ['pubspec.yaml', fileInfo({ type: CodeType.DEPENDENCIES })],
        ]);
        const migrated = migrateLegacyFileMapKeys(pathKeyed);
        assert.deepEqual(Array.from(migrated.keys()), Array.from(pathKeyed.keys()));
    });
});

describe('functionChangeFromFileMap', () => {
    it('derives adds, deletes, and renames from per-file function entries', () => {
        const fileMap = new Map<string, FileInfo>([
            // unchanged function
            ['lib/custom_code/functions/unchanged.dart', fileInfo({
                type: CodeType.FUNCTION,
                old_identifier_name: 'unchanged',
                new_identifier_name: 'unchanged',
                original_checksum: 'aaa',
                current_checksum: 'aaa',
            })],
            // new function file (no original checksum)
            ['lib/custom_code/functions/added_func.dart', fileInfo({
                type: CodeType.FUNCTION,
                old_identifier_name: 'addedFunc',
                new_identifier_name: 'addedFunc',
                current_checksum: 'bbb',
            })],
            // deleted function file
            ['lib/events/festival/old_func.dart', fileInfo({
                type: CodeType.FUNCTION,
                old_identifier_name: 'oldFunc',
                new_identifier_name: 'oldFunc',
                original_checksum: 'ccc',
                current_checksum: 'ccc',
                is_deleted: true,
            })],
            // renamed function (declaration changed in place)
            ['lib/custom_code/functions/renamed.dart', fileInfo({
                type: CodeType.FUNCTION,
                old_identifier_name: 'beforeName',
                new_identifier_name: 'afterName',
                original_checksum: 'ddd',
                current_checksum: 'eee',
            })],
            // actions and widgets are not functions
            ['lib/custom_code/actions/do_this.dart', fileInfo({ type: CodeType.ACTION, is_deleted: true, original_checksum: 'fff' })],
        ]);
        assert.deepEqual(functionChangeFromFileMap(fileMap), {
            functions_to_rename: [{
                old_function_name: 'beforeName',
                new_function_name: 'afterName',
                renamed_by_symbol: false,
            }],
            functions_to_delete: ['oldFunc'],
            functions_to_add: ['addedFunc'],
        });
    });

    it('ignores functions that were added and deleted without syncing', () => {
        const fileMap = new Map<string, FileInfo>([
            ['lib/custom_code/functions/flash.dart', fileInfo({
                type: CodeType.FUNCTION,
                old_identifier_name: 'flash',
                new_identifier_name: 'flash',
                current_checksum: 'aaa',
                is_deleted: true,
            })],
        ]);
        assert.deepEqual(functionChangeFromFileMap(fileMap), {
            functions_to_rename: [],
            functions_to_delete: [],
            functions_to_add: [],
        });
    });
});
