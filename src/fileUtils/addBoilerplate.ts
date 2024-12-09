import * as vscode from "vscode";
import * as path from "path";
// TODO: boilerplate imports aren't currently being generated properly. If a custom function
// is added, for example, all custom actions, widgets need to be updated with the custom function
// import. This is currently not happening. Minor issue.

// Adds boilerplate code for newly created custom action files.
async function insertCustomActionBoilerplate(file: vscode.Uri, customFunctionsExist: boolean, themeImportPath: string) {
  const fileName = path.basename(file.fsPath, ".dart");

  let customFunctionsImport = "";
  if (customFunctionsExist) {
    customFunctionsImport =
      "import '/flutter_flow/custom_functions.dart'; // Imports custom functions";
  }
  const functionName = toCamelCase(fileName);
  const boilerplate = `// Automatic FlutterFlow imports
import ${themeImportPath};
import '/flutter_flow/flutter_flow_util.dart';
import 'index.dart'; // Imports other custom actions
${customFunctionsImport}import 'package:flutter/material.dart';
// Begin custom action code
// DO NOT REMOVE OR MODIFY THE CODE ABOVE!

Future ${functionName}() async {
  // Add your function code here!
}
`;
  await vscode.workspace.fs.writeFile(file, Buffer.from(boilerplate));
}

// Adds boilerplate code for newly created custom widget files.
async function insertCustomWidgetBoilerplate(file: vscode.Uri, customFunctionsExist: boolean, themeImportPath: string) {
  const fileName = path.basename(file.fsPath, ".dart");
  let customFunctionsImport = "";
  if (customFunctionsExist) {
    customFunctionsImport =
      "import '/flutter_flow/custom_functions.dart'; // Imports custom functions";
  }
  const widgetName = toPascalCase(fileName);
  const boilerplate = `// Automatic FlutterFlow imports
import ${themeImportPath};
import '/flutter_flow/flutter_flow_util.dart';
import 'index.dart'; // Imports other custom widgets
import '/custom_code/actions/index.dart'; // Imports custom actions
${customFunctionsImport}
import 'package:flutter/material.dart';
// Begin custom widget code
// DO NOT REMOVE OR MODIFY THE CODE ABOVE!

class ${widgetName} extends StatefulWidget {
  const ${widgetName}({
    super.key,
    this.width,
    this.height,
  });

  final double? width;
  final double? height;

  @override
  State<${widgetName}> createState() => _${widgetName}State();
}

class _${widgetName}State extends State<${widgetName}> {
  @override
  Widget build(BuildContext context) {
    return Container();
  }
}`;
  await vscode.workspace.fs.writeFile(file, Buffer.from(boilerplate));
}

// Adds boilerplate code for newly created custom action files.
function insertCustomFunctionBoilerplate() {
  const boilerplate = `// Automatic FlutterFlow imports
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
  return boilerplate;
}

// Converts a string to camel case.
// E.g. "hello_world" -> "helloWorld"
function toCamelCase(str: string): string {
  return str.replace(/[-_](.)/g, (_, c) => c.toUpperCase());
}

// Converts a string to pascal case.
// E.g. "hello_world" -> "HelloWorld"
function toPascalCase(str: string): string {
  return str
    .split("_")
    .map((word) =>
      word
        .replace(/(?:^\w|[A-Z]|\b\w)/g, (letter) => letter.toUpperCase())
        .replace(/[^a-zA-Z0-9]+/g, "")
    )
    .join("");
}
export {
  insertCustomActionBoilerplate,
  insertCustomWidgetBoilerplate,
  insertCustomFunctionBoilerplate,
  toCamelCase,
  toPascalCase,
};
