-- Compiled with roblox-ts v3.0.0
local TS = require(game:GetService("ReplicatedStorage"):WaitForChild("TS"):WaitForChild("RuntimeLib"))
local MovementCombatConfig = TS.import(script, game:GetService("ReplicatedStorage"), "MovementCombat", "MovementCombatConfig").MovementCombatConfig
local DashGate = TS.import(script, game:GetService("ServerScriptService"), "MovementCombatDashGate").DashGate
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local ServerStorage = game:GetService("ServerStorage")
local Workspace = game:GetService("Workspace")
local HttpService = game:GetService("HttpService")
local movementCombat = ReplicatedStorage:WaitForChild("MovementCombat")
local remotes = movementCombat:WaitForChild("Remotes")
local actionRequest = remotes:WaitForChild("ActionRequest")
local actionAck = remotes:WaitForChild("ActionAck")
local actionBroadcast = remotes:WaitForChild("ActionBroadcast")
local states = {}
local boundPlayers = {}
local function newDashGate()
	return DashGate.new(MovementCombatConfig.DashCooldown, function()
		return HttpService:GenerateGUID(false)
	end)
end
local function newState()
	return {
		character = nil,
		humanoid = nil,
		root = nil,
		movementMode = "Normal",
		actionState = "Free",
		dashGate = newDashGate(),
		dashToken = 0,
		punchToken = 0,
		dashCancel = nil,
		punchCancel = nil,
		dashCooldownEndsAt = 0,
		comboStep = 0,
		lastHitAt = 0,
		lastDamage = 0,
		highestRequestId = 0,
		responseCache = {},
		responseOrder = {},
		dashAccepted = 0,
		dashRejected = 0,
		dashCompleted = 0,
		punchAccepted = 0,
		punchRejected = 0,
		lastRequestReason = "-",
	}
end
local function getState(player)
	local _player = player
	local state = states[_player]
	if state == nil then
		state = newState()
		local _player_1 = player
		local _state = state
		states[_player_1] = _state
	end
	return state
end
local function isStance(state)
	return state.movementMode == "Stance"
end
local function isSprinting(state)
	return state.movementMode == "Sprint"
end
local function setAttribute(player, state, name, value)
	player:SetAttribute(name, value)
	if state.character ~= nil and state.character.Parent ~= nil then
		state.character:SetAttribute(name, value)
	end
end
local function syncAttributes(player, state)
	setAttribute(player, state, "StanceActive", isStance(state))
	setAttribute(player, state, "SprintActive", isSprinting(state))
	setAttribute(player, state, "CombatActionState", state.actionState)
	setAttribute(player, state, "CombatMovementMode", state.movementMode)
	setAttribute(player, state, "CombatDashReady", state.dashGate:getNonce() ~= nil)
	setAttribute(player, state, "CombatDashCooldownEndsAt", state.dashCooldownEndsAt)
	setAttribute(player, state, "CombatDashAccepted", state.dashAccepted)
	setAttribute(player, state, "CombatDashRejected", state.dashRejected)
	setAttribute(player, state, "CombatDashCompleted", state.dashCompleted)
	setAttribute(player, state, "CombatPunchAccepted", state.punchAccepted)
	setAttribute(player, state, "CombatPunchRejected", state.punchRejected)
	setAttribute(player, state, "CombatLastDamage", state.lastDamage)
	setAttribute(player, state, "CombatComboStep", state.comboStep)
	setAttribute(player, state, "CombatLastRequestReason", state.lastRequestReason)
end
local function applyWalkSpeed(state)
	local humanoid = state.humanoid
	if humanoid == nil or humanoid.Parent == nil or humanoid.Health <= 0 then
		return nil
	end
	humanoid.WalkSpeed = if isSprinting(state) then MovementCombatConfig.SprintWalkSpeed else MovementCombatConfig.NormalWalkSpeed
end
local function sendTo(player, payload)
	payload.userId = player.UserId
	actionBroadcast:FireClient(player, payload)
end
local function broadcast(player, payload)
	payload.userId = player.UserId
	actionBroadcast:FireAllClients(payload)
