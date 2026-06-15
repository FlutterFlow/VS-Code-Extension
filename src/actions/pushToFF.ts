import { CodeType, FileInfo } from "../fileUtils/FileInfo";
import { FlutterFlowApiClient, PushCodeRequest, FileWarning } from "../api/FlutterFlowApiClient";

import type { UpdateManager } from "../ffState/UpdateManager";
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

// The server looks up zip entries by their basename, so the wire file_map must be keyed
// by basename. It only consults the map for modified files (zip lookups) and deletions,
// so only those entries are sent; two such files sharing a basename cannot be
// disambiguated and block the push.
export function buildWireFileMap(fileMap: Map<string, FileInfo>): {
    wireFileMap: Record<string, FileInfo>;
    collidingPaths: string[][];
} {
    const wireFileMap: Record<string, FileInfo> = {};
    const pathsByBaseName = new Map<string, string[]>();
    for (const [filePath, fileInfo] of fileMap.entries()) {
        if (fileInfo.type === CodeType.DEPENDENCIES || fileInfo.type === CodeType.OTHER) continue;
        if (!fileInfo.is_deleted && fileInfo.original_checksum === fileInfo.current_checksum) continue;
        const baseName = path.posix.basename(filePath);
        pathsByBaseName.set(baseName, [...(pathsByBaseName.get(baseName) || []), filePath]);
        wireFileMap[baseName] = fileInfo;
    }
    const collidingPaths = Array.from(pathsByBaseName.values()).filter((paths) => paths.length > 1);
    return { wireFileMap, collidingPaths };
}

export async function pushToFF(apiClient: FlutterFlowApiClient, projectRoot: string, updateManager: UpdateManager, requestId: string): Promise<SyncCodeResult> {

    const branchName = apiClient.branchName;
    const projectId = apiClient.projectId;

    const fileMap: Map<string, FileInfo> = updateManager.fileMap;
    const { wireFileMap, collidingPaths } = buildWireFileMap(fileMap);
    if (collidingPaths.length > 0) {
        const collisionList = collidingPaths.map((paths) => paths.join(', ')).join('; ');
        return {
            error: new Error(`Cannot push: multiple custom code files share the same file name, which FlutterFlow cannot disambiguate yet. Rename one of: ${collisionList}`),
            fileWarnings: new Map(),
        };
    }
    // modifiedFiles is an array of full file paths; file map keys are project-root-relative
    const modifiedFiles = Array.from(fileMap.entries())
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        .filter(([_, file]) => !file.is_deleted && file.original_checksum !== file.current_checksum)
        .map(([key]) => path.join(projectRoot, ...key.split(path.posix.sep)));
    const yamlContents = fs.readFileSync(path.join(projectRoot, 'pubspec.yaml'), "utf8");
    const functionChangesMapString = JSON.stringify(await updateManager.functionChange());
    const syncCodeParams: SyncCodeParams = {

        customCodePaths: modifiedFiles,
        serializedYaml: yamlContents,
        branchName: branchName,
        projectId: projectId,
        uuid: requestId,
        fileMapContents: JSON.stringify(wireFileMap),
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
