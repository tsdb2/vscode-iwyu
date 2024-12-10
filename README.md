# `vscode-iwyu`

A VS Code extension by TSDB2 to run [IWYU](https://include-what-you-use.org/) on C++ files.

Currently under development and not yet published.

This extension requires that your build setup generate a
[JSON compilation database](https://clang.llvm.org/docs/JSONCompilationDatabase.html). If you use
Bazel you can try [`comp_db_hook`](https://github.com/tsdb2/comp_db_hook) to generate it and keep it
up-to-date at every build.
