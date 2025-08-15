import { CodeType, FileInfo } from "../fileUtils/FileInfo";
import { FlutterFlowApiClient, PushCodeRequest, FileWarning } from "../api/FlutterFlowApiClient";

import { UpdateManager } from "../ffState/UpdateManager";
import * as path from 'path';
import * as fs from 'fs';
import AdmZip from "adm-zip";


type SyncCodeParams = {
    customCodePaths: string[];
    serializedYaml: string;
    branchName: string;
    projectId: string;
    uuid: string;
    fileMapContents: string;
    functionChangesMap: string;
};

type SyncCodeResult = {
    error: Error | null;
    fileWarnings: Map<string, FileWarning[]>;
};


function customFilePath(fileMapKey: string, fileInfo: FileInfo): string {
    if (fileInfo.type == 'A') {
        return path.join('lib', 'custom_code', 'actions', fileMapKey);
    }
    if (fileInfo.type == 'W') {
        return path.join('lib', 'custom_code', 'widgets', fileMapKey);
    }
    if (fileInfo.type == 'F') {
        return path.join('lib', 'flutter_flow', 'custom_functions.dart');
    }
    if (fileInfo.type == 'D') {
        return 'pubspec.yaml';
    }
    if (fileInfo.type == 'O') {
        return path.join('lib', 'custom_code', fileMapKey);
    }
    throw Error(`Invalid custom code filemap entry ${fileMapKey}`);
}

export async function pushToFF(apiClient: FlutterFlowApiClient, projectRoot: string, updateManager: UpdateManager, requestId: string): Promise<SyncCodeResult> {

    const branchName = apiClient.branchName;
    const projectId = apiClient.projectId;

    const fileMap: Map<string, FileInfo> = updateManager.fileMap;
    // modifiedFiles is an array of full file paths relative to the project root
    const modifiedFiles = Array.from(fileMap.entries())
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        .filter(([_, file]) => file.original_checksum !== file.current_checksum)
        .map(([key, file]) => path.join(projectRoot, customFilePath(key, file)));
    const yamlContents = fs.readFileSync(path.join(projectRoot, 'pubspec.yaml'), "utf8");
    const functionChangesMapString = JSON.stringify(await updateManager.functionChange());
    const syncCodeParams: SyncCodeParams = {

        customCodePaths: modifiedFiles,
        serializedYaml: yamlContents,
        branchName: branchName,
        projectId: projectId,
        uuid: requestId,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        fileMapContents: JSON.stringify(Object.fromEntries(Array.from(fileMap.entries()).filter(([_, fileInfo]: [string, FileInfo]) => fileInfo.type !== CodeType.DEPENDENCIES))),
        functionChangesMap: functionChangesMapString
    };
    let fileErrors: Map<string, FileWarning[]> = new Map();
    try {
        const response = await sendSyncRequest(syncCodeParams, apiClient);
        fileErrors = await parseSyncCodeResponse(response);
    } catch (error) {
        console.error(error);
        return { error: new Error("Error syncing with FlutterFlow: " + error), fileWarnings: fileErrors };
    }
    return { error: null, fileWarnings: fileErrors };
}


async function parseSyncCodeResponse(response: Response): Promise<Map<string, FileWarning[]>> {
    // Distinguish failing on a project level error message vs file level.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let jsonResult: any;
    const originalResponse = response.clone();
    try {
        console.log("response status", response);
        jsonResult = await response.json();
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
        throw new Error(await originalResponse.text());
    }
    if (!response.ok) {
        const errorMap = new Map<string, FileWarning[]>(
            Object.entries(jsonResult)
        );
        return errorMap;
    } else {
        const valueObject = JSON.parse(jsonResult.value);
        const errorMap = new Map<string, FileWarning[]>(
            Object.entries(valueObject)
        );
        return errorMap;
    }
}


export async function sendSyncRequest(params: SyncCodeParams, apiClient: FlutterFlowApiClient): Promise<Response> {
    const pushCodeRequest = await _zipAndSendFolder(
        params.customCodePaths,
        params.serializedYaml,
        params.branchName,
        params.projectId,
        params.uuid,
        params.fileMapContents,
        params.functionChangesMap
    );
    if (pushCodeRequest) {
        return await apiClient.pushCode(pushCodeRequest);
    }
    return Response.error();
}

// Zips up files specified by the provided file paths and send it to the backend.
async function _zipAndSendFolder(
    customCodePaths: string[],
    serializedYaml: string,
    branchName: string,
    projectId: string,
    uuid: string,
    fileMapContents: string,
    functionChangesMap: string

): Promise<PushCodeRequest | null> {
    try {
        // Create a new zip file
        const zip = new AdmZip();

        // Loop through each path and add to zip
        for (const customCodePath of customCodePaths) {
            if (fs.statSync(customCodePath).isDirectory()) {
                // Add folder to zip
                zip.addLocalFolder(customCodePath);
            } else {
                // Add file to zip
                zip.addLocalFile(customCodePath);
            }
        }

        // Get the zip file bytes as a string
        const zipBuffer = zip.toBuffer().toString("base64");

        // Prepare the form data
        const formData = {
            project_id: projectId,
            zipped_custom_code: zipBuffer,
            uid: uuid,
            branch_name: branchName,
            serialized_yaml: serializedYaml,
            file_map: fileMapContents,
            functions_map: functionChangesMap,
        };

        return formData;
    } catch (error) {
        console.error(error);
    }
    return null;

}