-- Compiled with roblox-ts v3.0.0
local DashGate
do
	DashGate = setmetatable({}, {
		__tostring = function()
			return "DashGate"
		end,
	})
	DashGate.__index = DashGate
	function DashGate.new(...)
		local self = setmetatable({}, DashGate)
		return self:constructor(...) or self
	end
	function DashGate:constructor(cooldown, nonceFactory)
		self.cooldown = cooldown
		self.nonceFactory = nonceFactory
		self.nextReadyAt = 0
	end
	function DashGate:reset(now)
		if now == nil then
			now = 0
		end
		self.currentNonce = nil
		self.nextReadyAt = now
	end
	function DashGate:issue(now)
		if self.currentNonce ~= nil or now < self.nextReadyAt then
			return nil
		end
		self.currentNonce = self.nonceFactory()
		return self.currentNonce
	end
	function DashGate:consume(nonce, now)
		if now < self.nextReadyAt then
			return { false, "DashCooldown" }
		end
		if self.currentNonce == nil then
			return { false, "DashNotReady" }
		end
		local _nonce = nonce
		local _condition = not (type(_nonce) == "string")
		if not _condition then
			_condition = nonce ~= self.currentNonce
		end
		if _condition then
			return { false, "InvalidDashNonce" }
		end
		self.currentNonce = nil
		self.nextReadyAt = now + self.cooldown
		return { true, nil }
	end
	function DashGate:getNonce()
		return self.currentNonce
	end
	function DashGate:getReadyAt()
		return self.nextReadyAt
	end
end
return {
	DashGate = DashGate,
}
