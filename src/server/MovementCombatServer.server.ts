import {
	CombatActionState,
	DashDirection,
	MovementCombatConfig,
	MovementMode,
	PunchTiming,
} from "shared/MovementCombatConfig";
import { DashGate } from "server/MovementCombatDashGate";

const Players = game.GetService("Players");
const ReplicatedStorage = game.GetService("ReplicatedStorage");
const RunService = game.GetService("RunService");
const ServerStorage = game.GetService("ServerStorage");
const Workspace = game.GetService("Workspace");
const HttpService = game.GetService("HttpService");

const movementCombat = ReplicatedStorage.WaitForChild("MovementCombat") as Folder;
const remotes = movementCombat.WaitForChild("Remotes") as Folder;
const actionRequest = remotes.WaitForChild("ActionRequest") as RemoteEvent;
const actionAck = remotes.WaitForChild("ActionAck") as RemoteEvent;
const actionBroadcast = remotes.WaitForChild("ActionBroadcast") as RemoteEvent;

interface ActionResponse {
	requestId: number;
	action: string;
	accepted: boolean;
	reason?: string;
	[key: string]: unknown;
}

interface ClientRequest {
	requestId?: unknown;
	action?: unknown;
	direction?: unknown;
	cameraForward?: unknown;
	dashNonce?: unknown;
}

interface CombatState {
	character: Model | undefined;
	humanoid: Humanoid | undefined;
	root: BasePart | undefined;
	movementMode: MovementMode;
	actionState: CombatActionState;
	dashGate: DashGate;
	dashToken: number;
	punchToken: number;
	dashCancel: ((reasonName: string) => void) | undefined;
	punchCancel: ((reasonName: string) => void) | undefined;
	dashCooldownEndsAt: number;
	comboStep: number;
	lastHitAt: number;
	lastDamage: number;
	highestRequestId: number;
	responseCache: Map<number, ActionResponse>;
	responseOrder: number[];
	dashAccepted: number;
	dashRejected: number;
	dashCompleted: number;
	punchAccepted: number;
	punchRejected: number;
	lastRequestReason: string;
}

interface TargetCandidate {
	humanoid: Humanoid;
	model: Model;
	position: Vector3;
	distance: number;
}

const states = new Map<Player, CombatState>();
const boundPlayers = new Set<Player>();

function newDashGate(): DashGate {
	return new DashGate(MovementCombatConfig.DashCooldown, () => HttpService.GenerateGUID(false));
}

function newState(): CombatState {
	return {
		character: undefined,
		humanoid: undefined,
		root: undefined,
		movementMode: "Normal",
		actionState: "Free",
		dashGate: newDashGate(),
		dashToken: 0,
		punchToken: 0,
		dashCancel: undefined,
		punchCancel: undefined,
		dashCooldownEndsAt: 0,
		comboStep: 0,
		lastHitAt: 0,
		lastDamage: 0,
		highestRequestId: 0,
		responseCache: new Map<number, ActionResponse>(),
		responseOrder: [],
		dashAccepted: 0,
		dashRejected: 0,
		dashCompleted: 0,
		punchAccepted: 0,
		punchRejected: 0,
		lastRequestReason: "-",
	};
}

function getState(player: Player): CombatState {
	let state = states.get(player);
	if (state === undefined) {
		state = newState();
		states.set(player, state);
	}
	return state;
}

function isStance(state: CombatState): boolean {
	return state.movementMode === "Stance";
}

function isSprinting(state: CombatState): boolean {
	return state.movementMode === "Sprint";
}

function setAttribute(player: Player, state: CombatState, name: string, value: boolean | number | string): void {
	player.SetAttribute(name, value);
	if (state.character !== undefined && state.character.Parent !== undefined) {
		state.character.SetAttribute(name, value);
	}
}

