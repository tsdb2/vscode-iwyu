import * as vscode from 'vscode';
import child from 'node:child_process';
import path from 'node:path';

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

function processOutput(document: vscode.TextDocument, output: string): void {
  const diagnostics: vscode.Diagnostic[] = [];
  const lines = output.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = /^(.*) should remove these lines:$/.exec(lines[i]);
    if (!match) {
      continue;
    }
    if (match[1] !== document.fileName) { continue; }
    for (i++; i < lines.length && lines[i]; i++) {
      const match = lines[i].match(/^- #include\s*(?:"[^"]+"|<[^>]+>)\s*\/\/ lines (\d+)-(\d+)/);
      if (match) {
        const [, startLine, endLine] = match;
        diagnostics.push({
          range: new vscode.Range(parseInt(startLine, 10) - 1, 0, parseInt(endLine, 10), 0),
          message: 'Unused #include.',
          severity: vscode.DiagnosticSeverity.Hint,
          source: 'IWYU',
        });
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
  const sourceFilePath = path.relative(workspaceRoot, activeFileUri.fsPath);
  const command = `iwyu_tool -p '${commandFilePath}' '${sourceFilePath}' -- -Xiwyu --no_fwd_decls`;
  try {
    const stdout = await exec(command, { cwd: workspaceRoot });
    console.info(`IWYU run:\n$ ${command}\n${stdout}`);
    processOutput(document, stdout);
  } catch (error) {
    vscode.window.showErrorMessage(`IWYU error: ${error}`);
  }
}

let timeout: NodeJS.Timeout | null = null;

function scheduleIWYU(document: vscode.TextDocument): void {
  if (timeout !== null) {
    clearTimeout(timeout);
  }
  timeout = setTimeout(() => {
    timeout = null;
    runIWYU(document);
  }, 10000);
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand('iwyu.analyzeFile', () => {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      runIWYU(editor.document);
    } else {
      vscode.window.showErrorMessage('No file is currently open to analyze.');
    }
  }));
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => {
    if (document.languageId === 'cpp') {
      scheduleIWYU(document);
    }
  }));
}

export function deactivate(): void { }
