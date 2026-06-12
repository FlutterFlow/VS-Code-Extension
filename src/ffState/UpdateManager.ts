import * as vscode from 'vscode';
import { FileInfo, CodeType, functionChangeFromFileMap, migrateLegacyFileMapKeys } from "../fileUtils/FileInfo";
import * as path from 'path';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import { readFileMap, writeFileMap } from "../fileUtils/fileParsing";
import { FunctionChange, functionSimilarity } from "../fileUtils/functionSimilarity";
import { insertCustomActionBoilerplate, insertCustomFunctionFileBoilerplate, insertCustomWidgetBoilerplate, toCamelCase, toPascalCase } from "../fileUtils/addBoilerplate";
import { parseTopLevelFunctions, getTopLevelNames, parseIndexFileWithDart, formatDartCode } from '../fileUtils/dartParser';
import {
  buildCustomCodeManifest,
  classifyRelativePath,
  computeChecksum,
  CustomCodeManifest,
  fullPathFromKey,
  isFolderOrganizedProject,
  kActionsBarrelPath,
  kCustomFunctionsPath,
  kWidgetsBarrelPath,
  parseExportDirectives,
  parseTopLevelFunctionName,
  reconcileFileMapWithManifest,
  resolveExportTarget,
  toPosixPath,
} from '../fileUtils/customCodeManifest';

export { computeChecksum };

// Path to store snapshot of custom functions for tracking changes
const kCustomFunctionsSnapshotPath = path.join('lib', 'flutter_flow', 'custom_functions_snapshot.txt');

// Only warn once per session about files we cannot classify.
let warnedAboutUnclassifiedFile = false;

/**
 * UpdateManager class is responsible for tracking and managing changes to custom code in a FlutterFlow project.
 * It handles file operations, state management, and synchronization with FlutterFlow.
 * Key responsibilities include:
 * - Tracking file modifications, additions, and deletions
 * - Managing custom actions and widgets
 * - Handling function renames and updates
 * - Maintaining file checksums for change detection
 */
export class UpdateManager {
  // Map of files and their metadata.
  // The map is keyed by project-root-relative POSIX path and contains FileInfo objects with metadata about each file.
  private _fileMap: Map<string, FileInfo>;
  // Event emitter for file changes
  private _eventEmitter: EventEmitter;
  // Maps for tracking exported symbols in action and widget files, keyed by export URI
  private actionIndex: Map<string, string[]>;
  private widgetIndex: Map<string, string[]>;
  // Export shim entries for folder-organized custom functions, keyed by export URI
  private functionsIndex: Map<string, string[]>;
  // Current and initial state of custom functions
  private _functionsCode: string;
  private _initialFunctionsCode: string;
  // Whether the project uses the folder-organized custom code structure
  private _folderOrganized: boolean;
  // Manifest of custom code files derived from the barrel files
  private _manifest: CustomCodeManifest;
  // Flag to temporarily pause file operations
  private paused: boolean = false;
  // Root path of the project
  private _rootPath: string;

  // Getters for internal state
  public get fileMap(): Map<string, FileInfo> {
    return new Map(this._fileMap);
  }

  public get functionsCode(): string {
    return this._functionsCode;
  }

  public get rootPath(): string {
    return this._rootPath;
  }

  public get folderOrganized(): boolean {
    return this._folderOrganized;
  }

  constructor(
    fileMap: Map<string, FileInfo>,
    rootPath: string,
    actionIndex: Map<string, string[]>,
    widgetIndex: Map<string, string[]>,
    functionsCode: string,
    initialFunctionsCode: string,
    folderOrganized: boolean = false,
    manifest: CustomCodeManifest = new Map(),
    functionsIndex: Map<string, string[]> = new Map()
  ) {
    this._fileMap = fileMap;
    this._rootPath = rootPath;
    this.actionIndex = actionIndex;
    this.widgetIndex = widgetIndex;
    this.functionsIndex = functionsIndex;
    this._functionsCode = functionsCode;
    this._initialFunctionsCode = initialFunctionsCode;
    this._folderOrganized = folderOrganized;
    this._manifest = manifest;
    this._eventEmitter = new EventEmitter();
  }

  /**
   * Subscribe to file change events
   * @param listener Callback function that receives file path and FileInfo
   */
  public onFileChange(listener: (filePath: string, fileInfo: FileInfo) => void): void {
    this._eventEmitter.on('fileChange', listener);
  }

