import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';


type AssetDescription = {
    path: string;
    url: string;
}

type ExportCodeResponse = {
    project_zip: string;
    assets: AssetDescription[];
    success: boolean;
    reason?: string;
    code?: number;
}

export async function exportCode(
    {
        token,
        endpoint,
        projectId,
        destinationPath,
        includeAssets,
        unzipToParentFolder,
        exportAsModule,
        branchName,
        commitHash,
        exportAsDebug = false,
        format = true,
    }: {
        token: string,
        endpoint: string,
        projectId: string,
        destinationPath: string,
        includeAssets: boolean,
        unzipToParentFolder: boolean,
        exportAsModule: boolean,
        branchName?: string,
        commitHash?: string,
        exportAsDebug?: boolean,
        format?: boolean,
    },
): Promise<string | undefined> {
    if (exportAsDebug && exportAsModule) {
        throw new Error('Cannot export as module and debug at the same time.');
    }

    const endpointUrl = new URL(endpoint);

    const result = await callExport(
        token,
        endpointUrl,
        projectId,
        branchName,
        commitHash,
        exportAsModule,
        includeAssets,
        format,
        exportAsDebug
    );
    if (!result.success) {
        throw new Error(`status: ${result.code} Message: ${result.reason}`);
    }

    // Download actual code
    const projectZipBuffer = Buffer.from(result.project_zip, 'base64');
    const zip = new AdmZip(projectZipBuffer);

    if (unzipToParentFolder) {
        zip.extractAllTo(destinationPath, true);
    } else {
        await extractArchiveToCurrentDirectory(zip, destinationPath);
    }

    const folderName = zip.getEntries()[0].entryName.split('/')[0];

    const postCodeGenerationPromises: Promise<void>[] = [];

    if (includeAssets) {
        postCodeGenerationPromises.push(downloadAssets(destinationPath, result.assets, unzipToParentFolder));
    }

    if (postCodeGenerationPromises.length > 0) {
        await Promise.all(postCodeGenerationPromises);
    }

    return folderName;
}

async function extractArchiveToCurrentDirectory(zip: AdmZip, destinationPath: string) {
    zip.getEntries().forEach(async (entry) => {
        if (!entry.isDirectory) {
            const entryPath = entry.entryName.split('/').slice(1).join('/');
            const fullPath = path.join(destinationPath, entryPath);
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            await fs.promises.writeFile(fullPath, entry.getData());
        }
    });
}

async function callExport(
    token: string,
    endpoint: URL,
    projectId: string,
    branchName?: string,
    commitHash?: string,
    exportAsModule: boolean = false,
    includeAssets: boolean = false,
    format: boolean = true,
    exportAsDebug: boolean = false
): Promise<ExportCodeResponse> {
    console.log(`calling exportCode with endpoint: ${endpoint.toString()} projectId: ${projectId}`);
    const body = JSON.stringify({
        project: { path: `projects/${projectId}` },
        ...(branchName && { branch_name: branchName }),
        ...(commitHash && { commit: { path: `commits/${commitHash}` } }),
        export_as_module: exportAsModule,
        include_assets_map: includeAssets,
        format: format,
        export_as_debug: exportAsDebug,
    });

    const response = await fetch(new URL(endpoint.pathname + '/exportCode', endpoint), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        },
        body: body,
    });
    if (!response.ok) {
        return {
            project_zip: "",
            assets: [],
            success: false,
            reason: await response.text(),
            code: response.status,
        } as ExportCodeResponse;
    }
    const responseJson = await response.json() as { value: ExportCodeResponse };
    return {
        project_zip: responseJson.value.project_zip as string,
        assets: responseJson.value.assets as AssetDescription[],
        success: true,
        code: response.status,
    } as ExportCodeResponse;

}

async function downloadAssets(destinationPath: string, assetDescriptions: AssetDescription[], unzipToParentFolder: boolean): Promise<void> {
    const downloadPromises = assetDescriptions.map(async (assetDescription) => {
        let assetPath = assetDescription.path.split('/').join(path.sep);
        if (!unzipToParentFolder) {
            assetPath = path.join(...path.parse(assetPath).dir.split(path.sep).slice(1), path.parse(assetPath).base);
        }
        const url = assetDescription.url;
        const fileDest = path.join(destinationPath, assetPath);

        try {
            const response = await fetch(url);
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                await fs.promises.mkdir(path.dirname(fileDest), { recursive: true });
                await fs.promises.writeFile(fileDest, Buffer.from(arrayBuffer));
            } else {
                console.error(`Error downloading asset ${assetPath}. This is probably fine.`);
            }
        } catch (error) {
            console.error(`Error downloading asset ${assetPath}. This is probably fine. Error: ${error}`);
        }
    });

    await Promise.all(downloadPromises);
}
