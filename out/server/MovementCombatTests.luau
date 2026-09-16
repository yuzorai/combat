-- Compiled with roblox-ts v3.0.0
local TS = require(game:GetService("ReplicatedStorage"):WaitForChild("TS"):WaitForChild("RuntimeLib"))
local MovementCombatConfig = TS.import(script, game:GetService("ReplicatedStorage"), "MovementCombat", "MovementCombatConfig").MovementCombatConfig
local DashGate = TS.import(script, game:GetService("ServerScriptService"), "MovementCombatDashGate").DashGate
local function expect(condition, message)
	local _condition = condition
	local _arg1 = "MovementCombatTests failed: " .. message
	assert(_condition, _arg1)
end
--* In-memory server-contract stress harness. Invoke with require(MovementCombatTests).Run(). 
local function Run()
	local now = 0
	local issued = 0
	local gate = DashGate.new(MovementCombatConfig.DashCooldown, function()
		issued += 1
		return "nonce-" .. tostring(issued)
	end)
	local responses = {}
	local highestRequestId = 0
	local dashExecutions = 0
	local request = function(requestId, nonce, at)
		now = at
		local _requestId = requestId
		local cached = responses[_requestId]
		if cached ~= nil then
			return { cached, true }
		end
		if requestId <= highestRequestId then
			local stale = {
				accepted = false,
				reason = "StaleRequest",
			}
			local _requestId_1 = requestId
			responses[_requestId_1] = stale
			return { stale, false }
		end
		highestRequestId = requestId
		local _binding = gate:consume(nonce, now)
		local accepted = _binding[1]
		local reason = _binding[2]
		local result = {
			accepted = accepted,
			reason = reason,
		}
		local _requestId_1 = requestId
		responses[_requestId_1] = result
		if accepted then
			dashExecutions += 1
		end
		return { result, false }
	end
	local firstNonce = gate:issue(now)
	expect(firstNonce == "nonce-1", "first nonce was not issued")
	local _binding = request(1, firstNonce, now)
	local first = _binding[1]
	local replay = _binding[2]
	expect(first.accepted and not replay, "first request was not accepted")
	do
		local index = 0
		local _shouldIncrement = false
		while true do
			if _shouldIncrement then
				index += 1
			else
				_shouldIncrement = true
			end
			if not (index < MovementCombatConfig.Debug.StressRequestCount) then
				break
			end
			local _binding_1 = request(1, firstNonce, now)
			local duplicate = _binding_1[1]
			local duplicateReplay = _binding_1[2]
			expect(duplicate.accepted and duplicateReplay, "duplicate request did not return the cached acceptance")
		end
	end
	expect(dashExecutions == 1, "duplicate request IDs started more than one dash")
	local rejected = 0
	do
		local requestId = 2
		local _shouldIncrement = false
		while true do
			if _shouldIncrement then
				requestId += 1
			else
				_shouldIncrement = true
			end
			if not (requestId <= MovementCombatConfig.Debug.StressRequestCount + 1) then
				break
			end
			local _binding_1 = request(requestId, firstNonce, now)
			local result = _binding_1[1]
			if not result.accepted then
				rejected += 1
			end
		end
	end
	expect(rejected == MovementCombatConfig.Debug.StressRequestCount, "unique spam requests were not all rejected")
	expect(dashExecutions == 1, "unique spam requests started more than one dash")
	now = MovementCombatConfig.DashCooldown
	local secondNonce = gate:issue(now)
	expect(secondNonce == "nonce-2", "cooldown did not issue a fresh nonce")
	local delayedId = MovementCombatConfig.Debug.StressRequestCount + 2
	local freshId = delayedId + 1
	local _binding_1 = request(delayedId, firstNonce, now + 0.25)
	local delayed = _binding_1[1]
	expect(not delayed.accepted and delayed.reason == "InvalidDashNonce", "old delayed request was accepted")
	local _binding_2 = request(freshId, secondNonce, now + 0.25)
	local second = _binding_2[1]
	expect(second.accepted, "fresh post-cooldown request was rejected")
	expect(dashExecutions == 2, "fresh request did not start exactly one new dash")
	responses[50] = nil
	local _binding_3 = request(50, secondNonce, now + 0.25)
	local stale = _binding_3[1]
	expect(not stale.accepted and stale.reason == "StaleRequest", "out-of-order request was not rejected")
	local comboStep = 0
	local lastHitAt = 0
	local chooseComboStep = function(actionStartedAt)
		local nextStep = (comboStep % 3) + 1
		local timing = MovementCombatConfig.PunchTimings[nextStep]
		local continues = lastHitAt > 0 and actionStartedAt + timing.Impact - lastHitAt <= MovementCombatConfig.ComboWindow
		return if continues then nextStep else 1
	end
	local firstStep = chooseComboStep(0)
	expect(firstStep == 1, "first combo hit was not step 1")
	local firstImpact = MovementCombatConfig.PunchTimings[1].Impact
	comboStep = 1
	lastHitAt = firstImpact
	local secondStartedAt = MovementCombatConfig.PunchTimings[1].Duration
	local secondStep = chooseComboStep(secondStartedAt)
	expect(secondStep == 2, "second landed combo hit did not continue")
	local secondImpact = secondStartedAt + MovementCombatConfig.PunchTimings[2].Impact
	comboStep = 2
	lastHitAt = secondImpact
	local thirdStartedAt = secondStartedAt + MovementCombatConfig.PunchTimings[2].Duration
	local thirdStep = chooseComboStep(thirdStartedAt)
	expect(thirdStep == 3, "third landed combo hit did not continue")
	local thirdImpact = thirdStartedAt + MovementCombatConfig.PunchTimings[3].Impact
	expect(thirdImpact - secondImpact <= MovementCombatConfig.ComboWindow, "third impact falls outside the one-second combo window")
	comboStep = 3
	lastHitAt = thirdImpact
	local resetStep = chooseComboStep(thirdImpact + 1.001)
	expect(resetStep == 1, "combo did not reset after one second without a landed follow-up")
	return {
		passed = true,
		dashExecutions = dashExecutions,
		rejectedSpam = rejected,
		issuedNonces = issued,
		comboWindow = MovementCombatConfig.ComboWindow,
		thirdImpactGap = thirdImpact - secondImpact,
	}
end
return {
	Run = Run,
}