  public clearFileChangeListeners() {
    this._eventEmitter.removeAllListeners('fileChange');
  }

  // Converts an absolute (or already relative) path to a project-root-relative POSIX key.
  private relativeKey(filePath: string): string {
    const relative = path.isAbsolute(filePath) ? path.relative(this._rootPath, filePath) : filePath;
    return toPosixPath(relative);
  }

  private classify(relativeKey: string): CodeType {
    const codeType = classifyRelativePath(relativeKey, this._manifest, this._folderOrganized);
    if (codeType !== CodeType.OTHER) {
      return codeType;
    }
    return this._fileMap.get(relativeKey)?.type ?? CodeType.OTHER;
  }

  /**
   * Returns whether a watcher event for this file should be processed. Files that are
   * neither tracked nor classifiable are ignored; newly created dart files outside the
   * canonical custom code folders additionally trigger a one-time warning.
   */
  public shouldTrackFile(filePath: string, editType: 'add' | 'delete' | 'update'): boolean {
    const relKey = this.relativeKey(filePath);
    if (relKey.startsWith('..')) return false;
    if (this._fileMap.has(relKey) || this._manifest.has(relKey)) return true;
    if (this.classify(relKey) !== CodeType.OTHER) return true;
    if (
      this._folderOrganized &&
      editType === 'add' &&
      relKey.startsWith('lib/') &&
      relKey.endsWith('.dart') &&
      path.posix.basename(relKey) !== 'index.dart' &&
      !warnedAboutUnclassifiedFile
    ) {
      warnedAboutUnclassifiedFile = true;
      vscode.window.showWarningMessage(
        "Create new custom actions/widgets/functions under lib/custom_code/... or in FlutterFlow; files created elsewhere won't sync."
      );
    }
    return false;
  }

  // Finds the barrel export URI whose resolved target matches the given file key.
  private indexKeyForFile(indexMap: Map<string, string[]>, barrelRelativePath: string, relativeKey: string): string | undefined {
    for (const exportUri of indexMap.keys()) {
      if (resolveExportTarget(exportUri, barrelRelativePath) === relativeKey) {
        return exportUri;
      }
    }
    return undefined;
  }

  private barrelFullPath(barrelRelativePath: string): string {
    return fullPathFromKey(this._rootPath, barrelRelativePath);
  }

  /**
   * Handles deletion of a file from the project
   * Updates file map and relevant indexes
   * @param filePath Path of file to delete
   * @returns FileInfo of deleted file or null
   */
  public async deleteFile(filePath: string): Promise<FileInfo | null> {
    if (this.paused) return null;
    const relKey = this.relativeKey(filePath);
    const codeType = this.classify(relKey);

    if (codeType === CodeType.OTHER) return null;
    if (codeType === CodeType.FUNCTION && !this._folderOrganized) {
      throw new Error('Cannot delete function file');
    }

    const fileInfo = this._fileMap.get(relKey);
    if (!fileInfo) {
      return null;
    }

    fileInfo.is_deleted = true;
    this._fileMap.set(relKey, fileInfo);

    // Update relevant index file
    if (codeType === CodeType.ACTION) {
      const indexKey = this.indexKeyForFile(this.actionIndex, kActionsBarrelPath, relKey);
      if (indexKey !== undefined) {
        this.actionIndex.delete(indexKey);
        await this.saveIndexFile(this.actionIndex, this.barrelFullPath(kActionsBarrelPath));
      }
    } else if (codeType === CodeType.WIDGET) {
      const indexKey = this.indexKeyForFile(this.widgetIndex, kWidgetsBarrelPath, relKey);
      if (indexKey !== undefined) {
        this.widgetIndex.delete(indexKey);
        await this.saveIndexFile(this.widgetIndex, this.barrelFullPath(kWidgetsBarrelPath));
      }
    } else if (codeType === CodeType.FUNCTION) {
      const indexKey = this.indexKeyForFile(this.functionsIndex, kCustomFunctionsPath, relKey);
      if (indexKey !== undefined) {
        this.functionsIndex.delete(indexKey);
        await this.saveIndexFile(this.functionsIndex, this.barrelFullPath(kCustomFunctionsPath));
      }
    }

    writeFileMap(this._rootPath, this._fileMap);
    this._eventEmitter.emit('fileChange', fullPathFromKey(this._rootPath, relKey), fileInfo);
    return fileInfo;
  }