end
local function broadcastMovementMode(player, state)
	broadcast(player, {
		kind = "Stance",
		active = isStance(state),
	})
	broadcast(player, {
		kind = "Sprint",
		active = isSprinting(state),
	})
end
local function cacheResponse(state, requestId, response)
	local _responseCache = state.responseCache
	local _requestId = requestId
	local _response = response
	_responseCache[_requestId] = _response
	local _responseOrder = state.responseOrder
	local _requestId_1 = requestId
	table.insert(_responseOrder, _requestId_1)
	if #state.responseOrder > 512 then
		local expiredId = table.remove(state.responseOrder, 1)
		if expiredId ~= nil then
			state.responseCache[expiredId] = nil
		end
	end
end
local function respond(player, state, requestId, action, accepted, reason, extra)
	local response = {
		requestId = requestId,
		action = action,
		accepted = accepted,
		reason = reason,
	}
	if extra ~= nil then
		for key, value in pairs(extra) do
			response[key] = value
		end
	end
	cacheResponse(state, requestId, response)
	if action == "Dash" then
		if accepted then
			state.dashAccepted += 1
		else
			state.dashRejected += 1
		end
	elseif action == "Punch" then
		if accepted then
			state.punchAccepted += 1
		else
			state.punchRejected += 1
		end
	end
	local _result
	if accepted then
		_result = action .. " accepted"
	else
		local _condition = reason
		if _condition == nil then
			_condition = (action .. " rejected")
		end
		_result = tostring(_condition)
	end
	state.lastRequestReason = _result
	syncAttributes(player, state)
	actionAck:FireClient(player, response)
end
local function getRoot(character)
	local root = character:FindFirstChild("HumanoidRootPart")
	return if root ~= nil and root:IsA("BasePart") then root else nil
end
local function getCharacterState(player)
	local state = getState(player)
	local character = player.Character
	if character == nil or character ~= state.character then
		return { state, nil, nil, nil }
	end
	local humanoid = state.humanoid or character:FindFirstChildOfClass("Humanoid")
	local root = state.root or getRoot(character)
	if humanoid ~= nil and root ~= nil and humanoid.Health > 0 then
		state.humanoid = humanoid
		state.root = root
		return { state, character, humanoid, root }
	end
	return { state, nil, nil, nil }
end
local function horizontalUnit(vector)
	local flat = Vector3.new(vector.X, 0, vector.Z)
	return if flat.Magnitude < 0.001 then nil else flat.Unit
end
local function validCameraForward(cameraForward)
	local _cameraForward = cameraForward
	if not (typeof(_cameraForward) == "Vector3") then
		return nil
	end
	if cameraForward.X ~= cameraForward.X or cameraForward.Y ~= cameraForward.Y or cameraForward.Z ~= cameraForward.Z or math.abs(cameraForward.X) > 100000 or math.abs(cameraForward.Y) > 100000 or math.abs(cameraForward.Z) > 100000 then
		return nil
	end
	return horizontalUnit(cameraForward)
end
local function isDashDirection(value)
	return value == "Forward" or value == "Backward" or value == "Left" or value == "Right"
end
local function dashProgress(alpha)
	if MovementCombatConfig.DashEasing == "OutQuad" then
		return 1 - (1 - alpha) * (1 - alpha)
	end
	return alpha
end
local function issueDashReady(player, state)
	local nonce = state.dashGate:issue(os.clock())
	if nonce == nil then
		return nil
	end
	state.dashCooldownEndsAt = Workspace:GetServerTimeNow()
	syncAttributes(player, state)
	sendTo(player, {
		kind = "DashReady",
		nonce = nonce,
		readyAt = state.dashCooldownEndsAt,
	})
end
local function scheduleDashReady(player, state, token, character)
	task.delay(MovementCombatConfig.DashCooldown, function()
		local _player = player
		local _condition = states[_player] ~= state
		if not _condition then
			_condition = state.dashToken ~= token or state.character ~= character
		end
		if _condition then
			return nil
		end
		issueDashReady(player, state)
	end)
