-- Compiled with roblox-ts v3.0.0
local TS = require(game:GetService("ReplicatedStorage"):WaitForChild("TS"):WaitForChild("RuntimeLib"))
local MovementCombatConfig = TS.import(script, game:GetService("ReplicatedStorage"), "MovementCombat", "MovementCombatConfig").MovementCombatConfig
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")
local Workspace = game:GetService("Workspace")
local localPlayer = Players.LocalPlayer
local movementCombat = ReplicatedStorage:WaitForChild("MovementCombat")
local remotes = movementCombat:WaitForChild("Remotes")
local actionRequest = remotes:WaitForChild("ActionRequest")
local actionAck = remotes:WaitForChild("ActionAck")
local actionBroadcast = remotes:WaitForChild("ActionBroadcast")
local records = {}
local watchedPlayers = {}
local warnedMissingDash = {}
local heldKeys = {}
local activeShakes = {}
local requestCounter = 0
local heldKeyOrder = 0
local dashNonce
local lastServerResult = "-"
local function nextRequestId()
	requestCounter += 1
	return requestCounter
end
local function sendRequest(action, extra)
	local payload = {
		action = action,
		requestId = nextRequestId(),
	}
	if extra ~= nil then
		for key, value in pairs(extra) do
			payload[key] = value
		end
	end
	actionRequest:FireServer(payload)
	return payload.requestId
end
local function stopTrack(track, fadeTime)
	if track ~= nil and track.IsPlaying then
		pcall(function()
			local _track = track
			local _condition = fadeTime
			if _condition == nil then
				_condition = 0.05
			end
			return _track:Stop(_condition)
		end)
	end
end
local function playLoop(track, fadeTime)
	if track ~= nil and not track.IsPlaying then
		pcall(function()
			local _track = track
			local _condition = fadeTime
			if _condition == nil then
				_condition = 0.05
			end
			return _track:Play(_condition, 1, 1)
		end)
	end
end
local function playAction(track, fadeTime, speed)
	if track == nil then
		return nil
	end
	pcall(function()
		if track.IsPlaying then
			local _track = track
			local _condition = fadeTime
			if _condition == nil then
				_condition = 0.05
			end
			_track:Stop(math.min(_condition, 0.03))
		end
		local _track = track
		local _condition = fadeTime
		if _condition == nil then
			_condition = 0.05
		end
		local _condition_1 = speed
		if _condition_1 == nil then
			_condition_1 = 1
		end
		_track:Play(_condition, 1, _condition_1)
		track.TimePosition = 0
	end)
end
local function createTrack(animator, animationId, priority, looped)
	if animationId == "" then
		return nil
	end
	local animation = Instance.new("Animation")
	animation.AnimationId = animationId
	local ok, loaded = pcall(function()
		return animator:LoadAnimation(animation)
	end)
	if not ok or loaded == nil then
		warn("MovementCombat: failed to load animation " .. animationId)
		animation:Destroy()
		return nil
	end
	local track = loaded
	track.Priority = priority
	track.Looped = looped
	return track
end
local function stopRecord(record)
	if record == nil then
		return nil
	end
	if record.runningConnection ~= nil then
		record.runningConnection:Disconnect()
		record.runningConnection = nil
	end
	stopTrack(record.tracks.stance, 0.05)
	stopTrack(record.tracks.sprint, 0.05)
	stopTrack(record.tracks.normalWalk, 0.05)
	stopTrack(record.tracks.legWalk, 0.05)
	for _, track in record.tracks.punches do
		stopTrack(track, 0.05)
	end
	for _, direction in { "Forward", "Backward", "Left", "Right" } do
		stopTrack(record.tracks.dashes[direction], 0.05)
	end
end
local function getMovementMode(player, record)
	local replicatedMode = player:GetAttribute("CombatMovementMode")
	if replicatedMode == "Normal" or replicatedMode == "Sprint" or replicatedMode == "Stance" then
		return replicatedMode
	end
	if record ~= nil then
		return record.movementMode
	end
	if player:GetAttribute("StanceActive") == true then
		return "Stance"
	end
	if player:GetAttribute("SprintActive") == true then
		return "Sprint"
	end
	return "Normal"
