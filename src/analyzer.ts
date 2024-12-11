import childProcess from 'node:child_process';
import path from 'node:path';

import vscode from 'vscode';

function exec(command: string, options: object): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    childProcess.exec(command, options, (error, stdout, stderr) => {
      if (error) {
        reject(Error(`${error}.\n\n${stdout}\n\n${stderr}\n`));
      } else {
        resolve(stdout);
      }
    });
  });
}

type DiagnosticsByUri = { [uri: string]: vscode.Diagnostic[] };

export class Analyzer {
  private static readonly _analyzers: { [filePath: string]: Analyzer } = Object.create(null);

  private static _diagnostics: vscode.DiagnosticCollection | null = null;

  private readonly _root: vscode.WorkspaceFolder;
  private readonly _document: vscode.TextDocument;

  // Timeout used to debounce our runs if the user re-saves too quickly.
  private _timeout: NodeJS.Timeout | null = null;

  public static initialize(): void {
    if (!Analyzer._diagnostics) {
      Analyzer._diagnostics = vscode.languages.createDiagnosticCollection('iwyu');
    }
  }

  public static finalize(): void {
    Analyzer._diagnostics?.dispose();
    Analyzer._diagnostics = null;
  }

  private static _getDiagnostics(): vscode.DiagnosticCollection {
    Analyzer.initialize();
    return Analyzer._diagnostics!;
  }

  public static getFor(document: vscode.TextDocument): Analyzer {
    const filePath = document.fileName;
    if (!Analyzer._analyzers[filePath]) {
      Analyzer._analyzers[filePath] = new Analyzer(document);
    }
    return Analyzer._analyzers[filePath];
  }

  private constructor(document: vscode.TextDocument) {
    const root = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!root) {
      throw Error(`'${document.fileName}' doesn't seem to be located in an open workspace.`);
    }
    this._root = root;
    this._document = document;
  }

  private _processAddFinding(diagnostics: DiagnosticsByUri, line: string): boolean {
    const match = line.match(
      /^([^:]+):(\d+):(\d+): warning: ([^\s]+) is defined in ("[^"]+"|<[^>]+>), which isn't directly #included.$/,
    );
    if (!match) {
      return false;
    }
    const [, path, row, column, symbol, include] = match;
    const lineNumber = parseInt(row, 10) - 1;
    const charNumber = parseInt(column, 10) - 1;
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(lineNumber, charNumber, lineNumber, charNumber + 1),
      `${symbol} is defined in ${include}, which isn't directly #included.`,
      vscode.DiagnosticSeverity.Warning,
    );
    diagnostic.source = 'iwyu';
    diagnostic.code = 'add';
    const uri = vscode.Uri.joinPath(this._root.uri, path).toString();
    if (diagnostics[uri]) {
      diagnostics[uri].push(diagnostic);
    } else {
      diagnostics[uri] = [diagnostic];
    }
    return true;
  }

  private _processRemoveFinding(
    diagnostics: vscode.Diagnostic[],
    uri: string,
    line: string,
  ): boolean {
    const match = line.match(/^- (#include\s*("[^"]+"|<[^>]+>))\s*\/\/ lines (\d+)-(\d+)/);
    if (!match) {
      return false;
    }
    const [, include, includePath, row] = match;
    const lineNumber = parseInt(row, 10) - 1;
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(lineNumber, 0, lineNumber, include.length),
      `Unused #include ${includePath}.`,
      vscode.DiagnosticSeverity.Warning,
    );
    diagnostic.source = 'iwyu';
    diagnostic.code = 'remove';
    diagnostics.push(diagnostic);
    return true;
  }

  public async run(): Promise<void> {
    const commandFilePath = path.join(this._root.uri.fsPath, 'compile_commands.json');
    const sourceFilePath = vscode.workspace.asRelativePath(
      this._document.uri,
      /*includeWorkspaceFolder=*/ false,
    );
    const command = `iwyu_tool -p '${commandFilePath}' '${sourceFilePath}' -- -Xiwyu --no_fwd_decls -Xiwyu --verbose=3 -Xiwyu --cxx17ns`;
    const stdout = await exec(command, { cwd: this._root.uri.fsPath });
    // console.info(`IWYU run:\n$ ${command}\n${stdout}`);
    const diagnostics: DiagnosticsByUri = Object.create(null);
    const lines = stdout.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!this._processAddFinding(diagnostics, line)) {
        const match = line.match(/^(.*) should remove these lines:$/);
        if (!match) {
          continue;
        }
        const [, path] = match;
        const uri = vscode.Uri.joinPath(this._root.uri, path).toString();
        if (!diagnostics[uri]) {
          diagnostics[uri] = [];
        }
        for (i++; i < lines.length && lines[i] !== ''; i++) {
          this._processRemoveFinding(diagnostics[uri], uri, lines[i]);
        }
      }
    }
    for (const uri in diagnostics) {
      Analyzer._getDiagnostics().set(vscode.Uri.parse(uri), diagnostics[uri]);
    }
  }

  private _debounce(seconds: number): Promise<void> {
    if (this._timeout !== null) {
      clearTimeout(this._timeout);
    }
    return new Promise<void>(resolve => {
      this._timeout = setTimeout(() => {
        resolve();
      }, seconds * 1000);
    });
  }

  public async runIn(seconds: number): Promise<void> {
    await this._debounce(seconds);
    await this.run();
  }
}