end
local function startDash(player, state, directionName, cameraForward, dashNonce)
	local _binding = getCharacterState(player)
	local currentState = _binding[1]
	local character = _binding[2]
	local humanoid = _binding[3]
	local root = _binding[4]
	if currentState ~= state or character == nil or humanoid == nil or root == nil then
		return { false, "CharacterNotReady", nil }
	end
	if state.actionState ~= "Free" then
		return { false, "ActionBusy", nil }
	end
	if not isDashDirection(directionName) then
		return { false, "InvalidDirection", nil }
	end
	local cameraForwardUnit = validCameraForward(cameraForward)
	if cameraForwardUnit == nil then
		return { false, "InvalidCameraDirection", nil }
	end
	local direction
	if directionName == "Forward" then
		direction = cameraForwardUnit
	elseif directionName == "Backward" then
		direction = cameraForwardUnit * (-1)
	elseif directionName == "Left" then
		direction = Vector3.new(cameraForwardUnit.Z, 0, -cameraForwardUnit.X)
	else
		direction = Vector3.new(-cameraForwardUnit.Z, 0, cameraForwardUnit.X)
	end
	local _binding_1 = state.dashGate:consume(dashNonce, os.clock())
	local accepted = _binding_1[1]
	local reason = _binding_1[2]
	if not accepted then
		return { false, reason, nil }
	end
	state.actionState = "Dash"
	state.dashToken += 1
	local token = state.dashToken
	state.dashCooldownEndsAt = Workspace:GetServerTimeNow() + MovementCombatConfig.DashCooldown
	state.lastDamage = 0
	local dashFacing = cameraForwardUnit
	pcall(function()
		return root:SetNetworkOwner(nil)
	end)
	local previousAutoRotate = humanoid.AutoRotate
	humanoid.AutoRotate = false
	root.CFrame = CFrame.lookAt(root.Position, root.Position + dashFacing)
	root.AssemblyLinearVelocity = Vector3.new(0, root.AssemblyLinearVelocity.Y, 0)
	local _condition = MovementCombatConfig.DashRecoveryFade[directionName]
	if _condition == nil then
		_condition = MovementCombatConfig.AnimationFade.Dash
	end
	local recoveryFade = _condition
	syncAttributes(player, state)
	broadcast(player, {
		kind = "Dash",
		direction = directionName,
		token = token,
		duration = MovementCombatConfig.DashDuration,
		recoveryFade = recoveryFade,
	})
	scheduleDashReady(player, state, token, character)
	local startedAt = os.clock()
	local moved = 0
	local connection
	local finished = false
	local finish = function(reasonName)
		if finished then
			return nil
		end
		finished = true
		if connection ~= nil then
			connection:Disconnect()
			connection = nil
		end
		if state.dashCancel ~= nil then
			state.dashCancel = nil
		end
		if state.dashToken == token then
			state.actionState = "Free"
			state.dashCompleted += 1
		end
		if humanoid.Parent ~= nil then
			humanoid.AutoRotate = previousAutoRotate
		end
		if root.Parent ~= nil then
			root.AssemblyLinearVelocity = Vector3.new(0, root.AssemblyLinearVelocity.Y, 0)
			pcall(function()
				return root:SetNetworkOwnershipAuto()
			end)
		end
		if player.Parent ~= nil then
			syncAttributes(player, state)
			broadcast(player, {
				kind = "DashEnded",
				direction = directionName,
				token = token,
				recoveryFade = recoveryFade,
				reason = reasonName,
			})
		end
	end
	state.dashCancel = finish
	connection = RunService.Heartbeat:Connect(function()
		local _player = player
		local _condition_1 = states[_player] ~= state
		if not _condition_1 then
			_condition_1 = state.dashToken ~= token or root.Parent == nil or humanoid.Health <= 0
		end
		if _condition_1 then
			finish("Interrupted")
			return nil
		end
		local elapsed = os.clock() - startedAt
		local alpha = math.clamp(elapsed / MovementCombatConfig.DashDuration, 0, 1)
		local wantedDistance = MovementCombatConfig.DashDistance * dashProgress(alpha)
		local stepDistance = wantedDistance - moved
		if stepDistance > 0 then
			local rayParams = RaycastParams.new()
			rayParams.FilterType = Enum.RaycastFilterType.Exclude
			rayParams.FilterDescendantsInstances = { character }
			rayParams.IgnoreWater = true
			local _direction = direction
			local _stepDistance = stepDistance
			local step = _direction * _stepDistance
			local hit = Workspace:Raycast(root.Position, step, rayParams)
			if hit ~= nil then
				stepDistance = math.max(hit.Distance - MovementCombatConfig.DashObstaclePadding, 0)
				local _direction_1 = direction
				local _stepDistance_1 = stepDistance
				step = _direction_1 * _stepDistance_1
			end
			if stepDistance > 0 then
				local _position = root.Position
				local _step = step
				local nextPosition = _position + _step
				root.CFrame = CFrame.lookAt(nextPosition, nextPosition + dashFacing)
				moved += stepDistance
			end
			if hit ~= nil then
				finish("Blocked")
				return nil
			end
		end
		if alpha >= 1 then
			finish("Completed")
		end
	end)
	return { true, nil, {
		direction = directionName,
		token = token,
		duration = MovementCombatConfig.DashDuration,
	} }
