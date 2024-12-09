import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

// For each custom function, we will have a name (in the signature) and its content.
interface FunctionInfo {
  name: string;
  content: string;
}

// For each custom function that has been renamed, we will store its old and new names
// as well as whether the user used rename symbol on it. We will also store the identifier
// names of functions that have been added and deleted.
export interface FunctionChange {
  functions_to_rename: {
    old_function_name: string;
    new_function_name: string;
    renamed_by_symbol: boolean;
  }[];
  functions_to_delete: string[];
  functions_to_add: string[];
}

// A function to compute the levenshtein (edit) distance between two strings.
function _levenshteinDistance(s1: string, s2: string): number {
  if (s1.length < s2.length) {
    return _levenshteinDistance(s2, s1);
  }
  if (s2.length === 0) {
    return s1.length;
  }
  let previousRow = Array.from({ length: s2.length + 1 }, (_, i) => i);
  for (let i = 0; i < s1.length; i++) {
    const currentRow = [i + 1];
    for (let j = 0; j < s2.length; j++) {
      const insertions = previousRow[j + 1] + 1;
      const deletions = currentRow[j] + 1;
      const substitutions = previousRow[j] + (s1[i] !== s2[j] ? 1 : 0);
      currentRow.push(Math.min(insertions, deletions, substitutions));
    }
    previousRow = currentRow;
  }
  return previousRow[previousRow.length - 1];
}

// Get all the custom function declarations in the snapshot based on regex.
function _extractFunctions(snapshot: string): FunctionInfo[] {
  // TODO: better regex
  const functionPattern =
    /(?:Future|String\?|\w+)\s+(\w+)\s*\([^)]*\)\s*(?:async)?\s*{([^}]*)}/gs;
  const matches = snapshot.matchAll(functionPattern);
  return Array.from(matches, (m) => ({
    name: m[1],
    content: m[2].trim(),
  }));
}


export function functionSimilarity(func1: string, func2: string): number | null {
  const similarity = 1 - _levenshteinDistance(func1, func2) / Math.max(func1.length, func2.length);
  // If the similarity is less than 0.7, return null
  return similarity >= 0.7 ? similarity : null;
}

// Returns a list of functions that "best guess" have been renamed, created, and
// deleted. Utilizes levenshtein distance to determine similarity between function content.
export function analyzeFunctionChanges(
  snapshot1: string,
  snapshot2: string,
  similarityThreshold: number = 0.7
): FunctionChange {
  const functions1 = _extractFunctions(snapshot1);
  const functions2 = _extractFunctions(snapshot2);

  const functions_to_rename: {
    old_function_name: string;
    new_function_name: string;
    renamed_by_symbol: boolean;
  }[] = [];
  const functions_to_delete: string[] = [];
  const functions_to_add: string[] = [];

  for (const func1 of functions1) {
    const matchingFunc = functions2.find((f) => f.name === func1.name);
    if (!matchingFunc) {
      let bestMatch: FunctionInfo | null = null;
      let bestSimilarity = 0;
      for (const func2 of functions2) {
        const similarity =
          1 -
          _levenshteinDistance(func1.content, func2.content) /
          Math.max(func1.content.length, func2.content.length);
        if (similarity > bestSimilarity && similarity >= similarityThreshold) {
          bestMatch = func2;
          bestSimilarity = similarity;
        }
      }
      if (bestMatch) {
        functions_to_rename.push({
          old_function_name: func1.name,
          new_function_name: bestMatch.name,
          renamed_by_symbol: false,
        });
      } else {
        functions_to_delete.push(func1.name);
      }
    }
  }

  for (const func2 of functions2) {
    if (
      !functions1.some((f) => f.name === func2.name) &&
      !Object.values(functions_to_rename).some(
        (item) => item.new_function_name === func2.name
      )
    ) {
      functions_to_add.push(func2.name);
    }
  }

  return { functions_to_rename, functions_to_delete, functions_to_add };
}

