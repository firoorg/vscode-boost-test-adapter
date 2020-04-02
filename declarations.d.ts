declare module 'dotparser' {
	export declare interface NodeId {
		type: 'node_id';
		id: string;
	}

	export declare interface Value {
		type: 'attr',
		id: string;
		eq: string;
	}

	export declare interface Attribute {
		type: 'attr_stmt';
		attr_list: Value[];
	}

	export declare interface Node {
		type: 'node_stmt';
		node_id: NodeId;
		attr_list: Value[];
	}

	export declare interface Graph {
		type: 'digraph' | 'graph' | 'subgraph';
		id?: string;
		children: Array<Attribute | Node | Graph>;
	}

	declare function parse(s: string): Graph[];

	export = parse;
}
