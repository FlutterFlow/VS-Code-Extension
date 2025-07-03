import * as vscode from 'vscode';
import { FileInfo, CodeType, pathToCodeType } from "../fileUtils/FileInfo";
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import { readFileMap, writeFileMap } from "../fileUtils/fileParsing";
import { FunctionChange, functionSimilarity } from "../fileUtils/functionSimilarity";
import { insertCustomActionBoilerplate, insertCustomWidgetBoilerplate, toCamelCase, toPascalCase } from "../fileUtils/addBoilerplate";
import { parseTopLevelFunctions, getTopLevelNames, parseIndexFileWithDart, formatDartCode } from '../fileUtils/dartParser';

// Path to store snapshot of custom functions for tracking changes
const kCustomFunctionsSnapshotPath = path.join('lib', 'flutter_flow', 'custom_functions_snapshot.txt');

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
  // The map is keyed by filename and contains FileInfo objects with metadata about each file.
  private _fileMap: Map<string, FileInfo>;
  // Event emitter for file changes
  private _eventEmitter: EventEmitter;
  // Maps for tracking exported symbols in action and widget files
  private actionIndex: Map<string, string[]>;
  private widgetIndex: Map<string, string[]>;
  // Current and initial state of custom functions
  private _functionsCode: string;
  private _initialFunctionsCode: string;
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

  constructor(
    fileMap: Map<string, FileInfo>,
    rootPath: string,
    actionIndex: Map<string, string[]>,
    widgetIndex: Map<string, string[]>,
    functionsCode: string,
    initialFunctionsCode: string
  ) {
    this._fileMap = fileMap;
    this._rootPath = rootPath;
    this.actionIndex = actionIndex;
    this.widgetIndex = widgetIndex;
    this._functionsCode = functionsCode;
    this._initialFunctionsCode = initialFunctionsCode;
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

  /**
   * Handles deletion of a file from the project
   * Updates file map and relevant indexes
   * @param filePath Path of file to delete
   * @returns FileInfo of deleted file or null
   */
  public async deleteFile(filePath: string): Promise<FileInfo | null> {
    if (this.paused) return null;
    const codeType = pathToCodeType(filePath);
    const baseName = path.basename(filePath);

    //if (codeType === CodeType.OTHER) return null;
    if (codeType === CodeType.FUNCTION) {
      throw new Error('Cannot delete function file');
    }

    const fileInfo = this._fileMap.get(baseName);
    if (!fileInfo) {
      return null;
    }

    fileInfo.is_deleted = true;
    this._fileMap.set(baseName, fileInfo);

    // Update relevant index file
    if (codeType === CodeType.ACTION) {
      this.actionIndex.delete(baseName);
      await this.saveIndexFile(this.actionIndex, path.join(this._rootPath, 'lib', 'custom_code', 'actions', 'index.dart'));
    } else if (codeType === CodeType.WIDGET) {
      this.widgetIndex.delete(baseName);
      await this.saveIndexFile(this.widgetIndex, path.join(this._rootPath, 'lib', 'custom_code', 'widgets', 'index.dart'));
    }

    writeFileMap(this._rootPath, this._fileMap);
    const fullFilePath = fullPath(this._rootPath, baseName, fileInfo);
    this._eventEmitter.emit('fileChange', fullFilePath, fileInfo);
    return fileInfo;
  }

  /**
   * Adds a new file to the project and updates the corresponding index.
   * Creates a new FileInfo entry with default values based on the file type.
   * @param filePath The path of the file to be added
   * @returns The created FileInfo object, or null if addition was paused or file type is not supported
   */
  public async addFile(filePath: string): Promise<FileInfo | null> {
    //TODO handle file type other than action, widget, function
    if (this.paused) return null;
    const codeType = pathToCodeType(filePath);
    //if (codeType === CodeType.OTHER) return null;

    // Add boilerplate if file is empty
    if (fs.readFileSync(filePath, "utf8").length === 0) {
      await this.insertBoilerplate(filePath);
    }

    const baseName = path.basename(filePath);
    const existingFileInfo = this._fileMap.get(baseName);
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

    // TODO: base name should include the full path to the file from custom_code/ for OTHER files
    const relativePath =  path.relative(path.join(this._rootPath, 'lib', 'custom_code'), filePath);
    if (codeType === CodeType.OTHER) { 
      this._fileMap.set(relativePath, fileInfo);
    } else {
      this._fileMap.set(baseName, fileInfo);
    }

    // Update relevant index file
    if (codeType === CodeType.ACTION) {
      this.actionIndex.set(baseName, [impliedName]);
      await this.saveIndexFile(this.actionIndex, path.join(this._rootPath, 'lib', 'custom_code', 'actions', 'index.dart'));
    } else if (codeType === CodeType.WIDGET) {
      this.widgetIndex.set(baseName, [impliedName]);
      await this.saveIndexFile(this.widgetIndex, path.join(this._rootPath, 'lib', 'custom_code', 'widgets', 'index.dart'));
    }

    writeFileMap(this._rootPath, this._fileMap);
    const fullFilePath = fullPath(this._rootPath, baseName, fileInfo);
    this._eventEmitter.emit('fileChange', fullFilePath, fileInfo);
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
    const oldBaseName = path.basename(oldFilePath);
    const fileInfo = this._fileMap.get(oldBaseName);
    if (!fileInfo) {
      return null;
    }
    this._fileMap.set(path.basename(newFilePath), fileInfo);
    this._fileMap.delete(oldBaseName);
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
    const baseName = path.basename(filePath);
    const fileInfo = this._fileMap.get(baseName);
    if (!fileInfo) {
      return null;
    }

    // Update checksum and check for changes
    fileInfo.current_checksum = computeChecksum(filePath);
    if (fileInfo.current_checksum === fileInfo.original_checksum) return fileInfo;

    const codeType = pathToCodeType(filePath);
    //if (codeType === CodeType.OTHER) return fileInfo;

    fileInfo.is_deleted = false;

    // Handle updates for actions and widgets
    if (codeType === CodeType.ACTION || codeType === CodeType.WIDGET) {
      const topLevelDeclarations = await getTopLevelNames(await fs.promises.readFile(filePath, 'utf-8'));
      const indexMap = codeType === CodeType.ACTION ? this.actionIndex : this.widgetIndex;
      const indexExports = indexMap.get(baseName) || [];

      if (indexExports.length === 0) {
        console.log('no shown exports found in index file for ', filePath);
      } else {
        // Check for renames
        const newName = this.getNewName(topLevelDeclarations, indexExports, fileInfo.old_identifier_name);
        if (newName) {
          fileInfo.new_identifier_name = newName;
          if (indexExports[0] !== newName) {
            indexMap.set(baseName, [newName]);
            const indexPath = codeType === CodeType.ACTION
              ? path.join(this._rootPath, 'lib', 'custom_code', 'actions', 'index.dart')
              : path.join(this._rootPath, 'lib', 'custom_code', 'widgets', 'index.dart');
            await this.saveIndexFile(indexMap, indexPath);
          }
        }
      }
    }

    // Handle updates for functions
    if (codeType === CodeType.FUNCTION) {
      this._functionsCode = await fs.promises.readFile(path.join(this._rootPath, 'lib', 'flutter_flow', 'custom_functions.dart'), 'utf-8');
    }

    this._fileMap.set(baseName, fileInfo);
    writeFileMap(this._rootPath, this._fileMap);

    const fullFilePath = fullPath(this._rootPath, baseName, fileInfo);
    this._eventEmitter.emit('fileChange', fullFilePath, fileInfo);

    return fileInfo;
  }

  /**
   * Analyzes changes in custom functions
   * Detects added, deleted, and renamed functions
   * @returns Object containing function changes
   */
  public async functionChange(): Promise<FunctionChange> {
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
      await this.saveIndexFile(this.actionIndex, path.join(filePath, 'lib', 'custom_code', 'actions', 'index.dart'));
      await this.saveIndexFile(this.widgetIndex, path.join(filePath, 'lib', 'custom_code', 'widgets', 'index.dart'));
      await fs.promises.writeFile(path.join(filePath, kCustomFunctionsSnapshotPath), this._initialFunctionsCode);
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
    this.actionIndex = new Map();
    try {
      this.actionIndex = parseIndexFile(await fs.promises.readFile(path.join(this._rootPath, 'lib', 'custom_code', 'actions', 'index.dart'), 'utf-8'));
    } catch (error) {
      console.error('Error refreshing action index:', error);
    }
    this.widgetIndex = new Map();
    try {
      this.widgetIndex = parseIndexFile(await fs.promises.readFile(path.join(this._rootPath, 'lib', 'custom_code', 'widgets', 'index.dart'), 'utf-8'));
    } catch (error) {
      console.error('Error refreshing widget index:', error);
    }
    this._fileMap = await computeFileMap(this._rootPath);
    this._functionsCode = await fs.promises.readFile(path.join(this._rootPath, 'lib', 'flutter_flow', 'custom_functions.dart'), 'utf-8');
    this._initialFunctionsCode = this._functionsCode;
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
    const fileContent = Array.from(indexContent.entries()).map(([key, value]) => `export '${key}' show ${value.join(', ')};`).join('\n');
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
    if (pathToCodeType(filePath) === CodeType.ACTION) {
      await insertCustomActionBoilerplate(vscode.Uri.file(filePath), await this.customFunctionsExist(), await this.themeImportPath());
    } else if (pathToCodeType(filePath) === CodeType.WIDGET) {
      await insertCustomWidgetBoilerplate(vscode.Uri.file(filePath), await this.customFunctionsExist(), await this.themeImportPath());
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
    await fs.promises.writeFile(path.join(this._rootPath, kCustomFunctionsSnapshotPath), this._initialFunctionsCode);
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
    const actionIndexContent = fs.readFileSync(path.join(projectPath, 'lib', 'custom_code', 'actions', 'index.dart'), 'utf-8');
    const actionIndex = parseIndexFile(actionIndexContent);

    const widgetIndexContent = fs.readFileSync(path.join(projectPath, 'lib', 'custom_code', 'widgets', 'index.dart'), 'utf-8');
    const widgetIndex = parseIndexFile(widgetIndexContent);

    const functionsCode = fs.readFileSync(path.join(projectPath, 'lib', 'flutter_flow', 'custom_functions.dart'), 'utf-8');
    let initialFunctionsCode: string;
    if (fs.existsSync(path.join(projectPath, kCustomFunctionsSnapshotPath))) {
      initialFunctionsCode = fs.readFileSync(path.join(projectPath, kCustomFunctionsSnapshotPath), 'utf-8');
    } else {
      initialFunctionsCode = functionsCode;
    }

    let fileMap: Map<string, FileInfo>;
    if (fs.existsSync(path.join(projectPath, '.vscode', 'file_map.json'))) {
      fileMap = await readFileMap(projectPath);
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
      fileMap = await computeFileMap(projectPath);
    }

    // Verify and compute checksums if needed
    for (const [filePath, fileInfo] of fileMap.entries()) {
      if (!fileInfo.original_checksum && !fileInfo.current_checksum) {
        fileInfo.original_checksum = computeChecksum(fullPath(projectPath, filePath, fileInfo));
        fileInfo.current_checksum = fileInfo.original_checksum;
        fileMap.set(filePath, fileInfo);
      }
    }
    writeFileMap(projectPath, fileMap);

    return new UpdateManager(fileMap, projectPath, actionIndex, widgetIndex, functionsCode, initialFunctionsCode);
  } catch (error) {
    console.error('Error deserializing UpdateManager:', error);
    throw error;
  }
}

/**
 * Computes the file map from index files
 * @param filePath Project root path
 * @returns Map of files and their metadata
 */
async function computeFileMap(filePath: string): Promise<Map<string, FileInfo>> {
  const actionIndex = parseIndexFile(await fs.promises.readFile(path.join(filePath, 'lib', 'custom_code', 'actions', 'index.dart'), 'utf-8'));
  const widgetIndex = parseIndexFile(await fs.promises.readFile(path.join(filePath, 'lib', 'custom_code', 'widgets', 'index.dart'), 'utf-8'));

  const newFileMap = fileMapFromIndexFiles(actionIndex, widgetIndex);

  // Custom code under /actions and /widgets are not handled here.
  const customCodeFiles = await fs.promises.readdir(path.join(filePath, 'lib', 'custom_code'), { recursive: true })
    .then(files => files
      .filter(file => !file.startsWith('widgets' + path.sep) && !file.startsWith('actions' + path.sep) && file.endsWith('.dart')));
  for (const file of customCodeFiles) {
    const fileInfo = {
      old_identifier_name: file,
      new_identifier_name: file,
      type: CodeType.OTHER,
      is_deleted: false
    };
    newFileMap.set(file, fileInfo);
  }

  for (const [filename, fileInfo] of newFileMap.entries()) {
    let fileChecksum = '';
    if (fileInfo.type === 'A') {
      fileChecksum = computeChecksum(path.join(filePath, 'lib', 'custom_code', 'actions', filename));
    } else if (fileInfo.type === 'W') {
      fileChecksum = computeChecksum(path.join(filePath, 'lib', 'custom_code', 'widgets', filename));
    } else if (fileInfo.type === 'F') {
      fileChecksum = computeChecksum(path.join(filePath, 'lib', 'flutter_flow', filename));
    } else if (fileInfo.type === 'O') {
      fileChecksum = computeChecksum(path.join(filePath, 'lib', 'custom_code', filename));
    } else if (fileInfo.type === 'D') {
      fileChecksum = computeChecksum(path.join(filePath, filename));
    }
    fileInfo.current_checksum = fileChecksum;
    fileInfo.original_checksum = fileChecksum;
    newFileMap.set(filename, fileInfo);
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

/**
 * Computes SHA-256 checksum of a file
 * @param filePath Path to file
 * @returns Hex string of checksum
 */
export function computeChecksum(filePath: string): string {
  const fileContent = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileContent).digest('hex');
}

/**
 * Creates a file map from action and widget indexes
 * @param actionIndex Map of action exports
 * @param widgetIndex Map of widget exports
 * @returns Combined file map
 */
function fileMapFromIndexFiles(actionIndex: Map<string, string[]>, widgetIndex: Map<string, string[]>): Map<string, FileInfo> {
  const fileMap = new Map<string, FileInfo>();

  // Add actions
  for (const [filename, exports] of actionIndex.entries()) {
    fileMap.set(path.basename(filename), {
      old_identifier_name: exports[0],
      new_identifier_name: exports[0],
      type: CodeType.ACTION,
      is_deleted: false,
    });
  }

  // Add widgets
  for (const [filename, exports] of widgetIndex.entries()) {
    fileMap.set(path.basename(filename), {
      old_identifier_name: exports[0],
      new_identifier_name: exports[0],
      type: CodeType.WIDGET,
      is_deleted: false,
    });
  }

  // Add custom functions and pubspec
  fileMap.set("custom_functions.dart", {
    "old_identifier_name": "CustomFunctions",
    "new_identifier_name": "CustomFunctions",
    "type": CodeType.FUNCTION,
    "is_deleted": false
  });

  fileMap.set("pubspec.yaml", {
    "old_identifier_name": "pubspec.yaml",
    "new_identifier_name": "pubspec.yaml",
    "type": CodeType.DEPENDENCIES,
    "is_deleted": false
  });

  return fileMap;
}

/**
 * Constructs full file path based on file type
 * @param rootPath Project root path
 * @param filePath Relative file path
 * @param fileInfo File metadata
 * @returns Full file path
 */
function fullPath(rootPath: string, filePath: string, fileInfo: FileInfo): string {
  if (fileInfo.type === CodeType.ACTION) {
    return path.join(rootPath, 'lib', 'custom_code', 'actions', filePath);
  } else if (fileInfo.type === CodeType.WIDGET) {
    return path.join(rootPath, 'lib', 'custom_code', 'widgets', filePath);
  } else if (fileInfo.type === CodeType.FUNCTION) {
    return path.join(rootPath, 'lib', 'flutter_flow', filePath);
  } else if (fileInfo.type === CodeType.OTHER) {
    return path.join(rootPath, 'lib', 'custom_code', filePath);
  } else if (fileInfo.type === CodeType.DEPENDENCIES) {
    return path.join(rootPath, filePath);
  }
  // should never happen
  return '';
}