function syncAttributes(player: Player, state: CombatState): void {
	setAttribute(player, state, "StanceActive", isStance(state));
	setAttribute(player, state, "SprintActive", isSprinting(state));
	setAttribute(player, state, "CombatActionState", state.actionState);
	setAttribute(player, state, "CombatMovementMode", state.movementMode);
	setAttribute(player, state, "CombatDashReady", state.dashGate.getNonce() !== undefined);
	setAttribute(player, state, "CombatDashCooldownEndsAt", state.dashCooldownEndsAt);
	setAttribute(player, state, "CombatDashAccepted", state.dashAccepted);
	setAttribute(player, state, "CombatDashRejected", state.dashRejected);
	setAttribute(player, state, "CombatDashCompleted", state.dashCompleted);
	setAttribute(player, state, "CombatPunchAccepted", state.punchAccepted);
	setAttribute(player, state, "CombatPunchRejected", state.punchRejected);
	setAttribute(player, state, "CombatLastDamage", state.lastDamage);
	setAttribute(player, state, "CombatComboStep", state.comboStep);
	setAttribute(player, state, "CombatLastRequestReason", state.lastRequestReason);
}

function applyWalkSpeed(state: CombatState): void {
	const humanoid = state.humanoid;
	if (humanoid === undefined || humanoid.Parent === undefined || humanoid.Health <= 0) return;
	humanoid.WalkSpeed = isSprinting(state)
		? MovementCombatConfig.SprintWalkSpeed
		: MovementCombatConfig.NormalWalkSpeed;
}

function sendTo(player: Player, payload: Record<string, unknown>): void {
	payload.userId = player.UserId;
	actionBroadcast.FireClient(player, payload);
}

function broadcast(player: Player, payload: Record<string, unknown>): void {
	payload.userId = player.UserId;
	actionBroadcast.FireAllClients(payload);
}

function broadcastMovementMode(player: Player, state: CombatState): void {
	broadcast(player, { kind: "Stance", active: isStance(state) });
	broadcast(player, { kind: "Sprint", active: isSprinting(state) });
}

function cacheResponse(state: CombatState, requestId: number, response: ActionResponse): void {
	state.responseCache.set(requestId, response);
	state.responseOrder.push(requestId);
	if (state.responseOrder.size() > 512) {
		const expiredId = state.responseOrder.shift();
		if (expiredId !== undefined) state.responseCache.delete(expiredId);
	}
}

function respond(
	player: Player,
	state: CombatState,
	requestId: number,
	action: string,
	accepted: boolean,
	reason?: string,
	extra?: Record<string, unknown>,
): void {
	const response: ActionResponse = { requestId, action, accepted, reason };
	if (extra !== undefined) {
		for (const [key, value] of pairs(extra)) response[key] = value;
	}
	cacheResponse(state, requestId, response);

	if (action === "Dash") {
		if (accepted) state.dashAccepted += 1;
		else state.dashRejected += 1;
	} else if (action === "Punch") {
		if (accepted) state.punchAccepted += 1;
		else state.punchRejected += 1;
	}

	state.lastRequestReason = accepted ? action + " accepted" : tostring(reason ?? (action + " rejected"));
	syncAttributes(player, state);
	actionAck.FireClient(player, response);
}

function getRoot(character: Model): BasePart | undefined {
	const root = character.FindFirstChild("HumanoidRootPart");
	return root !== undefined && root.IsA("BasePart") ? root : undefined;
}

function getCharacterState(player: Player): [CombatState, Model | undefined, Humanoid | undefined, BasePart | undefined] {
	const state = getState(player);
	const character = player.Character;
	if (character === undefined || character !== state.character) return [state, undefined, undefined, undefined];

	const humanoid = state.humanoid ?? character.FindFirstChildOfClass("Humanoid");
	const root = state.root ?? getRoot(character);
	if (humanoid !== undefined && root !== undefined && humanoid.Health > 0) {
		state.humanoid = humanoid;
		state.root = root;
		return [state, character, humanoid, root];
	}
	return [state, undefined, undefined, undefined];
}

function horizontalUnit(vector: Vector3): Vector3 | undefined {
	const flat = new Vector3(vector.X, 0, vector.Z);
	return flat.Magnitude < 0.001 ? undefined : flat.Unit;
}

