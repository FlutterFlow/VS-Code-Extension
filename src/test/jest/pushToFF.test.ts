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
    it('keys the wire file map by basename and filters OTHER and DEPENDENCIES entries', () => {
        const fileMap = new Map<string, FileInfo>([
            ['lib/custom_code/actions/do_this.dart', fileInfo({ type: CodeType.ACTION })],
            ['lib/events/festival/plan_festival.dart', fileInfo({ type: CodeType.ACTION, current_checksum: 'bbb' })],
            ['lib/custom_code/functions/trim_string.dart', fileInfo({ type: CodeType.FUNCTION })],
            ['pubspec.yaml', fileInfo({ type: CodeType.DEPENDENCIES })],
            ['lib/some/other.dart', fileInfo({ type: CodeType.OTHER })],
        ]);
        const { wireFileMap, collidingPaths } = buildWireFileMap(fileMap);
        assert.deepEqual(Object.keys(wireFileMap).sort(), ['do_this.dart', 'plan_festival.dart', 'trim_string.dart']);
        assert.equal(wireFileMap['plan_festival.dart'].current_checksum, 'bbb');
        assert.deepEqual(collidingPaths, []);
    });

    it('reports basename collisions among modified files', () => {
        const fileMap = new Map<string, FileInfo>([
            ['lib/custom_code/functions/helper.dart', fileInfo({ type: CodeType.FUNCTION, current_checksum: 'changed' })],
            ['lib/events/helper.dart', fileInfo({ type: CodeType.FUNCTION })],
        ]);
        const { collidingPaths } = buildWireFileMap(fileMap);
        assert.deepEqual(collidingPaths, [['lib/custom_code/functions/helper.dart', 'lib/events/helper.dart']]);
    });

    it('reports basename collisions involving deleted files', () => {
        const fileMap = new Map<string, FileInfo>([
            ['lib/custom_code/actions/act.dart', fileInfo({ type: CodeType.ACTION, is_deleted: true })],
            ['lib/events/act.dart', fileInfo({ type: CodeType.ACTION })],
        ]);
        const { collidingPaths } = buildWireFileMap(fileMap);
        assert.equal(collidingPaths.length, 1);
    });

    it('does not fail on collisions when neither file has pending changes', () => {
        const fileMap = new Map<string, FileInfo>([
            ['lib/custom_code/functions/helper.dart', fileInfo({ type: CodeType.FUNCTION })],
            ['lib/events/helper.dart', fileInfo({ type: CodeType.FUNCTION })],
        ]);
        const { collidingPaths } = buildWireFileMap(fileMap);
        assert.deepEqual(collidingPaths, []);
    });
});
