# FlutterFlow VS Code Extension — build & publish helpers.
#
# Publishing targets the `FlutterFlow` Marketplace publisher and needs a
# Personal Access Token (Azure DevOps, scope: Marketplace > Manage). Provide it
# once with `make login`, or export VSCE_PAT in the environment.
#
# Always publish from a clean, merged `main` — the published artifact should
# match the repo's source of truth.

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

## package: produce a versioned .vsix in build/ (runs vscode:prepublish automatically)
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
