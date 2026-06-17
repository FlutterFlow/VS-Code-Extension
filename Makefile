# FlutterFlow VS Code Extension — build & publish helpers.
#
# Always build from a clean, merged `main` — the published artifact should
# match the repo's source of truth.
#
# Two ways to publish (both require membership in the `FlutterFlow` Marketplace
# publisher: https://marketplace.visualstudio.com/manage/publishers/flutterflow):
#
# 1. Manual web upload (no token needed):
#      - `make package`  (writes build/*.vsix)
#      - Open https://marketplace.visualstudio.com/manage/publishers/flutterflow
#      - Extensions tab -> "FlutterFlow: Custom Code Editor" row -> `...` -> Update
#      - Drag in build/*.vsix and confirm. Version is read from package.json.
#
# 2. CLI (`make publish`): needs a Personal Access Token (Azure DevOps, scope
#    Marketplace > Manage, organization "All accessible organizations").
#    Provide it once with `make login`, or export VSCE_PAT in the environment.

VSCE ?= npx --yes @vscode/vsce

.PHONY: install build test package login publish clean

## install: clean install of dependencies
install:
	npm ci

## build: production bundle (type-check + lint + minified esbuild)
build:
	npm run package

## test: run the VS Code integration harness and the jest unit tests
test:
	npm test
	npx jest

## package: build a versioned .vsix into build/ (drag into the web portal, or run `make publish`)
package:
	@mkdir -p build
	$(VSCE) package --out build/

## login: authenticate the FlutterFlow publisher (interactive PAT prompt)
login:
	$(VSCE) login FlutterFlow

## publish: publish the current package.json version to the Marketplace
publish:
	$(VSCE) publish

## clean: remove build output and packaged artifacts
clean:
	rm -rf dist build
