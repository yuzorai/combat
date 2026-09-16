import { CameraShakeSettings, DashDirection, MovementCombatConfig, MovementMode } from "shared/MovementCombatConfig";

const Players = game.GetService("Players");
const ReplicatedStorage = game.GetService("ReplicatedStorage");
const RunService = game.GetService("RunService");
const UserInputService = game.GetService("UserInputService");
const Workspace = game.GetService("Workspace");

const localPlayer = Players.LocalPlayer;
const movementCombat = ReplicatedStorage.WaitForChild("MovementCombat") as Folder;
const remotes = movementCombat.WaitForChild("Remotes") as Folder;
const actionRequest = remotes.WaitForChild("ActionRequest") as RemoteEvent;
const actionAck = remotes.WaitForChild("ActionAck") as RemoteEvent;
const actionBroadcast = remotes.WaitForChild("ActionBroadcast") as RemoteEvent;

interface AnimationTracks {
	stance: AnimationTrack | undefined;
	sprint: AnimationTrack | undefined;
	normalWalk: AnimationTrack | undefined;
	legWalk: AnimationTrack | undefined;
	punches: AnimationTrack[];
	dashes: Record<DashDirection, AnimationTrack | undefined>;
}

interface AnimationRecord {
	character: Model;
	humanoid: Humanoid;
	movementMode: MovementMode;
	dashing: boolean;
	dashToken: number | undefined;
	dashTrack: AnimationTrack | undefined;
	punching: boolean;
	punchToken: number | undefined;
	punchTrack: AnimationTrack | undefined;
	tracks: AnimationTracks;
	runningConnection: RBXScriptConnection | undefined;
}

interface BroadcastPayload {
	userId?: unknown;
	kind?: unknown;
	nonce?: unknown;
	direction?: unknown;
	token?: unknown;
	recoveryFade?: unknown;
	active?: unknown;
	step?: unknown;
	playbackSpeed?: unknown;
	landed?: unknown;
	targetUserId?: unknown;
}

interface AckPayload {
	action?: unknown;
	accepted?: unknown;
	reason?: unknown;
}

interface ActiveShake {
	startedAt: number;
	duration: number;
	position: number;
	rotation: number;
	seed: number;
}

const records = new Map<Player, AnimationRecord>();
const watchedPlayers = new Set<Player>();
const warnedMissingDash = new Set<DashDirection>();
const heldKeys = new Map<Enum.KeyCode, number>();
const activeShakes = new Array<ActiveShake>();

let requestCounter = 0;
let heldKeyOrder = 0;
let dashNonce: string | undefined;
let lastServerResult = "-";

function nextRequestId(): number {
	requestCounter += 1;
	return requestCounter;
}

function sendRequest(action: string, extra?: Record<string, unknown>): number {
	const payload: Record<string, unknown> = {
		action,
		requestId: nextRequestId(),
	};
	if (extra !== undefined) {
		for (const [key, value] of pairs(extra)) payload[key] = value;
	}
	actionRequest.FireServer(payload);
	return payload.requestId as number;
}

function stopTrack(track: AnimationTrack | undefined, fadeTime?: number): void {
	if (track !== undefined && track.IsPlaying) {
		pcall(() => track.Stop(fadeTime ?? 0.05));
	}
}

function playLoop(track: AnimationTrack | undefined, fadeTime?: number): void {
	if (track !== undefined && !track.IsPlaying) {
		pcall(() => track.Play(fadeTime ?? 0.05, 1, 1));
	}
}

function playAction(track: AnimationTrack | undefined, fadeTime?: number, speed?: number): void {
	if (track === undefined) return;
	pcall(() => {
		if (track.IsPlaying) track.Stop(math.min(fadeTime ?? 0.05, 0.03));
		track.Play(fadeTime ?? 0.05, 1, speed ?? 1);
		track.TimePosition = 0;
	});
}

function createTrack(
	animator: Animator,
	animationId: string,
	priority: Enum.AnimationPriority,
	looped: boolean,
): AnimationTrack | undefined {
	if (animationId === "") return undefined;

	const animation = new Instance("Animation");
	animation.AnimationId = animationId;
	const [ok, loaded] = pcall(() => animator.LoadAnimation(animation));
	if (!ok || loaded === undefined) {
		warn("MovementCombat: failed to load animation " + animationId);
		animation.Destroy();
		return undefined;
	}

	const track = loaded as AnimationTrack;
	track.Priority = priority;
	track.Looped = looped;
	return track;
}