function validCameraForward(cameraForward: unknown): Vector3 | undefined {
	if (!typeIs(cameraForward, "Vector3")) return undefined;
	if (
		cameraForward.X !== cameraForward.X ||
		cameraForward.Y !== cameraForward.Y ||
		cameraForward.Z !== cameraForward.Z ||
		math.abs(cameraForward.X) > 100000 ||
		math.abs(cameraForward.Y) > 100000 ||
		math.abs(cameraForward.Z) > 100000
	) {
		return undefined;
	}
	return horizontalUnit(cameraForward);
}

function isDashDirection(value: unknown): value is DashDirection {
	return value === "Forward" || value === "Backward" || value === "Left" || value === "Right";
}

function dashProgress(alpha: number): number {
	if (MovementCombatConfig.DashEasing === "OutQuad") return 1 - (1 - alpha) * (1 - alpha);
	return alpha;
}

function issueDashReady(player: Player, state: CombatState): void {
	const nonce = state.dashGate.issue(os.clock());
	if (nonce === undefined) return;

	state.dashCooldownEndsAt = Workspace.GetServerTimeNow();
	syncAttributes(player, state);
	sendTo(player, {
		kind: "DashReady",
		nonce,
		readyAt: state.dashCooldownEndsAt,
	});
}

function scheduleDashReady(player: Player, state: CombatState, token: number, character: Model): void {
	task.delay(MovementCombatConfig.DashCooldown, () => {
		if (states.get(player) !== state || state.dashToken !== token || state.character !== character) return;
		issueDashReady(player, state);
	});
}

function startDash(
	player: Player,
	state: CombatState,
	directionName: unknown,
	cameraForward: unknown,
	dashNonce: unknown,
): [boolean, string | undefined, Record<string, unknown> | undefined] {
	const [currentState, character, humanoid, root] = getCharacterState(player);
	if (currentState !== state || character === undefined || humanoid === undefined || root === undefined) {
		return [false, "CharacterNotReady", undefined];
	}
	if (state.actionState !== "Free") return [false, "ActionBusy", undefined];
	if (!isDashDirection(directionName)) return [false, "InvalidDirection", undefined];

	const cameraForwardUnit = validCameraForward(cameraForward);
	if (cameraForwardUnit === undefined) return [false, "InvalidCameraDirection", undefined];

	let direction: Vector3;
	if (directionName === "Forward") direction = cameraForwardUnit;
	else if (directionName === "Backward") direction = cameraForwardUnit.mul(-1);
	else if (directionName === "Left") direction = new Vector3(cameraForwardUnit.Z, 0, -cameraForwardUnit.X);
	else direction = new Vector3(-cameraForwardUnit.Z, 0, cameraForwardUnit.X);

	const [accepted, reason] = state.dashGate.consume(dashNonce, os.clock());
	if (!accepted) return [false, reason, undefined];

	state.actionState = "Dash";
	state.dashToken += 1;
	const token = state.dashToken;
	state.dashCooldownEndsAt = Workspace.GetServerTimeNow() + MovementCombatConfig.DashCooldown;
	state.lastDamage = 0;

	const dashFacing = cameraForwardUnit;
	pcall(() => root.SetNetworkOwner(undefined));
	const previousAutoRotate = humanoid.AutoRotate;
	humanoid.AutoRotate = false;
	root.CFrame = CFrame.lookAt(root.Position, root.Position.add(dashFacing));
	root.AssemblyLinearVelocity = new Vector3(0, root.AssemblyLinearVelocity.Y, 0);

	const recoveryFade = MovementCombatConfig.DashRecoveryFade[directionName] ?? MovementCombatConfig.AnimationFade.Dash;
	syncAttributes(player, state);
	broadcast(player, {
		kind: "Dash",
		direction: directionName,
		token,
		duration: MovementCombatConfig.DashDuration,
		recoveryFade,
	});
	scheduleDashReady(player, state, token, character);

	const startedAt = os.clock();
	let moved = 0;
	let connection: RBXScriptConnection | undefined;
	let finished = false;

	const finish = (reasonName: string) => {
		if (finished) return;
		finished = true;
		if (connection !== undefined) {
			connection.Disconnect();
			connection = undefined;
		}
		if (state.dashCancel !== undefined) state.dashCancel = undefined;

		if (state.dashToken === token) {
			state.actionState = "Free";
			state.dashCompleted += 1;
		}
		if (humanoid.Parent !== undefined) humanoid.AutoRotate = previousAutoRotate;
		if (root.Parent !== undefined) {
			root.AssemblyLinearVelocity = new Vector3(0, root.AssemblyLinearVelocity.Y, 0);
			pcall(() => root.SetNetworkOwnershipAuto());
		}
		if (player.Parent !== undefined) {
			syncAttributes(player, state);
			broadcast(player, {
				kind: "DashEnded",
				direction: directionName,
				token,
				recoveryFade,
				reason: reasonName,
			});
		}
	};

	state.dashCancel = finish;
	connection = RunService.Heartbeat.Connect(() => {
		if (states.get(player) !== state || state.dashToken !== token || root.Parent === undefined || humanoid.Health <= 0) {
			finish("Interrupted");
			return;
		}

		const elapsed = os.clock() - startedAt;
		const alpha = math.clamp(elapsed / MovementCombatConfig.DashDuration, 0, 1);
		const wantedDistance = MovementCombatConfig.DashDistance * dashProgress(alpha);
		let stepDistance = wantedDistance - moved;

		if (stepDistance > 0) {
			const rayParams = new RaycastParams();
			rayParams.FilterType = Enum.RaycastFilterType.Exclude;
			rayParams.FilterDescendantsInstances = [character];
			rayParams.IgnoreWater = true;

			let step = direction.mul(stepDistance);
			const hit = Workspace.Raycast(root.Position, step, rayParams);
			if (hit !== undefined) {
				stepDistance = math.max(hit.Distance - MovementCombatConfig.DashObstaclePadding, 0);
				step = direction.mul(stepDistance);
			}

			if (stepDistance > 0) {
				const nextPosition = root.Position.add(step);
				root.CFrame = CFrame.lookAt(nextPosition, nextPosition.add(dashFacing));
				moved += stepDistance;
			}

			if (hit !== undefined) {
				finish("Blocked");
				return;
			}
		}

		if (alpha >= 1) finish("Completed");
	});

	return [
		true,
		undefined,
		{
			direction: directionName,
			token,
			duration: MovementCombatConfig.DashDuration,
		},
	];
}

