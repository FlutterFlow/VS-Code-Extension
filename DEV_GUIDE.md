# Development Guide

This guide explains how to set up, run, and test the FlutterFlow Custom Code Editor VS Code extension.

## Prerequisites

- Node.js and npm installed
- VS Code
- Dart and Flutter VS Code extensions installed
- Reccomended: FVM installed

## Setup

1. Clone the repository
2. Install dependencies:
```bash
npm install
```

## Development

## Debugging

The most straightforward way to debug the extension is to run it in VS Code.
It's recommended to uninstall this extension from VSCode before running it in this mode.

1. Open the project in VS Code
2. Press F5 to start debugging
   - This will launch a new VS Code Extension Development Host
   - You can set breakpoints and debug the extension

### Building the Extension

To build the extension for release:
```bash
vsce package
```

This will:
- Check TypeScript types
- Run ESLint
- Build the extension using esbuild
- Package the extension using vsce generating a .vsix file

## Testing

### Running Tests

To run all tests:
```bash
npm test
```

This will:
1. Compile the test files
2. Compile the extension
3. Run ESLint
4. Execute the tests

### Test Types

The project includes:
- Unit tests (`src/test/unit/`)
- End-to-end tests (`src/test/e2e/`)