function stopRecord(record: AnimationRecord | undefined): void {
	if (record === undefined) return;
	if (record.runningConnection !== undefined) {
		record.runningConnection.Disconnect();
		record.runningConnection = undefined;
	}
	stopTrack(record.tracks.stance, 0.05);
	stopTrack(record.tracks.sprint, 0.05);
	stopTrack(record.tracks.normalWalk, 0.05);
	stopTrack(record.tracks.legWalk, 0.05);
	for (const track of record.tracks.punches) stopTrack(track, 0.05);
	for (const direction of ["Forward", "Backward", "Left", "Right"] as DashDirection[]) {
		stopTrack(record.tracks.dashes[direction], 0.05);
	}
}

function getMovementMode(player: Player, record?: AnimationRecord): MovementMode {
	const replicatedMode = player.GetAttribute("CombatMovementMode");
	if (replicatedMode === "Normal" || replicatedMode === "Sprint" || replicatedMode === "Stance") return replicatedMode;
	if (record !== undefined) return record.movementMode;
	if (player.GetAttribute("StanceActive") === true) return "Stance";
	if (player.GetAttribute("SprintActive") === true) return "Sprint";
	return "Normal";
}

let updateLocomotion: (player: Player) => void;

function getRecord(player: Player): AnimationRecord | undefined {
	const character = player.Character;
	if (character === undefined) return undefined;

	const existing = records.get(player);
	if (existing !== undefined && existing.character === character) return existing;
	stopRecord(existing);
	records.delete(player);

	const humanoid = character.FindFirstChildOfClass("Humanoid");
	if (humanoid === undefined) return undefined;
	let animator = humanoid.FindFirstChildOfClass("Animator");
	if (animator === undefined) {
		animator = new Instance("Animator");
		animator.Parent = humanoid;
	}

	const record: AnimationRecord = {
		character,
		humanoid,
		movementMode: getMovementMode(player),
		dashing: false,
		dashToken: undefined,
		dashTrack: undefined,
		punching: false,
		punchToken: undefined,
		punchTrack: undefined,
		tracks: {
			stance: createTrack(animator, MovementCombatConfig.AnimationIds.Stance, Enum.AnimationPriority.Action, true),
			sprint: createTrack(animator, MovementCombatConfig.AnimationIds.Sprint, Enum.AnimationPriority.Action, true),
			normalWalk: createTrack(
				animator,
				MovementCombatConfig.AnimationIds.NormalWalk,
				Enum.AnimationPriority.Action,
				true,
			),
			legWalk: createTrack(
				animator,
				MovementCombatConfig.AnimationIds.LegWalk,
				Enum.AnimationPriority.Action2,
				true,
			),
			punches: [],
			dashes: {
				Forward: createTrack(
					animator,
					MovementCombatConfig.AnimationIds.Dash.Forward,
					Enum.AnimationPriority.Action4,
					false,
				),
				Backward: createTrack(
					animator,
					MovementCombatConfig.AnimationIds.Dash.Backward,
					Enum.AnimationPriority.Action4,
					false,
				),
				Left: createTrack(
					animator,
					MovementCombatConfig.AnimationIds.Dash.Left,
					Enum.AnimationPriority.Action4,
					false,
				),
				Right: createTrack(
					animator,
					MovementCombatConfig.AnimationIds.Dash.Right,
					Enum.AnimationPriority.Action4,
					false,
				),
			},
		},
		runningConnection: undefined,
	};
	records.set(player, record);

	for (const animationId of MovementCombatConfig.AnimationIds.Punches) {
		const punchTrack = createTrack(animator, animationId, Enum.AnimationPriority.Action3, false);
		if (punchTrack !== undefined) record.tracks.punches.push(punchTrack);
	}

	record.runningConnection = humanoid.Running.Connect(() => updateLocomotion(player));
	return record;
}