end
local updateLocomotion
local function getRecord(player)
	local character = player.Character
	if character == nil then
		return nil
	end
	local _player = player
	local existing = records[_player]
	if existing ~= nil and existing.character == character then
		return existing
	end
	stopRecord(existing)
	local _player_1 = player
	records[_player_1] = nil
	local humanoid = character:FindFirstChildOfClass("Humanoid")
	if humanoid == nil then
		return nil
	end
	local animator = humanoid:FindFirstChildOfClass("Animator")
	if animator == nil then
		animator = Instance.new("Animator")
		animator.Parent = humanoid
	end
	local record = {
		character = character,
		humanoid = humanoid,
		movementMode = getMovementMode(player),
		dashing = false,
		dashToken = nil,
		dashTrack = nil,
		punching = false,
		punchToken = nil,
		punchTrack = nil,
		tracks = {
			stance = createTrack(animator, MovementCombatConfig.AnimationIds.Stance, Enum.AnimationPriority.Action, true),
			sprint = createTrack(animator, MovementCombatConfig.AnimationIds.Sprint, Enum.AnimationPriority.Action, true),
			normalWalk = createTrack(animator, MovementCombatConfig.AnimationIds.NormalWalk, Enum.AnimationPriority.Action, true),
			legWalk = createTrack(animator, MovementCombatConfig.AnimationIds.LegWalk, Enum.AnimationPriority.Action2, true),
			punches = {},
			dashes = {
				Forward = createTrack(animator, MovementCombatConfig.AnimationIds.Dash.Forward, Enum.AnimationPriority.Action4, false),
				Backward = createTrack(animator, MovementCombatConfig.AnimationIds.Dash.Backward, Enum.AnimationPriority.Action4, false),
				Left = createTrack(animator, MovementCombatConfig.AnimationIds.Dash.Left, Enum.AnimationPriority.Action4, false),
				Right = createTrack(animator, MovementCombatConfig.AnimationIds.Dash.Right, Enum.AnimationPriority.Action4, false),
			},
		},
		runningConnection = nil,
	}
	local _player_2 = player
	records[_player_2] = record
	for _, animationId in MovementCombatConfig.AnimationIds.Punches do
		local punchTrack = createTrack(animator, animationId, Enum.AnimationPriority.Action3, false)
		if punchTrack ~= nil then
			local _exp = record.tracks.punches
			table.insert(_exp, punchTrack)
		end
	end
	record.runningConnection = humanoid.Running:Connect(function()
		return updateLocomotion(player)
	end)
	return record
end
local function stopLocomotion(record, keepStance)
	stopTrack(record.tracks.normalWalk, MovementCombatConfig.AnimationFade.LegWalk)
	stopTrack(record.tracks.legWalk, MovementCombatConfig.AnimationFade.LegWalk)
	stopTrack(record.tracks.sprint, MovementCombatConfig.AnimationFade.Sprint)
	if not keepStance then
		stopTrack(record.tracks.stance, MovementCombatConfig.AnimationFade.Stance)
	end
end
updateLocomotion = function(player)
	local record = getRecord(player)
	if record == nil or record.humanoid.Health <= 0 then
		return nil
	end
	local mode = getMovementMode(player, record)
	record.movementMode = mode
	local moving = record.humanoid.MoveDirection.Magnitude > 0.05
	if record.dashing then
		stopLocomotion(record, false)
		return nil
	end
	if record.punching then
		stopTrack(record.tracks.normalWalk, MovementCombatConfig.AnimationFade.LegWalk)
		stopTrack(record.tracks.legWalk, MovementCombatConfig.AnimationFade.LegWalk)
		stopTrack(record.tracks.sprint, MovementCombatConfig.AnimationFade.Sprint)
		if mode == "Stance" then
			playLoop(record.tracks.stance, MovementCombatConfig.AnimationFade.Stance)
		else
			stopTrack(record.tracks.stance, MovementCombatConfig.AnimationFade.Stance)
		end
		return nil
	end
	if mode == "Stance" then
		stopTrack(record.tracks.normalWalk, MovementCombatConfig.AnimationFade.LegWalk)
		stopTrack(record.tracks.sprint, MovementCombatConfig.AnimationFade.Sprint)
		playLoop(record.tracks.stance, MovementCombatConfig.AnimationFade.Stance)
		if moving then
			playLoop(record.tracks.legWalk, MovementCombatConfig.AnimationFade.LegWalk)
		else
			stopTrack(record.tracks.legWalk, MovementCombatConfig.AnimationFade.LegWalk)
		end
	elseif mode == "Sprint" then
		stopTrack(record.tracks.stance, MovementCombatConfig.AnimationFade.Stance)
		stopTrack(record.tracks.normalWalk, MovementCombatConfig.AnimationFade.LegWalk)
		stopTrack(record.tracks.legWalk, MovementCombatConfig.AnimationFade.LegWalk)
		if moving then
			playLoop(record.tracks.sprint, MovementCombatConfig.AnimationFade.Sprint)
		else
			stopTrack(record.tracks.sprint, MovementCombatConfig.AnimationFade.Sprint)
		end
	else
		stopTrack(record.tracks.stance, MovementCombatConfig.AnimationFade.Stance)
		stopTrack(record.tracks.legWalk, MovementCombatConfig.AnimationFade.LegWalk)
		stopTrack(record.tracks.sprint, MovementCombatConfig.AnimationFade.Sprint)
		if moving then
			playLoop(record.tracks.normalWalk, MovementCombatConfig.AnimationFade.LegWalk)
		else
			stopTrack(record.tracks.normalWalk, MovementCombatConfig.AnimationFade.LegWalk)
		end
	end
