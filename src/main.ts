import { extensions, ExtensionContext, workspace } from 'vscode';
import { testExplorerExtensionId, TestHub } from 'vscode-test-adapter-api';
import { Log, TestAdapterRegistrar } from 'vscode-test-adapter-util';
import { BoostTestAdapter } from './adapter';

export async function activate(context: ExtensionContext) {
	// init adaptor logging
	const ws = (workspace.workspaceFolders || [])[0];
	const log = new Log('boost-test-adapter', ws, 'Boost.Test Explorer');

	context.subscriptions.push(log);

	// get the Test Explorer extension
	const testExplorer = extensions.getExtension<TestHub>(testExplorerExtensionId);

	if (testExplorer) {
		const testHub = testExplorer.exports;
		const registrar = new TestAdapterRegistrar(
			testHub,
			workspace => new BoostTestAdapter(workspace, log),
			log);

		context.subscriptions.push(registrar);
	}
}
