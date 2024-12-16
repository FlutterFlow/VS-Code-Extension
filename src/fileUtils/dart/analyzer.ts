import { sep } from 'path';
import { pathToFileURL } from 'url';

// Extend the globalThis interface to include our custom properties
declare global {
    interface Window {
        analyzeDartCode: (code: string) => string;
        parseIndexFile: (code: string) => string;
        formatDartCodeJs: (code: string) => string;
    }
    var window: Window;
    var analyzer: Record<string, unknown>;
    var location: {
        href: string;
    };
    var self: typeof globalThis;
}

// Set up the Node.js global context
globalThis.self = globalThis;
globalThis.window = globalThis as unknown as Window;

// Create a namespace for our analyzer
globalThis.analyzer = {};

// Now require the Dart compiled code
require('../dart/out/analyzer.dart.js');

global.location = {
    href: `${pathToFileURL(process.cwd()).href}${sep}`,
};

// Export the analyzeDartCode function with proper typing
export const analyzeDartCode = globalThis.window.analyzeDartCode;
export const parseIndexFile = globalThis.window.parseIndexFile;
export const formatDartCodeJs = globalThis.window.formatDartCodeJs;
