import vscode from 'vscode';

import { Analyzer } from './analyzer';
import { CodeActionProvider } from './code_action_provider';

const supportedLanguages = ['cpp', 'c'];

export function activate(context: vscode.ExtensionContext): void {
  Analyzer.initialize();
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      supportedLanguages.map(language => ({ language })),
      new CodeActionProvider(),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('iwyu.analyzeFile', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        try {
          Analyzer.getFor(editor.document).run();
        } catch (error) {
          vscode.window.showErrorMessage('' + error);
        }
      } else {
        vscode.window.showErrorMessage('No file is currently open to analyze.');
      }
    }),
  );
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(document => {
      if (supportedLanguages.includes(document.languageId)) {
        try {
          Analyzer.getFor(document).run();
        } catch (error) {
          console.error(error);
        }
      }
    }),
  );
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(document => {
      if (supportedLanguages.includes(document.languageId)) {
        try {
          Analyzer.getFor(document).runIn(/*seconds=*/ 5);
        } catch (error) {
          console.error(error);
        }
      }
    }),
  );
}

export function deactivate(): void {
  Analyzer.finalize();
}
