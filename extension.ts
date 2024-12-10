import * as vscode from 'vscode';
import child from 'node:child_process';
import path from 'node:path';

const supportedLanguages = ['cpp', 'c'];

function exec(command: string, options: object): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    child.exec(command, options, (error, stdout, stderr) => {
      if (error) {
        reject(Error(`${error}.\n\n${stdout}\n\n${stderr}\n`));
      } else {
        resolve(stdout);
      }
    });
  });
}

class CodeActionProvider implements vscode.CodeActionProvider {
  public provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.CodeAction[]> {
    return context.diagnostics
      .filter(diagnostic => diagnostic.source === 'IWYU' && diagnostic.code === 'remove')
      .map(diagnostic => CodeActionProvider.createQuickFix(document, diagnostic));
  }

  private static createQuickFix(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic,
  ): vscode.CodeAction {
    const match = diagnostic.message.match(/^Unused #include (.+)\.$/);
    const action = new vscode.CodeAction(
      match ? `Remove header ${match[1]}` : 'Remove header',
      vscode.CodeActionKind.QuickFix,
    );
    action.diagnostics = [diagnostic];
    action.edit = new vscode.WorkspaceEdit();
    const start = diagnostic.range.start;
    const range = new vscode.Range(start.line, start.character, start.line + 1, 0);
    action.edit.delete(document.uri, range);
    return action;
  }
}

function processAddFinding(
  diagnostics: vscode.Diagnostic[],
  line: string,
  sourceFilePath: string,
): boolean {
  const match = line.match(
    /^([^:]+):(\d+):(\d+): warning: ([^\s]+) is defined in ("[^"]+"|<[^>]+>), which isn't directly #included.$/,
  );
  if (!match || match[1] !== sourceFilePath) {
    return false;
  }
  const [, path, row, column, symbol, include] = match;
  if (path !== sourceFilePath) {
    return false;
  }
  const lineNumber = parseInt(row, 10) - 1;
  const charNumber = parseInt(column, 10) - 1;
  const diagnostic = new vscode.Diagnostic(
    new vscode.Range(lineNumber, charNumber, lineNumber, charNumber + 1),
    `${symbol} is defined in ${include}, which isn't directly #included.`,
    vscode.DiagnosticSeverity.Warning,
  );
  diagnostic.source = 'IWYU';
  diagnostic.code = 'add';
  diagnostics.push(diagnostic);
  return true;
}

function isRemoveFinding(line: string, sourceFilePath: string): boolean {
  const match = line.match(/^(.*) should remove these lines:$/);
  return match !== null && match[1] === sourceFilePath;
}

function processRemoveFinding(diagnostics: vscode.Diagnostic[], line: string): void {
  const match = line.match(/^- (#include\s*("[^"]+"|<[^>]+>))\s*\/\/ lines (\d+)-(\d+)/);
  if (match) {
    const [, include, includePath, row] = match;
    const lineNumber = parseInt(row, 10) - 1;
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(lineNumber, 0, lineNumber, include.length),
      `Unused #include ${includePath}.`,
      vscode.DiagnosticSeverity.Warning,
    );
    diagnostic.source = 'IWYU';
    diagnostic.code = 'remove';
    diagnostics.push(diagnostic);
  }
}

function processOutput(
  document: vscode.TextDocument,
  sourceFilePath: string,
  output: string,
): void {
  const diagnostics: vscode.Diagnostic[] = [];
  const lines = output.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!processAddFinding(diagnostics, lines[i], sourceFilePath)) {
      if (isRemoveFinding(lines[i], sourceFilePath)) {
        for (i++; i < lines.length && lines[i] !== ''; i++) {
          processRemoveFinding(diagnostics, lines[i]);
        }
      }
    }
  }
  const diagnosticCollection = vscode.languages.createDiagnosticCollection('IWYU');
  diagnosticCollection.set(document.uri, diagnostics);
}

async function runIWYU(document: vscode.TextDocument): Promise<void> {
  const activeFileUri = vscode.window.activeTextEditor?.document.uri;
  if (!activeFileUri) {
    throw Error('No file is currently open to analyze.');
  }
  const workspaceRoot = vscode.workspace.getWorkspaceFolder(activeFileUri)?.uri.fsPath;
  if (!workspaceRoot) {
    throw Error(`'${activeFileUri.fsPath}' doesn't seem to be located in an open workspace.`);
  }
  const commandFilePath = path.join(workspaceRoot, 'compile_commands.json');
  const sourceFilePath = vscode.workspace.asRelativePath(
    activeFileUri,
    /*includeWorkspaceFolder=*/ false,
  );
  const command = `iwyu_tool -p '${commandFilePath}' '${sourceFilePath}' -- -Xiwyu --no_fwd_decls -Xiwyu --verbose=3 -Xiwyu --cxx17ns`;
  try {
    const stdout = await exec(command, { cwd: workspaceRoot });
    // console.info(`IWYU run:\n$ ${command}\n${stdout}`);
    processOutput(document, sourceFilePath, stdout);
  } catch (error) {
    vscode.window.showErrorMessage(`IWYU error: ${error}`);
  }
}

let timeout: NodeJS.Timeout | null = null;

function scheduleIWYU(document: vscode.TextDocument, inSeconds: number): void {
  if (timeout !== null) {
    clearTimeout(timeout);
  }
  timeout = setTimeout(() => {
    timeout = null;
    runIWYU(document);
  }, inSeconds * 1000);
}

export function activate(context: vscode.ExtensionContext): void {
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
        runIWYU(editor.document);
      } else {
        vscode.window.showErrorMessage('No file is currently open to analyze.');
      }
    }),
  );
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(document => {
      if (supportedLanguages.includes(document.languageId)) {
        runIWYU(document);
      }
    }),
  );
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(document => {
      if (supportedLanguages.includes(document.languageId)) {
        scheduleIWYU(document, 5);
      }
    }),
  );
}

export function deactivate(): void {}