  /** Re-adds the barrel export that deleteFile removed, if it is missing. */
  private async restoreIndexEntry(relKey: string, fileInfo: FileInfo, codeType: CodeType): Promise<void> {
    const libUri = `/${relKey.replace(/^lib\//, '')}`;
    if (codeType === CodeType.ACTION) {
      if (this.indexKeyForFile(this.actionIndex, kActionsBarrelPath, relKey) === undefined) {
        this.actionIndex.set(libUri, [fileInfo.new_identifier_name]);
        await this.saveIndexFile(this.actionIndex, this.barrelFullPath(kActionsBarrelPath));
      }
    } else if (codeType === CodeType.WIDGET) {
      if (this.indexKeyForFile(this.widgetIndex, kWidgetsBarrelPath, relKey) === undefined) {
        this.widgetIndex.set(libUri, [fileInfo.new_identifier_name]);
        await this.saveIndexFile(this.widgetIndex, this.barrelFullPath(kWidgetsBarrelPath));
      }
    } else if (codeType === CodeType.FUNCTION && this._folderOrganized) {
      if (this.indexKeyForFile(this.functionsIndex, kCustomFunctionsPath, relKey) === undefined) {
        this.functionsIndex.set(libUri, []);
        await this.saveIndexFile(this.functionsIndex, this.barrelFullPath(kCustomFunctionsPath));
      }
    }
  }

  /**
   * Adds a new file to the project and updates the corresponding index.
   * Creates a new FileInfo entry with default values based on the file type.
   * @param filePath The path of the file to be added
   * @returns The created FileInfo object, or null if addition was paused or file type is not supported
   */
  public async addFile(filePath: string): Promise<FileInfo | null> {
    if (this.paused) return null;
    const relKey = this.relativeKey(filePath);
    const codeType = this.classify(relKey);
    if (codeType === CodeType.OTHER) return null;

    // Add boilerplate if file is empty
    if (fs.readFileSync(filePath, "utf8").length === 0) {
      await this.insertBoilerplate(filePath);
    }

    const existingFileInfo = this._fileMap.get(relKey);
    if (existingFileInfo) {
      if (existingFileInfo.type === codeType) {
        return this.updateFile(filePath);
      }
    }

    // Create new FileInfo with default values
    const impliedName = codeType === CodeType.WIDGET ?
      toPascalCase(path.basename(filePath, '.dart')) :
      toCamelCase(path.basename(filePath, '.dart'));

    const fileInfo: FileInfo = {
      old_identifier_name: impliedName,
      new_identifier_name: impliedName,
      type: codeType as CodeType,
      is_deleted: false,
    };

    this._fileMap.set(relKey, fileInfo);

    // Update relevant index file. New files can only be created in the canonical
    // folders, so a basename (actions/widgets) or lib-relative (functions) URI is correct.
    const baseName = path.basename(filePath);
    if (codeType === CodeType.ACTION) {
      this.actionIndex.set(baseName, [impliedName]);
      await this.saveIndexFile(this.actionIndex, this.barrelFullPath(kActionsBarrelPath));
    } else if (codeType === CodeType.WIDGET) {
      this.widgetIndex.set(baseName, [impliedName]);
      await this.saveIndexFile(this.widgetIndex, this.barrelFullPath(kWidgetsBarrelPath));
    } else if (codeType === CodeType.FUNCTION && this._folderOrganized) {
      this.functionsIndex.set(`/${relKey.replace(/^lib\//, '')}`, []);
      await this.saveIndexFile(this.functionsIndex, this.barrelFullPath(kCustomFunctionsPath));
    }

    writeFileMap(this._rootPath, this._fileMap);
    this._eventEmitter.emit('fileChange', fullPathFromKey(this._rootPath, relKey), fileInfo);
    return fileInfo;
  }

  /**
   * Handles renaming of files in the project
   * Updates file map with new file name
   * @param oldFilePath Original file path
   * @param newFilePath New file path
   * @returns Updated FileInfo or null
   */
  public async renameFile(oldFilePath: string, newFilePath: string): Promise<FileInfo | null> {
    if (this.paused) return null;
    const oldKey = this.relativeKey(oldFilePath);
    const fileInfo = this._fileMap.get(oldKey);
    if (!fileInfo) {
      return null;
    }
    this._fileMap.set(this.relativeKey(newFilePath), fileInfo);
    this._fileMap.delete(oldKey);
    return fileInfo;
  }