end
local function playDash(player, direction, token)
	local record = getRecord(player)
	if record == nil then
		return nil
	end
	local variant = if direction == "Forward" then "Forward" elseif direction == "Backward" then "Backward" elseif direction == "Left" then "Left" else "Right"
	local track = record.tracks.dashes[variant]
	record.dashing = true
	record.dashToken = token
	record.dashTrack = track
	stopLocomotion(record, false)
	if track == nil then
		if not (warnedMissingDash[variant] ~= nil) then
			warnedMissingDash[variant] = true
			warn("MovementCombat: " .. variant .. " dash animation is missing; server movement remains active.")
		end
		return nil
	end
	playAction(track, MovementCombatConfig.AnimationFade.Dash)
end
local function endDash(player, token, recoveryFade)
	local record = getRecord(player)
	if record == nil or record.dashToken ~= token then
		return nil
	end
	local _exp = record.dashTrack
	local _condition = recoveryFade
	if _condition == nil then
		_condition = MovementCombatConfig.AnimationFade.Dash
	end
	stopTrack(_exp, _condition)
	record.dashing = false
	record.dashToken = nil
	record.dashTrack = nil
	updateLocomotion(player)
end
local function playPunch(player, step, token, playbackSpeed)
	local record = getRecord(player)
	if record == nil then
		return nil
	end
	if record.dashing then
		stopTrack(record.dashTrack, 0.03)
		record.dashing = false
		record.dashToken = nil
		record.dashTrack = nil
	end
	record.punching = true
	record.punchToken = token
	stopTrack(record.tracks.normalWalk, MovementCombatConfig.AnimationFade.LegWalk)
	stopTrack(record.tracks.legWalk, MovementCombatConfig.AnimationFade.LegWalk)
	stopTrack(record.tracks.sprint, MovementCombatConfig.AnimationFade.Sprint)
	for _, track in record.tracks.punches do
		stopTrack(track, 0.03)
	end
	local punchTrack = record.tracks.punches[step]
	record.punchTrack = punchTrack
	if punchTrack ~= nil then
		playAction(punchTrack, MovementCombatConfig.AnimationFade.Punch, playbackSpeed)
	end
end
local function endPunch(player, token)
	local record = getRecord(player)
	if record == nil or record.punchToken ~= token then
		return nil
	end
	stopTrack(record.punchTrack, MovementCombatConfig.AnimationFade.Punch)
	record.punching = false
	record.punchToken = nil
	record.punchTrack = nil
	updateLocomotion(player)
end
local function addCameraShake(settings)
	local _arg0 = {
		startedAt = os.clock(),
		duration = settings.Duration,
		position = settings.Position,
		rotation = settings.Rotation,
		seed = math.random(100000, 999999),
	}
	table.insert(activeShakes, _arg0)