function stopLocomotion(record: AnimationRecord, keepStance: boolean): void {
	stopTrack(record.tracks.normalWalk, MovementCombatConfig.AnimationFade.LegWalk);
	stopTrack(record.tracks.legWalk, MovementCombatConfig.AnimationFade.LegWalk);
	stopTrack(record.tracks.sprint, MovementCombatConfig.AnimationFade.Sprint);
	if (!keepStance) stopTrack(record.tracks.stance, MovementCombatConfig.AnimationFade.Stance);
}

updateLocomotion = (player: Player): void => {
	const record = getRecord(player);
	if (record === undefined || record.humanoid.Health <= 0) return;

	const mode = getMovementMode(player, record);
	record.movementMode = mode;
	const moving = record.humanoid.MoveDirection.Magnitude > 0.05;

	if (record.dashing) {
		stopLocomotion(record, false);
		return;
	}

	if (record.punching) {
		stopTrack(record.tracks.normalWalk, MovementCombatConfig.AnimationFade.LegWalk);
		stopTrack(record.tracks.legWalk, MovementCombatConfig.AnimationFade.LegWalk);
		stopTrack(record.tracks.sprint, MovementCombatConfig.AnimationFade.Sprint);
		if (mode === "Stance") playLoop(record.tracks.stance, MovementCombatConfig.AnimationFade.Stance);
		else stopTrack(record.tracks.stance, MovementCombatConfig.AnimationFade.Stance);
		return;
	}

	if (mode === "Stance") {
		stopTrack(record.tracks.normalWalk, MovementCombatConfig.AnimationFade.LegWalk);
		stopTrack(record.tracks.sprint, MovementCombatConfig.AnimationFade.Sprint);
		playLoop(record.tracks.stance, MovementCombatConfig.AnimationFade.Stance);
		if (moving) playLoop(record.tracks.legWalk, MovementCombatConfig.AnimationFade.LegWalk);
		else stopTrack(record.tracks.legWalk, MovementCombatConfig.AnimationFade.LegWalk);
	} else if (mode === "Sprint") {
		stopTrack(record.tracks.stance, MovementCombatConfig.AnimationFade.Stance);
		stopTrack(record.tracks.normalWalk, MovementCombatConfig.AnimationFade.LegWalk);
		stopTrack(record.tracks.legWalk, MovementCombatConfig.AnimationFade.LegWalk);
		if (moving) playLoop(record.tracks.sprint, MovementCombatConfig.AnimationFade.Sprint);
		else stopTrack(record.tracks.sprint, MovementCombatConfig.AnimationFade.Sprint);
	} else {
		stopTrack(record.tracks.stance, MovementCombatConfig.AnimationFade.Stance);
		stopTrack(record.tracks.legWalk, MovementCombatConfig.AnimationFade.LegWalk);
		stopTrack(record.tracks.sprint, MovementCombatConfig.AnimationFade.Sprint);
		if (moving) playLoop(record.tracks.normalWalk, MovementCombatConfig.AnimationFade.LegWalk);
		else stopTrack(record.tracks.normalWalk, MovementCombatConfig.AnimationFade.LegWalk);
	}
};

function playDash(player: Player, direction: DashDirection, token: number): void {
	const record = getRecord(player);
	if (record === undefined) return;

	const variant: DashDirection =
		direction === "Forward"
			? "Forward"
			: direction === "Backward"
				? "Backward"
				: direction === "Left"
					? "Left"
					: "Right";
	const track = record.tracks.dashes[variant];

	record.dashing = true;
	record.dashToken = token;
	record.dashTrack = track;
	stopLocomotion(record, false);

	if (track === undefined) {
		if (!warnedMissingDash.has(variant)) {
			warnedMissingDash.add(variant);
			warn("MovementCombat: " + variant + " dash animation is missing; server movement remains active.");
		}
		return;
	}
	playAction(track, MovementCombatConfig.AnimationFade.Dash);
}

function endDash(player: Player, token: number, recoveryFade?: number): void {
	const record = getRecord(player);
	if (record === undefined || record.dashToken !== token) return;

	stopTrack(record.dashTrack, recoveryFade ?? MovementCombatConfig.AnimationFade.Dash);
	record.dashing = false;
	record.dashToken = undefined;
	record.dashTrack = undefined;
	updateLocomotion(player);
}