  /**
   * Handles updating existing files in the project
   * Detects changes, updates checksums, and manages renames
   * @param filePath Path of file to update
   * @returns Updated FileInfo or null
   */
  public async updateFile(filePath: string): Promise<FileInfo | null> {
    if (this.paused) return null;
    const relKey = this.relativeKey(filePath);
    const fileInfo = this._fileMap.get(relKey);
    if (!fileInfo) {
      return null;
    }

    const codeType = this.classify(relKey);
    if (codeType === CodeType.OTHER) return fileInfo;

    fileInfo.current_checksum = computeChecksum(filePath);
    const undeleted = fileInfo.is_deleted;
    if (undeleted) {
      // A delete followed by a re-create (e.g. git checkout/stash) must clear the
      // deletion and restore the export deleteFile removed, even when the content is
      // unchanged — otherwise the next push reports a stale deletion.
      fileInfo.is_deleted = false;
      await this.restoreIndexEntry(relKey, fileInfo, codeType);
    }
    if (fileInfo.current_checksum === fileInfo.original_checksum) {
      // A reverted edit must still refresh the cached functions code, or a later push
      // reports deletions for functions that are back in the file.
      if (codeType === CodeType.FUNCTION && !this._folderOrganized) {
        this._functionsCode = await fs.promises.readFile(fullPathFromKey(this._rootPath, kCustomFunctionsPath), 'utf-8');
      }
      if (undeleted) {
        this._fileMap.set(relKey, fileInfo);
        writeFileMap(this._rootPath, this._fileMap);
      }
      return fileInfo;
    }

    // Handle updates for actions and widgets
    if (codeType === CodeType.ACTION || codeType === CodeType.WIDGET) {
      const topLevelDeclarations = await getTopLevelNames(await fs.promises.readFile(filePath, 'utf-8'));
      const indexMap = codeType === CodeType.ACTION ? this.actionIndex : this.widgetIndex;
      const barrelRelativePath = codeType === CodeType.ACTION ? kActionsBarrelPath : kWidgetsBarrelPath;
      const indexKey = this.indexKeyForFile(indexMap, barrelRelativePath, relKey);
      const indexExports = (indexKey !== undefined ? indexMap.get(indexKey) : undefined) || [];

      if (indexExports.length === 0) {
        console.log('no shown exports found in index file for ', filePath);
      } else {
        // Check for renames
        const newName = this.getNewName(topLevelDeclarations, indexExports, fileInfo.old_identifier_name);
        if (newName) {
          fileInfo.new_identifier_name = newName;
          if (indexExports[0] !== newName && indexKey !== undefined) {
            indexMap.set(indexKey, [newName]);
            await this.saveIndexFile(indexMap, this.barrelFullPath(barrelRelativePath));
          }
        }
      }
    }

    // Handle updates for functions
    if (codeType === CodeType.FUNCTION) {
      if (this._folderOrganized) {
        const impliedName = toCamelCase(path.posix.basename(relKey, '.dart'));
        const declaredName = parseTopLevelFunctionName(await fs.promises.readFile(filePath, 'utf-8'), impliedName);
        if (declaredName) {
          fileInfo.new_identifier_name = declaredName;
        }
      } else {
        this._functionsCode = await fs.promises.readFile(fullPathFromKey(this._rootPath, kCustomFunctionsPath), 'utf-8');
      }
    }

    this._fileMap.set(relKey, fileInfo);
    writeFileMap(this._rootPath, this._fileMap);

    this._eventEmitter.emit('fileChange', fullPathFromKey(this._rootPath, relKey), fileInfo);

    return fileInfo;
  }