function hasLineOfSight(character: Model, root: BasePart, targetModel: Model, targetPosition: Vector3): boolean {
	const origin = root.Position.add(new Vector3(0, 1.5, 0));
	const vector = targetPosition.sub(origin);
	if (vector.Magnitude < 0.05) return true;

	const rayParams = new RaycastParams();
	rayParams.FilterType = Enum.RaycastFilterType.Exclude;
	rayParams.FilterDescendantsInstances = [character];
	rayParams.IgnoreWater = true;

	const result = Workspace.Raycast(origin, vector, rayParams);
	return result !== undefined && result.Instance.IsDescendantOf(targetModel);
}

function findTargetHumanoid(character: Model, root: BasePart): [Humanoid | undefined, Model | undefined] {
	const overlapParams = new OverlapParams();
	overlapParams.FilterType = Enum.RaycastFilterType.Exclude;
	overlapParams.FilterDescendantsInstances = [character];
	overlapParams.MaxParts = 100;

	const boxCFrame = root.CFrame.mul(new CFrame(0, 0, -MovementCombatConfig.PunchHitboxOffset));
	const parts = Workspace.GetPartBoundsInBox(boxCFrame, MovementCombatConfig.PunchHitboxSize, overlapParams);
	const candidates = new Array<TargetCandidate>();
	const seen = new Set<Humanoid>();

	for (const part of parts) {
		const ancestor = part.FindFirstAncestorOfClass("Model");
		if (ancestor === undefined || !ancestor.IsA("Model")) continue;
		const model = ancestor;
		const humanoid = model.FindFirstChildOfClass("Humanoid");
		if (humanoid === undefined || humanoid.Health <= 0 || model === character || seen.has(humanoid)) continue;
		seen.add(humanoid);
		const targetRoot = getRoot(model);
		const targetPosition = targetRoot !== undefined ? targetRoot.Position : part.Position;
		candidates.push({
			humanoid,
			model,
			position: targetPosition,
			distance: targetPosition.sub(root.Position).Magnitude,
		});
	}

	candidates.sort((left, right) => left.distance < right.distance);
	for (const candidate of candidates) {
		if (hasLineOfSight(character, root, candidate.model, candidate.position)) {
			return [candidate.humanoid, candidate.model];
		}
	}
	return [undefined, undefined];
}

