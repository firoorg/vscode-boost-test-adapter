import { spawn } from 'child_process';
import { createInterface, ReadLine } from 'readline';
import { TestEvent, TestSuiteEvent, TestSuiteInfo } from 'vscode-test-adapter-api';

interface TestSession {
	readonly stdout: ReadLine;
	readonly stderr: ReadLine;
	readonly stopped: Promise<number>;
}

export class TestExecutable {
	constructor(private readonly path: string) {
	}

	async listTest(): Promise<TestSuiteInfo | undefined> {
		const session = this.run(['--list_content']);
		const tests = <TestSuiteInfo>{
			type: 'suite',
			id: this.path,
			label: this.path,
			children: []
		};

		// extract all suites and cases from the output
		let suite: TestSuiteInfo | undefined;

		session.stderr.on('line', line => {
			const match = /^(\w+)\*?$/.exec(line);

			if (match) {
				suite = {
					type: 'suite',
					id: match[1],
					label: match[1],
					children: []
				};

				tests.children.push(suite);
			} else if (suite) {
				const match = /^\s+(\w+)\*?$/.exec(line);

				if (match) {
					suite.children.push({
						type: 'test',
						id: `${suite.id}/${match[1]}`,
						label: match[1]
					});
				}
			}
		});

		// wait for process to exit
		const code = await session.stopped;

		if (code !== 0) {
			throw new Error(`${this.path} is exited with code ${code}`);
		}

		return tests;
	}

	async runTests(ids: string[] | undefined, progress: (e: TestSuiteEvent | TestEvent) => void): Promise<boolean> {
		let session: TestSession;
		let suite: string | undefined;
		let error: string | undefined;

		if (ids && !ids.length) {
			return true;
		}

		// spawn the test process
		if (ids) {
			const suites = ids.filter(id => !id.includes('/'));
			const cases = ids.filter(id => !suites.some(s => id === s || id.startsWith(`${s}/`)));
			const tests = suites.concat(cases);

			session = this.run(['-l', 'test_suite', '-t', tests.join(':')]);
		} else {
			session = this.run(['-l', 'test_suite']);
		}

		session.stdout.on('line', line => {
			let match: RegExpMatchArray | null;

			// case start
			match = /^(.+): Entering test case "(\w+)"$/.exec(line);

			if (match) {
				progress({
					type: 'test',
					test: `${suite}/${match[2]}`,
					state: 'running'
				});
				return;
			}

			// case end
			match = /^(.+): Leaving test case "(\w+)"; testing time: (\d+)(\w+)$/.exec(line);

			if (match) {
				progress({
					type: 'test',
					test: `${suite}/${match[2]}`,
					state: error === undefined ? 'passed' : 'failed',
					message: error
				});
				error = undefined;
				return;
			}

			// case error
			match = /^(.+): error: in "([\w\/]+)": (.+)$/.exec(line);

			if (match) {
				error = match[3];
				return;
			}

			// suite start
			match = /^(.+): Entering test suite "(\w+)"$/.exec(line);

			if (match) {
				suite = match[2];

				progress({
					type: 'suite',
					suite: suite,
					state: 'running'
				});
				return;
			}

			// suite end
			match = /^(.+): Leaving test suite "(\w+)"; testing time: (\d+)(\w+)$/.exec(line);

			if (match) {
				suite = undefined;

				progress({
					type: 'suite',
					suite: match[2],
					state: 'completed'
				});
				return;
			}
		});

		// wait for process to exit
		const code = await session.stopped;

		return code === 0;
	}

	private run(args: string[]): TestSession {
		const process = spawn(this.path, ['-x', 'no'].concat(args), { stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout, stderr: ReadLine | undefined;

		try {
			const stopped = new Promise<number>((resolve, reject) => {
				process.on('error', reject);
				process.on('close', resolve);
			});

			stdout = createInterface({ input: process.stdout! });
			stderr = createInterface({ input: process.stderr! });

			return { stdout, stderr, stopped };
		} catch (e) {
			stdout?.close();
			stderr?.close();
			process.kill();
			throw e;
		}
	}
}
