export abstract class PageChecker {
	public abstract hasPage(pathname: string): Promise<boolean>;
}