  /**
   * Analyzes changes in custom functions
   * Detects added, deleted, and renamed functions
   * @returns Object containing function changes
   */
  public async functionChange(): Promise<FunctionChange> {
    if (this._folderOrganized) {
      return functionChangeFromFileMap(this._fileMap);
    }
    const intialFunctionInfo = await parseTopLevelFunctions(this._initialFunctionsCode);
    const intialFunctionInfoMap = new Map(intialFunctionInfo.map(f => [f.name, f]));
    const currentFunctionInfo = await parseTopLevelFunctions(this._functionsCode);
    const currentFunctionInfoMap = new Map(currentFunctionInfo.map(f => [f.name, f]));

    let deletedFunctions = intialFunctionInfo.filter(f => !currentFunctionInfoMap.has(f.name));
    const addedFunctions = currentFunctionInfo.filter(f => !intialFunctionInfoMap.has(f.name));

    const renamedFunctions: {
      old_function_name: string;
      new_function_name: string;
      renamed_by_symbol: boolean;
    }[] = [];

    // Detect renamed functions by comparing content similarity
    for (const deletedFunction of deletedFunctions) {
      const similarities = addedFunctions.map(f => functionSimilarity(f.content, deletedFunction.content));
      let maxSimilarity: number | null = null;
      let maxSimilarityIndex: number | null = null;
      similarities.forEach((s, index) => {
        if (s !== null && (maxSimilarity === null || s > maxSimilarity)) {
          maxSimilarity = s;
          maxSimilarityIndex = index;
        }
      });
      if (maxSimilarityIndex !== null) {
        const bestMatch = addedFunctions[maxSimilarityIndex];
        renamedFunctions.push({
          old_function_name: deletedFunction.name,
          new_function_name: bestMatch.name,
          renamed_by_symbol: false,
        });
        addedFunctions.splice(maxSimilarityIndex, 1);
      }
    }

    deletedFunctions = deletedFunctions.filter(f => !renamedFunctions.some(rf => rf.old_function_name === f.name));

    return {
      functions_to_rename: renamedFunctions,
      functions_to_delete: deletedFunctions.map(f => f.name),
      functions_to_add: addedFunctions.map(f => f.name),
    };
  }

  /**
   * Serializes the UpdateManager state to disk
   * Saves file map, indexes, and function snapshots
   * @param filePath Root path for serialization
   */
  public async serializeUpdateManager(filePath: string = this._rootPath) {
    try {
      await this.serializeFileMap(filePath);
      await this.saveIndexFile(this.actionIndex, fullPathFromKey(filePath, kActionsBarrelPath));
      await this.saveIndexFile(this.widgetIndex, fullPathFromKey(filePath, kWidgetsBarrelPath));
      if (this._folderOrganized) {
        await this.saveIndexFile(this.functionsIndex, fullPathFromKey(filePath, kCustomFunctionsPath));
      } else {
        await fs.promises.writeFile(path.join(filePath, kCustomFunctionsSnapshotPath), this._initialFunctionsCode);
      }
    } catch (error) {
      console.error('Error serializing UpdateManager:', error);
      throw error;
    }
  }

  /**
   * Refreshes the UpdateManager state from disk
   * Reloads all indexes and file maps
   */
  public async refresh() {
    this._folderOrganized = isFolderOrganizedProject(this._rootPath);
    this._manifest = buildCustomCodeManifest(this._rootPath);
    this.actionIndex = new Map();
    try {
      this.actionIndex = parseIndexFile(await fs.promises.readFile(this.barrelFullPath(kActionsBarrelPath), 'utf-8'));
    } catch (error) {
      console.error('Error refreshing action index:', error);
    }
    this.widgetIndex = new Map();
    try {
      this.widgetIndex = parseIndexFile(await fs.promises.readFile(this.barrelFullPath(kWidgetsBarrelPath), 'utf-8'));
    } catch (error) {
      console.error('Error refreshing widget index:', error);
    }
    this._functionsCode = await fs.promises.readFile(this.barrelFullPath(kCustomFunctionsPath), 'utf-8');
    this._initialFunctionsCode = this._functionsCode;
    this.functionsIndex = this._folderOrganized ? parseFunctionsShim(this._functionsCode) : new Map();
    this._fileMap = await computeFileMap(this._rootPath, this._manifest);
  }

  /**
   * Serializes just the file map to disk
   * @param filePath Path to save file map
   */
  public async serializeFileMap(filePath: string) {
    const fileMapObj = Object.fromEntries(this._fileMap);
    await fs.promises.writeFile(path.join(filePath, '.vscode', 'file_map.json'), JSON.stringify(fileMapObj, null, 2));
  }

  private async saveIndexFile(indexContent: Map<string, string[]>, filePath: string) {
    const fileContent = Array.from(indexContent.entries())
      .map(([key, value]) => value.length > 0 ? `export '${key}' show ${value.join(', ')};` : `export '${key}';`)
      .join('\n');
    const formattedContent = formatDartCode(fileContent);
    await fs.promises.writeFile(filePath, formattedContent || '// No exports');
  }

