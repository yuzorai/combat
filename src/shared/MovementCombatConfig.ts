export type DashDirection = "Forward" | "Backward" | "Left" | "Right";
export type MovementMode = "Normal" | "Sprint" | "Stance";
export type CombatActionState = "Free" | "Dash" | "Punch";

export interface PunchTiming {
	Duration: number;
	Impact: number;
	PlaybackSpeed: number;
}

export interface CameraShakeSettings {
	Duration: number;
	Position: number;
	Rotation: number;
}

const dashRecoveryFade: Record<DashDirection, number> = {
	Forward: 0.08,
	Backward: 0.12,
	Left: 0.1,
	Right: 0.1,
};

const punchTimings: Record<number, PunchTiming> = {
	1: { Duration: 0.7241666913032532, Impact: 0.48, PlaybackSpeed: 1 },
	2: { Duration: 0.7774999737739563, Impact: 0.52, PlaybackSpeed: 1 },
	3: {
		Duration: 0.7496794829001798,
		Impact: 0.6923076923076923,
		PlaybackSpeed: 1.3,
	},
};

const dashAnimations: Record<DashDirection, string> & { Side: string } = {
	Forward: "rbxassetid://99796161985059",
	Backward: "rbxassetid://136068134829233",
	Right: "rbxassetid://105989610549591",
	Left: "rbxassetid://108755549470226",
	Side: "rbxassetid://105989610549591",
};

/** Faithful typed representation of ReplicatedStorage.MovementCombat.MovementCombatConfig. */
export const MovementCombatConfig = {
	NormalWalkSpeed: 16,
	SprintWalkSpeed: 24,

	DashDistance: 12,
	DashDuration: 0.35,
	DashCooldown: 1.5,
	DashObstaclePadding: 0.75,
	DashEasing: "OutQuad",
	DashRecoveryFade: dashRecoveryFade,

	PunchDamage: 10,
	PunchHitboxSize: new Vector3(4, 4, 5),
	PunchHitboxOffset: 3,
	ComboWindow: 1,
	PunchTimings: punchTimings,

	HitFlash: {
		Duration: 0.12,
		FillColor: Color3.fromRGB(255, 45, 45),
		FillTransparency: 0.35,
		OutlineColor: Color3.fromRGB(255, 105, 105),
		OutlineTransparency: 0.08,
	},

	CameraShake: {
		Punch: {
			Duration: 0.08,
			Position: 0.04,
			Rotation: math.rad(0.35),
		},
		Hit: {
			Duration: 0.14,
			Position: 0.08,
			Rotation: math.rad(0.75),
		},
	},

	Debug: {
		ToggleKey: Enum.KeyCode.F7,
		ShowInStudio: true,
		StressRequestCount: 100,
	},

	AnimationFade: {
		Stance: 0.15,
		Sprint: 0.12,
		Dash: 0.05,
		Punch: 0.05,
		LegWalk: 0.1,
	},

	AnimationIds: {
		Sprint: "rbxassetid://98197754367407",
		Stance: "rbxassetid://91221608002690",
		NormalWalk: "rbxassetid://103583209310741",
		LegWalk: "rbxassetid://70781014398505",
		Punches: [
			"rbxassetid://90926529345649",
			"rbxassetid://132559976251878",
			"rbxassetid://98819250605283",
		],
		Dash: dashAnimations,
	},
};