function playPunch(player: Player, step: number, token: number, playbackSpeed: number): void {
	const record = getRecord(player);
	if (record === undefined) return;

	if (record.dashing) {
		stopTrack(record.dashTrack, 0.03);
		record.dashing = false;
		record.dashToken = undefined;
		record.dashTrack = undefined;
	}

	record.punching = true;
	record.punchToken = token;
	stopTrack(record.tracks.normalWalk, MovementCombatConfig.AnimationFade.LegWalk);
	stopTrack(record.tracks.legWalk, MovementCombatConfig.AnimationFade.LegWalk);
	stopTrack(record.tracks.sprint, MovementCombatConfig.AnimationFade.Sprint);
	for (const track of record.tracks.punches) stopTrack(track, 0.03);

	const punchTrack = record.tracks.punches[step - 1];
	record.punchTrack = punchTrack;
	if (punchTrack !== undefined) playAction(punchTrack, MovementCombatConfig.AnimationFade.Punch, playbackSpeed);
}

function endPunch(player: Player, token: number): void {
	const record = getRecord(player);
	if (record === undefined || record.punchToken !== token) return;

	stopTrack(record.punchTrack, MovementCombatConfig.AnimationFade.Punch);
	record.punching = false;
	record.punchToken = undefined;
	record.punchTrack = undefined;
	updateLocomotion(player);
}

function addCameraShake(settings: CameraShakeSettings): void {
	activeShakes.push({
		startedAt: os.clock(),
		duration: settings.Duration,
		position: settings.Position,
		rotation: settings.Rotation,
		seed: math.random(100000, 999999),
	});
}

RunService.BindToRenderStep(
	"MovementCombatCameraShake",
	Enum.RenderPriority.Camera.Value + 1,
	() => {
		if (activeShakes.size() === 0) return;
		const camera = Workspace.CurrentCamera;
		if (camera === undefined) return;

		const now = os.clock();
		let x = 0;
		let y = 0;
		let z = 0;
		let pitch = 0;
		let yaw = 0;

		for (let index = activeShakes.size() - 1; index >= 0; index--) {
			const shake = activeShakes[index];
			const elapsed = now - shake.startedAt;
			if (elapsed >= shake.duration) {
				activeShakes.remove(index);
			} else {
				const fade = 1 - elapsed / shake.duration;
				const frequency = elapsed * 42;
				const strength = fade * fade;
				x += math.noise(shake.seed, frequency, 0) * shake.position * strength;
				y += math.noise(shake.seed, frequency, 1) * shake.position * strength;
				z += math.noise(shake.seed, frequency, 2) * shake.position * strength;
				pitch += math.noise(shake.seed, frequency, 3) * shake.rotation * strength;
				yaw += math.noise(shake.seed, frequency, 4) * shake.rotation * strength;
			}
		}

		camera.CFrame = camera.CFrame.mul(new CFrame(x, y, z)).mul(CFrame.Angles(pitch, yaw, 0));
	},
);

actionBroadcast.OnClientEvent.Connect((payload: unknown) => {
	if (!typeIs(payload, "table")) return;
	const broadcast = payload as BroadcastPayload;
	if (!typeIs(broadcast.userId, "number")) return;
	const player = Players.GetPlayerByUserId(broadcast.userId);
	if (player === undefined) return;

	if (broadcast.kind === "DashReady" && player === localPlayer) {
		dashNonce = typeIs(broadcast.nonce, "string") ? broadcast.nonce : undefined;
	} else if (broadcast.kind === "Dash" && isDashDirection(broadcast.direction) && typeIs(broadcast.token, "number")) {
		playDash(player, broadcast.direction, broadcast.token);
	} else if (
		broadcast.kind === "DashEnded" &&
		typeIs(broadcast.token, "number")
	) {
		endDash(player, broadcast.token, typeIs(broadcast.recoveryFade, "number") ? broadcast.recoveryFade : undefined);
	} else if (
		broadcast.kind === "Stance"
	) {
		const record = getRecord(player);
		if (record !== undefined) record.movementMode = broadcast.active === true ? "Stance" : "Normal";
		updateLocomotion(player);
	} else if (broadcast.kind === "Sprint") {
		const record = getRecord(player);
		if (record !== undefined) record.movementMode = broadcast.active === true ? "Sprint" : "Normal";
		updateLocomotion(player);
	} else if (
		broadcast.kind === "Punch" &&
		typeIs(broadcast.token, "number")
	) {
		const rawStep = tonumber(broadcast.step);
		const rawSpeed = tonumber(broadcast.playbackSpeed);
		playPunch(player, rawStep ?? 1, broadcast.token, rawSpeed ?? 1);
		if (player === localPlayer) addCameraShake(MovementCombatConfig.CameraShake.Punch);
	} else if (broadcast.kind === "PunchImpact") {
		if (broadcast.landed === true && broadcast.targetUserId === localPlayer.UserId) {
			addCameraShake(MovementCombatConfig.CameraShake.Hit);
		}
	} else if (broadcast.kind === "PunchEnded" && typeIs(broadcast.token, "number")) {
		endPunch(player, broadcast.token);
	}
});

