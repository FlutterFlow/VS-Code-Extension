import { analyzeDartCode, parseIndexFile, formatDartCodeJs } from './dart/analyzer';

interface DartAnalyzerResult {
    functions: { name: string, returnType: string, parameters: string, startLocation: number, endLocation: number }[];
    classes: { name: string, methods: { name: string, returnType: string, parameters: string }[] }[];
    enums: { name: string, values: string[] }[];
}

interface ExportContent { 
   fileName: string;
   exportNames: string[]; 
}
function toMap(content: ExportContent): Map<string, string[]> {
    const map = new Map<string, string[]>();
    map.set(content.fileName, content.exportNames);
    return map;
}

function analyzeWithDartAnalyzer(dartCode: string): DartAnalyzerResult {
    // returns a json object
    const resultJSON: string = analyzeDartCode(dartCode);
    return JSON.parse(resultJSON) as DartAnalyzerResult;
}


export type FunctionInfo = {
    name: string;
    content: string;
};

export async function getTopLevelNames(dartCode: string): Promise<string[]> {
    const analysis = analyzeWithDartAnalyzer(dartCode);
    return [...analysis.functions.map(f => f.name), ...analysis.classes.map(c => c.name)];
}

export async function parseTopLevelFunctions(dartCode: string): Promise<FunctionInfo[]> {
    const analysis = analyzeWithDartAnalyzer(dartCode);
    return analysis.functions.map(f => ({ name: f.name, content: dartCode.substring(f.startLocation, f.endLocation) }));
}

export function parseIndexFileWithDart(dartCode: string): Map<string, string[]> {
    const resultJSON: string = parseIndexFile(dartCode);
    const json = JSON.parse(resultJSON);
    const resultMap = new Map<string, string[]>();
    
    Object.entries(json).forEach(([key, value]) => {
        // If value is already an array, store it directly
        if (Array.isArray(value)) {
            resultMap.set(key, value.map(String));
        } else {
            // For non-array values, wrap them in an array
            resultMap.set(key, [String(value)]);
        }
    });
    
    return resultMap;
}

export function formatDartCode(dartCode: string): string {
    return formatDartCodeJs(dartCode);
}