import vscode from 'vscode';

export class CodeActionProvider implements vscode.CodeActionProvider {
  public provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.CodeAction[]> {
    return context.diagnostics
      .filter(diagnostic => diagnostic.source === 'iwyu' && diagnostic.code === 'remove')
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
