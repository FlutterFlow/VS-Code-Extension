import * as vscode from "vscode";

enum Environment {
  Prod = "prod",
  Dev = "dev",
  Alpha = "alpha",
  Beta = "beta",
}

const currentEnv = Environment.Prod;

const envToApiUrl = {
  [Environment.Prod]: "https://api.flutterflow.io/v1",
  [Environment.Dev]: "https://api.quoteboard.io/v1",
  [Environment.Alpha]: "https://api-alpha.flutterflow.io/v1",
  [Environment.Beta]: "https://api.flutterflow.io/v1-staging",
}

const apiUrlToWebAppUrl = new Map<string, string>([
  ["https://api.flutterflow.io/v1", "app.flutterflow.io"],
  ["https://api.quoteboard.io/v1", "flutterflowdev.web.app"],
  ["https://api-alpha.flutterflow.io/v1", "alpha.flutterflow.io"],
  ["https://api.flutterflow.io/v1-staging", "beta.flutterflow.io"],
  ["https://api-enterprise-us-central.flutterflow.io/v1", "enterprise-us-central.flutterflow.io"],
  ["https://api-enterprise-india.flutterflow.io/v1", "enterprise-india.flutterflow.io"],
  ["https://api-enterprise-europe.flutterflow.io/v1", "enterprise-europe.flutterflow.io"],
  ["https://api-enterprise-apac.flutterflow.io/v1", "enterprise-apac.flutterflow.io"],
]);

function getCurrentApiUrl(): string {
  const urlOverride = vscode.workspace.getConfiguration("flutterflow").get<string>("urlOverride");
  if (urlOverride) {
    return urlOverride;
  }
  return envToApiUrl[currentEnv];

}

function getCurrentWebAppUrl(): string {
  const apiUrl = getCurrentApiUrl();
  return apiUrlToWebAppUrl.get(apiUrl) || "app.flutterflow.io";
}

function getApiKey(): string {
  const configApiKey = vscode.workspace.getConfiguration("flutterflow").get<string>("userApiToken");
  const envApiKey = process.env.FLUTTERFLOW_API_TOKEN;

  if (configApiKey && configApiKey.trim() !== "") {
    return configApiKey;
  }

  return envApiKey || "";
};

export { getCurrentApiUrl, getCurrentWebAppUrl, getApiKey };
