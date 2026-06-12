import * as assert from 'assert';
import { CodeType, FileInfo } from '../../fileUtils/FileInfo';
import { buildWireFileMap } from '../../actions/pushToFF';

function fileInfo(overrides: Partial<FileInfo> & { type: CodeType }): FileInfo {
    return {
        old_identifier_name: 'name',
        new_identifier_name: 'name',
        is_deleted: false,
        original_checksum: 'aaa',
        current_checksum: 'aaa',
        ...overrides,
    };
}

describe('buildWireFileMap', () => {
    it('keys the wire file map by basename and only includes modified or deleted entries', () => {
        const fileMap = new Map<string, FileInfo>([
            ['lib/custom_code/actions/do_this.dart', fileInfo({ type: CodeType.ACTION })],
            ['lib/events/festival/plan_festival.dart', fileInfo({ type: CodeType.ACTION, current_checksum: 'bbb' })],
            ['lib/custom_code/functions/trim_string.dart', fileInfo({ type: CodeType.FUNCTION })],
            ['lib/custom_code/widgets/old_widget.dart', fileInfo({ type: CodeType.WIDGET, is_deleted: true })],
            ['pubspec.yaml', fileInfo({ type: CodeType.DEPENDENCIES, current_checksum: 'ccc' })],
            ['lib/some/other.dart', fileInfo({ type: CodeType.OTHER, current_checksum: 'ddd' })],
        ]);
        const { wireFileMap, collidingPaths } = buildWireFileMap(fileMap);
        assert.deepEqual(Object.keys(wireFileMap).sort(), ['old_widget.dart', 'plan_festival.dart']);
        assert.equal(wireFileMap['plan_festival.dart'].current_checksum, 'bbb');
        assert.equal(wireFileMap['old_widget.dart'].is_deleted, true);
        assert.deepEqual(collidingPaths, []);
    });

    it('reports basename collisions among modified files', () => {
        const fileMap = new Map<string, FileInfo>([
            ['lib/custom_code/functions/helper.dart', fileInfo({ type: CodeType.FUNCTION, current_checksum: 'changed' })],
            ['lib/events/helper.dart', fileInfo({ type: CodeType.FUNCTION, current_checksum: 'also_changed' })],
        ]);
        const { collidingPaths } = buildWireFileMap(fileMap);
        assert.deepEqual(collidingPaths, [['lib/custom_code/functions/helper.dart', 'lib/events/helper.dart']]);
    });

    it('reports basename collisions between a deleted and a modified file', () => {
        const fileMap = new Map<string, FileInfo>([
            ['lib/custom_code/actions/act.dart', fileInfo({ type: CodeType.ACTION, is_deleted: true })],
            ['lib/events/act.dart', fileInfo({ type: CodeType.ACTION, current_checksum: 'changed' })],
        ]);
        const { collidingPaths } = buildWireFileMap(fileMap);
        assert.equal(collidingPaths.length, 1);
    });

    it('does not block on a same-basename pair when only one rides in the request', () => {
        // Legacy projects can legitimately hold an action and a widget with the same
        // file name; editing one must not brick pushing.
        const fileMap = new Map<string, FileInfo>([
            ['lib/custom_code/actions/cool.dart', fileInfo({ type: CodeType.ACTION, current_checksum: 'changed' })],
            ['lib/custom_code/widgets/cool.dart', fileInfo({ type: CodeType.WIDGET })],
        ]);
        const { wireFileMap, collidingPaths } = buildWireFileMap(fileMap);
        assert.deepEqual(collidingPaths, []);
        assert.equal(wireFileMap['cool.dart'].type, CodeType.ACTION);
    });

    it('does not fail on collisions when neither file has pending changes', () => {
        const fileMap = new Map<string, FileInfo>([
            ['lib/custom_code/functions/helper.dart', fileInfo({ type: CodeType.FUNCTION })],
            ['lib/events/helper.dart', fileInfo({ type: CodeType.FUNCTION })],
        ]);
        const { wireFileMap, collidingPaths } = buildWireFileMap(fileMap);
        assert.deepEqual(collidingPaths, []);
        assert.deepEqual(Object.keys(wireFileMap), []);
    });
});