end
local function hasLineOfSight(character, root, targetModel, targetPosition)
	local _position = root.Position
	local _vector3 = Vector3.new(0, 1.5, 0)
	local origin = _position + _vector3
	local vector = targetPosition - origin
	if vector.Magnitude < 0.05 then
		return true
	end
	local rayParams = RaycastParams.new()
	rayParams.FilterType = Enum.RaycastFilterType.Exclude
	rayParams.FilterDescendantsInstances = { character }
	rayParams.IgnoreWater = true
	local result = Workspace:Raycast(origin, vector, rayParams)
	return result ~= nil and result.Instance:IsDescendantOf(targetModel)
end
local function findTargetHumanoid(character, root)
	local overlapParams = OverlapParams.new()
	overlapParams.FilterType = Enum.RaycastFilterType.Exclude
	overlapParams.FilterDescendantsInstances = { character }
	overlapParams.MaxParts = 100
	local _cFrame = root.CFrame
	local _cFrame_1 = CFrame.new(0, 0, -MovementCombatConfig.PunchHitboxOffset)
	local boxCFrame = _cFrame * _cFrame_1
	local parts = Workspace:GetPartBoundsInBox(boxCFrame, MovementCombatConfig.PunchHitboxSize, overlapParams)
	local candidates = {}
	local seen = {}
	for _, part in parts do
		local ancestor = part:FindFirstAncestorOfClass("Model")
		if ancestor == nil or not ancestor:IsA("Model") then
			continue
		end
		local model = ancestor
		local humanoid = model:FindFirstChildOfClass("Humanoid")
		if humanoid == nil or humanoid.Health <= 0 or model == character or seen[humanoid] ~= nil then
			continue
		end
		seen[humanoid] = true
		local targetRoot = getRoot(model)
		local targetPosition = if targetRoot ~= nil then targetRoot.Position else part.Position
		local _object = {
			humanoid = humanoid,
			model = model,
			position = targetPosition,
		}
		local _left = "distance"
		local _position = root.Position
		_object[_left] = (targetPosition - _position).Magnitude
		table.insert(candidates, _object)
	end
	table.sort(candidates, function(left, right)
		return left.distance < right.distance
	end)
	for _, candidate in candidates do
		if hasLineOfSight(character, root, candidate.model, candidate.position) then
			return { candidate.humanoid, candidate.model }
		end
	end
	return { nil, nil }
