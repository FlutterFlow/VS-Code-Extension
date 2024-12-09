

export const mockFiles = new Map<string, string>([
  ['lib/custom_code/actions/my_action.dart',
    `// Automatic FlutterFlow imports
import '/backend/schema/structs/index.dart';
import '/flutter_flow/flutter_flow_theme.dart';
import '/flutter_flow/flutter_flow_util.dart';
import 'index.dart'; // Imports other custom actions
import '/flutter_flow/custom_functions.dart'; // Imports custom functions
import 'package:flutter/material.dart';
// Begin custom action code
// DO NOT REMOVE OR MODIFY THE CODE ABOVE!

import 'package:file_picker/file_picker.dart';

Future<List<String>> myAction() async {
  // Add your function code here!
  return [""];
}
`
  ],
  ['lib/custom_code/widgets/my_widget.dart',
    `// Automatic FlutterFlow imports
import '/backend/schema/structs/index.dart';
import '/flutter_flow/flutter_flow_theme.dart';
import '/flutter_flow/flutter_flow_util.dart';
import 'index.dart'; // Imports other custom widgets
import '/custom_code/actions/index.dart'; // Imports custom actions
import '/flutter_flow/custom_functions.dart'; // Imports custom functions
import 'package:flutter/material.dart';
// Begin custom widget code
// DO NOT REMOVE OR MODIFY THE CODE ABOVE!

class MyWidget extends StatefulWidget {
  const MyWidget({
    super.key,
    this.width,
    this.height,
  });

  final double? width;
  final double? height;

  @override
  State<MyWidget> createState() => _MyWidgetState();
}

class _MyWidgetState extends State<MyWidget> {
  @override
  Widget build(BuildContext context) {
    return Container();
  }
}`
  ],
  ['lib/flutter_flow/custom_functions.dart', `
        import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import 'package:timeago/timeago.dart' as timeago;
import 'lat_lng.dart';
import 'place.dart';
import 'uploaded_file.dart';
import '/backend/schema/structs/index.dart';

String func335() {
  return "func335";
}

String func336(String param1) {
  return "func336 $param1";
}

String func337(String param1) {
  return "func337 $param1";
}

Future<DocumentReference?> createTestRun(
  String label,
  String hashBefore,
  String hashAfter, {
  List<String>? projectIds,
}) async {
  if (runnerId != 0 && runnerId != 1) {
    ffLog('Invalid runner id: $runnerId');
    return null;
    }
    return "$label";
    }

`
  ],
  ['lib/custom_code/widgets/index.dart', `
        export 'my_widget.dart' show MyWidget;
`],
  ['lib/custom_code/actions/index.dart', `
        export 'my_action.dart' show myAction;
`],
  ['pubspec.yaml', `
        name: flutter_flow_custom_code_editor
        description: A FlutterFlow custom code editor
        publish_to: none
        version: 1.0.0
`],
]);