// Returns a FunctionChange object with information on files that have been
// renamed, deleted, and created. Reads the current contents in the file.
function readContentsOfFunctionChangesFile(): FunctionChange {
  // Read function_changes.json
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showErrorMessage("No workspace folder open");
    return {
      functions_to_rename: [],
      functions_to_delete: [],
      functions_to_add: [],
    };
  }

  const changesFilePath = path.join(
    workspaceFolders[0].uri.fsPath,
    "lib",
    "flutter_flow",
    "function_changes.json"
  );

  let functionChanges: FunctionChange = {
    functions_to_rename: [],
    functions_to_delete: [],
    functions_to_add: [],
  };

  if (fs.existsSync(changesFilePath)) {
    try {
      const fileContent = fs.readFileSync(changesFilePath, "utf8");
      functionChanges = JSON.parse(fileContent);
    } catch (error) {
      console.error("Error reading function_changes.json:", error);
      vscode.window.showErrorMessage(
        `Error reading function_changes.json: ${error}`
      );
    }
  }
  return functionChanges;
}

// Given an old snapshot and a new snapshot of custom_function.dart, calculates
// a FunctionChange object and writes the changes to the metadata file.
async function writeFunctionDiffToFile(oldSnapshot: string, newSnapshot: string): Promise<void> {
  // Find the workspace folder
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showErrorMessage("No workspace folder open");
    return;
  }

  // Construct the path for custom_functions.dart
  const customFunctionsPath = path.join(
    workspaceFolders[0].uri.fsPath,
    "lib",
    "flutter_flow",
    "custom_functions.dart"
  );

  // Construct the path for the changes file
  const changesFilePath = path.join(
    path.dirname(customFunctionsPath),
    "function_changes.json"
  );

  const changes = analyzeFunctionChanges(oldSnapshot, newSnapshot);

  const existingContents = readContentsOfFunctionChangesFile();
  // Filter entries with renamed_by_symbol set to true
  let renamedBySymbolEntries = existingContents.functions_to_rename.filter(
    (entry) => entry.renamed_by_symbol === true
  );
  existingContents.functions_to_rename = [];
  for (const func of changes.functions_to_rename) {
    const oldName = func.old_function_name;
    const newName = func.new_function_name;
    const entryRenamedBySymbol = renamedBySymbolEntries.find(
      (rename) => rename.old_function_name === oldName
    );
    const entryDeleted = existingContents.functions_to_delete.find(
      (deleted) => deleted === newName
    );
    const entryCreated = existingContents.functions_to_add.find(
      (created) => created === newName
    );
    if (entryRenamedBySymbol || entryDeleted || entryCreated) {
      continue;
    } else {
      existingContents.functions_to_rename.push(func);
    }
  }
  existingContents.functions_to_add = changes.functions_to_add;
  existingContents.functions_to_delete = changes.functions_to_delete;
  for (const func of renamedBySymbolEntries) {
    if (
      existingContents.functions_to_delete.find(
        (deleted) => deleted === func.new_function_name
      )
    ) {
      renamedBySymbolEntries = renamedBySymbolEntries.filter(
        (entry) => entry !== func
      );
    }
    if (
      existingContents.functions_to_add.find(
        (created) => created === func.new_function_name
      )
    ) {
      renamedBySymbolEntries = renamedBySymbolEntries.filter(
        (entry) => entry !== func
      );
    }
  }
  existingContents.functions_to_rename.push(...renamedBySymbolEntries);

  // Convert changes to a formatted JSON string
  const newContents = JSON.stringify(existingContents, null, 2);

  try {
    // Write the changes to the file
    await fs.promises.writeFile(changesFilePath, newContents, "utf8");
  } catch (error) {
    vscode.window.showErrorMessage(`Error writing function changes: ${error}`);
  }
}

// Adds a rename entry to the function changes map.
async function updateFunctionChangesMap(
  oldName: string,
  newName: string,
  workSpacePath: string
): Promise<void> {
  const filePath = path.join(
    workSpacePath,
    "lib",
    "flutter_flow",
    "function_changes.json"
  );
  try {
    // Read the file
    const jsonString = fs.readFileSync(filePath, "utf-8");
    const jsonData: FunctionChange = JSON.parse(jsonString);

    let found = false;
    for (const entry of jsonData.functions_to_rename) {
      if (entry.new_function_name === oldName) {
        entry.new_function_name = newName;
        found = true;
        break;
      }
    }

    if (!found) {
      jsonData.functions_to_rename.push({
        old_function_name: oldName,
        new_function_name: newName,
        renamed_by_symbol: true,
      });
    }

    // Write the updated data back to the file
    await fs.promises.writeFile(filePath, JSON.stringify(jsonData, null, 2));
  } catch (error) {
    console.error("Error updating function changes map:", error);
    throw error;
  }
}

export { writeFunctionDiffToFile, updateFunctionChangesMap };
