import vscode from 'vscode';

import { Analyzer } from './analyzer';
import { CodeActionProvider } from './code_action_provider';
import { Logger } from './logger';

const supportedLanguages = ['cpp', 'c'];

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(Analyzer.initialize());
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      supportedLanguages.map(language => ({ language })),
      new CodeActionProvider(),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('iwyu.analyzeFile', async () => {
      const document = vscode.window.activeTextEditor?.document;
      if (document) {
        const logger = Logger.get();
        logger.showAndAppendLine(`Running IWYU run on ${document.uri.fsPath}...`);
        try {
          await Analyzer.getFor(document).run(/*force=*/ true);
        } catch (error) {
          logger.error(error as Error);
        }
      } else {
        vscode.window.showErrorMessage('No file is currently open to analyze.');
      }
    }),
  );
  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors(editors => {
      editors
        .map(editor => editor.document)
        .filter(document => supportedLanguages.includes(document.languageId))
        .forEach(async document => {
          try {
            await Analyzer.getFor(document).run();
          } catch (error) {
            Logger.get().error(error as Error);
          }
        });
    }),
  );
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async document => {
      if (supportedLanguages.includes(document.languageId)) {
        try {
          await Analyzer.getFor(document).runIn(/*seconds=*/ 5);
        } catch (error) {
          Logger.get().error(error as Error);
        }
      }
    }),
  );
}

export function deactivate(): void {}
