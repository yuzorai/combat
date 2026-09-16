export class DashGate {
	private currentNonce: string | undefined;
	private nextReadyAt = 0;

	public constructor(
		private readonly cooldown: number,
		private readonly nonceFactory: () => string,
	) {}

	public reset(now = 0): void {
		this.currentNonce = undefined;
		this.nextReadyAt = now;
	}

	public issue(now: number): string | undefined {
		if (this.currentNonce !== undefined || now < this.nextReadyAt) return undefined;
		this.currentNonce = this.nonceFactory();
		return this.currentNonce;
	}

	public consume(nonce: unknown, now: number): [boolean, string | undefined] {
		if (now < this.nextReadyAt) return [false, "DashCooldown"];
		if (this.currentNonce === undefined) return [false, "DashNotReady"];
		if (!typeIs(nonce, "string") || nonce !== this.currentNonce) return [false, "InvalidDashNonce"];

		this.currentNonce = undefined;
		this.nextReadyAt = now + this.cooldown;
		return [true, undefined];
	}

	public getNonce(): string | undefined {
		return this.currentNonce;
	}

	public getReadyAt(): number {
		return this.nextReadyAt;
	}
}
