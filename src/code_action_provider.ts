import vscode from 'vscode';

// This regular expression matches everything at the top of a C++ file (including header files),
// including:
//
// * an optional include guard;
// * any amount of whitespaces, newlines, single-line comments, and multi-line comments;
// * #include directives with angle brackets;
// * #include directives with double quotes.
//
// Our "include header" quick fix will append the header to the end of the matched prologue.
const PROLOGUE_PATTERN =
  /^(?:(?:(?:\/\*([^*]|\*[^/])*\*\/|\s)*(?:#\s*(?:ifndef\s+[A-Za-z_][A-Za-z0-9_]*|define\s+[A-Za-z_][A-Za-z0-9_]*|include\s*(?:"[^"]*"|<[^>]*>)))?(?:\/\*([^*]|\*[^/])*\*\/|\s)*(?:\/\/[^\n]*)?)\n)*/;

export class CodeActionProvider implements vscode.CodeActionProvider {
  public provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.CodeAction[]> {
    return context.diagnostics
      .filter(diagnostic => diagnostic.source === 'iwyu')
      .map(diagnostic => {
        switch (diagnostic.code) {
          case 'add':
            return CodeActionProvider.createQuickFixForAddition(document, diagnostic);
          case 'remove':
            return CodeActionProvider.createQuickFixForRemoval(document, diagnostic);
          default:
            return null;
        }
      })
      .filter(action => action !== null);
  }

  private static createQuickFixForAddition(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic,
  ): vscode.CodeAction {
    const match = diagnostic.message.match(
      / is defined in ("[^"]+"|<[^>]+>), which isn't directly #included.$/,
    );
    const [, header] = match!;
    const action = new vscode.CodeAction(
      `Include header ${header}`,
      vscode.CodeActionKind.QuickFix,
    );
    action.diagnostics = [diagnostic];
    action.edit = new vscode.WorkspaceEdit();
    const prologueMatch = document.getText().match(PROLOGUE_PATTERN);
    if (prologueMatch) {
      const [prologue] = prologueMatch;
      const position = document.positionAt(prologue.length);
      action.edit.insert(document.uri, position, `#include ${header}\n\n`);
    }
    return action;
  }

  private static createQuickFixForRemoval(
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
