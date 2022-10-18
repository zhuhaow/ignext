export abstract class Logger {
	constructor(public quite: boolean) {}

	public abstract logError(error: Error): void;
}

export class ConsoleLogger extends Logger {
	public logError(error: Error) {
		if (this.quite) return;
		console.error(error);
	}
}
