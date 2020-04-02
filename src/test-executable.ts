import { spawn } from 'child_process';
import parseDot = require('dotparser');
import { Graph, Node } from 'dotparser';
import { createInterface, ReadLine } from 'readline';
import { TestEvent, TestInfo, TestSuiteEvent, TestSuiteInfo } from 'vscode-test-adapter-api';

interface TestSession {
	readonly stdout: ReadLine;
	readonly stderr: ReadLine;
	readonly stopped: Promise<number>;
}

function parseLabel(node: Node): { name: string; file: string; line: number } {
	const label = node.attr_list.find(a => a.id === 'label');

	if (!label) {
		throw new Error('Node does not have a label attribute');
	}

	const match = /^(\w+)\|(.+)\((\d+)\)$/.exec(label.eq);

	if (!match) {
		throw new Error(`Failed to extract label ${label.eq}`);
	}

	return {
		name: match[1],
		file: match[2],
		line: parseInt(match[3])
	};
}

function parseSuite(node: Node): TestSuiteInfo {
	const info = parseLabel(node);

	return {
		type: 'suite',
		id: info.name,
		label: info.name,
		children: []
	};
}

function parseCases(suite: TestSuiteInfo, graph: Graph): TestInfo[] {
	const tests = new Array<TestInfo>();

	for (const child of graph.children) {
		if (child.type === 'node_stmt') {
			const info = parseLabel(child);

			tests.push({
				type: 'test',
				id: `${suite.id}/${info.name}`,
				label: info.name
			})
		}
	}

	return tests;
}

export class TestExecutable {
	constructor(private readonly path: string) {
	}

	async listTest(): Promise<TestSuiteInfo | undefined> {
		// gather all output
		const session = this.run(['--list_content=DOT']);
		let output = '';

		session.stderr.on('line', line => output += line);

		const code = await session.stopped;

		if (code !== 0) {
			throw new Error(`${this.path} is exited with code ${code}`);
		}

		// parse the output
		const parsed = parseDot(output);

		if (!parsed.length) {
			throw new Error(`Failed to parse list of test cases from ${this.path}`);
		}

		// extract module information
		const root = parsed[0];
		const module = root.children.find(c => c.type === 'node_stmt');

		if (module?.type !== 'node_stmt') {
			throw new Error("Cannot find test's module definition");
		}

		const moduleName = module.attr_list.find(a => a.id === 'label');

		if (!moduleName) {
			throw new Error('Cannot find the name of test module');
		}

		const tests = <TestSuiteInfo>{
			type: 'suite',
			id: this.path,
			label: moduleName.eq,
			file: this.path,
			children: []
		};

		// extract all suites and cases from the graph
		const suites = root.children.find(c => c.type === 'subgraph');

		if (suites?.type !== 'subgraph') {
			throw new Error('Cannot find a list of test suite');
		}

		for (const suite of suites.children) {
			switch (suite.type) {
				case 'node_stmt':
					tests.children.push(parseSuite(suite));
					break;
				case 'subgraph':
					const current = <TestSuiteInfo>tests.children[tests.children.length - 1];
					current.children = parseCases(current, suite);
					break;
			}
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
