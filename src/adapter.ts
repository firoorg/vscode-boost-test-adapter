import { Mutex } from 'async-mutex';
import { access, constants } from 'fs';
import { resolve } from 'path';
import * as vscode from "vscode";
import { Event, EventEmitter, FileSystemWatcher, RelativePattern, workspace, WorkspaceFolder, Uri } from 'vscode';
import {
	TestAdapter,
	TestEvent,
	TestLoadFinishedEvent,
	TestLoadStartedEvent,
	TestRunFinishedEvent,
	TestRunStartedEvent,
	TestSuiteEvent,
	TestSuiteInfo
} from 'vscode-test-adapter-api';
import { Log } from 'vscode-test-adapter-util';
import { BinaryError, TestExecutable } from './test-executable';

export class BoostTestAdapter implements TestAdapter {
	private readonly mutex: Mutex;
	private readonly disposables: { dispose(): void }[];
	private readonly testsEmitter: EventEmitter<TestLoadStartedEvent | TestLoadFinishedEvent>;
	private readonly testStatesEmitter: EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>;
	private readonly testExecutable?: TestExecutable;
	private watcher?: FileSystemWatcher;
	private currentTests?: TestSuiteInfo;

	constructor(readonly workspaceFolder: WorkspaceFolder, private readonly log: Log) {
		const settings = workspace.getConfiguration('boost-test-adapter');
		const executable = settings.get<string>('testExecutable');
		const sourcePrefix = settings.get<string>('sourcePrefix');

		this.log.info(`executable = '${executable}', sourcePrefix = '${sourcePrefix}'`)
		this.mutex = new Mutex();
		this.disposables = [];
		this.testsEmitter = new EventEmitter<TestLoadStartedEvent | TestLoadFinishedEvent>();
		this.testStatesEmitter = new EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>();
		this.testExecutable = executable
			? new TestExecutable(
				this.workspaceFolder,
				executable,
				sourcePrefix ? resolve(this.workspaceFolder.uri.fsPath, sourcePrefix) : undefined)
			: undefined;

		this.disposables.push(this.testsEmitter);
		this.disposables.push(this.testStatesEmitter);
	}

	get tests(): Event<TestLoadStartedEvent | TestLoadFinishedEvent> {
		return this.testsEmitter.event;
	}

	get testStates(): Event<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent> {
		return this.testStatesEmitter.event;
	}

	dispose() {
		this.cancel();

		for (const disposable of this.disposables) {
			disposable.dispose();
		}

		this.disposables.length = 0;
	}

	async load(): Promise<void> {
		if (!this.testExecutable) {
			this.log.info('No test executable is provided in the configuration');
			return;
		}

		// load test cases
		const release = await this.mutex.acquire();

		try {
			this.testsEmitter.fire({ type: 'started' });

			try {
				this.currentTests = await this.testExecutable.listTest();
			} catch (e) {
				if (!(e instanceof BinaryError && e.cause.code === 'ENOENT')) {
					this.log.error(e);
				}

				this.currentTests = undefined;
			}

			this.testsEmitter.fire({ type: 'finished', suite: this.currentTests });
		} finally {
			release();
		}

		// start watching test binary
		if (!this.watcher) {
			this.watcher = workspace.createFileSystemWatcher(
				new RelativePattern(this.workspaceFolder, this.testExecutable.path));

			try {
				const load = (e: Uri) => {
					return new Promise<void>((resolve, reject) => access(e.fsPath, constants.X_OK, async (e: any) => {
						if (!e) {
							try {
								await this.load();
							} catch (e) {
								reject(e);
								return;
							}
						}
						resolve();
					}));
				};

				this.watcher.onDidChange(load);
				this.watcher.onDidCreate(load);
				this.watcher.onDidDelete(() => this.load());

				this.disposables.push(this.watcher);
			} catch (e) {
				this.log.error(e);
				this.watcher.dispose();
			}
		}
	}

	async run(tests: string[]): Promise<void> {
		const all = tests.length === 1 && tests[0] === this.currentTests!.id;

		const release = await this.mutex.acquire();

		try {
			this.testStatesEmitter.fire({ type: 'started', tests });

			try {
				await this.testExecutable!.runTests(all ? undefined : tests, e => {
					this.testStatesEmitter.fire(e);
				});
			} catch (e) {
				this.log.error(e);
			}

			this.testStatesEmitter.fire({ type: 'finished' });
		} finally {
			release();
		}
	}

	async debug?(tests: string[]): Promise<void> {
		let args:String[] = [];
		const ids = tests.join(',');
		if (ids) {
			args = [`--run_test=${ids}`];
		}
		const path = resolve(this.workspaceFolder.uri.fsPath, this.testExecutable!.path);
		const debugConfiguration: vscode.DebugConfiguration = {
			name: "(lldb) Launch test cmake",
			type: "cppdbg",
			request: "launch",
			cwd: this.testExecutable?.workspaceFolder.uri.fsPath,
			program: path,
			MIMode: "lldb",
			args:args
		};
		this.log.info(`${JSON.stringify(debugConfiguration)} workspaceFolder=${this.testExecutable?.workspaceFolder.uri.fsPath}`)
		await vscode.debug.startDebugging( undefined, debugConfiguration);
	}

	cancel() {
	}
}
