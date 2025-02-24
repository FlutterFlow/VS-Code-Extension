# FlutterFlow Custom Code Editor

## Settings


To use the VSCode extension, you must set your API key in the VSCode extension settings (under the FlutterFlow extension). You can generate an API key from the [FlutterFlow account page](https://app.flutterflow.io/account). 

Besides the API key, there are some additional optional settings that can be used to specify the default **Project ID** and **Branch** to use when pulling and updating code.  

You can also set the **Download Location** to use as the initial file location where the code will be downloaded.

_Note that if you want the extension to use Flutter Version Management (FVM) under-the-hood for managing the correct version of Flutter, please ensure it's been [installed](https://fvm.app/documentation/getting-started/installation) and added to your path_


## Basic Usage:

### Downloading Code

The first step in editing custom code for your FlutterFlow project is to download its code. To download the code for your project, use the VSCode command palette (`cmd + shift + p` or `ctrl + shift + p`).

In the command palette, you can use the `FlutterFlow: Download Code` command. 

This command will prompt you for three pieces of information:

1. **Project ID**: This is the unique identifier for your FlutterFlow project. You can find it by hovering over the Project Name in the top left corner inside the FlutterFlow builder.

2. **Branch Name**: The name of the FlutterFlow project branch you want to work on. Leave this blank to work on the main branch.

3. **Download Location**: A file picker will be presented for you to choose where to download your project code. The code will be downloaded to `<selected_directory>/<projectID>`.

After downloading, the extension will automatically begin initializing your environment. This process includes setting up the correct Flutter version and running `flutter pub get`, which may take a few seconds. Once initialization is complete, you can begin editing your code.

### Editing Custom Code

Once initialization is complete, you can begin adding or editing custom code. 

Right now, the only files that are editable are:

- **Custom Actions**: in the `lib/custom_code/actions` directory 
- **Custom Widgets**: in the `lib/custom_code/widgets` directory
- **Custom Functions**: in `lib/flutter_flow/custom_functions.dart`
- **Package Dependencies**: in `pubspec.yaml`

Note that Custom Actions and Widgets have a 1-to-1 relationship between Actions/Widgets and files. So if you create a new file in the `lib/custom_code/actions` directory, you’ll add a new action that will be available in your FlutterFlow project.

For custom functions they are all in one file `lib/flutter_flow/custom_functions.dart`, you can add, edit and delete custom functions directly in this file.

It’s recommended that you install the [Flutter & Dart VSCode Extensions](https://marketplace.visualstudio.com/items?itemName=Dart-Code.flutter) which will make it easier to edit Flutter and Dart code. 

### Testing Changes Locally

As you’re writing custom code, you’ll likely need to test it out. We recommend that you call your Custom Function, Action or Widget from within your FlutterFlow project (for example, by adding the Custom Widget to a page). 

You can then choose to test your app from FlutterFlow, using a Test Mode session or Local Run, or run it locally from VSCode. 

To test using FlutterFlow, make sure to push your changes (covered below) before running.

To run from VSCode, you should have the Flutter VSCode extension installed. Then, you can simply press the Run (play) button in VSCode. [For more details, follow Flutter’s documentation.](https://docs.flutter.dev/tools/vs-code#running-and-debugging)

### Pushing Changes From VSCode to FlutterFlow

To make your custom code available inside of FlutterFlow, you need to push your changes to FlutterFlow. 

Pushing your changes takes all of the files that have been modified in VSCode, and overwrites the state of those files within FlutterFlow. To see what files have been modified, you can check the **FF: Modified Files** section of the Explorer.

The **FF: Modified Files** panel should be updated when a file is updated and saved to indicate what has been added, removed, or changed.

To push your changes to FlutterFlow, click the **Push to FlutterFlow** status bar icon, or run the `FlutterFlow: Push to FlutterFlow` command from the command palette.

Please note that this action cannot be undone. Make sure that you don’t have changes in FlutterFlow that should not be overwritten by local changes in VSCode. To help avoid this situation, we recommend pulling your changes from FlutterFlow before editing in VSCode, and pushing changes as soon as they are complete.

### Pulling Changes From FlutterFlow into VSCode

As you make changes in FlutterFlow, you’ll want to pull those changes down into your local repository. This is especially useful for when you add new Components, App State Variables or Custom Data Types / Enums that you may want to reference in your custom code.

To pull changes click the `Pull Latest` icon on the lower status bar or run the `FlutterFlow: Pull Latest Changes` command.

Similar to pushing changes, it’s important to note that this will override all of your local changes with what was present in FlutterFlow. 

### Renaming Resources

To rename Custom Actions or Custom Widget, use the VSCode rename symbol functionality. Simply, right click the name of a Custom Action or Widget and select **Rename Symbol**, then type the new name.

If you change the name without doing this, you’ll need to update the name in the file where the Widget or Action is defined, as well as the index file that exports the Widget (`lib/custom_code/widgets/index.dart`) or Action (`lib/custom_code/actions/index.dart`).

### Creating a New Resource

To add a new Custom Action or Widget, create a new dart file in the `lib/custom_code/widgets` or `lib/custom_code/actions` directory and the boilerplate should appear within the new file.

To add a new Custom Function, simply create a new function in the `lib/flutter_flow/custom_functions.dart` file. We do not have automatic support for Custom Function boilerplate code in VSCode at this time.

### Deleting a New Resource

To delete a Custom Action or Widget, delete the associated file. 

### Adding New Dependencies

You can add custom pub.dev package dependencies with the Dart: Add Dependency command. This will update the pubspec.yaml file.
