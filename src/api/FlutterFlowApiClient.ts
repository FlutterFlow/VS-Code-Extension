import { CodeType } from "../fileUtils/FileInfo";
import { exportCode } from "./exportCode";

/**
 * Represents a warning or error in the FlutterFlow problems panel.
 * These warnings can be related to different types of files and can be either critical or non-critical.
 * Critical errors prevent syncing and require user fixes.
 */
export type FileWarning = {
    // Indicates the type of file where the warning occurred (action, widget, function, or pubspec)
    fileType?: CodeType;
    // The actual error message describing the issue
    errorMessage: string;
    // If true, this error prevents syncing and requires user intervention
    isCritical: boolean;
}

/**
 * Represents the result of attempting to push code to FlutterFlow.
 * Contains status code and any potential error information.
 */
export type PushCodeResult = {
    // HTTP response code from the API call
    responseCode: number,
    // Optional error message if the push failed
    errorMessage?: string,
    // Map of file paths to their associated warnings/errors
    errorMap?: Map<string, FileWarning[]>,
}

/**
 * Response type for the Flutter version API endpoint.
 * Contains the Flutter version string used by FlutterFlow.
 */
type FlutterFlowFlutterVersionResponse = {
    // The Flutter version string used by FlutterFlow. e.g. "3.24.2"
    value: string;
};

/**
 * Request payload structure for pushing code to FlutterFlow.
 * Contains all necessary data for syncing local changes with the FlutterFlow project.
 */
export type PushCodeRequest = {
    // FlutterFlow project identifier
    project_id: string;
    // Base64 encoded zip file containing custom code
    zipped_custom_code: string;
    // User identifier
    uid: string;
    // Target branch name in FlutterFlow
    branch_name: string;
    // Serialized pubspec.yaml configuration
    serialized_yaml: string;
    // JSON string mapping of file paths to their contents
    file_map: string;
    // JSON string mapping of function definitions
    functions_map: string;
}

/**
 * Client class for interacting with the FlutterFlow API.
 * Handles authentication and provides methods for code synchronization operations.
 */
export class FlutterFlowApiClient {
    private apiKey: string;
    private baseUrl: string;
    private readonly _projectId: string;
    private readonly _branchName: string;
    private fetchFn: typeof fetch;

    // Getter for the project ID to ensure read-only access
    get projectId(): string {
        return this._projectId;
    }

    // Getter for the branch name to ensure read-only access
    get branchName(): string {
        // "main" and "" both represent the default branch in FlutterFlow. The APIs expect "".
        return this._branchName === 'main' ? '' : this._branchName;
    }

    /**
     * Creates a new FlutterFlow API client instance.
     * @param apiKey - Authentication token for API access
     * @param baseUrl - Base URL for the FlutterFlow API
     * @param projectId - ID of the FlutterFlow project
     * @param branchName - Name of the branch to work with
     * @param fetchFn - Optional fetch function for making HTTP requests (useful for testing)
     */
    constructor(apiKey: string, baseUrl: string, projectId: string, branchName: string, fetchFn: typeof fetch = fetch) {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
        this._projectId = projectId;
        this._branchName = branchName;
        this.fetchFn = fetchFn;
    }

    /**
     * Pulls code from FlutterFlow and saves it to the specified directory.
     * @param destDir - Destination directory where the code will be saved
     */
    async pullCode(destDir: string) {
        console.log(`Pulling code from FlutterFlow to ${destDir}, project ID: ${this.projectId}, branch: ${this.branchName}`);
        await exportCode({
            token: this.apiKey,
            endpoint: this.baseUrl,
            projectId: this.projectId,
            destinationPath: destDir,
            includeAssets: true,
            unzipToParentFolder: false,
            exportAsModule: false,
            branchName: this.branchName,
        });
    }

    /**
     * Pushes local code changes to FlutterFlow.
     * @param pushCodeRequest - Request object containing all necessary data for the push operation
     * @returns Promise resolving to the API response
     * @throws Error if the API call fails
     */
    async pushCode(pushCodeRequest: PushCodeRequest): Promise<Response> {
        try {
            const response = await this.fetchFn(`${this.baseUrl}/syncCustomCodeChanges`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify(pushCodeRequest),
            });
            return response;
        } catch (error) {
            throw new Error(`API Error syncing code: ${error}`);
        }
    }

    /**
     * Retrieves the Flutter version used by FlutterFlow.
     * @returns Promise resolving to the Flutter version string
     * @throws Error for non-401 API errors
     */
    async getFlutterFlowFlutterVersion(): Promise<string> {
        // Default Flutter version to use if the API call fails with a 401
        const kFallbackFlutterVersion = "3.32.4";
        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({})
        };

        const url = this.baseUrl + "/flutterFlowFlutterVersion";
        try {
            const response = await this.fetchFn(url, options);
            const jsonResult = await response.json() as FlutterFlowFlutterVersionResponse;
            return jsonResult.value;
        } catch (error: unknown) {
            console.log(`Error getting FlutterFlow Flutter version: ${error} at url: ${url}`);
            if (typeof error === 'object' && error !== null && 'status' in error && error.status === 401) {
                return kFallbackFlutterVersion;
            }
            throw error; // Re-throw the error if it's not a 401 status
        }
    }
}
