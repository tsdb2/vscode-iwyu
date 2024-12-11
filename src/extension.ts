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
    vscode.commands.registerCommand('iwyu.analyzeFile', () => {
      const document = vscode.window.activeTextEditor?.document;
      if (document) {
        const logger = Logger.get();
        logger.spinner(async () => {
          Logger.get().showAndDump(`Running IWYU run on ${document.uri.fsPath}...`);
          try {
            await Analyzer.getFor(document).run();
          } catch (error) {
            vscode.window.showErrorMessage('' + error);
          }
        });
      } else {
        vscode.window.showErrorMessage('No file is currently open to analyze.');
      }
    }),
  );
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(document => {
      if (supportedLanguages.includes(document.languageId)) {
        const logger = Logger.get();
        logger.spinner(async () => {
          try {
            await Analyzer.getFor(document).run();
          } catch (error) {
            logger.error(error as Error);
          }
        });
      }
    }),
  );
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(document => {
      if (supportedLanguages.includes(document.languageId)) {
        const logger = Logger.get();
        logger.spinner(async () => {
          try {
            await Analyzer.getFor(document).runIn(/*seconds=*/ 5);
          } catch (error) {
            logger.error(error as Error);
          }
        });
      }
    }),
  );
}

export function deactivate(): void {}