  /**
   * Pauses all file operations
   */
  public pause() {
    this.paused = true;
  }

  /**
   * Resumes file operations
   */
  public resume() {
    this.paused = false;
  }

  /**
   * Inserts boilerplate code for new files
   * @param filePath Path of file to add boilerplate to
   */
  public async insertBoilerplate(filePath: string) {
    const codeType = this.classify(this.relativeKey(filePath));
    if (codeType === CodeType.ACTION) {
      await insertCustomActionBoilerplate(vscode.Uri.file(filePath), await this.customFunctionsExist(), await this.themeImportPath());
    } else if (codeType === CodeType.WIDGET) {
      await insertCustomWidgetBoilerplate(vscode.Uri.file(filePath), await this.customFunctionsExist(), await this.themeImportPath());
    } else if (codeType === CodeType.FUNCTION && this._folderOrganized) {
      await insertCustomFunctionFileBoilerplate(vscode.Uri.file(filePath));
    }
  }

  private async themeImportPath(): Promise<string> {
    const pubspecPath = path.join(this._rootPath, "pubspec.yaml");
    const pubspecText = fs.readFileSync(pubspecPath, "utf8");
    const containsFFTheme = pubspecText.includes("ff_theme");
    return containsFFTheme
      ? `'package:ff_theme/flutter_flow/flutter_flow_theme.dart'`
      : `'/flutter_flow/flutter_flow_theme.dart'`;
  }

  private async customFunctionsExist(): Promise<boolean> {
    // TODO: Implement this. It's ok to return true for now, but it would be better to check if
    // there are any functions in the file, then update the imports everywhere when we go from 0 to 1.
    return true;
  }

  /**
   * Determines if a symbol has been renamed
   * @param topLevelDeclarations List of top-level declarations
   * @param indexExports List of exports from index file
   * @param oldName Original symbol name
   * @returns New name if renamed, null otherwise
   */
  private getNewName(topLevelDeclarations: string[], indexExports: string[], oldName: string): string | null {
    const inIndexExport = indexExports[0];
    const matchingDeclaration = topLevelDeclarations.find(d => d === inIndexExport);
    const oldDeclaration = topLevelDeclarations.find(d => d === oldName);
    const inFileDeclaration = matchingDeclaration ?? oldDeclaration ?? topLevelDeclarations[0];

    if (inIndexExport === inFileDeclaration && inIndexExport === oldName) {
      return null; // No change
    }
    if (inIndexExport === inFileDeclaration && inIndexExport !== oldName) {
      return inFileDeclaration; // Renamed and updated in index
    }
    if (inIndexExport === oldName && inFileDeclaration !== oldName) {
      return inFileDeclaration; // Renamed but not updated in index
    }
    if (inIndexExport !== inFileDeclaration && inIndexExport !== oldName) {
      return null; // Index changed but symbol not renamed
    }
    return null;
  }

