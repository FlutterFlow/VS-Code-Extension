import * as vscode from "vscode";
import * as fs from "fs";
// Functions in this file are currently not used, but may be useful in the future.
// They were used in the past to for validation of index.dart files, but now we update the index.dart file
// when we detect changes to files in the custom code folder.

// Updates the custom diagnostic collection to error if there are warnings in index.dart.
function updateDiagnostics(
  uri: vscode.Uri,
  diagnosticCollection: vscode.DiagnosticCollection
) {
  diagnosticCollection.clear();
  // Check if this is the file we want to modify (e.g., index.dart)
  if (uri.path.endsWith("index.dart")) {
    const diagnostics = vscode.languages.getDiagnostics(uri);
    const newDiagnostics = diagnostics.map((d) => {
      if (d.severity === vscode.DiagnosticSeverity.Warning) {
        return new vscode.Diagnostic(
          d.range,
          "Please ensure that the identifier name matches a custom code declaration.",
          vscode.DiagnosticSeverity.Error
        );
      }
      return d;
    });

    // Only update if there's a change
    diagnosticCollection.set(uri, newDiagnostics);
  }
}

// Validates the format of index.dart.
// Entries in this file should be of the form `export "file_name.dart" show ClassName;`.
// We surface an error if the format is incorrect.
function validateIndexFile(document: vscode.TextDocument): boolean {
  // Check for existing VS Code diagnostics (errors)
  const diagnostics = vscode.languages.getDiagnostics(document.uri);
  if (diagnostics.length > 0) {
    const errorMessages = diagnostics
      .filter((diag) => diag.severity === vscode.DiagnosticSeverity.Error)
      .map((diag) => `Line ${diag.range.start.line + 1}: ${diag.message}`)
      .join("\n");

    if (errorMessages) {
      vscode.window.showErrorMessage(`File contains errors:\n${errorMessages}`);
      return false;
    }
  }
  const text = document.getText();
  const lines = text.split("\n");
  let isValid = true;
  let errorMessage = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue; // Skip empty lines

    const regex = /^export ["'](.+)["'] show (\w+);$/;
    if (!regex.test(line)) {
      isValid = false;
      errorMessage = `Invalid format at line ${i + 1}: ${line}`;
      break;
    }
  }

  if (!isValid) {
    vscode.window.showErrorMessage(`Format index.dart: ${errorMessage}`);
  } else {
    vscode.window.showInformationMessage(
      "index.dart format is valid. File saved."
    );
  }

  return isValid; // Return whether the validation was successful
}

function isFileEmpty(path: string): boolean {
  try {
    const stats = fs.statSync(path);
    return stats.size === 0;
  } catch (error) {
    console.error(`Error checking file ${path}:`, error);
    return true; // Assume empty if there's an error (file doesn't exist, no permissions, etc.)
  }
}

async function checkFolderExists(projectPath: string): Promise<boolean> {
  try {
    const stats = await fs.promises.stat(projectPath);
    return stats.isDirectory();
  } catch (error) {
    // If there's an error (e.g., folder doesn't exist), return false
    console.error(`Error checking file:`, error);
    return false;
  }
}

export { updateDiagnostics, validateIndexFile, isFileEmpty, checkFolderExists };
