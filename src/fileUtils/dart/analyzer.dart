// analyzer.dart
@JS()
library analyzer;

import 'dart:convert';
import 'package:dart_style/dart_style.dart';
import 'package:js/js.dart';
import 'package:js/js_util.dart';
import 'package:analyzer/dart/analysis/utilities.dart';
import 'package:analyzer/dart/analysis/features.dart';
import 'package:analyzer/dart/ast/ast.dart';
import 'package:analyzer/dart/ast/visitor.dart';

@JS('analyzeDartCode')
external set _analyzeDartCode(dynamic Function(String) f);

@JS('parseIndexFile')
external set _parseIndexFile(dynamic Function(String) f);

@JS('formatDartCodeJs')
external set _formatDartCodeJs(dynamic Function(String) f);

void main() {
  _analyzeDartCode = allowInterop(analyzeDartCode);
  _parseIndexFile = allowInterop(parseIndexFile);
  _formatDartCodeJs = allowInterop(formatDartCodeJs);
}

String analyzeDartCode(String code) {
  try {
    // Create a fake path since we're analyzing string content directly
    final parseResult = parseString(
      content: code,
      featureSet: FeatureSet.latestLanguageVersion(),
      throwIfDiagnostics: false,
      path: '/virtual/main.dart', // Provide a fake path to avoid URI.base usage
    );

    // Get the compilation unit
    final unit = parseResult.unit;
    final analysisResult = {
      'functions': <Map<String, dynamic>>[],
      'classes': <Map<String, dynamic>>[],
      'enums': <Map<String, dynamic>>[]
    };

    // Process declarations
    for (var declaration in unit.declarations) {
      if (declaration is FunctionDeclaration) {
        analysisResult['functions']!.add({
          'name': declaration.name.lexeme,
          'returnType': declaration.returnType?.toString() ?? 'dynamic',
          'parameters':
              declaration.functionExpression.parameters?.toString() ?? '()',
          'startLocation': declaration.functionExpression.body.offset,
          'endLocation': declaration.functionExpression.body.offset +
              declaration.functionExpression.body.length,
        });
      } else if (declaration is ClassDeclaration) {
        final classData = <String, dynamic>{
          'name': declaration.name.lexeme,
          'methods': <Map<String, dynamic>>[],
          'fields': <Map<String, dynamic>>[]
        };

        // Add methods
        for (var member in declaration.members) {
          if (member is MethodDeclaration) {
            classData['methods']!.add({
              'name': member.name.lexeme,
              'returnType': member.returnType?.toString() ?? 'dynamic',
              'parameters': member.parameters?.toString() ?? '()',
              'isStatic': member.isStatic,
              'isPrivate': member.name.lexeme.startsWith('_'),
            });
          } else if (member is FieldDeclaration) {
            for (var variable in member.fields.variables) {
              classData['fields']!.add({
                'name': variable.name.lexeme,
                'type': member.fields.type?.toString() ?? 'dynamic',
                'isStatic': member.isStatic,
                'isPrivate': variable.name.lexeme.startsWith('_'),
                'isFinal': member.fields.isFinal,
                'isConst': member.fields.isConst,
              });
            }
          }
        }

        analysisResult['classes']!.add(classData);
      } else if (declaration is EnumDeclaration) {
        final enumData = {
          'name': declaration.name.lexeme,
          'values': declaration.constants
              .map((constant) => constant.name.lexeme)
              .toList(),
        };
        analysisResult['enums']!.add(enumData);
      }
    }

    return jsonEncode(analysisResult);
  } catch (e, stackTrace) {
    return jsonEncode({
      'error': e.toString(),
      'stackTrace': stackTrace.toString(),
    });
  }
}

class ExportVisitor extends SimpleAstVisitor<void> {
  final Map<String, List<String>> exports = {};

  @override
  void visitExportDirective(ExportDirective node) {
    final uri = node.uri.stringValue;
    if (uri != null) {
      final shows = node.combinators
          .whereType<ShowCombinator>()
          .expand((show) => show.shownNames)
          .map((id) => id.name)
          .toList();

      if (shows.isNotEmpty) {
        exports[uri] = shows;
      }
    }
  }
}

String parseIndexFile(String content) {
  try {
    // Parse the content into an AST
    final parseResult = parseString(
      content: content,
      featureSet: FeatureSet.latestLanguageVersion(),
    );

    // Create and use our visitor
    final visitor = ExportVisitor();
    parseResult.unit.visitChildren(visitor);

    return jsonEncode(visitor.exports);
  } catch (e) {
    print('Error parsing exports: $e');
    return '{}';
  }
}

String formatDartCodeJs(String sourceCode) {
  try {
    final formatter = DartFormatter();
    return formatter.format(sourceCode);
  } catch (e) {
    // If formatting fails, return the original code
    print('Formatting failed: $e');
    return sourceCode;
  }
}
