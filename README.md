# Boost.Test Adapter for Visual Studio Code

This is a test adapter for [Test Explorer](https://marketplace.visualstudio.com/items?itemName=hbenl.vscode-test-explorer) to work with Boot.Test.

## Required configurations

You need to configure `boost-test-adapter.testExecutable` to point to the path of your test executable.

## Features that not implemented yet

- Debug the test.
- Cancel the test.
- Automatically reload test list.

## Development Setup

- Install the [Test Explorer](https://marketplace.visualstudio.com/items?itemName=hbenl.vscode-test-explorer) extension.
- Run `npm install`.
- Run `npm run build`.
- Start the debugger.

You should now see a second VS Code window, the Extension Development Host. Open a folder in this window and click the "Test" icon in the Activity bar.
