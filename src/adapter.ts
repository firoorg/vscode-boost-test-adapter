import { Mutex } from 'async-mutex';
import { resolve } from 'path';
import { Event, EventEmitter, FileSystemWatcher, RelativePattern, workspace, WorkspaceFolder } from 'vscode';
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
import { TestExecutable } from './test-executable';

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

		const release = await this.mutex.acquire();

		try {
			this.testsEmitter.fire({ type: 'started' });

			try {
				this.currentTests = await this.testExecutable.listTest();
			} catch (e) {
				this.log.error(e);
				this.currentTests = undefined;
			}

			this.testsEmitter.fire({ type: 'finished', suite: this.currentTests });
		} finally {
			release();
		}

		if (!this.watcher) {
			this.watcher = workspace.createFileSystemWatcher(
				new RelativePattern(this.workspaceFolder, this.testExecutable.path));

			try {
				this.watcher.onDidChange(() => this.load());
				this.watcher.onDidCreate(() => this.load());
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

	cancel() {
	}
}