  /**
   * Updates file states after successful sync
   * Resets checksums and removes deleted files
   */
  public async setToSynced() {
    this._fileMap.forEach(fileInfo => {
      fileInfo.original_checksum = fileInfo.current_checksum;
      fileInfo.old_identifier_name = fileInfo.new_identifier_name;
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    this._fileMap = new Map(Array.from(this._fileMap.entries()).filter(([_, fileInfo]) => !fileInfo.is_deleted));
    this._initialFunctionsCode = this._functionsCode;
    writeFileMap(this._rootPath, this._fileMap);
    if (!this._folderOrganized) {
      await fs.promises.writeFile(path.join(this._rootPath, kCustomFunctionsSnapshotPath), this._initialFunctionsCode);
    }
  }
}

/**
 * Helper Functions
 */

/**
 * Deserializes an UpdateManager instance from disk
 * @param projectPath Path to project root
 * @returns New UpdateManager instance
 */
export async function deserializeUpdateManager(projectPath: string): Promise<UpdateManager> {
  try {
    const folderOrganized = isFolderOrganizedProject(projectPath);
    const manifest = buildCustomCodeManifest(projectPath);

    const actionIndexContent = fs.readFileSync(fullPathFromKey(projectPath, kActionsBarrelPath), 'utf-8');
    const actionIndex = parseIndexFile(actionIndexContent);

    const widgetIndexContent = fs.readFileSync(fullPathFromKey(projectPath, kWidgetsBarrelPath), 'utf-8');
    const widgetIndex = parseIndexFile(widgetIndexContent);

    const functionsCode = fs.readFileSync(fullPathFromKey(projectPath, kCustomFunctionsPath), 'utf-8');
    const functionsIndex = folderOrganized ? parseFunctionsShim(functionsCode) : new Map<string, string[]>();
    let initialFunctionsCode: string;
    if (!folderOrganized && fs.existsSync(path.join(projectPath, kCustomFunctionsSnapshotPath))) {
      initialFunctionsCode = fs.readFileSync(path.join(projectPath, kCustomFunctionsSnapshotPath), 'utf-8');
    } else {
      initialFunctionsCode = functionsCode;
    }

    let fileMap: Map<string, FileInfo>;
    if (fs.existsSync(path.join(projectPath, '.vscode', 'file_map.json'))) {
      fileMap = migrateLegacyFileMapKeys(await readFileMap(projectPath));
      fileMap = reconcileFileMapWithManifest(fileMap, manifest, folderOrganized, projectPath);
      // add the pubspec.yaml file to the file map if it's not already there
      if (!fileMap.has('pubspec.yaml')) {
        fileMap.set('pubspec.yaml', {
          old_identifier_name: 'pubspec.yaml',
          new_identifier_name: 'pubspec.yaml',
          type: CodeType.DEPENDENCIES,
          is_deleted: false
        });
      }
    } else {
      fileMap = await computeFileMap(projectPath, manifest);
    }

    // Verify and compute checksums if needed
    for (const [filePath, fileInfo] of fileMap.entries()) {
      if (!fileInfo.original_checksum && !fileInfo.current_checksum) {
        const fullFilePath = fullPathFromKey(projectPath, filePath);
        if (!fs.existsSync(fullFilePath)) continue;
        fileInfo.original_checksum = computeChecksum(fullFilePath);
        fileInfo.current_checksum = fileInfo.original_checksum;
        fileMap.set(filePath, fileInfo);
      }
    }
    writeFileMap(projectPath, fileMap);

    return new UpdateManager(fileMap, projectPath, actionIndex, widgetIndex, functionsCode, initialFunctionsCode, folderOrganized, manifest, functionsIndex);
  } catch (error) {
    console.error('Error deserializing UpdateManager:', error);
    throw error;
  }
}

// Parses the folder-organized custom_functions.dart export shim into an index map.
function parseFunctionsShim(functionsCode: string): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const directive of parseExportDirectives(functionsCode)) {
    index.set(directive.uri, directive.shownNames);
  }
  return index;
}

/**
 * Computes the file map from the custom code manifest
 * @param projectRoot Project root path
 * @param manifest Manifest of custom code files
 * @returns Map of files and their metadata
 */
async function computeFileMap(projectRoot: string, manifest: CustomCodeManifest): Promise<Map<string, FileInfo>> {
  const newFileMap = new Map<string, FileInfo>();

  for (const [relativePath, entry] of manifest.entries()) {
    newFileMap.set(relativePath, {
      old_identifier_name: entry.identifierName,
      new_identifier_name: entry.identifierName,
      type: entry.type,
      is_deleted: false,
    });
  }

  newFileMap.set("pubspec.yaml", {
    "old_identifier_name": "pubspec.yaml",
    "new_identifier_name": "pubspec.yaml",
    "type": CodeType.DEPENDENCIES,
    "is_deleted": false
  });

  for (const [relativePath, fileInfo] of newFileMap.entries()) {
    const fullFilePath = fullPathFromKey(projectRoot, relativePath);
    if (!fs.existsSync(fullFilePath)) {
      console.error('Custom code file listed in barrel does not exist:', fullFilePath);
      continue;
    }
    const fileChecksum = computeChecksum(fullFilePath);
    fileInfo.current_checksum = fileChecksum;
    fileInfo.original_checksum = fileChecksum;
    newFileMap.set(relativePath, fileInfo);
  }
  return newFileMap;
}

/**
 * Parses Dart index files
 * @param content Content of index file
 * @returns Map of exports
 */
function parseIndexFile(content: string): Map<string, string[]> {
  return parseIndexFileWithDart(content);
}