end
local function flashHit(targetModel)
	local existing = targetModel:FindFirstChild("CombatHitFlash")
	local highlight = if existing ~= nil and existing:IsA("Highlight") then existing else nil
	if existing ~= nil and highlight == nil then
		existing:Destroy()
	end
	if highlight == nil then
		highlight = Instance.new("Highlight")
		highlight.Name = "CombatHitFlash"
		highlight.Adornee = targetModel
		highlight.DepthMode = Enum.HighlightDepthMode.Occluded
		highlight.Parent = targetModel
	end
	highlight.FillColor = MovementCombatConfig.HitFlash.FillColor
	highlight.FillTransparency = MovementCombatConfig.HitFlash.FillTransparency
	highlight.OutlineColor = MovementCombatConfig.HitFlash.OutlineColor
	highlight.OutlineTransparency = MovementCombatConfig.HitFlash.OutlineTransparency
	local priorToken = highlight:GetAttribute("FlashToken")
	local flashToken = (if type(priorToken) == "number" then priorToken else 0) + 1
	highlight:SetAttribute("FlashToken", flashToken)
	task.delay(MovementCombatConfig.HitFlash.Duration, function()
		if highlight.Parent ~= nil and highlight:GetAttribute("FlashToken") == flashToken then
			highlight:Destroy()
		end
	end)
end
local function getPunchTiming(step)
	local timing = MovementCombatConfig.PunchTimings[step]
	local _condition = timing == nil
	if not _condition then
		local _duration = timing.Duration
		_condition = not (type(_duration) == "number")
		if not _condition then
			local _impact = timing.Impact
			_condition = not (type(_impact) == "number")
			if not _condition then
				local _playbackSpeed = timing.PlaybackSpeed
				_condition = not (type(_playbackSpeed) == "number")
			end
		end
	end
	if _condition then
		return nil
	end
	if timing.Duration <= 0 or timing.Impact < 0 or timing.Impact > timing.Duration or timing.PlaybackSpeed <= 0 then
		return nil
	end
	return timing
end
local function startPunch(player, state)
	local _binding = getCharacterState(player)
	local currentState = _binding[1]
	local character = _binding[2]
	local humanoid = _binding[3]
	local root = _binding[4]
	if currentState ~= state or character == nil or humanoid == nil or root == nil then
		return { false, "CharacterNotReady", nil }
	end
	if state.actionState ~= "Free" then
		return { false, "ActionBusy", nil }
	end
	if not isStance(state) then
		return { false, "StanceRequired", nil }
	end
	local now = os.clock()
	local nextComboStep = (state.comboStep % 3) + 1
	local continuationTiming = getPunchTiming(nextComboStep)
	local withinComboWindow = continuationTiming ~= nil and state.lastHitAt > 0 and now + continuationTiming.Impact - state.lastHitAt <= MovementCombatConfig.ComboWindow
	local attemptStep = if withinComboWindow then nextComboStep else 1
	local timing = getPunchTiming(attemptStep)
	if timing == nil then
		return { false, "InvalidPunchTiming", nil }
	end
	state.actionState = "Punch"
	state.punchToken += 1
	local token = state.punchToken
	state.lastDamage = 0
	syncAttributes(player, state)
	broadcast(player, {
		kind = "Punch",
		step = attemptStep,
		token = token,
		duration = timing.Duration,
		impactTime = timing.Impact,
		playbackSpeed = timing.PlaybackSpeed,
	})
	local finished = false
	local finish = function(reasonName)
		if finished then
			return nil
		end
		finished = true
		if state.punchCancel ~= nil then
			state.punchCancel = nil
		end
		if state.punchToken == token then
			state.actionState = "Free"
		end
		if player.Parent ~= nil then
			syncAttributes(player, state)
			broadcast(player, {
				kind = "PunchEnded",
				token = token,
				reason = reasonName,
			})
		end
	end
	state.punchCancel = finish
	task.delay(timing.Impact, function()
		local _player = player
		local _condition = states[_player] ~= state
		if not _condition then
			_condition = state.punchToken ~= token or state.character ~= character
		end
		if _condition then
			return nil
		end
		local _binding_1 = getCharacterState(player)
		local activeState = _binding_1[1]
		local activeCharacter = _binding_1[2]
		local activeHumanoid = _binding_1[3]
		local activeRoot = _binding_1[4]
		if activeState ~= state or activeCharacter ~= character or activeHumanoid == nil or activeRoot == nil then
			return nil
		end
		local _binding_2 = findTargetHumanoid(character, activeRoot)
		local targetHumanoid = _binding_2[1]
		local targetModel = _binding_2[2]
		local landed = targetHumanoid ~= nil
		local targetPlayer = if targetModel ~= nil then Players:GetPlayerFromCharacter(targetModel) else nil
		if landed and targetModel ~= nil then
			local impactAt = os.clock()
			local continued = attemptStep > 1 and state.lastHitAt > 0 and impactAt - state.lastHitAt <= MovementCombatConfig.ComboWindow
			targetHumanoid:TakeDamage(MovementCombatConfig.PunchDamage)
			flashHit(targetModel)
			state.comboStep = if continued then attemptStep else 1
			state.lastHitAt = impactAt
			state.lastDamage = MovementCombatConfig.PunchDamage
			syncAttributes(player, state)
		end
		local _exp = player
		local _object = {
			kind = "PunchImpact",
			step = attemptStep,
			token = token,
			landed = landed,
		}
		local _left = "targetUserId"
		local _result = targetPlayer
		if _result ~= nil then
			_result = _result.UserId
		end
		_object[_left] = _result
		broadcast(_exp, _object)
	end)
	task.delay(timing.Duration, function()
		local _player = player
		local _condition = states[_player] == state
		if _condition then
			_condition = state.punchToken == token and state.character == character
		end
		if _condition then
			finish("Completed")
		end
	end)
	return { true, nil, {
		step = attemptStep,
		token = token,
		duration = timing.Duration,
		impactTime = timing.Impact,
	} }