end
RunService:BindToRenderStep("MovementCombatCameraShake", Enum.RenderPriority.Camera.Value + 1, function()
	if #activeShakes == 0 then
		return nil
	end
	local camera = Workspace.CurrentCamera
	if camera == nil then
		return nil
	end
	local now = os.clock()
	local x = 0
	local y = 0
	local z = 0
	local pitch = 0
	local yaw = 0
	for index = #activeShakes - 1, 0, -1 do
		local shake = activeShakes[index + 1]
		local elapsed = now - shake.startedAt
		if elapsed >= shake.duration then
			local _index = index
			table.remove(activeShakes, _index + 1)
		else
			local fade = 1 - elapsed / shake.duration
			local frequency = elapsed * 42
			local strength = fade * fade
			x += math.noise(shake.seed, frequency, 0) * shake.position * strength
			y += math.noise(shake.seed, frequency, 1) * shake.position * strength
			z += math.noise(shake.seed, frequency, 2) * shake.position * strength
			pitch += math.noise(shake.seed, frequency, 3) * shake.rotation * strength
			yaw += math.noise(shake.seed, frequency, 4) * shake.rotation * strength
		end
	end
	local _cFrame = camera.CFrame
	local _cFrame_1 = CFrame.new(x, y, z)
	local _arg0 = CFrame.Angles(pitch, yaw, 0)
	camera.CFrame = _cFrame * _cFrame_1 * _arg0
end)
local isDashDirection
actionBroadcast.OnClientEvent:Connect(function(payload)
	local _payload = payload
	if not (type(_payload) == "table") then
		return nil
	end
	local broadcast = payload
	local _userId = broadcast.userId
	if not (type(_userId) == "number") then
		return nil
	end
	local player = Players:GetPlayerByUserId(broadcast.userId)
	if player == nil then
		return nil
	end
	if broadcast.kind == "DashReady" and player == localPlayer then
		local _nonce = broadcast.nonce
		dashNonce = if type(_nonce) == "string" then broadcast.nonce else nil
	else
		local _condition = broadcast.kind == "Dash" and isDashDirection(broadcast.direction)
		if _condition then
			local _token = broadcast.token
			_condition = type(_token) == "number"
		end
		if _condition then
			playDash(player, broadcast.direction, broadcast.token)
		else
			local _condition_1 = broadcast.kind == "DashEnded"
			if _condition_1 then
				local _token = broadcast.token
				_condition_1 = type(_token) == "number"
			end
			if _condition_1 then
				local _exp = broadcast.token
				local _recoveryFade = broadcast.recoveryFade
				endDash(player, _exp, if type(_recoveryFade) == "number" then broadcast.recoveryFade else nil)
			elseif broadcast.kind == "Stance" then
				local record = getRecord(player)
				if record ~= nil then
					record.movementMode = if broadcast.active == true then "Stance" else "Normal"
				end
				updateLocomotion(player)
			elseif broadcast.kind == "Sprint" then
				local record = getRecord(player)
				if record ~= nil then
					record.movementMode = if broadcast.active == true then "Sprint" else "Normal"
				end
				updateLocomotion(player)
			else
				local _condition_2 = broadcast.kind == "Punch"
				if _condition_2 then
					local _token = broadcast.token
					_condition_2 = type(_token) == "number"
				end
				if _condition_2 then
					local rawStep = tonumber(broadcast.step)
					local rawSpeed = tonumber(broadcast.playbackSpeed)
					local _condition_3 = rawStep
					if _condition_3 == nil then
						_condition_3 = 1
					end
					local _exp = broadcast.token
					local _condition_4 = rawSpeed
					if _condition_4 == nil then
						_condition_4 = 1
					end
					playPunch(player, _condition_3, _exp, _condition_4)
					if player == localPlayer then
						addCameraShake(MovementCombatConfig.CameraShake.Punch)
					end
				elseif broadcast.kind == "PunchImpact" then
					if broadcast.landed == true and broadcast.targetUserId == localPlayer.UserId then
						addCameraShake(MovementCombatConfig.CameraShake.Hit)
					end
				else
					local _condition_3 = broadcast.kind == "PunchEnded"
					if _condition_3 then
						local _token = broadcast.token
						_condition_3 = type(_token) == "number"
					end
					if _condition_3 then
						endPunch(player, broadcast.token)
					end
				end
			end
		end
	end
end)
actionAck.OnClientEvent:Connect(function(response)
	local _response = response
	if not (type(_response) == "table") then
		return nil
	end
	local ack = response
	local _condition = ack.action
	if _condition == nil then
		_condition = "Action"
	end
	local action = tostring(_condition)
	local _result
	local _value = ack.accepted
	if _value ~= 0 and _value == _value and _value ~= "" and _value then
		_result = action .. " accepted"
	else
		local _exp = action .. ": "
		local _condition_1 = ack.reason
		if _condition_1 == nil then
			_condition_1 = "rejected"
		end
		_result = _exp .. tostring(_condition_1)
	end
	lastServerResult = _result
end)
local movementKeyCodes = {
	[Enum.KeyCode.W] = "Forward",
	[Enum.KeyCode.S] = "Backward",
	[Enum.KeyCode.A] = "Left",
	[Enum.KeyCode.D] = "Right",
}
function isDashDirection(value)
	return value == "Forward" or value == "Backward" or value == "Left" or value == "Right"