function flashHit(targetModel: Model): void {
	const existing = targetModel.FindFirstChild("CombatHitFlash");
	let highlight = existing !== undefined && existing.IsA("Highlight") ? existing : undefined;
	if (existing !== undefined && highlight === undefined) existing.Destroy();
	if (highlight === undefined) {
		highlight = new Instance("Highlight");
		highlight.Name = "CombatHitFlash";
		highlight.Adornee = targetModel;
		highlight.DepthMode = Enum.HighlightDepthMode.Occluded;
		highlight.Parent = targetModel;
	}

	highlight.FillColor = MovementCombatConfig.HitFlash.FillColor;
	highlight.FillTransparency = MovementCombatConfig.HitFlash.FillTransparency;
	highlight.OutlineColor = MovementCombatConfig.HitFlash.OutlineColor;
	highlight.OutlineTransparency = MovementCombatConfig.HitFlash.OutlineTransparency;

	const priorToken = highlight.GetAttribute("FlashToken");
	const flashToken = (typeIs(priorToken, "number") ? priorToken : 0) + 1;
	highlight.SetAttribute("FlashToken", flashToken);
	task.delay(MovementCombatConfig.HitFlash.Duration, () => {
		if (highlight.Parent !== undefined && highlight.GetAttribute("FlashToken") === flashToken) highlight.Destroy();
	});
}

function getPunchTiming(step: number): PunchTiming | undefined {
	const timing = MovementCombatConfig.PunchTimings[step];
	if (
		timing === undefined ||
		!typeIs(timing.Duration, "number") ||
		!typeIs(timing.Impact, "number") ||
		!typeIs(timing.PlaybackSpeed, "number")
	) {
		return undefined;
	}
	if (
		timing.Duration <= 0 ||
		timing.Impact < 0 ||
		timing.Impact > timing.Duration ||
		timing.PlaybackSpeed <= 0
	) {
		return undefined;
	}
	return timing;
}