end
local function cancelActions(player, state, reasonName)
	if state.dashCancel ~= nil then
		state.dashCancel(reasonName)
	end
	if state.punchCancel ~= nil then
		state.punchCancel(reasonName)
	end
	state.dashToken += 1
	state.punchToken += 1
	state.actionState = "Free"
end
local function bindCharacter(player, character)
	local state = getState(player)
	cancelActions(player, state, "CharacterChanged")
	state.character = character
	state.humanoid = nil
	state.root = nil
	state.movementMode = "Normal"
	state.comboStep = 0
	state.lastHitAt = 0
	state.lastDamage = 0
	state.dashCooldownEndsAt = 0
	state.dashGate:reset(os.clock())
	syncAttributes(player, state)
	task.spawn(function()
		local humanoid = character:WaitForChild("Humanoid", 8)
		local root = character:WaitForChild("HumanoidRootPart", 8)
		local _player = player
		local _condition = states[_player] ~= state
		if not _condition then
			_condition = state.character ~= character or humanoid == nil or root == nil or not humanoid:IsA("Humanoid") or not root:IsA("BasePart")
		end
		if _condition then
			return nil
		end
		state.humanoid = humanoid
		state.root = root
		applyWalkSpeed(state)
		syncAttributes(player, state)
		issueDashReady(player, state)
		humanoid.Died:Connect(function()
			local _player_1 = player
			local _condition_1 = states[_player_1] ~= state
			if not _condition_1 then
				_condition_1 = state.character ~= character
			end
			if _condition_1 then
				return nil
			end
			cancelActions(player, state, "Died")
			state.movementMode = "Normal"
			state.comboStep = 0
			state.lastHitAt = 0
			state.lastDamage = 0
			state.dashCooldownEndsAt = 0
			state.dashGate:reset(os.clock())
			syncAttributes(player, state)
			broadcastMovementMode(player, state)
		end)
	end)
end
local function handleSprint(player, state)
	local _binding = getCharacterState(player)
	local currentState = _binding[1]
	local character = _binding[2]
	local humanoid = _binding[3]
	if currentState ~= state or character == nil or humanoid == nil then
		return { false, "CharacterNotReady", nil }
	end
	if state.actionState ~= "Free" then
		return { false, "ActionBusy", nil }
	end
	if isStance(state) then
		return { false, "StanceBlocksSprint", nil }
	end
	state.movementMode = if isSprinting(state) then "Normal" else "Sprint"
	applyWalkSpeed(state)
	syncAttributes(player, state)
	broadcastMovementMode(player, state)
	return { true, nil, {
		active = isSprinting(state),
	} }