end
local function dashDirection()
	local chosenDirection = "Forward"
	local newestOrder = -1
	for keyCode, direction in movementKeyCodes do
		local order = heldKeys[keyCode]
		if order ~= nil and order > newestOrder then
			newestOrder = order
			chosenDirection = direction
		end
	end
	return chosenDirection
end
local function dashCameraForward()
	local camera = Workspace.CurrentCamera
	if camera ~= nil then
		local forward = Vector3.new(camera.CFrame.LookVector.X, 0, camera.CFrame.LookVector.Z)
		if forward.Magnitude >= 0.001 then
			return forward.Unit
		end
	end
	local character = localPlayer.Character
	local _root = character
	if _root ~= nil then
		_root = _root:FindFirstChild("HumanoidRootPart")
	end
	local root = _root
	if root ~= nil and root:IsA("BasePart") then
		local forward = Vector3.new(root.CFrame.LookVector.X, 0, root.CFrame.LookVector.Z)
		if forward.Magnitude >= 0.001 then
			return forward.Unit
		end
	end
	return Vector3.new(0, 0, -1)
end
local function getDebugGui()
	local playerGui = localPlayer:FindFirstChildOfClass("PlayerGui")
	local _gui = playerGui
	if _gui ~= nil then
		_gui = _gui:FindFirstChild("CombatDebugGui")
	end
	local gui = _gui
	return if gui ~= nil and gui:IsA("ScreenGui") then gui else nil
end
local function getDebugPanel()
	local _panel = getDebugGui()
	if _panel ~= nil then
		_panel = _panel:FindFirstChild("Panel")
	end
	local panel = _panel
	return if panel ~= nil and panel:IsA("GuiObject") then panel else nil
end
local function getDebugLabel(panel, name)
	local label = panel:FindFirstChild(name)
	return if label ~= nil and label:IsA("TextLabel") then label else nil
end
local function setDebugVisible(visible)
	local gui = getDebugGui()
	local panel = getDebugPanel()
	if gui == nil or panel == nil then
		return nil
	end
	gui.Enabled = true
	panel.Visible = visible
end
local function attributeNumber(name)
	local value = localPlayer:GetAttribute(name)
	return if type(value) == "number" then value else 0
end
local function updateDebugGui()
	local gui = getDebugGui()
	local panel = getDebugPanel()
	if gui == nil or not gui.Enabled or panel == nil or not panel.Visible then
		return nil
	end
	local state = getDebugLabel(panel, "State")
	local dash = getDebugLabel(panel, "Dash")
	local punch = getDebugLabel(panel, "Punch")
	local damage = getDebugLabel(panel, "Damage")
	local combo = getDebugLabel(panel, "Combo")
	local last = getDebugLabel(panel, "Last")
	if state == nil or dash == nil or punch == nil or damage == nil or combo == nil or last == nil then
		return nil
	end
	local _condition = localPlayer:GetAttribute("CombatActionState")
	if _condition == nil then
		_condition = "Waiting"
	end
	local actionState = tostring(_condition)
	local _condition_1 = localPlayer:GetAttribute("CombatMovementMode")
	if _condition_1 == nil then
		_condition_1 = "Waiting"
	end
	local movementMode = tostring(_condition_1)
	local ready = localPlayer:GetAttribute("CombatDashReady") == true
	local remaining = math.max(attributeNumber("CombatDashCooldownEndsAt") - Workspace:GetServerTimeNow(), 0)
	local dashText = if ready then "READY" else string.format("%.2fs", remaining)
	state.Text = "State: " .. actionState .. " | Mode: " .. movementMode
	dash.Text = string.format("Dash: %s | A %d / R %d / E %d", dashText, attributeNumber("CombatDashAccepted"), attributeNumber("CombatDashRejected"), attributeNumber("CombatDashCompleted"))
	punch.Text = string.format("Punch: A %d / R %d", attributeNumber("CombatPunchAccepted"), attributeNumber("CombatPunchRejected"))
	local _condition_2 = localPlayer:GetAttribute("CombatLastDamage")
	if _condition_2 == nil then
		_condition_2 = 0
	end
	damage.Text = "Last damage: " .. tostring(_condition_2)
	local _condition_3 = localPlayer:GetAttribute("CombatComboStep")
	if _condition_3 == nil then
		_condition_3 = 0
	end
	combo.Text = "Combo: " .. tostring(_condition_3)
	last.Text = "Last server result: " .. lastServerResult