function startPunch(
	player: Player,
	state: CombatState,
): [boolean, string | undefined, Record<string, unknown> | undefined] {
	const [currentState, character, humanoid, root] = getCharacterState(player);
	if (currentState !== state || character === undefined || humanoid === undefined || root === undefined) {
		return [false, "CharacterNotReady", undefined];
	}
	if (state.actionState !== "Free") return [false, "ActionBusy", undefined];
	if (!isStance(state)) return [false, "StanceRequired", undefined];

	const now = os.clock();
	const nextComboStep = (state.comboStep % 3) + 1;
	const continuationTiming = getPunchTiming(nextComboStep);
	const withinComboWindow =
		continuationTiming !== undefined &&
		state.lastHitAt > 0 &&
		now + continuationTiming.Impact - state.lastHitAt <= MovementCombatConfig.ComboWindow;
	const attemptStep = withinComboWindow ? nextComboStep : 1;
	const timing = getPunchTiming(attemptStep);
	if (timing === undefined) return [false, "InvalidPunchTiming", undefined];

	state.actionState = "Punch";
	state.punchToken += 1;
	const token = state.punchToken;
	state.lastDamage = 0;
	syncAttributes(player, state);
	broadcast(player, {
		kind: "Punch",
		step: attemptStep,
		token,
		duration: timing.Duration,
		impactTime: timing.Impact,
		playbackSpeed: timing.PlaybackSpeed,
	});

	let finished = false;
	const finish = (reasonName: string) => {
		if (finished) return;
		finished = true;
		if (state.punchCancel !== undefined) state.punchCancel = undefined;
		if (state.punchToken === token) state.actionState = "Free";
		if (player.Parent !== undefined) {
			syncAttributes(player, state);
			broadcast(player, { kind: "PunchEnded", token, reason: reasonName });
		}
	};
	state.punchCancel = finish;

	task.delay(timing.Impact, () => {
		if (states.get(player) !== state || state.punchToken !== token || state.character !== character) return;

		const [activeState, activeCharacter, activeHumanoid, activeRoot] = getCharacterState(player);
		if (
			activeState !== state ||
			activeCharacter !== character ||
			activeHumanoid === undefined ||
			activeRoot === undefined
		) {
			return;
		}

		const [targetHumanoid, targetModel] = findTargetHumanoid(character, activeRoot);
		const landed = targetHumanoid !== undefined;
		const targetPlayer = targetModel !== undefined ? Players.GetPlayerFromCharacter(targetModel) : undefined;

		if (landed && targetModel !== undefined) {
			const impactAt = os.clock();
			const continued =
				attemptStep > 1 &&
				state.lastHitAt > 0 &&
				impactAt - state.lastHitAt <= MovementCombatConfig.ComboWindow;

			targetHumanoid.TakeDamage(MovementCombatConfig.PunchDamage);
			flashHit(targetModel);
			state.comboStep = continued ? attemptStep : 1;
			state.lastHitAt = impactAt;
			state.lastDamage = MovementCombatConfig.PunchDamage;
			syncAttributes(player, state);
		}

		broadcast(player, {
			kind: "PunchImpact",
			step: attemptStep,
			token,
			landed,
			targetUserId: targetPlayer?.UserId,
		});
	});

	task.delay(timing.Duration, () => {
		if (states.get(player) === state && state.punchToken === token && state.character === character) {
			finish("Completed");
		}
	});

	return [
		true,
		undefined,
		{
			step: attemptStep,
			token,
			duration: timing.Duration,
			impactTime: timing.Impact,
		},
	];
}

function cancelActions(player: Player, state: CombatState, reasonName: string): void {
	if (state.dashCancel !== undefined) state.dashCancel(reasonName);
	if (state.punchCancel !== undefined) state.punchCancel(reasonName);
	state.dashToken += 1;
	state.punchToken += 1;
	state.actionState = "Free";
}

function bindCharacter(player: Player, character: Model): void {
	const state = getState(player);
	cancelActions(player, state, "CharacterChanged");

	state.character = character;
	state.humanoid = undefined;
	state.root = undefined;
	state.movementMode = "Normal";
	state.comboStep = 0;
	state.lastHitAt = 0;
	state.lastDamage = 0;
	state.dashCooldownEndsAt = 0;
	state.dashGate.reset(os.clock());
	syncAttributes(player, state);

	task.spawn(() => {
		const humanoid = character.WaitForChild("Humanoid", 8);
		const root = character.WaitForChild("HumanoidRootPart", 8);
		if (
			states.get(player) !== state ||
			state.character !== character ||
			humanoid === undefined ||
			root === undefined ||
			!humanoid.IsA("Humanoid") ||
			!root.IsA("BasePart")
		) {
			return;
		}

		state.humanoid = humanoid;
		state.root = root;
		applyWalkSpeed(state);
		syncAttributes(player, state);
		issueDashReady(player, state);

		humanoid.Died.Connect(() => {
			if (states.get(player) !== state || state.character !== character) return;
			cancelActions(player, state, "Died");
			state.movementMode = "Normal";
			state.comboStep = 0;
			state.lastHitAt = 0;
			state.lastDamage = 0;
			state.dashCooldownEndsAt = 0;
			state.dashGate.reset(os.clock());
			syncAttributes(player, state);
			broadcastMovementMode(player, state);
		});
	});
}

function handleSprint(player: Player, state: CombatState): [boolean, string | undefined, Record<string, unknown> | undefined] {
	const [currentState, character, humanoid] = getCharacterState(player);
	if (currentState !== state || character === undefined || humanoid === undefined) {
		return [false, "CharacterNotReady", undefined];
	}
	if (state.actionState !== "Free") return [false, "ActionBusy", undefined];
	if (isStance(state)) return [false, "StanceBlocksSprint", undefined];

	state.movementMode = isSprinting(state) ? "Normal" : "Sprint";
	applyWalkSpeed(state);
	syncAttributes(player, state);
	broadcastMovementMode(player, state);
	return [true, undefined, { active: isSprinting(state) }];
}

