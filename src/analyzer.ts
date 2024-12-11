import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';

import vscode from 'vscode';

import { Logger } from './logger';

function hash(text: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(text);
  return hash.digest('hex');
}

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

const TOKEN_PATTERNS = [
  /^[A-Za-z_][A-Za-z0-9_]*/, // identifier or keyword
  /^(0[Xx])?[0-9]+(?:\.[0-9]+)?/, // number
  /^'(?:[^'])*'/, // character literal
  /^"(?:[^"]|\\")*"/, // string literal
  /^[Rr]"[A-Za-z]*\(.*\)[A-Za-z]*"/, // raw string literal
];

type DiagnosticsByUri = { [uri: string]: vscode.Diagnostic[] };

export class Analyzer {
  private static readonly _analyzers: { [filePath: string]: Analyzer } = Object.create(null);

  private static _diagnostics: vscode.DiagnosticCollection | null = null;

  private readonly _root: vscode.WorkspaceFolder;
  private readonly _document: vscode.TextDocument;

  // Hash of the last revision we analyzed, which we keep here to avoid duplicated work.
  private _lastHash: string = '';

  // Timeout used to debounce our runs if the user re-saves too quickly.
  private _timeout: NodeJS.Timeout | null = null;

  public static initialize(): typeof Analyzer {
    if (!Analyzer._diagnostics) {
      Analyzer._diagnostics = vscode.languages.createDiagnosticCollection('iwyu');
    }
    return Analyzer;
  }

  public static dispose(): void {
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

  private _getTokenRange(position: vscode.Position): vscode.Range {
    const offset = this._document.offsetAt(position);
    const text = this._document.getText().substring(offset);
    for (const pattern of TOKEN_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        const [token] = match;
        return new vscode.Range(
          position,
          position.with({ character: position.character + token.length }),
        );
      }
    }
    return new vscode.Range(position, position);
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
      this._getTokenRange(new vscode.Position(lineNumber, charNumber)),
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

  public async run(force: boolean = false): Promise<void> {
    const logger = Logger.get();
    const sourceFilePath = vscode.workspace.asRelativePath(
      this._document.uri,
      /*includeWorkspaceFolder=*/ false,
    );
    const revision = hash(this._document.getText());
    if (!force && revision === this._lastHash) {
      logger.appendLine(
        `Skipping IWYU analysis for ${sourceFilePath} which hasn't changed since last findings.`,
      );
      return;
    }
    this._lastHash = revision;
    const commandFilePath = path.join(this._root.uri.fsPath, 'compile_commands.json');
    const command = `iwyu_tool -p '${commandFilePath}' '${sourceFilePath}' -- -Xiwyu --no_fwd_decls -Xiwyu --verbose=3 -Xiwyu --cxx17ns`;
    await logger.spinner(async () => {
      const stdout = await exec(command, { cwd: this._root.uri.fsPath });
      logger.append(`IWYU run for ${sourceFilePath}:\n$ ${command}\n${stdout}`);
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
    });
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
