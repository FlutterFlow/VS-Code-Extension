/* eslint-disable @typescript-eslint/no-unused-expressions */
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as assert from 'assert';
import { describe, it } from 'mocha';
import { parseTopLevelFunctions } from '../../fileUtils/dartParser';

describe('dartParser', () => {
    const testCases = [
        {
            description: 'basic function',
            input: `
            void test() {
                print('Hello, world!');
            }
            `,
            expected: [
                {
                    name: 'test',
                    content: "{\n                print('Hello, world!');\n            }"
                }
            ]
        },
        {
            description: 'basic async function',
            input: `
            Future<void> test() async {
                print('Hello, world!');
            }
            `,
            expected: [
                {
                    name: 'test',
                    content: "async {\n                print('Hello, world!');\n            }"
                }
            ]
        },
        {
            description: 'basic function with some closures',
            input: `
            void test() {
                final fn0 = () => print('Hello, world!');
                final fn1 = () {
                    final a = 1;
                    final b = 2;
                    return a + b;
                };
                fn1();
                print('Hello, world!');
            }
            `,
            expected: [
                {
                    name: 'test',
                    content: "{\n                final fn0 = () => print('Hello, world!');\n                final fn1 = () {\n                    final a = 1;\n                    final b = 2;\n                    return a + b;\n                };\n                fn1();\n                print('Hello, world!');\n            }"
                }
            ]
        },
        {
            description: 'async function with default named arguments',
            input: `
            Future<void> test({String name = 'World'}) async {
                print('Hello, $name!');
            }
            `,
            expected: [
                {
                    content: "async {\n" +
                        "                print('Hello, $name!');\n" +
                        '            }',
                    name: 'test'
                }
            ],
        },
        {
            description: 'multiline function signature',
            input: `
            Future<SomeCustomStruct?> createData(
            String first,
            int second, {
            List<int>? ids,
            $rand.Rand testVal = $rand.Rand.defaultVal,
            bool isTrue = false,
            }) async {
                int b = second + 1;
                return null;
            }
            `,
            expected: [
                {
                    name: 'createData',
                    content: "async {\n                int b = second + 1;\n                return null;\n            }"
                }
            ]
        },
        {
            description: 'multiple functions',
            input: `
            void test1() {
                print('Hello, world!');
            }

            void test2() {
                print('Hello, world!');
            }
            `,
            expected: [
                {
                    name: 'test1',
                    content: "{\n                print('Hello, world!');\n            }"
                },
                {
                    name: 'test2',
                    content: "{\n                print('Hello, world!');\n            }"
                }
            ]
        },
        {
            description: 'function with optional list return',
            input: `

            List<String>? convertArrayToStrings(
                List<FruitStruct> fruitBasket,
                int basketIndex,
            ) {
                return fruitBasket![basketIndex!]
                .colorList!
                .map((item) => item.toString())
                .toList();
            }
            `,
            expected: [
                {
                    name: 'convertArrayToStrings',
                    content: "{\n                return fruitBasket![basketIndex!]\n                .colorList!\n                .map((item) => item.toString())\n                .toList();\n            }"
                }
            ]
        },
        {
            description: 'realistic example',
            input: `
            import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import 'package:timeago/timeago.dart' as timeago;
import 'lat_lng.dart';
import 'place.dart';
import 'uploaded_file.dart';
import '/backend/backend.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import '/backend/schema/structs/index.dart';
import '/backend/schema/enums/enums.dart';
import '/auth/firebase_auth/auth_util.dart';

List<String>? convertArrayToStrings(
  List<FruitStruct> fruitBasket,
  int basketIndex,
) {
  return fruitBasket![basketIndex!]
      .colorList!
      .map((item) => item.toString())
      .toList();
}

List<String>? numberListToString(List<int>? sequence) {
  print('numberListToString');
  print(sequence);

  return sequence!.map((item) => item.toString()).toList();
}

int calculatePreference(
  double? ratingValue,
  String? choiceValue,
  String? preferenceMode,
) {
  if (preferenceMode == "rating") {
    return ratingValue!.floor();
  } else {
    return int.parse(choiceValue!);
  }
}

String? getDifficultyLevel(String? gameMode) {
  switch (gameMode) {
    case 'Standard':
      return 'basic';
      break;
    case 'Beginner':
      return 'simple';
      break;
    case 'Expert':
      return 'difficult';
      break;
    case 'Elimination':
      return 'survival';
      break;
    case 'Timed':
      return 'rush';
      break;
    case 'Personalized':
      return 'tailored';
      break;
  }
}

String verifySelection(AnimalStruct? creature) {
  if (creature == null) {
    return 'https://placeholder.image.jpg';
  } else {
    return creature!.pictureUrl;
  }
}

            `,
            expected: [
                {
                    name: "convertArrayToStrings",
                    content: "{\n  return fruitBasket![basketIndex!]\n      .colorList!\n      .map((item) => item.toString())\n      .toList();\n}",
                },
                {
                    name: "numberListToString",
                    content: "{\n  print('numberListToString');\n  print(sequence);\n\n  return sequence!.map((item) => item.toString()).toList();\n}",
                },
                {
                    name: "calculatePreference",
                    content: "{\n  if (preferenceMode == \"rating\") {\n    return ratingValue!.floor();\n  } else {\n    return int.parse(choiceValue!);\n  }\n}",
                },
                {
                    name: "getDifficultyLevel",
                    content: "{\n  switch (gameMode) {\n    case 'Standard':\n      return 'basic';\n      break;\n    case 'Beginner':\n      return 'simple';\n      break;\n    case 'Expert':\n      return 'difficult';\n      break;\n    case 'Elimination':\n      return 'survival';\n      break;\n    case 'Timed':\n      return 'rush';\n      break;\n    case 'Personalized':\n      return 'tailored';\n      break;\n  }\n}",
                },
                {
                    name: "verifySelection",
                    content: "{\n  if (creature == null) {\n    return 'https://placeholder.image.jpg';\n  } else {\n    return creature!.pictureUrl;\n  }\n}"
                }
            ]
        },
        {
            description: 'only a widget file',
            input: `
            // Automatic FlutterFlow imports
import '/backend/backend.dart';
import '/flutter_flow/flutter_flow_theme.dart';
import '/flutter_flow/flutter_flow_util.dart';
import 'index.dart'; // Imports other custom widgets
import '/custom_code/actions/index.dart'; // Imports custom actions
import '/flutter_flow/custom_functions.dart'; // Imports custom functions
import 'package:flutter/material.dart';
// Begin custom widget code
// DO NOT REMOVE OR MODIFY THE CODE ABOVE!

class Acontainer extends StatefulWidget {
  const Acontainer({
    super.key,
    this.width,
    this.height,
  });

  final double? width;
  final double? height;

  @override
  State<Acontainer> createState() => _AcontainerState();
}

class _AcontainerState extends State<Acontainer> {
  @override
  Widget build(BuildContext context) {
    return Container();
  }
}

            `,
            expected: []
        }


    ];

    testCases.forEach((testCase) => {
        it(`should parse case "${testCase.description}" correctly`, async () => {
            const result = await parseTopLevelFunctions(testCase.input);
            assert.deepEqual(result, testCase.expected);
        });
    });
});