function handleStance(player: Player, state: CombatState): [boolean, string | undefined, Record<string, unknown> | undefined] {
	const [currentState, character, humanoid] = getCharacterState(player);
	if (currentState !== state || character === undefined || humanoid === undefined) {
		return [false, "CharacterNotReady", undefined];
	}

	const canExitDuringPunch = state.actionState === "Punch" && isStance(state);
	if (state.actionState !== "Free" && !canExitDuringPunch) return [false, "ActionBusy", undefined];

	state.movementMode = isStance(state) ? "Normal" : "Stance";
	applyWalkSpeed(state);
	syncAttributes(player, state);
	broadcastMovementMode(player, state);
	return [true, undefined, { active: isStance(state) }];
}

function handleRequest(player: Player, payload: unknown): void {
	const state = getState(player);
	if (!typeIs(payload, "table")) return;
	const request = payload as ClientRequest;
	const requestId = request.requestId;
	const action = request.action;
	if (!typeIs(requestId, "number") || requestId < 1 || requestId % 1 !== 0) return;

	const cached = state.responseCache.get(requestId);
	if (cached !== undefined) {
		actionAck.FireClient(player, cached);
		return;
	}
	if (requestId <= state.highestRequestId) {
		respond(player, state, requestId, tostring(action), false, "StaleRequest");
		return;
	}
	state.highestRequestId = requestId;

	if (!typeIs(action, "string")) {
		respond(player, state, requestId, "", false, "InvalidAction");
		return;
	}

	let accepted: boolean;
	let reason: string | undefined;
	let extra: Record<string, unknown> | undefined;
	if (action === "Dash") {
		[accepted, reason, extra] = startDash(player, state, request.direction, request.cameraForward, request.dashNonce);
	} else if (action === "ToggleSprint") {
		[accepted, reason, extra] = handleSprint(player, state);
	} else if (action === "ToggleStance") {
		[accepted, reason, extra] = handleStance(player, state);
	} else if (action === "Punch") {
		[accepted, reason, extra] = startPunch(player, state);
	} else {
		respond(player, state, requestId, action, false, "UnknownAction");
		return;
	}
	respond(player, state, requestId, action, accepted, reason, extra);
}

function bindTrainingDummy(dummy: Model): void {
	const humanoid = dummy.FindFirstChildOfClass("Humanoid");
	if (humanoid === undefined) return;
	humanoid.Died.Connect(() => {
		task.delay(2, () => {
			if (dummy.Parent === undefined) return;
			const template = ServerStorage.FindFirstChild("CombatTrainingDummyTemplate");
			if (template === undefined) return;
			const spawnCFrame = template.GetAttribute("SpawnCFrame");
			dummy.Destroy();
			const replacement = template.Clone();
			replacement.Name = "CombatTrainingDummy";
			replacement.Parent = Workspace;
			if (replacement.IsA("Model")) {
				if (typeIs(spawnCFrame, "CFrame")) replacement.PivotTo(spawnCFrame);
				bindTrainingDummy(replacement);
			}
		});
	});
}

task.defer(() => {
	const dummy = Workspace.FindFirstChild("CombatTrainingDummy");
	if (dummy !== undefined && dummy.IsA("Model")) bindTrainingDummy(dummy);
});

actionRequest.OnServerEvent.Connect(handleRequest);

function bindPlayer(player: Player): void {
	if (boundPlayers.has(player)) return;
	boundPlayers.add(player);
	getState(player);
	player.CharacterAdded.Connect((character) => bindCharacter(player, character));
	if (player.Character !== undefined) bindCharacter(player, player.Character);
}

Players.PlayerAdded.Connect(bindPlayer);
Players.PlayerRemoving.Connect((player) => {
	const state = states.get(player);
	if (state !== undefined) cancelActions(player, state, "PlayerRemoving");
	boundPlayers.delete(player);
	states.delete(player);
});

for (const player of Players.GetPlayers()) bindPlayer(player);
