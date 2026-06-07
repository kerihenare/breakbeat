// A recorded note that a stage completed its purpose only partially. Any
// Warning turns a `done` Job into `done_with_warnings`.
export type Warning = {
	readonly message: string;
};