actionAck.OnClientEvent.Connect((response: unknown) => {
	if (!typeIs(response, "table")) return;
	const ack = response as AckPayload;
	const action = tostring(ack.action ?? "Action");
	lastServerResult = ack.accepted ? action + " accepted" : action + ": " + tostring(ack.reason ?? "rejected");
});

const movementKeyCodes = new Map<Enum.KeyCode, DashDirection>([
	[Enum.KeyCode.W, "Forward"],
	[Enum.KeyCode.S, "Backward"],
	[Enum.KeyCode.A, "Left"],
	[Enum.KeyCode.D, "Right"],
]);

function isDashDirection(value: unknown): value is DashDirection {
	return value === "Forward" || value === "Backward" || value === "Left" || value === "Right";
}

function dashDirection(): DashDirection {
	let chosenDirection: DashDirection = "Forward";
	let newestOrder = -1;
	for (const [keyCode, direction] of movementKeyCodes) {
		const order = heldKeys.get(keyCode);
		if (order !== undefined && order > newestOrder) {
			newestOrder = order;
			chosenDirection = direction;
		}
	}
	return chosenDirection;
}

function dashCameraForward(): Vector3 {
	const camera = Workspace.CurrentCamera;
	if (camera !== undefined) {
		const forward = new Vector3(camera.CFrame.LookVector.X, 0, camera.CFrame.LookVector.Z);
		if (forward.Magnitude >= 0.001) return forward.Unit;
	}

	const character = localPlayer.Character;
	const root = character?.FindFirstChild("HumanoidRootPart");
	if (root !== undefined && root.IsA("BasePart")) {
		const forward = new Vector3(root.CFrame.LookVector.X, 0, root.CFrame.LookVector.Z);
		if (forward.Magnitude >= 0.001) return forward.Unit;
	}
	return new Vector3(0, 0, -1);
}

function getDebugGui(): ScreenGui | undefined {
	const playerGui = localPlayer.FindFirstChildOfClass("PlayerGui");
	const gui = playerGui?.FindFirstChild("CombatDebugGui");
	return gui !== undefined && gui.IsA("ScreenGui") ? gui : undefined;
}

function getDebugPanel(): GuiObject | undefined {
	const panel = getDebugGui()?.FindFirstChild("Panel");
	return panel !== undefined && panel.IsA("GuiObject") ? panel : undefined;
}

function getDebugLabel(panel: GuiObject, name: string): TextLabel | undefined {
	const label = panel.FindFirstChild(name);
	return label !== undefined && label.IsA("TextLabel") ? label : undefined;
}

function setDebugVisible(visible: boolean): void {
	const gui = getDebugGui();
	const panel = getDebugPanel();
	if (gui === undefined || panel === undefined) return;
	gui.Enabled = true;
	panel.Visible = visible;
}

function attributeNumber(name: string): number {
	const value = localPlayer.GetAttribute(name);
	return typeIs(value, "number") ? value : 0;
}