end
UserInputService.InputBegan:Connect(function(input, gameProcessedEvent)
	if input.KeyCode == MovementCombatConfig.Debug.ToggleKey then
		local panel = getDebugPanel()
		if panel ~= nil then
			setDebugVisible(not panel.Visible)
		end
		return nil
	end
	if gameProcessedEvent then
		return nil
	end
	local _keyCode = input.KeyCode
	local direction = movementKeyCodes[_keyCode]
	if direction ~= nil then
		heldKeyOrder += 1
		local _keyCode_1 = input.KeyCode
		local _heldKeyOrder = heldKeyOrder
		heldKeys[_keyCode_1] = _heldKeyOrder
		return nil
	end
	if input.KeyCode == Enum.KeyCode.LeftControl or input.KeyCode == Enum.KeyCode.RightControl then
		sendRequest("Dash", {
			direction = dashDirection(),
			cameraForward = dashCameraForward(),
			dashNonce = dashNonce,
		})
	elseif input.KeyCode == Enum.KeyCode.R then
		sendRequest("ToggleSprint")
	elseif input.KeyCode == Enum.KeyCode.C then
		sendRequest("ToggleStance")
	elseif input.UserInputType == Enum.UserInputType.MouseButton1 then
		sendRequest("Punch")
	end
end)
UserInputService.InputEnded:Connect(function(input)
	local _keyCode = input.KeyCode
	if movementKeyCodes[_keyCode] ~= nil then
		local _keyCode_1 = input.KeyCode
		heldKeys[_keyCode_1] = nil
	end
end)
local function watchPlayer(player)
	local _player = player
	if watchedPlayers[_player] ~= nil then
		return nil
	end
	local _player_1 = player
	watchedPlayers[_player_1] = true
	player.CharacterAdded:Connect(function()
		local _player_2 = player
		stopRecord(records[_player_2])
		local _player_3 = player
		records[_player_3] = nil
		task.defer(function()
			if player.Parent ~= nil then
				getRecord(player)
				updateLocomotion(player)
			end
		end)
	end)
	for _, attributeName in { "CombatMovementMode", "CombatActionState", "StanceActive", "SprintActive" } do
		player:GetAttributeChangedSignal(attributeName):Connect(function()
			return updateLocomotion(player)
		end)
	end
	if player.Character ~= nil then
		task.defer(function()
			if player.Parent ~= nil then
				getRecord(player)
				updateLocomotion(player)
			end
		end)
	end
end
Players.PlayerAdded:Connect(watchPlayer)
Players.PlayerRemoving:Connect(function(player)
	local _player = player
	stopRecord(records[_player])
	local _player_1 = player
	records[_player_1] = nil
	local _player_2 = player
	watchedPlayers[_player_2] = nil
end)
for _, player in Players:GetPlayers() do
	watchPlayer(player)
end
task.defer(function()
	setDebugVisible(MovementCombatConfig.Debug.ShowInStudio and RunService:IsStudio())
end)
local elapsed = 0
RunService.Heartbeat:Connect(function(deltaTime)
	elapsed += deltaTime
	if elapsed >= 0.1 then
		elapsed = 0
		updateDebugGui()
	end
end)
