# Change Log

## 1.2.0

- Removed requirement to run "Start Code Editing Session" command. Environment initialization (Flutter setup and package installation) now happens automatically after downloading code.

## 1.1.9

- Fix issue with downloading assets on Windows.

## 1.1.5

- Added branch name info to status bar.

## 1.1.3

- Fix issue with multi-line exports in generated index.dart files.

## 1.1.2

- Add separate FlutterFlow panel containing the modified files and problems panels
- use FVM to support multiple Flutter versions.
- Various bugfixes

## 1.0.9

- Less destructive pull: Top level files and folders that are not part of the FlutterFlow
  generated project code are not deleted when pulling the latest code.

## 1.0.8

- Better error reporting when downloading code

## 1.0.6

- Fix some sync issues related to multi-file export statements in index.dart files
- Add overrideUrl option for using extension in other environments.

## 1.0.2

- Initial release
