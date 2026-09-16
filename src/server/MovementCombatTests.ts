import { MovementCombatConfig } from "shared/MovementCombatConfig";
import { DashGate } from "server/MovementCombatDashGate";

interface TestResponse {
	accepted: boolean;
	reason?: string;
}

export interface MovementCombatTestResult {
	passed: boolean;
	dashExecutions: number;
	rejectedSpam: number;
	issuedNonces: number;
	comboWindow: number;
	thirdImpactGap: number;
}

function expect(condition: boolean, message: string): void {
	assert(condition, "MovementCombatTests failed: " + message);
}

/** In-memory server-contract stress harness. Invoke with require(MovementCombatTests).Run(). */
export function Run(): MovementCombatTestResult {
	let now = 0;
	let issued = 0;
	const gate = new DashGate(MovementCombatConfig.DashCooldown, () => {
		issued += 1;
		return "nonce-" + issued;
	});

	const responses = new Map<number, TestResponse>();
	let highestRequestId = 0;
	let dashExecutions = 0;

	const request = (requestId: number, nonce: unknown, at: number): [TestResponse, boolean] => {
		now = at;
		const cached = responses.get(requestId);
		if (cached !== undefined) return [cached, true];
		if (requestId <= highestRequestId) {
			const stale: TestResponse = { accepted: false, reason: "StaleRequest" };
			responses.set(requestId, stale);
			return [stale, false];
		}

		highestRequestId = requestId;
		const [accepted, reason] = gate.consume(nonce, now);
		const result: TestResponse = { accepted, reason };
		responses.set(requestId, result);
		if (accepted) dashExecutions += 1;
		return [result, false];
	};

	const firstNonce = gate.issue(now);
	expect(firstNonce === "nonce-1", "first nonce was not issued");

	const [first, replay] = request(1, firstNonce, now);
	expect(first.accepted && !replay, "first request was not accepted");

	for (let index = 0; index < MovementCombatConfig.Debug.StressRequestCount; index++) {
		const [duplicate, duplicateReplay] = request(1, firstNonce, now);
		expect(duplicate.accepted && duplicateReplay, "duplicate request did not return the cached acceptance");
	}
	expect(dashExecutions === 1, "duplicate request IDs started more than one dash");

	let rejected = 0;
	for (let requestId = 2; requestId <= MovementCombatConfig.Debug.StressRequestCount + 1; requestId++) {
		const [result] = request(requestId, firstNonce, now);
		if (!result.accepted) rejected += 1;
	}
	expect(rejected === MovementCombatConfig.Debug.StressRequestCount, "unique spam requests were not all rejected");
	expect(dashExecutions === 1, "unique spam requests started more than one dash");

	now = MovementCombatConfig.DashCooldown;
	const secondNonce = gate.issue(now);
	expect(secondNonce === "nonce-2", "cooldown did not issue a fresh nonce");

	const delayedId = MovementCombatConfig.Debug.StressRequestCount + 2;
	const freshId = delayedId + 1;
	const [delayed] = request(delayedId, firstNonce, now + 0.25);
	expect(!delayed.accepted && delayed.reason === "InvalidDashNonce", "old delayed request was accepted");

	const [second] = request(freshId, secondNonce, now + 0.25);
	expect(second.accepted, "fresh post-cooldown request was rejected");
	expect(dashExecutions === 2, "fresh request did not start exactly one new dash");

	responses.delete(50);
	const [stale] = request(50, secondNonce, now + 0.25);
	expect(!stale.accepted && stale.reason === "StaleRequest", "out-of-order request was not rejected");

	let comboStep = 0;
	let lastHitAt = 0;
	const chooseComboStep = (actionStartedAt: number): number => {
		const nextStep = (comboStep % 3) + 1;
		const timing = MovementCombatConfig.PunchTimings[nextStep];
		const continues = lastHitAt > 0 && actionStartedAt + timing.Impact - lastHitAt <= MovementCombatConfig.ComboWindow;
		return continues ? nextStep : 1;
	};

	const firstStep = chooseComboStep(0);
	expect(firstStep === 1, "first combo hit was not step 1");
	const firstImpact = MovementCombatConfig.PunchTimings[1].Impact;
	comboStep = 1;
	lastHitAt = firstImpact;

	const secondStartedAt = MovementCombatConfig.PunchTimings[1].Duration;
	const secondStep = chooseComboStep(secondStartedAt);
	expect(secondStep === 2, "second landed combo hit did not continue");
	const secondImpact = secondStartedAt + MovementCombatConfig.PunchTimings[2].Impact;
	comboStep = 2;
	lastHitAt = secondImpact;

	const thirdStartedAt = secondStartedAt + MovementCombatConfig.PunchTimings[2].Duration;
	const thirdStep = chooseComboStep(thirdStartedAt);
	expect(thirdStep === 3, "third landed combo hit did not continue");
	const thirdImpact = thirdStartedAt + MovementCombatConfig.PunchTimings[3].Impact;
	expect(
		thirdImpact - secondImpact <= MovementCombatConfig.ComboWindow,
		"third impact falls outside the one-second combo window",
	);
	comboStep = 3;
	lastHitAt = thirdImpact;

	const resetStep = chooseComboStep(thirdImpact + 1.001);
	expect(resetStep === 1, "combo did not reset after one second without a landed follow-up");

	return {
		passed: true,
		dashExecutions,
		rejectedSpam: rejected,
		issuedNonces: issued,
		comboWindow: MovementCombatConfig.ComboWindow,
		thirdImpactGap: thirdImpact - secondImpact,
	};
}
