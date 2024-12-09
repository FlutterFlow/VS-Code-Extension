import analyzeDartCode from './dart/analyzer';

interface DartAnalyzerResult {
    functions: { name: string, returnType: string, parameters: string, startLocation: number, endLocation: number }[];
    classes: { name: string, methods: { name: string, returnType: string, parameters: string }[] }[];
    enums: { name: string, values: string[] }[];
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