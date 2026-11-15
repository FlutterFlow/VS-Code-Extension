import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    applyReadonlyGlobs,
    clearReadonlySettings,
    MANAGED_FILE_NAME,
    removeReadonlyGlobs,
    writeReadonlySettings,
} from '../../fileUtils/readonlySettings';

const FF_INCLUDE = { '**': true };
const FF_EXCLUDE = { 'lib/custom_code/**': true, 'pubspec.yaml': true, '.vscode/settings.json': true };

function tmpProject(settings?: unknown): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-readonly-'));
    if (settings !== undefined) {
        fs.mkdirSync(path.join(dir, '.vscode'));
        fs.writeFileSync(path.join(dir, '.vscode', 'settings.json'), typeof settings === 'string' ? settings : JSON.stringify(settings));
    }
    return dir;
}
const readSettings = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, '.vscode', 'settings.json'), 'utf8'));

describe('applyReadonlyGlobs / removeReadonlyGlobs', () => {
    it('keeps the user\'s own read-only globs and only records what it added', () => {
        const user = {
            'editor.tabSize': 2,
            'files.readonlyInclude': { 'build/**': true },
            'files.readonlyExclude': { 'pubspec.yaml': false },
        };
        const { settings, added } = applyReadonlyGlobs(user, FF_INCLUDE, FF_EXCLUDE);
        assert.deepEqual(settings['files.readonlyInclude'], { 'build/**': true, '**': true });
        // user's explicit pubspec.yaml value wins
        assert.equal((settings['files.readonlyExclude'] as Record<string, boolean>)['pubspec.yaml'], false);
        assert.deepEqual(added.include, ['**']);
        assert.deepEqual(added.exclude.sort(), ['.vscode/settings.json', 'lib/custom_code/**']);

        const restored = removeReadonlyGlobs(settings, added);
        assert.deepEqual(restored, user);
    });

    it('drops the read-only keys entirely when only extension globs were present', () => {
        const { settings, added } = applyReadonlyGlobs({}, FF_INCLUDE, FF_EXCLUDE);
        assert.deepEqual(removeReadonlyGlobs(settings, added), {});
    });
});

describe('writeReadonlySettings / clearReadonlySettings', () => {
    it('creates settings.json and can fully remove its rules again', async () => {
        const dir = tmpProject();
        assert.equal(await writeReadonlySettings(dir, FF_INCLUDE, FF_EXCLUDE), true);
        assert.deepEqual(readSettings(dir)['files.readonlyInclude'], { '**': true });
        assert.ok(fs.existsSync(path.join(dir, '.vscode', MANAGED_FILE_NAME)));

        assert.equal(await clearReadonlySettings(dir), true);
        assert.deepEqual(readSettings(dir), {});
        assert.ok(!fs.existsSync(path.join(dir, '.vscode', MANAGED_FILE_NAME)));
    });

    it('replaces its own entries on re-download without duplicating or touching user settings', async () => {
        const dir = tmpProject({ 'files.readonlyExclude': { 'my_notes/**': true } });
        await writeReadonlySettings(dir, FF_INCLUDE, { ...FF_EXCLUDE, 'lib/old_action.dart': true });
        await writeReadonlySettings(dir, FF_INCLUDE, FF_EXCLUDE);
        const exclude = readSettings(dir)['files.readonlyExclude'];
        assert.equal(exclude['lib/old_action.dart'], undefined);
        assert.equal(exclude['my_notes/**'], true);

        await clearReadonlySettings(dir);
        assert.deepEqual(readSettings(dir), { 'files.readonlyExclude': { 'my_notes/**': true } });
    });

    it('cleans up projects downloaded by older versions that left no record', async () => {
        const dir = tmpProject({
            'dart.lineLength': 100,
            'files.readonlyInclude': { '**': true },
            'files.readonlyExclude': { 'lib/custom_code/**': true, 'pubspec.yaml': true, '.vscode/settings.json': true },
        });
        assert.equal(await clearReadonlySettings(dir), true);
        assert.deepEqual(readSettings(dir), { 'dart.lineLength': 100 });
    });

    it('does not rewrite a settings.json it cannot parse (e.g. with comments)', async () => {
        const jsonc = '{\n  // my comment\n  "editor.tabSize": 2\n}';
        const dir = tmpProject(jsonc);
        assert.equal(await writeReadonlySettings(dir, FF_INCLUDE, FF_EXCLUDE), false);
        assert.equal(fs.readFileSync(path.join(dir, '.vscode', 'settings.json'), 'utf8'), jsonc);
    });

    it('reports nothing to unlock in an unrelated project', async () => {
        const dir = tmpProject({ 'editor.tabSize': 2 });
        assert.equal(await clearReadonlySettings(dir), false);
        assert.deepEqual(readSettings(dir), { 'editor.tabSize': 2 });
    });
});
