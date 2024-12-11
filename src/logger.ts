import vscode from 'vscode';

export class Logger {
  private static _instance: Logger | null = null;

  public static get(): Logger {
    if (!Logger._instance) {
      Logger._instance = new Logger();
    }
    return Logger._instance;
  }

  private readonly _output: vscode.OutputChannel;
  private readonly _status: vscode.StatusBarItem;

  private _spinCount: number = 0;

  private constructor() {
    this._output = vscode.window.createOutputChannel('IWYU', { log: true });
    this._status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
    this._status.text = '$(tools) IWYU';
    this._status.tooltip = 'Run IWYU analysis on the current file';
    this._status.command = 'iwyu.analyzeFile';
    this._status.show();
  }

  public async spinner(fn: () => Promise<void>): Promise<void> {
    this._spinCount++;
    this._status.text = '$(loading~spin) IWYU';
    try {
      await fn();
    } finally {
      if (!--this._spinCount) {
        this._status.text = '$(tools) IWYU';
      }
    }
  }

  public show(): void {
    this._output.show();
  }

  public append(lines: string): void {
    this._output.append(lines);
  }

  public appendLine(line: string): void {
    this._output.appendLine(line);
  }

  public showAndAppendLine(line: string): void {
    this._output.show();
    this._output.appendLine(line);
  }

  public error(error: Error): void {
    this._output.append(`ERROR: ${error.message}\n\n${error.stack}\n`);
  }
}