function updateDebugGui(): void {
	const gui = getDebugGui();
	const panel = getDebugPanel();
	if (gui === undefined || !gui.Enabled || panel === undefined || !panel.Visible) return;

	const state = getDebugLabel(panel, "State");
	const dash = getDebugLabel(panel, "Dash");
	const punch = getDebugLabel(panel, "Punch");
	const damage = getDebugLabel(panel, "Damage");
	const combo = getDebugLabel(panel, "Combo");
	const last = getDebugLabel(panel, "Last");
	if (state === undefined || dash === undefined || punch === undefined || damage === undefined || combo === undefined || last === undefined) {
		return;
	}

	const actionState = tostring(localPlayer.GetAttribute("CombatActionState") ?? "Waiting");
	const movementMode = tostring(localPlayer.GetAttribute("CombatMovementMode") ?? "Waiting");
	const ready = localPlayer.GetAttribute("CombatDashReady") === true;
	const remaining = math.max(attributeNumber("CombatDashCooldownEndsAt") - Workspace.GetServerTimeNow(), 0);
	const dashText = ready ? "READY" : string.format("%.2fs", remaining);

	state.Text = "State: " + actionState + " | Mode: " + movementMode;
	dash.Text = string.format(
		"Dash: %s | A %d / R %d / E %d",
		dashText,
		attributeNumber("CombatDashAccepted"),
		attributeNumber("CombatDashRejected"),
		attributeNumber("CombatDashCompleted"),
	);
	punch.Text = string.format(
		"Punch: A %d / R %d",
		attributeNumber("CombatPunchAccepted"),
		attributeNumber("CombatPunchRejected"),
	);
	damage.Text = "Last damage: " + tostring(localPlayer.GetAttribute("CombatLastDamage") ?? 0);
	combo.Text = "Combo: " + tostring(localPlayer.GetAttribute("CombatComboStep") ?? 0);
	last.Text = "Last server result: " + lastServerResult;
}

UserInputService.InputBegan.Connect((input, gameProcessedEvent) => {
	if (input.KeyCode === MovementCombatConfig.Debug.ToggleKey) {
		const panel = getDebugPanel();
		if (panel !== undefined) setDebugVisible(!panel.Visible);
		return;
	}
	if (gameProcessedEvent) return;

	const direction = movementKeyCodes.get(input.KeyCode);
	if (direction !== undefined) {
		heldKeyOrder += 1;
		heldKeys.set(input.KeyCode, heldKeyOrder);
		return;
	}

	if (input.KeyCode === Enum.KeyCode.LeftControl || input.KeyCode === Enum.KeyCode.RightControl) {
		sendRequest("Dash", {
			direction: dashDirection(),
			cameraForward: dashCameraForward(),
			dashNonce,
		});
	} else if (input.KeyCode === Enum.KeyCode.R) {
		sendRequest("ToggleSprint");
	} else if (input.KeyCode === Enum.KeyCode.C) {
		sendRequest("ToggleStance");
	} else if (input.UserInputType === Enum.UserInputType.MouseButton1) {
		sendRequest("Punch");
	}
});

UserInputService.InputEnded.Connect((input) => {
	if (movementKeyCodes.has(input.KeyCode)) heldKeys.delete(input.KeyCode);
});

function watchPlayer(player: Player): void {
	if (watchedPlayers.has(player)) return;
	watchedPlayers.add(player);

	player.CharacterAdded.Connect(() => {
		stopRecord(records.get(player));
		records.delete(player);
		task.defer(() => {
			if (player.Parent !== undefined) {
				getRecord(player);
				updateLocomotion(player);
			}
		});
	});

	for (const attributeName of ["CombatMovementMode", "CombatActionState", "StanceActive", "SprintActive"]) {
		player.GetAttributeChangedSignal(attributeName).Connect(() => updateLocomotion(player));
	}

	if (player.Character !== undefined) {
		task.defer(() => {
			if (player.Parent !== undefined) {
				getRecord(player);
				updateLocomotion(player);
			}
		});
	}
}

Players.PlayerAdded.Connect(watchPlayer);
Players.PlayerRemoving.Connect((player) => {
	stopRecord(records.get(player));
	records.delete(player);
	watchedPlayers.delete(player);
});

for (const player of Players.GetPlayers()) watchPlayer(player);

task.defer(() => {
	setDebugVisible(MovementCombatConfig.Debug.ShowInStudio && RunService.IsStudio());
});

let elapsed = 0;
RunService.Heartbeat.Connect((deltaTime) => {
	elapsed += deltaTime;
	if (elapsed >= 0.1) {
		elapsed = 0;
		updateDebugGui();
	}
});