end
local function handleStance(player, state)
	local _binding = getCharacterState(player)
	local currentState = _binding[1]
	local character = _binding[2]
	local humanoid = _binding[3]
	if currentState ~= state or character == nil or humanoid == nil then
		return { false, "CharacterNotReady", nil }
	end
	local canExitDuringPunch = state.actionState == "Punch" and isStance(state)
	if state.actionState ~= "Free" and not canExitDuringPunch then
		return { false, "ActionBusy", nil }
	end
	state.movementMode = if isStance(state) then "Normal" else "Stance"
	applyWalkSpeed(state)
	syncAttributes(player, state)
	broadcastMovementMode(player, state)
	return { true, nil, {
		active = isStance(state),
	} }
end
local function handleRequest(player, payload)
	local state = getState(player)
	local _payload = payload
	if not (type(_payload) == "table") then
		return nil
	end
	local request = payload
	local requestId = request.requestId
	local action = request.action
	if not (type(requestId) == "number") or requestId < 1 or requestId % 1 ~= 0 then
		return nil
	end
	local cached = state.responseCache[requestId]
	if cached ~= nil then
		actionAck:FireClient(player, cached)
		return nil
	end
	if requestId <= state.highestRequestId then
		respond(player, state, requestId, tostring(action), false, "StaleRequest")
		return nil
	end
	state.highestRequestId = requestId
	if not (type(action) == "string") then
		respond(player, state, requestId, "", false, "InvalidAction")
		return nil
	end
	local accepted
	local reason
	local extra
	if action == "Dash" then
		local _binding = startDash(player, state, request.direction, request.cameraForward, request.dashNonce)
		accepted = _binding[1]
		reason = _binding[2]
		extra = _binding[3]
	elseif action == "ToggleSprint" then
		local _binding = handleSprint(player, state)
		accepted = _binding[1]
		reason = _binding[2]
		extra = _binding[3]
	elseif action == "ToggleStance" then
		local _binding = handleStance(player, state)
		accepted = _binding[1]
		reason = _binding[2]
		extra = _binding[3]
	elseif action == "Punch" then
		local _binding = startPunch(player, state)
		accepted = _binding[1]
		reason = _binding[2]
		extra = _binding[3]
	else
		respond(player, state, requestId, action, false, "UnknownAction")
		return nil
	end
	respond(player, state, requestId, action, accepted, reason, extra)
end
local function bindTrainingDummy(dummy)
	local humanoid = dummy:FindFirstChildOfClass("Humanoid")
	if humanoid == nil then
		return nil
	end
	humanoid.Died:Connect(function()
		task.delay(2, function()
			if dummy.Parent == nil then
				return nil
			end
			local template = ServerStorage:FindFirstChild("CombatTrainingDummyTemplate")
			if template == nil then
				return nil
			end
			local spawnCFrame = template:GetAttribute("SpawnCFrame")
			dummy:Destroy()
			local replacement = template:Clone()
			replacement.Name = "CombatTrainingDummy"
			replacement.Parent = Workspace
			if replacement:IsA("Model") then
				if typeof(spawnCFrame) == "CFrame" then
					replacement:PivotTo(spawnCFrame)
				end
				bindTrainingDummy(replacement)
			end
		end)
	end)
end
task.defer(function()
	local dummy = Workspace:FindFirstChild("CombatTrainingDummy")
	if dummy ~= nil and dummy:IsA("Model") then
		bindTrainingDummy(dummy)
	end
end)
actionRequest.OnServerEvent:Connect(handleRequest)
local function bindPlayer(player)
	local _player = player
	if boundPlayers[_player] ~= nil then
		return nil
	end
	local _player_1 = player
	boundPlayers[_player_1] = true
	getState(player)
	player.CharacterAdded:Connect(function(character)
		return bindCharacter(player, character)
	end)
	if player.Character ~= nil then
		bindCharacter(player, player.Character)
	end
end
Players.PlayerAdded:Connect(bindPlayer)
Players.PlayerRemoving:Connect(function(player)
	local _player = player
	local state = states[_player]
	if state ~= nil then
		cancelActions(player, state, "PlayerRemoving")
	end
	local _player_1 = player
	boundPlayers[_player_1] = nil
	local _player_2 = player
	states[_player_2] = nil
end)
for _, player in Players:GetPlayers() do
	bindPlayer(player)
end
