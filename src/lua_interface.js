(function () {
	let _GLOBAL;
	if (window) {
		_GLOBAL = window;
	} else if (global) {
		_GLOBAL = global;
	}

	function importFromC(arr) {
		const target = {};
		const funcRegex = /^(js)?lua_/;
		arr.forEach(function (value) {
			target[value[0].replace(funcRegex, "")] = Module.cwrap(value[0], value[1], value[2]);
		});
		return target;
	}

	const eventEmitter = new EventTarget();

	let luaNative = undefined;

	const lua_state_tbl = {};

	const luaTypes = {
		nil: 0,
		bool: 1,
		boolean: 1,
		lightuserdata: 2,
		number: 3,
		string: 4,
		table: 5,
		function: 6,
		userdata: 7,
		thread: 8,
		coroutine: 8
	};

	const luaJSDataTypes = {
		unknown: 0,
		function: 1,
		array: 2,
		object: 3
	};

	const luaConstants = {
		LUA_REGISTRYINDEX: -10000,
		LUA_ENVIRONINDEX: -10001,
		LUA_GLOBALSINDEX: -10002,
		LUA_RIDX_GLOBALS: 2
	};

	function decodeSingle(state, pos, convertArgs) {
		switch (luaNative.type(state, pos)) {
			case luaTypes.nil:
				return undefined;
			case luaTypes.number:
				return luaNative.tonumber(state, pos);
			case luaTypes.string:
				return luaNative.tostring(state, pos);
			case luaTypes.table:
				const tbl = new LuaTable(state, luaNative.toref(state, pos));
				if (convertArgs) {
					const ret = tbl.toObject(true, true);
					tbl.unref();
					return ret;
				}
				return tbl;
			case luaTypes.userdata:
				return luaPassedVars[luaNative.pop_jsvar(state, pos)][0];
			case luaTypes.function:
				const ret = new LuaFunction(state, luaNative.toref(state, pos));
				if (convertArgs) {
					return ret.getClosure();
				}
				return ret;
			default:
				if (convertArgs) {
					return undefined;
				}
				return new LuaReference(state, luaNative.toref(state, pos));
		}
	}

	function decodeStack(state, stack_size, convertArgs) {
		const ret = [];
		for (let i = 0; i < stack_size; i++) {
			ret.unshift(decodeSingle(state, -1, convertArgs));
			luaNative.pop(state, 1);
		}
		return ret;
	}

	let luaLastRefIdx = -1;
	const luaPassedVars = {};
	luaPassedVars[-1] = [_GLOBAL, -1];

	function luaGetVarPtr(varObj) {
		for (const idx in luaPassedVars) {
			const ptr = luaPassedVars[idx];
			if (ptr[0] == varObj) {
				if (ptr[1] > 0) {
					ptr[1]++;
				}
				return idx;
			}
		}

		luaPassedVars[++luaLastRefIdx] = [varObj, 1];
		return luaLastRefIdx;
	}

	Module.__luaRemoveVarPtr = function luaRemoveVarPtr(varPtr) {
		const refCounter = luaPassedVars[varPtr][1];

		if (refCounter > 1) {
			luaPassedVars[varPtr][1]--;
		} else if (refCounter >= 0) {
			delete luaPassedVars[varPtr];
		}
	}

	function pushVar(state, arg, ref) {
		if (arg === null || arg === undefined) {
			luaNative.pushnil(state);
			return;
		}

		switch (typeof arg) {
			case "boolean":
				luaNative.push_boolean(state, arg ? 1 : 0);
				break;
			case "number":
				luaNative.push_number(state, arg);
				break;
			case "string":
				luaNative.push_string(state, arg);
				break;
			case "function":
				luaNative.push_jsvar(state, luaGetVarPtr(arg, ref), luaJSDataTypes.function);
				break;
			case "object":
				if (arg instanceof LuaReference) {
					arg.push(state);
				} else if (arg instanceof Array) {
					luaNative.push_jsvar(state, luaGetVarPtr(arg, ref), luaJSDataTypes.array);
				} else {
					luaNative.push_jsvar(state, luaGetVarPtr(arg, ref), luaJSDataTypes.object);
				}
				break;
			default:
				throw new LuaError("Unhandled value push: " + arg);
		}
	}

	function getVarByRef(index) {
		return luaPassedVars[index][0];
	}

	function luaCallFunction(func, state, stack_size, convertArgs) {
		let variables, funcThis;

		if (stack_size > 0) {
			variables = decodeStack(state, stack_size, convertArgs);
			funcThis = variables[0];
			variables = variables.slice(1);
		} else {
			funcThis = undefined;
			variables = [];
		}

		pushVar(state, func.apply(funcThis, variables));
	}

	Module.__luaCallFunctionPointer = function luaCallFunctionPointer(funcPtr, state, stack_size, convertArgs) {
		const varPtr = luaPassedVars[funcPtr];
		return luaCallFunction(varPtr[0], state, stack_size, convertArgs);
	}

	function initializeCFuncs() {
		luaNative = importFromC([
			["jslua_execute", "number", ["number", "string"]],
			["jslua_call", "number", ["number", "number"]],
			["lua_settop", "", ["number", "number"]],
			["lua_gettop", "number", ["number"]],
			["lua_type", "number", ["number", "number"]],
			["jslua_new_state", "number", []],
			["jslua_delete_state", "", ["number"]],
			["jslua_pop_string", "string", ["number"]],
			["jslua_push_string", "", ["number", "string"]],
			["jslua_pop_number", "number", ["number"]],
			["jslua_push_number", "", ["number", "number"]],
			["jslua_push_jsvar", "", ["number", "number", "number"]],
			["jslua_pop_jsvar", "", ["number", "number"]],
			["lua_gettable", "", ["number", "number"]],
			["lua_settable", "", ["number", "number"]],
			["jslua_toref", "number", ["number", "number"]],
			["jslua_push_ref", "", ["number", "number"]],
			["jslua_unref", "", ["number", "number"]],
			["lua_createtable", "", ["number"]],
			["lua_pushvalue", "", ["number", "number"]],
			["lua_pushnil", "", ["number"]],
			["lua_next", "", ["number", "number"]],
			["lua_tolstring", "string", ["number", "number", "number"]],
			["lua_tonumberx", "number", ["number", "number", "number"]],
			["lua_getmetatable", "number", ["number", "number"]],
			["lua_setmetatable", "number", ["number", "number"]],
			["lua_rawseti", "", ["number", "number"]],
			["lua_rawset", "", ["number", "number"]],
		]);

		_GLOBAL.LuaJS.__luaNative = luaNative;

		luaNative.pop = function pop(state, n) {
			luaNative.settop(state, -n - 1);
		}

		luaNative.pop_ref = function pop_ref(state) {
			const ref = luaNative.toref(state, -1);
			luaNative.pop(state, 1);
			return ref;
		}

		luaNative.tostring = function tostring(a, b) {
			return luaNative.tolstring(a, b, 0);
		}

		luaNative.tonumber = function tonumber(state, i) {
			return luaNative.tonumberx(state, i, 0);
		}

		eventEmitter.dispatchEvent(new Event("ready"));
	}

	function luaUnref(objectRef) {
		const index =  objectRef.index;
		const state = objectRef.state;
		objectRef.state = undefined;
		objectRef.index = undefined;
		if (state === undefined || index === undefined) {
			return;
		}

		const oldRef = lua_state_tbl[state].refArray[index];
		if (!oldRef) {
			return;
		}
		if (oldRef !== objectRef) {
			return;
		}

		luaNative.unref(state, index);
		delete lua_state_tbl[state].refArray[index];
	}

	const luaRefFinalizer = new FinalizationRegistry(luaUnref);

	class LuaError extends Error {

	}

	class LuaReference {
		constructor(state, index) {
			this.refObj = {
				state,
				index,
			};
			this.state = state;
	
			const oldRef = lua_state_tbl[state].refArray[index];
			if (oldRef) {
				luaUnref(oldRef);
			}
			lua_state_tbl[state].refArray[index] = this.refObj;
	
			luaRefFinalizer.register(this, this.refObj, this);
		}

		unref() {
			luaUnref(this.refObj);
			luaRefFinalizer.unregister(this);
		}

		push(state) {
			if (state && state != this.refObj.state) {
				throw new Error("Wrong Lua state");
			}
			luaNative.push_ref(this.refObj.state, this.refObj.index);
		}

		getmetatable() {
			this.push();
			luaNative.getmetatable(this.refObj.state, -1);
			const ret = decodeSingle(this.refObj.state, -1);
			luaNative.pop(this.refObj.state, 1);
			return ret;
		}
	
		setmetatable() {
			this.push();
			luaNative.setmetatable(this.refObj.state, -1);
			luaNative.pop(this.refObj.state, 1);
		}
	}

	class LuaFunction  extends LuaReference {
		getClosure() {
			const ret = () => {
				LuaFunction.prototype.call.apply(func, arguments);
			};
			ret._LuaFunction = func;
			return ret;
		}

		call() {
			this.push(this.state);
	
			for (let i = 0; i < arguments.length; i++) {
				try {
					pushVar(this.state, arguments[i])
				} catch (e) {
					for (; i >= 0; i--) {
						luaNative.pop(this.state, 1);
					}
					throw e;
				}
			}
	
			const stack = luaNative.call(this.state, arguments.length);
			const ret = decodeStack(this.state, Math.abs(stack));
			if (stack < 0) {
				throw new LuaError(ret[0]);
			}
	
			return ret;
		}
	}

	class LuaTable extends LuaReference {
		set(key, value) {
			this.push();
			pushVar(this.state, key);
			pushVar(this.state, value);
			luaNative.settable(this.state, -3);
			luaNative.pop(this.state, 1);
	
		}
	
		get(key) {
			this.push();
			pushVar(this.state, key);
			luaNative.gettable(this.state, -2);
			const ret = decodeSingle(this.state, -1);
			luaNative.pop(this.state, 2);
			return ret;
		}
	
		toObject(recurse, unrefAll, maxDepth) {
			this.push();
			luaNative.pushnil(this.state);
			const ret = {};
			while (luaNative.next(this.state, -2)) {
				luaNative.pushvalue(this.state, -2);
				const key = luaNative.tostring(this.state, -1);
				const value = decodeSingle(this.state, -2);
				ret[key] = value;
				luaNative.pop(this.state, 2);
			}
			luaNative.pop(this.state, 1);
	
			if (!maxDepth) {
				maxDepth = 10;
			}
	
			if (recurse) {
				maxDepth--;
	
				for (const idx of Object.keys(ret)) {
					const val = ret[idx];
					if (val instanceof LuaTable && maxDepth > 0) {
						ret[idx] = val.toObject(true, unrefAll, maxDepth);
						val.unref();
					} else if (unrefAll && val instanceof LuaReference) {
						val.unref();
						delete ret[idx];
					}
				}
			}
	
			return ret;
		}
	}

	class LuaState {
		constructor() {
			this.state = luaNative.new_state();
			this.refArray = {};
			lua_state_tbl[this.state] = this;
	
			this.run("dofile('/lua/init.lua')");
		}

		unrefAll() {
			for (ref of this.refArray) {
				luaUnref(ref);
			}
			this.refArray = {};
		}

		close() {
			this.unrefAll();
			luaNative.delete_state(this.state);
			delete lua_state_tbl[this.state];
			this.state = undefined;
		}

		run(code) {
			const stack = luaNative.execute(this.state, code);
			const ret = decodeStack(this.state, Math.abs(stack));
			if (stack < 0) {
				throw new LuaError(ret[0]);
			}
			return ret;
		}

		getGlobalTable() {
			return new LuaTable(this.state, luaConstants.LUA_RIDX_GLOBALS);
		}

		createTable() {
			luaNative.createtable(this.state, 0, 0);
			return new LuaTable(this.state, luaNative.pop_ref(this.state));
		}

		async __runNode(node) {
			let code = node.textContent;
			if (node.src) {
				const res = await fetch(node.src);
				code = await res.text();
			}
			this.run(code);
		}

		async __tryRunNode(node) {
			try {
				await this.__runNode(node);
			} catch (e) {
				console.error("Error loading script from", node, e);
			}
		}

		async loadDocumentScripts(doc) {
			const xPathResult = document.evaluate('//script[@type="text/lua"]', doc, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
			const scriptPromises = [];

			let node;
			while (node = xPathResult.iterateNext()) {
				await this.__tryRunNode(node);
			}
		}

		listenForScripts(doc) {
			const observer = new MutationObserver(async (mutations) => {
				for (const mutation of mutations)  {
					if (mutation.type !== "childList") {
						continue;
					}

					for (const node of mutation.addedNodes) {
						if (!(node instanceof HTMLScriptElement)) {
							continue;
						}

						if (!node.type) {
							continue;
						}

						if (node.type.toLowerCase() !== "text/lua") {
							continue;
						}

						await this.__tryRunNode(node);
					}
				}
			});

			observer.observe(doc, {
				childList: true,
				subtree: true
			});
		}
	}

	_GLOBAL.LuaJS = {
		State: LuaState,
		Function: LuaFunction,
		Table: LuaTable,
		Reference: LuaReference,

		addEventListener: eventEmitter.addEventListener.bind(eventEmitter),
		removeEventListener: eventEmitter.removeEventListener.bind(eventEmitter),

		__luaNative: luaNative,
		__pushVar: pushVar,
		__getVarByRef: getVarByRef,
		__decodeSingle: decodeSingle,
		__onready: initializeCFuncs,
	};
})();
