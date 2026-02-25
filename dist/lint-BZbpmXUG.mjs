import crypto$1 from "crypto";
import fs from "fs";
import path from "path";
import { execSync, spawn } from "node:child_process";
import { existsSync, globSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import process$1 from "node:process";

//#region node_modules/.pnpm/hookified@1.15.1/node_modules/hookified/dist/node/index.js
var Eventified = class {
	_eventListeners;
	_maxListeners;
	_logger;
	_throwOnEmitError = false;
	_throwOnEmptyListeners = false;
	_errorEvent = "error";
	constructor(options) {
		this._eventListeners = /* @__PURE__ */ new Map();
		this._maxListeners = 100;
		this._logger = options?.logger;
		if (options?.throwOnEmitError !== void 0) this._throwOnEmitError = options.throwOnEmitError;
		if (options?.throwOnEmptyListeners !== void 0) this._throwOnEmptyListeners = options.throwOnEmptyListeners;
	}
	/**
	* Gets the logger
	* @returns {Logger}
	*/
	get logger() {
		return this._logger;
	}
	/**
	* Sets the logger
	* @param {Logger} logger
	*/
	set logger(logger) {
		this._logger = logger;
	}
	/**
	* Gets whether an error should be thrown when an emit throws an error. Default is false and only emits an error event.
	* @returns {boolean}
	*/
	get throwOnEmitError() {
		return this._throwOnEmitError;
	}
	/**
	* Sets whether an error should be thrown when an emit throws an error. Default is false and only emits an error event.
	* @param {boolean} value
	*/
	set throwOnEmitError(value) {
		this._throwOnEmitError = value;
	}
	/**
	* Gets whether an error should be thrown when emitting 'error' event with no listeners. Default is false.
	* @returns {boolean}
	*/
	get throwOnEmptyListeners() {
		return this._throwOnEmptyListeners;
	}
	/**
	* Sets whether an error should be thrown when emitting 'error' event with no listeners. Default is false.
	* @param {boolean} value
	*/
	set throwOnEmptyListeners(value) {
		this._throwOnEmptyListeners = value;
	}
	/**
	* Adds a handler function for a specific event that will run only once
	* @param {string | symbol} eventName
	* @param {EventListener} listener
	* @returns {IEventEmitter} returns the instance of the class for chaining
	*/
	once(eventName, listener) {
		const onceListener = (...arguments_) => {
			this.off(eventName, onceListener);
			listener(...arguments_);
		};
		this.on(eventName, onceListener);
		return this;
	}
	/**
	* Gets the number of listeners for a specific event. If no event is provided, it returns the total number of listeners
	* @param {string} eventName The event name. Not required
	* @returns {number} The number of listeners
	*/
	listenerCount(eventName) {
		if (eventName === void 0) return this.getAllListeners().length;
		const listeners = this._eventListeners.get(eventName);
		return listeners ? listeners.length : 0;
	}
	/**
	* Gets an array of event names
	* @returns {Array<string | symbol>} An array of event names
	*/
	eventNames() {
		return [...this._eventListeners.keys()];
	}
	/**
	* Gets an array of listeners for a specific event. If no event is provided, it returns all listeners
	* @param {string} [event] (Optional) The event name
	* @returns {EventListener[]} An array of listeners
	*/
	rawListeners(event) {
		if (event === void 0) return this.getAllListeners();
		return this._eventListeners.get(event) ?? [];
	}
	/**
	* Prepends a listener to the beginning of the listeners array for the specified event
	* @param {string | symbol} eventName
	* @param {EventListener} listener
	* @returns {IEventEmitter} returns the instance of the class for chaining
	*/
	prependListener(eventName, listener) {
		const listeners = this._eventListeners.get(eventName) ?? [];
		listeners.unshift(listener);
		this._eventListeners.set(eventName, listeners);
		return this;
	}
	/**
	* Prepends a one-time listener to the beginning of the listeners array for the specified event
	* @param {string | symbol} eventName
	* @param {EventListener} listener
	* @returns {IEventEmitter} returns the instance of the class for chaining
	*/
	prependOnceListener(eventName, listener) {
		const onceListener = (...arguments_) => {
			this.off(eventName, onceListener);
			listener(...arguments_);
		};
		this.prependListener(eventName, onceListener);
		return this;
	}
	/**
	* Gets the maximum number of listeners that can be added for a single event
	* @returns {number} The maximum number of listeners
	*/
	maxListeners() {
		return this._maxListeners;
	}
	/**
	* Adds a listener for a specific event. It is an alias for the on() method
	* @param {string | symbol} event
	* @param {EventListener} listener
	* @returns {IEventEmitter} returns the instance of the class for chaining
	*/
	addListener(event, listener) {
		this.on(event, listener);
		return this;
	}
	/**
	* Adds a listener for a specific event
	* @param {string | symbol} event
	* @param {EventListener} listener
	* @returns {IEventEmitter} returns the instance of the class for chaining
	*/
	on(event, listener) {
		if (!this._eventListeners.has(event)) this._eventListeners.set(event, []);
		const listeners = this._eventListeners.get(event);
		if (listeners) {
			if (listeners.length >= this._maxListeners) console.warn(`MaxListenersExceededWarning: Possible event memory leak detected. ${listeners.length + 1} ${event} listeners added. Use setMaxListeners() to increase limit.`);
			listeners.push(listener);
		}
		return this;
	}
	/**
	* Removes a listener for a specific event. It is an alias for the off() method
	* @param {string | symbol} event
	* @param {EventListener} listener
	* @returns {IEventEmitter} returns the instance of the class for chaining
	*/
	removeListener(event, listener) {
		this.off(event, listener);
		return this;
	}
	/**
	* Removes a listener for a specific event
	* @param {string | symbol} event
	* @param {EventListener} listener
	* @returns {IEventEmitter} returns the instance of the class for chaining
	*/
	off(event, listener) {
		const listeners = this._eventListeners.get(event) ?? [];
		const index = listeners.indexOf(listener);
		if (index !== -1) listeners.splice(index, 1);
		if (listeners.length === 0) this._eventListeners.delete(event);
		return this;
	}
	/**
	* Calls all listeners for a specific event
	* @param {string | symbol} event
	* @param arguments_ The arguments to pass to the listeners
	* @returns {boolean} Returns true if the event had listeners, false otherwise
	*/
	emit(event, ...arguments_) {
		let result = false;
		const listeners = this._eventListeners.get(event);
		if (listeners && listeners.length > 0) for (const listener of listeners) {
			listener(...arguments_);
			result = true;
		}
		if (event === this._errorEvent) {
			const error = arguments_[0] instanceof Error ? arguments_[0] : /* @__PURE__ */ new Error(`${arguments_[0]}`);
			if (this._throwOnEmitError && !result) throw error;
			else if (this.listeners(this._errorEvent).length === 0 && this._throwOnEmptyListeners === true) throw error;
		}
		this.sendLog(event, arguments_);
		return result;
	}
	/**
	* Gets all listeners for a specific event. If no event is provided, it returns all listeners
	* @param {string} [event] (Optional) The event name
	* @returns {EventListener[]} An array of listeners
	*/
	listeners(event) {
		return this._eventListeners.get(event) ?? [];
	}
	/**
	* Removes all listeners for a specific event. If no event is provided, it removes all listeners
	* @param {string} [event] (Optional) The event name
	* @returns {IEventEmitter} returns the instance of the class for chaining
	*/
	removeAllListeners(event) {
		if (event !== void 0) this._eventListeners.delete(event);
		else this._eventListeners.clear();
		return this;
	}
	/**
	* Sets the maximum number of listeners that can be added for a single event
	* @param {number} n The maximum number of listeners
	* @returns {void}
	*/
	setMaxListeners(n) {
		this._maxListeners = n;
		for (const listeners of this._eventListeners.values()) if (listeners.length > n) listeners.splice(n);
	}
	/**
	* Gets all listeners
	* @returns {EventListener[]} An array of listeners
	*/
	getAllListeners() {
		let result = [];
		for (const listeners of this._eventListeners.values()) result = [...result, ...listeners];
		return result;
	}
	/**
	* Sends a log message using the configured logger based on the event name
	* @param {string | symbol} eventName - The event name that determines the log level
	* @param {unknown} data - The data to log
	*/
	sendLog(eventName, data) {
		if (!this._logger) return;
		let message;
		if (typeof data === "string") message = data;
		else if (Array.isArray(data) && data.length > 0 && data[0] instanceof Error) message = data[0].message;
		else if (data instanceof Error) message = data.message;
		else if (Array.isArray(data) && data.length > 0 && typeof data[0]?.message === "string") message = data[0].message;
		else message = JSON.stringify(data);
		switch (eventName) {
			case "error":
				this._logger.error?.(message, {
					event: eventName,
					data
				});
				break;
			case "warn":
				this._logger.warn?.(message, {
					event: eventName,
					data
				});
				break;
			case "trace":
				this._logger.trace?.(message, {
					event: eventName,
					data
				});
				break;
			case "debug":
				this._logger.debug?.(message, {
					event: eventName,
					data
				});
				break;
			case "fatal":
				this._logger.fatal?.(message, {
					event: eventName,
					data
				});
				break;
			default:
				this._logger.info?.(message, {
					event: eventName,
					data
				});
				break;
		}
	}
};
var Hookified = class extends Eventified {
	_hooks;
	_throwOnHookError = false;
	_enforceBeforeAfter = false;
	_deprecatedHooks;
	_allowDeprecated = true;
	constructor(options) {
		super({
			logger: options?.logger,
			throwOnEmitError: options?.throwOnEmitError,
			throwOnEmptyListeners: options?.throwOnEmptyListeners
		});
		this._hooks = /* @__PURE__ */ new Map();
		this._deprecatedHooks = options?.deprecatedHooks ? new Map(options.deprecatedHooks) : /* @__PURE__ */ new Map();
		if (options?.throwOnHookError !== void 0) this._throwOnHookError = options.throwOnHookError;
		else if (options?.throwHookErrors !== void 0) this._throwOnHookError = options.throwHookErrors;
		if (options?.enforceBeforeAfter !== void 0) this._enforceBeforeAfter = options.enforceBeforeAfter;
		if (options?.allowDeprecated !== void 0) this._allowDeprecated = options.allowDeprecated;
	}
	/**
	* Gets all hooks
	* @returns {Map<string, Hook[]>}
	*/
	get hooks() {
		return this._hooks;
	}
	/**
	* Gets whether an error should be thrown when a hook throws an error. Default is false and only emits an error event.
	* @returns {boolean}
	* @deprecated - this will be deprecated in version 2. Please use throwOnHookError.
	*/
	get throwHookErrors() {
		return this._throwOnHookError;
	}
	/**
	* Sets whether an error should be thrown when a hook throws an error. Default is false and only emits an error event.
	* @param {boolean} value
	* @deprecated - this will be deprecated in version 2. Please use throwOnHookError.
	*/
	set throwHookErrors(value) {
		this._throwOnHookError = value;
	}
	/**
	* Gets whether an error should be thrown when a hook throws an error. Default is false and only emits an error event.
	* @returns {boolean}
	*/
	get throwOnHookError() {
		return this._throwOnHookError;
	}
	/**
	* Sets whether an error should be thrown when a hook throws an error. Default is false and only emits an error event.
	* @param {boolean} value
	*/
	set throwOnHookError(value) {
		this._throwOnHookError = value;
	}
	/**
	* Gets whether to enforce that all hook names start with 'before' or 'after'. Default is false.
	* @returns {boolean}
	* @default false
	*/
	get enforceBeforeAfter() {
		return this._enforceBeforeAfter;
	}
	/**
	* Sets whether to enforce that all hook names start with 'before' or 'after'. Default is false.
	* @param {boolean} value
	*/
	set enforceBeforeAfter(value) {
		this._enforceBeforeAfter = value;
	}
	/**
	* Gets the map of deprecated hook names to deprecation messages.
	* @returns {Map<string, string>}
	*/
	get deprecatedHooks() {
		return this._deprecatedHooks;
	}
	/**
	* Sets the map of deprecated hook names to deprecation messages.
	* @param {Map<string, string>} value
	*/
	set deprecatedHooks(value) {
		this._deprecatedHooks = value;
	}
	/**
	* Gets whether deprecated hooks are allowed to be registered and executed. Default is true.
	* @returns {boolean}
	*/
	get allowDeprecated() {
		return this._allowDeprecated;
	}
	/**
	* Sets whether deprecated hooks are allowed to be registered and executed. Default is true.
	* @param {boolean} value
	*/
	set allowDeprecated(value) {
		this._allowDeprecated = value;
	}
	/**
	* Validates hook event name if enforceBeforeAfter is enabled
	* @param {string} event - The event name to validate
	* @throws {Error} If enforceBeforeAfter is true and event doesn't start with 'before' or 'after'
	*/
	validateHookName(event) {
		if (this._enforceBeforeAfter) {
			const eventValue = event.trim().toLocaleLowerCase();
			if (!eventValue.startsWith("before") && !eventValue.startsWith("after")) throw new Error(`Hook event "${event}" must start with "before" or "after" when enforceBeforeAfter is enabled`);
		}
	}
	/**
	* Checks if a hook is deprecated and emits a warning if it is
	* @param {string} event - The event name to check
	* @returns {boolean} - Returns true if the hook should proceed, false if it should be blocked
	*/
	checkDeprecatedHook(event) {
		if (this._deprecatedHooks.has(event)) {
			const message = this._deprecatedHooks.get(event);
			const warningMessage = `Hook "${event}" is deprecated${message ? `: ${message}` : ""}`;
			this.emit("warn", {
				hook: event,
				message: warningMessage
			});
			return this._allowDeprecated;
		}
		return true;
	}
	/**
	* Adds a handler function for a specific event
	* @param {string} event
	* @param {Hook} handler - this can be async or sync
	* @returns {void}
	*/
	onHook(event, handler) {
		this.onHookEntry({
			event,
			handler
		});
	}
	/**
	* Adds a handler function for a specific event
	* @param {HookEntry} hookEntry
	* @returns {void}
	*/
	onHookEntry(hookEntry) {
		this.validateHookName(hookEntry.event);
		if (!this.checkDeprecatedHook(hookEntry.event)) return;
		const eventHandlers = this._hooks.get(hookEntry.event);
		if (eventHandlers) eventHandlers.push(hookEntry.handler);
		else this._hooks.set(hookEntry.event, [hookEntry.handler]);
	}
	/**
	* Alias for onHook. This is provided for compatibility with other libraries that use the `addHook` method.
	* @param {string} event
	* @param {Hook} handler - this can be async or sync
	* @returns {void}
	*/
	addHook(event, handler) {
		this.onHookEntry({
			event,
			handler
		});
	}
	/**
	* Adds a handler function for a specific event
	* @param {Array<HookEntry>} hooks
	* @returns {void}
	*/
	onHooks(hooks) {
		for (const hook of hooks) this.onHook(hook.event, hook.handler);
	}
	/**
	* Adds a handler function for a specific event that runs before all other handlers
	* @param {string} event
	* @param {Hook} handler - this can be async or sync
	* @returns {void}
	*/
	prependHook(event, handler) {
		this.validateHookName(event);
		if (!this.checkDeprecatedHook(event)) return;
		const eventHandlers = this._hooks.get(event);
		if (eventHandlers) eventHandlers.unshift(handler);
		else this._hooks.set(event, [handler]);
	}
	/**
	* Adds a handler that only executes once for a specific event before all other handlers
	* @param event
	* @param handler
	*/
	prependOnceHook(event, handler) {
		this.validateHookName(event);
		if (!this.checkDeprecatedHook(event)) return;
		const hook = async (...arguments_) => {
			this.removeHook(event, hook);
			return handler(...arguments_);
		};
		this.prependHook(event, hook);
	}
	/**
	* Adds a handler that only executes once for a specific event
	* @param event
	* @param handler
	*/
	onceHook(event, handler) {
		this.validateHookName(event);
		if (!this.checkDeprecatedHook(event)) return;
		const hook = async (...arguments_) => {
			this.removeHook(event, hook);
			return handler(...arguments_);
		};
		this.onHook(event, hook);
	}
	/**
	* Removes a handler function for a specific event
	* @param {string} event
	* @param {Hook} handler
	* @returns {void}
	*/
	removeHook(event, handler) {
		this.validateHookName(event);
		if (!this.checkDeprecatedHook(event)) return;
		const eventHandlers = this._hooks.get(event);
		if (eventHandlers) {
			const index = eventHandlers.indexOf(handler);
			if (index !== -1) eventHandlers.splice(index, 1);
		}
	}
	/**
	* Removes all handlers for a specific event
	* @param {Array<HookEntry>} hooks
	* @returns {void}
	*/
	removeHooks(hooks) {
		for (const hook of hooks) this.removeHook(hook.event, hook.handler);
	}
	/**
	* Calls all handlers for a specific event
	* @param {string} event
	* @param {T[]} arguments_
	* @returns {Promise<void>}
	*/
	async hook(event, ...arguments_) {
		this.validateHookName(event);
		if (!this.checkDeprecatedHook(event)) return;
		const eventHandlers = this._hooks.get(event);
		if (eventHandlers) for (const handler of eventHandlers) try {
			await handler(...arguments_);
		} catch (error) {
			const message = `${event}: ${error.message}`;
			this.emit("error", new Error(message));
			if (this._throwOnHookError) throw new Error(message);
		}
	}
	/**
	* Calls all synchronous handlers for a specific event.
	* Async handlers (declared with `async` keyword) are silently skipped.
	*
	* Note: The `hook` method is preferred as it executes both sync and async functions.
	* Use `hookSync` only when you specifically need synchronous execution.
	* @param {string} event
	* @param {T[]} arguments_
	* @returns {void}
	*/
	hookSync(event, ...arguments_) {
		this.validateHookName(event);
		if (!this.checkDeprecatedHook(event)) return;
		const eventHandlers = this._hooks.get(event);
		if (eventHandlers) for (const handler of eventHandlers) {
			if (handler.constructor.name === "AsyncFunction") continue;
			try {
				handler(...arguments_);
			} catch (error) {
				const message = `${event}: ${error.message}`;
				this.emit("error", new Error(message));
				if (this._throwOnHookError) throw new Error(message);
			}
		}
	}
	/**
	* Prepends the word `before` to your hook. Example is event is `test`, the before hook is `before:test`.
	* @param {string} event - The event name
	* @param {T[]} arguments_ - The arguments to pass to the hook
	*/
	async beforeHook(event, ...arguments_) {
		await this.hook(`before:${event}`, ...arguments_);
	}
	/**
	* Prepends the word `after` to your hook. Example is event is `test`, the after hook is `after:test`.
	* @param {string} event - The event name
	* @param {T[]} arguments_ - The arguments to pass to the hook
	*/
	async afterHook(event, ...arguments_) {
		await this.hook(`after:${event}`, ...arguments_);
	}
	/**
	* Calls all handlers for a specific event. This is an alias for `hook` and is provided for
	* compatibility with other libraries that use the `callHook` method.
	* @param {string} event
	* @param {T[]} arguments_
	* @returns {Promise<void>}
	*/
	async callHook(event, ...arguments_) {
		await this.hook(event, ...arguments_);
	}
	/**
	* Gets all hooks for a specific event
	* @param {string} event
	* @returns {Hook[]}
	*/
	getHooks(event) {
		this.validateHookName(event);
		if (!this.checkDeprecatedHook(event)) return;
		return this._hooks.get(event);
	}
	/**
	* Removes all hooks
	* @returns {void}
	*/
	clearHooks() {
		this._hooks.clear();
	}
};
/* v8 ignore next -- @preserve */

//#endregion
//#region node_modules/.pnpm/hashery@1.5.0/node_modules/hashery/dist/node/index.js
var Cache = class {
	_enabled = true;
	_maxSize = 4e3;
	_store = /* @__PURE__ */ new Map();
	_keys = [];
	constructor(options) {
		if (options?.enabled !== void 0) this._enabled = options.enabled;
		if (options?.maxSize !== void 0) this._maxSize = options.maxSize;
	}
	/**
	* Gets whether the cache is enabled.
	*/
	get enabled() {
		return this._enabled;
	}
	/**
	* Sets whether the cache is enabled.
	*/
	set enabled(value) {
		this._enabled = value;
	}
	/**
	* Gets the maximum number of items the cache can hold.
	*/
	get maxSize() {
		return this._maxSize;
	}
	/**
	* Sets the maximum number of items the cache can hold.
	*/
	set maxSize(value) {
		this._maxSize = value;
	}
	/**
	* Gets the underlying Map store.
	*/
	get store() {
		return this._store;
	}
	/**
	* Gets the current number of items in the cache.
	*/
	get size() {
		return this._store.size;
	}
	/**
	* Gets a value from the cache.
	* @param key - The cache key
	* @returns The cached value, or undefined if not found
	*/
	get(key) {
		return this._store.get(key);
	}
	/**
	* Sets a value in the cache with FIFO eviction.
	* If the cache is disabled, this method does nothing.
	* If the cache is at capacity, the oldest entry is removed before adding the new one.
	* @param key - The cache key
	* @param value - The value to cache
	*/
	set(key, value) {
		if (!this._enabled) return;
		if (this._store.has(key)) {
			this._store.set(key, value);
			return;
		}
		if (this._store.size >= this._maxSize) {
			const oldestKey = this._keys.shift();
			if (oldestKey) this._store.delete(oldestKey);
		}
		this._keys.push(key);
		this._store.set(key, value);
	}
	/**
	* Checks if a key exists in the cache.
	* @param key - The cache key
	* @returns True if the key exists, false otherwise
	*/
	has(key) {
		return this._store.has(key);
	}
	/**
	* Clears all entries from the cache.
	*/
	clear() {
		this._store.clear();
		this._keys = [];
	}
};
var CRC = class {
	get name() {
		return "crc32";
	}
	toHashSync(data) {
		let bytes;
		if (data instanceof Uint8Array) bytes = data;
		else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
		else if (data instanceof DataView) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
		else {
			const view = data;
			bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
		}
		const CRC32_POLYNOMIAL = 3988292384;
		let crc = 4294967295;
		for (let i = 0; i < bytes.length; i++) {
			crc = crc ^ bytes[i];
			for (let j = 0; j < 8; j++) crc = crc >>> 1 ^ CRC32_POLYNOMIAL & -(crc & 1);
		}
		crc = (crc ^ 4294967295) >>> 0;
		return crc.toString(16).padStart(8, "0");
	}
	async toHash(data) {
		return this.toHashSync(data);
	}
};
var WebCrypto = class {
	_algorithm = "SHA-256";
	constructor(options) {
		if (options?.algorithm) this._algorithm = options?.algorithm;
	}
	get name() {
		return this._algorithm;
	}
	async toHash(data) {
		const hashBuffer = await crypto.subtle.digest(this._algorithm, data);
		return Array.from(new Uint8Array(hashBuffer)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
	}
};
var DJB2 = class {
	/**
	* The name identifier for this hash provider.
	*/
	get name() {
		return "djb2";
	}
	/**
	* Computes the DJB2 hash of the provided data synchronously.
	*
	* @param data - The data to hash (Uint8Array, ArrayBuffer, or DataView)
	* @returns An 8-character lowercase hexadecimal string
	*
	* @example
	* ```typescript
	* const djb2 = new DJB2();
	* const data = new TextEncoder().encode('hello');
	* const hash = djb2.toHashSync(data);
	* console.log(hash); // "7c9df5ea"
	* ```
	*/
	toHashSync(data) {
		let bytes;
		if (data instanceof Uint8Array) bytes = data;
		else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
		else if (data instanceof DataView) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
		else {
			const view = data;
			bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
		}
		let hash = 5381;
		for (let i = 0; i < bytes.length; i++) {
			hash = (hash << 5) + hash + bytes[i];
			hash = hash >>> 0;
		}
		return hash.toString(16).padStart(8, "0");
	}
	/**
	* Computes the DJB2 hash of the provided data.
	*
	* @param data - The data to hash (Uint8Array, ArrayBuffer, or DataView)
	* @returns A Promise resolving to an 8-character lowercase hexadecimal string
	*
	* @example
	* ```typescript
	* const djb2 = new DJB2();
	* const data = new TextEncoder().encode('hello');
	* const hash = await djb2.toHash(data);
	* console.log(hash); // "7c9df5ea"
	* ```
	*/
	async toHash(data) {
		return this.toHashSync(data);
	}
};
var FNV1 = class {
	/**
	* The name identifier for this hash provider.
	*/
	get name() {
		return "fnv1";
	}
	/**
	* Computes the FNV-1 hash of the provided data synchronously.
	*
	* @param data - The data to hash (Uint8Array, ArrayBuffer, or DataView)
	* @returns An 8-character lowercase hexadecimal string
	*/
	toHashSync(data) {
		let bytes;
		if (data instanceof Uint8Array) bytes = data;
		else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
		else if (data instanceof DataView) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
		else {
			const view = data;
			bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
		}
		const FNV_OFFSET_BASIS = 2166136261;
		const FNV_PRIME = 16777619;
		let hash = FNV_OFFSET_BASIS;
		for (let i = 0; i < bytes.length; i++) {
			hash = hash * FNV_PRIME;
			hash = hash ^ bytes[i];
			hash = hash >>> 0;
		}
		return hash.toString(16).padStart(8, "0");
	}
	/**
	* Computes the FNV-1 hash of the provided data.
	*
	* @param data - The data to hash (Uint8Array, ArrayBuffer, or DataView)
	* @returns A Promise resolving to an 8-character lowercase hexadecimal string
	*/
	async toHash(data) {
		return this.toHashSync(data);
	}
};
var Murmur = class {
	_seed;
	/**
	* Creates a new Murmur instance.
	*
	* @param seed - Optional seed value for the hash (default: 0)
	*/
	constructor(seed = 0) {
		this._seed = seed >>> 0;
	}
	/**
	* The name identifier for this hash provider.
	*/
	get name() {
		return "murmur";
	}
	/**
	* Gets the current seed value used for hashing.
	*/
	get seed() {
		return this._seed;
	}
	/**
	* Computes the Murmur 32-bit hash of the provided data synchronously.
	*
	* @param data - The data to hash (Uint8Array, ArrayBuffer, or DataView)
	* @returns An 8-character lowercase hexadecimal string
	*
	* @example
	* ```typescript
	* const murmur = new Murmur();
	* const data = new TextEncoder().encode('hello');
	* const hash = murmur.toHashSync(data);
	* console.log(hash); // "248bfa47"
	* ```
	*/
	toHashSync(data) {
		let bytes;
		if (data instanceof Uint8Array) bytes = data;
		else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
		else if (data instanceof DataView) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
		else {
			const view = data;
			bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
		}
		const c1 = 3432918353;
		const c2 = 461845907;
		const length = bytes.length;
		const nblocks = Math.floor(length / 4);
		let h1 = this._seed;
		for (let i = 0; i < nblocks; i++) {
			const index = i * 4;
			let k12 = bytes[index] & 255 | (bytes[index + 1] & 255) << 8 | (bytes[index + 2] & 255) << 16 | (bytes[index + 3] & 255) << 24;
			k12 = this._imul(k12, c1);
			k12 = this._rotl32(k12, 15);
			k12 = this._imul(k12, c2);
			h1 ^= k12;
			h1 = this._rotl32(h1, 13);
			h1 = this._imul(h1, 5) + 3864292196;
		}
		const tail = nblocks * 4;
		let k1 = 0;
		switch (length & 3) {
			case 3: k1 ^= (bytes[tail + 2] & 255) << 16;
			case 2: k1 ^= (bytes[tail + 1] & 255) << 8;
			case 1:
				k1 ^= bytes[tail] & 255;
				k1 = this._imul(k1, c1);
				k1 = this._rotl32(k1, 15);
				k1 = this._imul(k1, c2);
				h1 ^= k1;
		}
		h1 ^= length;
		h1 ^= h1 >>> 16;
		h1 = this._imul(h1, 2246822507);
		h1 ^= h1 >>> 13;
		h1 = this._imul(h1, 3266489909);
		h1 ^= h1 >>> 16;
		h1 = h1 >>> 0;
		return h1.toString(16).padStart(8, "0");
	}
	/**
	* Computes the Murmur 32-bit hash of the provided data.
	*
	* @param data - The data to hash (Uint8Array, ArrayBuffer, or DataView)
	* @returns A Promise resolving to an 8-character lowercase hexadecimal string
	*
	* @example
	* ```typescript
	* const murmur = new Murmur();
	* const data = new TextEncoder().encode('hello');
	* const hash = await murmur.toHash(data);
	* console.log(hash); // "248bfa47"
	* ```
	*/
	async toHash(data) {
		return this.toHashSync(data);
	}
	/**
	* 32-bit integer multiplication with proper overflow handling.
	* @private
	*/
	_imul(a, b) {
		if (Math.imul) return Math.imul(a, b);
		const ah = a >>> 16 & 65535;
		const al = a & 65535;
		const bh = b >>> 16 & 65535;
		const bl = b & 65535;
		return al * bl + (ah * bl + al * bh << 16 >>> 0) | 0;
	}
	/**
	* Left rotate a 32-bit integer.
	* @private
	*/
	_rotl32(x, r) {
		return x << r | x >>> 32 - r;
	}
};
var HashProviders = class {
	_providers = /* @__PURE__ */ new Map();
	_getFuzzy = true;
	/**
	* Creates a new HashProviders instance.
	* @param options - Optional configuration including initial providers to load
	* @example
	* ```ts
	* const providers = new HashProviders({
	*   providers: [{ name: 'custom', toHash: async (data) => '...' }]
	* });
	* ```
	*/
	constructor(options) {
		if (options?.providers) this.loadProviders(options?.providers);
		if (options?.getFuzzy !== void 0) this._getFuzzy = Boolean(options?.getFuzzy);
	}
	/**
	* Loads multiple hash providers at once.
	* Each provider is added to the internal map using its name as the key.
	* @param providers - Array of HashProvider objects to load
	* @example
	* ```ts
	* const providers = new HashProviders();
	* providers.loadProviders([
	*   { name: 'md5', toHash: async (data) => '...' },
	*   { name: 'sha1', toHash: async (data) => '...' }
	* ]);
	* ```
	*/
	loadProviders(providers) {
		for (const provider of providers) this._providers.set(provider.name, provider);
	}
	/**
	* Gets the internal Map of all registered hash providers.
	* @returns Map of provider names to HashProvider objects
	*/
	get providers() {
		return this._providers;
	}
	/**
	* Sets the internal Map of hash providers, replacing all existing providers.
	* @param providers - Map of provider names to HashProvider objects
	*/
	set providers(providers) {
		this._providers = providers;
	}
	/**
	* Gets an array of all provider names.
	* @returns Array of provider names
	* @example
	* ```ts
	* const providers = new HashProviders();
	* providers.add({ name: 'sha256', toHash: async (data) => '...' });
	* providers.add({ name: 'md5', toHash: async (data) => '...' });
	* console.log(providers.names); // ['sha256', 'md5']
	* ```
	*/
	get names() {
		return Array.from(this._providers.keys());
	}
	/**
	* Gets a hash provider by name with optional fuzzy matching.
	*
	* Fuzzy matching (enabled by default) attempts to find providers by:
	* 1. Exact match (after trimming whitespace)
	* 2. Case-insensitive match (lowercase)
	* 3. Dash-removed match (e.g., "SHA-256" matches "sha256")
	*
	* @param name - The name of the provider to retrieve
	* @param options - Optional configuration for the get operation
	* @param options.fuzzy - Enable/disable fuzzy matching (overrides constructor setting)
	* @returns The HashProvider if found, undefined otherwise
	* @example
	* ```ts
	* const providers = new HashProviders();
	* providers.add({ name: 'sha256', toHash: async (data) => '...' });
	*
	* // Exact match
	* const provider = providers.get('sha256');
	*
	* // Fuzzy match (case-insensitive)
	* const provider2 = providers.get('SHA256');
	*
	* // Fuzzy match (with dash)
	* const provider3 = providers.get('SHA-256');
	*
	* // Disable fuzzy matching
	* const provider4 = providers.get('SHA256', { fuzzy: false }); // returns undefined
	* ```
	*/
	get(name, options) {
		const getFuzzy = options?.fuzzy ?? this._getFuzzy;
		name = name.trim();
		let result = this._providers.get(name);
		if (result === void 0 && getFuzzy === true) {
			name = name.toLowerCase();
			result = this._providers.get(name);
		}
		if (result === void 0 && getFuzzy === true) {
			name = name.replaceAll("-", "");
			result = this._providers.get(name);
		}
		return result;
	}
	/**
	* Adds a single hash provider to the collection.
	* If a provider with the same name already exists, it will be replaced.
	* @param provider - The HashProvider object to add
	* @example
	* ```ts
	* const providers = new HashProviders();
	* providers.add({
	*   name: 'custom-hash',
	*   toHash: async (data) => {
	*     // Custom hashing logic
	*     return 'hash-result';
	*   }
	* });
	* ```
	*/
	add(provider) {
		this._providers.set(provider.name, provider);
	}
	/**
	* Removes a hash provider from the collection by name.
	* @param name - The name of the provider to remove
	* @returns true if the provider was found and removed, false otherwise
	* @example
	* ```ts
	* const providers = new HashProviders();
	* providers.add({ name: 'custom', toHash: async (data) => '...' });
	* const removed = providers.remove('custom'); // returns true
	* const removed2 = providers.remove('nonexistent'); // returns false
	* ```
	*/
	remove(name) {
		return this._providers.delete(name);
	}
};
var Hashery = class extends Hookified {
	_parse = JSON.parse;
	_stringify = JSON.stringify;
	_providers = new HashProviders();
	_defaultAlgorithm = "SHA-256";
	_defaultAlgorithmSync = "djb2";
	_cache;
	constructor(options) {
		super(options);
		if (options?.parse) this._parse = options.parse;
		if (options?.stringify) this._stringify = options.stringify;
		if (options?.defaultAlgorithm) this._defaultAlgorithm = options.defaultAlgorithm;
		if (options?.defaultAlgorithmSync) this._defaultAlgorithmSync = options.defaultAlgorithmSync;
		this._cache = new Cache(options?.cache);
		this.loadProviders(options?.providers, { includeBase: options?.includeBase ?? true });
	}
	/**
	* Gets the parse function used to deserialize stored values.
	* @returns The current parse function (defaults to JSON.parse)
	*/
	get parse() {
		return this._parse;
	}
	/**
	* Sets the parse function used to deserialize stored values.
	* @param value - The parse function to use for deserialization
	*/
	set parse(value) {
		this._parse = value;
	}
	/**
	* Gets the stringify function used to serialize values for storage.
	* @returns The current stringify function (defaults to JSON.stringify)
	*/
	get stringify() {
		return this._stringify;
	}
	/**
	* Sets the stringify function used to serialize values for storage.
	* @param value - The stringify function to use for serialization
	*/
	set stringify(value) {
		this._stringify = value;
	}
	/**
	* Gets the HashProviders instance used to manage hash providers.
	* @returns The current HashProviders instance
	*/
	get providers() {
		return this._providers;
	}
	/**
	* Sets the HashProviders instance used to manage hash providers.
	* @param value - The HashProviders instance to use
	*/
	set providers(value) {
		this._providers = value;
	}
	/**
	* Gets the names of all registered hash algorithm providers.
	* @returns An array of provider names (e.g., ['SHA-256', 'SHA-384', 'SHA-512'])
	*/
	get names() {
		return this._providers.names;
	}
	/**
	* Gets the default hash algorithm used when none is specified.
	* @returns The current default algorithm (defaults to 'SHA-256')
	*/
	get defaultAlgorithm() {
		return this._defaultAlgorithm;
	}
	/**
	* Sets the default hash algorithm to use when none is specified.
	* @param value - The default algorithm to use (e.g., 'SHA-256', 'SHA-512', 'djb2')
	* @example
	* ```ts
	* const hashery = new Hashery();
	* hashery.defaultAlgorithm = 'SHA-512';
	*
	* // Now toHash will use SHA-512 by default
	* const hash = await hashery.toHash({ data: 'example' });
	* ```
	*/
	set defaultAlgorithm(value) {
		this._defaultAlgorithm = value;
	}
	/**
	* Gets the default synchronous hash algorithm used when none is specified.
	* @returns The current default synchronous algorithm (defaults to 'djb2')
	*/
	get defaultAlgorithmSync() {
		return this._defaultAlgorithmSync;
	}
	/**
	* Sets the default synchronous hash algorithm to use when none is specified.
	* @param value - The default synchronous algorithm to use (e.g., 'djb2', 'fnv1', 'murmur', 'crc32')
	* @example
	* ```ts
	* const hashery = new Hashery();
	* hashery.defaultAlgorithmSync = 'fnv1';
	*
	* // Now synchronous operations will use fnv1 by default
	* ```
	*/
	set defaultAlgorithmSync(value) {
		this._defaultAlgorithmSync = value;
	}
	/**
	* Gets the cache instance used to store computed hash values.
	* @returns The Cache instance
	* @example
	* ```ts
	* const hashery = new Hashery({ cache: { enabled: true } });
	*
	* // Access the cache
	* hashery.cache.enabled; // true
	* hashery.cache.size; // number of cached items
	* hashery.cache.clear(); // clear all cached items
	* ```
	*/
	get cache() {
		return this._cache;
	}
	/**
	* Generates a cryptographic hash of the provided data using the Web Crypto API.
	* The data is first stringified using the configured stringify function, then hashed.
	*
	* If an invalid algorithm is provided, a 'warn' event is emitted and the method falls back
	* to the default algorithm. You can listen to these warnings:
	* ```ts
	* hashery.on('warn', (message) => console.log(message));
	* ```
	*
	* @param data - The data to hash (will be stringified before hashing)
	* @param options - Optional configuration object
	* @param options.algorithm - The hash algorithm to use (defaults to 'SHA-256')
	* @param options.maxLength - Optional maximum length for the hash output
	* @returns A Promise that resolves to the hexadecimal string representation of the hash
	*
	* @example
	* ```ts
	* const hashery = new Hashery();
	* const hash = await hashery.toHash({ name: 'John', age: 30 });
	* console.log(hash); // "a1b2c3d4..."
	*
	* // Using a different algorithm
	* const hash512 = await hashery.toHash({ name: 'John' }, { algorithm: 'SHA-512' });
	* ```
	*/
	async toHash(data, options) {
		const context = {
			data,
			algorithm: options?.algorithm ?? this._defaultAlgorithm,
			maxLength: options?.maxLength
		};
		await this.beforeHook("toHash", context);
		const stringified = this._stringify(context.data);
		const cacheKey = `${context.algorithm}:${stringified}`;
		if (this._cache.enabled) {
			const cached = this._cache.get(cacheKey);
			if (cached !== void 0) {
				let cachedHash = cached;
				if (options?.maxLength && cachedHash.length > options.maxLength) cachedHash = cachedHash.substring(0, options.maxLength);
				const result2 = {
					hash: cachedHash,
					data: context.data,
					algorithm: context.algorithm
				};
				await this.afterHook("toHash", result2);
				return result2.hash;
			}
		}
		const dataBuffer = new TextEncoder().encode(stringified);
		let provider = this._providers.get(context.algorithm);
		if (!provider) {
			this.emit("warn", `Invalid algorithm '${context.algorithm}' not found. Falling back to default algorithm '${this._defaultAlgorithm}'.`);
			provider = new WebCrypto({ algorithm: this._defaultAlgorithm });
		}
		let hash = await provider.toHash(dataBuffer);
		if (this._cache.enabled) this._cache.set(cacheKey, hash);
		if (options?.maxLength && hash.length > options?.maxLength) hash = hash.substring(0, options.maxLength);
		const result = {
			hash,
			data: context.data,
			algorithm: context.algorithm
		};
		await this.afterHook("toHash", result);
		return result.hash;
	}
	/**
	* Generates a deterministic number within a specified range based on the hash of the provided data.
	* This method uses the toHash function to create a consistent hash, then maps it to a number
	* between min and max (inclusive).
	*
	* @param data - The data to hash (will be stringified before hashing)
	* @param options - Configuration options (optional, defaults to min: 0, max: 100)
	* @param options.min - The minimum value of the range (inclusive, defaults to 0)
	* @param options.max - The maximum value of the range (inclusive, defaults to 100)
	* @param options.algorithm - The hash algorithm to use (defaults to 'SHA-256')
	* @param options.hashLength - Number of characters from hash to use for conversion (defaults to 16)
	* @returns A Promise that resolves to a number between min and max (inclusive)
	*
	* @example
	* ```ts
	* const hashery = new Hashery();
	* const num = await hashery.toNumber({ user: 'john' }); // Uses default min: 0, max: 100
	* console.log(num); // Always returns the same number for the same input, e.g., 42
	*
	* // Using custom range
	* const num2 = await hashery.toNumber({ user: 'john' }, { min: 1, max: 100 });
	*
	* // Using a different algorithm
	* const num512 = await hashery.toNumber({ user: 'john' }, { min: 0, max: 255, algorithm: 'SHA-512' });
	* ```
	*/
	async toNumber(data, options = {}) {
		const { min = 0, max = 100, algorithm = this._defaultAlgorithm, hashLength = 16 } = options;
		if (min > max) throw new Error("min cannot be greater than max");
		const hash = await this.toHash(data, {
			algorithm,
			maxLength: hashLength
		});
		return min + Number.parseInt(hash, 16) % (max - min + 1);
	}
	/**
	* Generates a hash of the provided data synchronously using a non-cryptographic hash algorithm.
	* The data is first stringified using the configured stringify function, then hashed.
	*
	* Note: This method only works with synchronous hash providers (djb2, fnv1, murmur, crc32).
	* WebCrypto algorithms (SHA-256, SHA-384, SHA-512) are not supported and will throw an error.
	*
	* If an invalid algorithm is provided, a 'warn' event is emitted and the method falls back
	* to the default synchronous algorithm. You can listen to these warnings:
	* ```ts
	* hashery.on('warn', (message) => console.log(message));
	* ```
	*
	* @param data - The data to hash (will be stringified before hashing)
	* @param options - Optional configuration object
	* @param options.algorithm - The hash algorithm to use (defaults to 'djb2')
	* @param options.maxLength - Optional maximum length for the hash output
	* @returns The hexadecimal string representation of the hash
	*
	* @throws {Error} If the specified algorithm does not support synchronous hashing
	* @throws {Error} If the default algorithm is not found
	*
	* @example
	* ```ts
	* const hashery = new Hashery();
	* const hash = hashery.toHashSync({ name: 'John', age: 30 });
	* console.log(hash); // "7c9df5ea..." (djb2 hash)
	*
	* // Using a different algorithm
	* const hashFnv1 = hashery.toHashSync({ name: 'John' }, { algorithm: 'fnv1' });
	* ```
	*/
	toHashSync(data, options) {
		const context = {
			data,
			algorithm: options?.algorithm ?? this._defaultAlgorithmSync,
			maxLength: options?.maxLength
		};
		this.hookSync("before:toHashSync", context);
		const algorithm = context.algorithm;
		const stringified = this._stringify(context.data);
		const cacheKey = `${algorithm}:${stringified}`;
		if (this._cache.enabled) {
			const cached = this._cache.get(cacheKey);
			if (cached !== void 0) {
				let cachedHash = cached;
				if (options?.maxLength && cachedHash.length > options.maxLength) cachedHash = cachedHash.substring(0, options.maxLength);
				const result2 = {
					hash: cachedHash,
					data: context.data,
					algorithm
				};
				this.hookSync("after:toHashSync", result2);
				return result2.hash;
			}
		}
		const dataBuffer = new TextEncoder().encode(stringified);
		let provider = this._providers.get(algorithm);
		if (!provider) {
			this.emit("warn", `Invalid algorithm '${algorithm}' not found. Falling back to default algorithm '${this._defaultAlgorithmSync}'.`);
			provider = this._providers.get(this._defaultAlgorithmSync);
			if (!provider) throw new Error(`Hash provider '${this._defaultAlgorithmSync}' (default) not found`);
		}
		if (!provider.toHashSync) throw new Error(`Hash provider '${algorithm}' does not support synchronous hashing. Use toHash() instead or choose a different algorithm (djb2, fnv1, murmur, crc32).`);
		let hash = provider.toHashSync(dataBuffer);
		if (this._cache.enabled) this._cache.set(cacheKey, hash);
		if (options?.maxLength && hash.length > options?.maxLength) hash = hash.substring(0, options.maxLength);
		const result = {
			hash,
			data: context.data,
			algorithm: context.algorithm
		};
		this.hookSync("after:toHashSync", result);
		return result.hash;
	}
	/**
	* Generates a deterministic number within a specified range based on the hash of the provided data synchronously.
	* This method uses the toHashSync function to create a consistent hash, then maps it to a number
	* between min and max (inclusive).
	*
	* Note: This method only works with synchronous hash providers (djb2, fnv1, murmur, crc32).
	*
	* @param data - The data to hash (will be stringified before hashing)
	* @param options - Configuration options (optional, defaults to min: 0, max: 100)
	* @param options.min - The minimum value of the range (inclusive, defaults to 0)
	* @param options.max - The maximum value of the range (inclusive, defaults to 100)
	* @param options.algorithm - The hash algorithm to use (defaults to 'djb2')
	* @param options.hashLength - Number of characters from hash to use for conversion (defaults to 16)
	* @returns A number between min and max (inclusive)
	*
	* @throws {Error} If the specified algorithm does not support synchronous hashing
	* @throws {Error} If min is greater than max
	*
	* @example
	* ```ts
	* const hashery = new Hashery();
	* const num = hashery.toNumberSync({ user: 'john' }); // Uses default min: 0, max: 100
	* console.log(num); // Always returns the same number for the same input, e.g., 42
	*
	* // Using custom range
	* const num2 = hashery.toNumberSync({ user: 'john' }, { min: 1, max: 100 });
	*
	* // Using a different algorithm
	* const numFnv1 = hashery.toNumberSync({ user: 'john' }, { min: 0, max: 255, algorithm: 'fnv1' });
	* ```
	*/
	toNumberSync(data, options = {}) {
		const { min = 0, max = 100, algorithm = this._defaultAlgorithmSync, hashLength = 16 } = options;
		if (min > max) throw new Error("min cannot be greater than max");
		const hash = this.toHashSync(data, {
			algorithm,
			maxLength: hashLength
		});
		return min + Number.parseInt(hash, 16) % (max - min + 1);
	}
	loadProviders(providers, options = { includeBase: true }) {
		if (providers) for (const provider of providers) this._providers.add(provider);
		if (options.includeBase) {
			this.providers.add(new WebCrypto({ algorithm: "SHA-256" }));
			this.providers.add(new WebCrypto({ algorithm: "SHA-384" }));
			this.providers.add(new WebCrypto({ algorithm: "SHA-512" }));
			this.providers.add(new CRC());
			this.providers.add(new DJB2());
			this.providers.add(new FNV1());
			this.providers.add(new Murmur());
		}
	}
};
/* v8 ignore next -- @preserve */

//#endregion
//#region node_modules/.pnpm/@cacheable+utils@2.3.4/node_modules/@cacheable/utils/dist/index.js
var shorthandToMilliseconds = (shorthand) => {
	let milliseconds;
	if (shorthand === void 0) return;
	if (typeof shorthand === "number") milliseconds = shorthand;
	else {
		if (typeof shorthand !== "string") return;
		shorthand = shorthand.trim();
		if (Number.isNaN(Number(shorthand))) {
			const match = /^([\d.]+)\s*(ms|s|m|h|hr|d)$/i.exec(shorthand);
			if (!match) throw new Error(`Unsupported time format: "${shorthand}". Use 'ms', 's', 'm', 'h', 'hr', or 'd'.`);
			const [, value, unit] = match;
			const numericValue = Number.parseFloat(value);
			switch (unit.toLowerCase()) {
				case "ms":
					milliseconds = numericValue;
					break;
				case "s":
					milliseconds = numericValue * 1e3;
					break;
				case "m":
					milliseconds = numericValue * 1e3 * 60;
					break;
				case "h":
					milliseconds = numericValue * 1e3 * 60 * 60;
					break;
				case "hr":
					milliseconds = numericValue * 1e3 * 60 * 60;
					break;
				case "d":
					milliseconds = numericValue * 1e3 * 60 * 60 * 24;
					break;
				default: milliseconds = Number(shorthand);
			}
		} else milliseconds = Number(shorthand);
	}
	return milliseconds;
};
var shorthandToTime = (shorthand, fromDate) => {
	fromDate ??= /* @__PURE__ */ new Date();
	const milliseconds = shorthandToMilliseconds(shorthand);
	if (milliseconds === void 0) return fromDate.getTime();
	return fromDate.getTime() + milliseconds;
};
var HashAlgorithm = /* @__PURE__ */ ((HashAlgorithm2) => {
	HashAlgorithm2["SHA256"] = "SHA-256";
	HashAlgorithm2["SHA384"] = "SHA-384";
	HashAlgorithm2["SHA512"] = "SHA-512";
	HashAlgorithm2["DJB2"] = "djb2";
	HashAlgorithm2["FNV1"] = "fnv1";
	HashAlgorithm2["MURMER"] = "murmer";
	HashAlgorithm2["CRC32"] = "crc32";
	return HashAlgorithm2;
})(HashAlgorithm || {});
function hashSync(object, options = {
	algorithm: "djb2",
	serialize: JSON.stringify
}) {
	const algorithm = options?.algorithm ?? "djb2";
	const objectString = (options?.serialize ?? JSON.stringify)(object);
	return new Hashery().toHashSync(objectString, { algorithm });
}
function hashToNumberSync(object, options = {
	min: 0,
	max: 10,
	algorithm: "djb2",
	serialize: JSON.stringify
}) {
	const min = options?.min ?? 0;
	const max = options?.max ?? 10;
	const algorithm = options?.algorithm ?? "djb2";
	const serialize = options?.serialize ?? JSON.stringify;
	const hashLength = options?.hashLength ?? 16;
	if (min >= max) throw new Error(`Invalid range: min (${min}) must be less than max (${max})`);
	const objectString = serialize(object);
	return new Hashery().toNumberSync(objectString, {
		algorithm,
		min,
		max,
		hashLength
	});
}
function wrapSync(function_, options) {
	const { ttl, keyPrefix, cache, serialize } = options;
	return (...arguments_) => {
		let cacheKey = createWrapKey(function_, arguments_, {
			keyPrefix,
			serialize
		});
		if (options.createKey) cacheKey = options.createKey(function_, arguments_, options);
		let value = cache.get(cacheKey);
		if (value === void 0) try {
			value = function_(...arguments_);
			cache.set(cacheKey, value, ttl);
		} catch (error) {
			cache.emit("error", error);
			if (options.cacheErrors) cache.set(cacheKey, error, ttl);
		}
		return value;
	};
}
function createWrapKey(function_, arguments_, options) {
	const { keyPrefix, serialize } = options || {};
	if (!keyPrefix) return `${function_.name}::${hashSync(arguments_, { serialize })}`;
	return `${keyPrefix}::${function_.name}::${hashSync(arguments_, { serialize })}`;
}
/* v8 ignore next -- @preserve */

//#endregion
//#region node_modules/.pnpm/@cacheable+memory@2.0.7/node_modules/@cacheable/memory/dist/index.js
var ListNode = class {
	value;
	prev = void 0;
	next = void 0;
	constructor(value) {
		this.value = value;
	}
};
var DoublyLinkedList = class {
	head = void 0;
	tail = void 0;
	nodesMap = /* @__PURE__ */ new Map();
	addToFront(value) {
		const newNode = new ListNode(value);
		if (this.head) {
			newNode.next = this.head;
			this.head.prev = newNode;
			this.head = newNode;
		} else this.head = this.tail = newNode;
		this.nodesMap.set(value, newNode);
	}
	moveToFront(value) {
		const node = this.nodesMap.get(value);
		if (!node || this.head === node) return;
		if (node.prev) node.prev.next = node.next;
		if (node.next) node.next.prev = node.prev;
		if (node === this.tail) this.tail = node.prev;
		node.prev = void 0;
		node.next = this.head;
		if (this.head) this.head.prev = node;
		this.head = node;
		this.tail ??= node;
	}
	getOldest() {
		return this.tail ? this.tail.value : void 0;
	}
	removeOldest() {
		if (!this.tail) return;
		const oldValue = this.tail.value;
		if (this.tail.prev) {
			this.tail = this.tail.prev;
			this.tail.next = void 0;
		} else this.head = this.tail = void 0;
		this.nodesMap.delete(oldValue);
		return oldValue;
	}
	get size() {
		return this.nodesMap.size;
	}
};
var defaultStoreHashSize = 16;
var maximumMapSize = 16777216;
var CacheableMemory = class extends Hookified {
	_lru = new DoublyLinkedList();
	_storeHashSize = defaultStoreHashSize;
	_storeHashAlgorithm = HashAlgorithm.DJB2;
	_store = Array.from({ length: this._storeHashSize }, () => /* @__PURE__ */ new Map());
	_ttl;
	_useClone = true;
	_lruSize = 0;
	_checkInterval = 0;
	_interval = 0;
	/**
	* @constructor
	* @param {CacheableMemoryOptions} [options] - The options for the CacheableMemory
	*/
	constructor(options) {
		super();
		if (options?.ttl) this.setTtl(options.ttl);
		if (options?.useClone !== void 0) this._useClone = options.useClone;
		if (options?.storeHashSize && options.storeHashSize > 0) this._storeHashSize = options.storeHashSize;
		if (options?.lruSize) if (options.lruSize > maximumMapSize) this.emit("error", /* @__PURE__ */ new Error(`LRU size cannot be larger than ${maximumMapSize} due to Map limitations.`));
		else this._lruSize = options.lruSize;
		if (options?.checkInterval) this._checkInterval = options.checkInterval;
		if (options?.storeHashAlgorithm) this._storeHashAlgorithm = options.storeHashAlgorithm;
		this._store = Array.from({ length: this._storeHashSize }, () => /* @__PURE__ */ new Map());
		this.startIntervalCheck();
	}
	/**
	* Gets the time-to-live
	* @returns {number|string|undefined} - The time-to-live in miliseconds or a human-readable format. If undefined, it will not have a time-to-live.
	*/
	get ttl() {
		return this._ttl;
	}
	/**
	* Sets the time-to-live
	* @param {number|string|undefined} value - The time-to-live in miliseconds or a human-readable format (example '1s' = 1 second, '1h' = 1 hour). If undefined, it will not have a time-to-live.
	*/
	set ttl(value) {
		this.setTtl(value);
	}
	/**
	* Gets whether to use clone
	* @returns {boolean} - If true, it will clone the value before returning it. If false, it will return the value directly. Default is true.
	*/
	get useClone() {
		return this._useClone;
	}
	/**
	* Sets whether to use clone
	* @param {boolean} value - If true, it will clone the value before returning it. If false, it will return the value directly. Default is true.
	*/
	set useClone(value) {
		this._useClone = value;
	}
	/**
	* Gets the size of the LRU cache
	* @returns {number} - The size of the LRU cache. If set to 0, it will not use LRU cache. Default is 0. If you are using LRU then the limit is based on Map() size 17mm.
	*/
	get lruSize() {
		return this._lruSize;
	}
	/**
	* Sets the size of the LRU cache
	* @param {number} value - The size of the LRU cache. If set to 0, it will not use LRU cache. Default is 0. If you are using LRU then the limit is based on Map() size 17mm.
	*/
	set lruSize(value) {
		if (value > maximumMapSize) {
			this.emit("error", /* @__PURE__ */ new Error(`LRU size cannot be larger than ${maximumMapSize} due to Map limitations.`));
			return;
		}
		this._lruSize = value;
		if (this._lruSize === 0) {
			this._lru = new DoublyLinkedList();
			return;
		}
		this.lruResize();
	}
	/**
	* Gets the check interval
	* @returns {number} - The interval to check for expired items. If set to 0, it will not check for expired items. Default is 0.
	*/
	get checkInterval() {
		return this._checkInterval;
	}
	/**
	* Sets the check interval
	* @param {number} value - The interval to check for expired items. If set to 0, it will not check for expired items. Default is 0.
	*/
	set checkInterval(value) {
		this._checkInterval = value;
	}
	/**
	* Gets the size of the cache
	* @returns {number} - The size of the cache
	*/
	get size() {
		let size = 0;
		for (const store of this._store) size += store.size;
		return size;
	}
	/**
	* Gets the number of hash stores
	* @returns {number} - The number of hash stores
	*/
	get storeHashSize() {
		return this._storeHashSize;
	}
	/**
	* Sets the number of hash stores. This will recreate the store and all data will be cleared
	* @param {number} value - The number of hash stores
	*/
	set storeHashSize(value) {
		if (value === this._storeHashSize) return;
		this._storeHashSize = value;
		this._store = Array.from({ length: this._storeHashSize }, () => /* @__PURE__ */ new Map());
	}
	/**
	* Gets the store hash algorithm
	* @returns {HashAlgorithm | StoreHashAlgorithmFunction} - The store hash algorithm
	*/
	get storeHashAlgorithm() {
		return this._storeHashAlgorithm;
	}
	/**
	* Sets the store hash algorithm. This will recreate the store and all data will be cleared
	* @param {HashAlgorithm | HashAlgorithmFunction} value - The store hash algorithm
	*/
	set storeHashAlgorithm(value) {
		this._storeHashAlgorithm = value;
	}
	/**
	* Gets the keys
	* @returns {IterableIterator<string>} - The keys
	*/
	get keys() {
		const keys = [];
		for (const store of this._store) for (const key of store.keys()) {
			const item = store.get(key);
			if (item && this.hasExpired(item)) {
				store.delete(key);
				continue;
			}
			keys.push(key);
		}
		return keys.values();
	}
	/**
	* Gets the items
	* @returns {IterableIterator<CacheableStoreItem>} - The items
	*/
	get items() {
		const items = [];
		for (const store of this._store) for (const item of store.values()) {
			if (this.hasExpired(item)) {
				store.delete(item.key);
				continue;
			}
			items.push(item);
		}
		return items.values();
	}
	/**
	* Gets the store
	* @returns {Array<Map<string, CacheableStoreItem>>} - The store
	*/
	get store() {
		return this._store;
	}
	/**
	* Gets the value of the key
	* @param {string} key - The key to get the value
	* @returns {T | undefined} - The value of the key
	*/
	get(key) {
		const store = this.getStore(key);
		const item = store.get(key);
		if (!item) return;
		if (item.expires && Date.now() > item.expires) {
			store.delete(key);
			return;
		}
		this.lruMoveToFront(key);
		if (!this._useClone) return item.value;
		return this.clone(item.value);
	}
	/**
	* Gets the values of the keys
	* @param {string[]} keys - The keys to get the values
	* @returns {T[]} - The values of the keys
	*/
	getMany(keys) {
		const result = [];
		for (const key of keys) result.push(this.get(key));
		return result;
	}
	/**
	* Gets the raw value of the key
	* @param {string} key - The key to get the value
	* @returns {CacheableStoreItem | undefined} - The raw value of the key
	*/
	getRaw(key) {
		const store = this.getStore(key);
		const item = store.get(key);
		if (!item) return;
		if (item.expires && item.expires && Date.now() > item.expires) {
			store.delete(key);
			return;
		}
		this.lruMoveToFront(key);
		return item;
	}
	/**
	* Gets the raw values of the keys
	* @param {string[]} keys - The keys to get the values
	* @returns {CacheableStoreItem[]} - The raw values of the keys
	*/
	getManyRaw(keys) {
		const result = [];
		for (const key of keys) result.push(this.getRaw(key));
		return result;
	}
	/**
	* Sets the value of the key
	* @param {string} key - The key to set the value
	* @param {any} value - The value to set
	* @param {number|string|SetOptions} [ttl] - Time to Live - If you set a number it is miliseconds, if you set a string it is a human-readable.
	* If you want to set expire directly you can do that by setting the expire property in the SetOptions.
	* If you set undefined, it will use the default time-to-live. If both are undefined then it will not have a time-to-live.
	* @returns {void}
	*/
	set(key, value, ttl) {
		const store = this.getStore(key);
		let expires;
		if (ttl !== void 0 || this._ttl !== void 0) if (typeof ttl === "object") {
			if (ttl.expire) expires = typeof ttl.expire === "number" ? ttl.expire : ttl.expire.getTime();
			if (ttl.ttl) {
				const finalTtl = shorthandToTime(ttl.ttl);
				if (finalTtl !== void 0) expires = finalTtl;
			}
		} else {
			const finalTtl = shorthandToTime(ttl ?? this._ttl);
			if (finalTtl !== void 0) expires = finalTtl;
		}
		if (this._lruSize > 0) if (store.has(key)) this.lruMoveToFront(key);
		else {
			this.lruAddToFront(key);
			if (this._lru.size > this._lruSize) {
				const oldestKey = this._lru.getOldest();
				if (oldestKey) {
					this._lru.removeOldest();
					this.delete(oldestKey);
				}
			}
		}
		const item = {
			key,
			value,
			expires
		};
		store.set(key, item);
	}
	/**
	* Sets the values of the keys
	* @param {CacheableItem[]} items - The items to set
	* @returns {void}
	*/
	setMany(items) {
		for (const item of items) this.set(item.key, item.value, item.ttl);
	}
	/**
	* Checks if the key exists
	* @param {string} key - The key to check
	* @returns {boolean} - If true, the key exists. If false, the key does not exist.
	*/
	has(key) {
		const item = this.get(key);
		return Boolean(item);
	}
	/**
	* @function hasMany
	* @param {string[]} keys - The keys to check
	* @returns {boolean[]} - If true, the key exists. If false, the key does not exist.
	*/
	hasMany(keys) {
		const result = [];
		for (const key of keys) {
			const item = this.get(key);
			result.push(Boolean(item));
		}
		return result;
	}
	/**
	* Take will get the key and delete the entry from cache
	* @param {string} key - The key to take
	* @returns {T | undefined} - The value of the key
	*/
	take(key) {
		const item = this.get(key);
		if (!item) return;
		this.delete(key);
		return item;
	}
	/**
	* TakeMany will get the keys and delete the entries from cache
	* @param {string[]} keys - The keys to take
	* @returns {T[]} - The values of the keys
	*/
	takeMany(keys) {
		const result = [];
		for (const key of keys) result.push(this.take(key));
		return result;
	}
	/**
	* Delete the key
	* @param {string} key - The key to delete
	* @returns {void}
	*/
	delete(key) {
		this.getStore(key).delete(key);
	}
	/**
	* Delete the keys
	* @param {string[]} keys - The keys to delete
	* @returns {void}
	*/
	deleteMany(keys) {
		for (const key of keys) this.delete(key);
	}
	/**
	* Clear the cache
	* @returns {void}
	*/
	clear() {
		this._store = Array.from({ length: this._storeHashSize }, () => /* @__PURE__ */ new Map());
		this._lru = new DoublyLinkedList();
	}
	/**
	* Get the store based on the key (internal use)
	* @param {string} key - The key to get the store
	* @returns {CacheableHashStore} - The store
	*/
	getStore(key) {
		const hash2 = this.getKeyStoreHash(key);
		this._store[hash2] ||= /* @__PURE__ */ new Map();
		return this._store[hash2];
	}
	/**
	* Hash the key for which store to go to (internal use)
	* @param {string} key - The key to hash
	* Available algorithms are: SHA256, SHA1, MD5, and djb2Hash.
	* @returns {number} - The hashed key as a number
	*/
	getKeyStoreHash(key) {
		if (this._store.length === 1) return 0;
		if (typeof this._storeHashAlgorithm === "function") return this._storeHashAlgorithm(key, this._storeHashSize);
		return hashToNumberSync(key, {
			min: 0,
			max: this._storeHashSize - 1,
			algorithm: this._storeHashAlgorithm
		});
	}
	/**
	* Clone the value. This is for internal use
	* @param {any} value - The value to clone
	* @returns {any} - The cloned value
	*/
	clone(value) {
		if (this.isPrimitive(value)) return value;
		return structuredClone(value);
	}
	/**
	* Add to the front of the LRU cache. This is for internal use
	* @param {string} key - The key to add to the front
	* @returns {void}
	*/
	lruAddToFront(key) {
		if (this._lruSize === 0) return;
		this._lru.addToFront(key);
	}
	/**
	* Move to the front of the LRU cache. This is for internal use
	* @param {string} key - The key to move to the front
	* @returns {void}
	*/
	lruMoveToFront(key) {
		if (this._lruSize === 0) return;
		this._lru.moveToFront(key);
	}
	/**
	* Resize the LRU cache. This is for internal use.
	* @returns {void}
	*/
	lruResize() {
		while (this._lru.size > this._lruSize) {
			const oldestKey = this._lru.getOldest();
			if (oldestKey) {
				this._lru.removeOldest();
				this.delete(oldestKey);
			}
		}
	}
	/**
	* Check for expiration. This is for internal use
	* @returns {void}
	*/
	checkExpiration() {
		for (const store of this._store) for (const item of store.values()) if (item.expires && Date.now() > item.expires) store.delete(item.key);
	}
	/**
	* Start the interval check. This is for internal use
	* @returns {void}
	*/
	startIntervalCheck() {
		if (this._checkInterval > 0) {
			if (this._interval) clearInterval(this._interval);
			this._interval = setInterval(() => {
				this.checkExpiration();
			}, this._checkInterval).unref();
		}
	}
	/**
	* Stop the interval check. This is for internal use
	* @returns {void}
	*/
	stopIntervalCheck() {
		if (this._interval) clearInterval(this._interval);
		this._interval = 0;
		this._checkInterval = 0;
	}
	/**
	* Wrap the function for caching
	* @param {Function} function_ - The function to wrap
	* @param {Object} [options] - The options to wrap
	* @returns {Function} - The wrapped function
	*/
	wrap(function_, options) {
		return wrapSync(function_, {
			ttl: options?.ttl ?? this._ttl,
			keyPrefix: options?.keyPrefix,
			createKey: options?.createKey,
			cache: this
		});
	}
	isPrimitive(value) {
		const result = false;
		if (value === null || value === void 0) return true;
		if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true;
		return result;
	}
	setTtl(ttl) {
		if (typeof ttl === "string" || ttl === void 0) this._ttl = ttl;
		else if (ttl > 0) this._ttl = ttl;
		else this._ttl = void 0;
	}
	hasExpired(item) {
		if (item.expires && Date.now() > item.expires) return true;
		return false;
	}
};
/* v8 ignore next -- @preserve */

//#endregion
//#region node_modules/.pnpm/flatted@3.3.3/node_modules/flatted/esm/index.js
const { parse: $parse, stringify: $stringify } = JSON;
const { keys } = Object;
const Primitive = String;
const primitive = "string";
const ignore = {};
const object = "object";
const noop = (_, value) => value;
const primitives = (value) => value instanceof Primitive ? Primitive(value) : value;
const Primitives = (_, value) => typeof value === primitive ? new Primitive(value) : value;
const revive = (input, parsed, output, $) => {
	const lazy = [];
	for (let ke = keys(output), { length } = ke, y = 0; y < length; y++) {
		const k = ke[y];
		const value = output[k];
		if (value instanceof Primitive) {
			const tmp = input[value];
			if (typeof tmp === object && !parsed.has(tmp)) {
				parsed.add(tmp);
				output[k] = ignore;
				lazy.push({
					k,
					a: [
						input,
						parsed,
						tmp,
						$
					]
				});
			} else output[k] = $.call(output, k, tmp);
		} else if (output[k] !== ignore) output[k] = $.call(output, k, value);
	}
	for (let { length } = lazy, i = 0; i < length; i++) {
		const { k, a } = lazy[i];
		output[k] = $.call(output, k, revive.apply(null, a));
	}
	return output;
};
const set = (known, input, value) => {
	const index = Primitive(input.push(value) - 1);
	known.set(value, index);
	return index;
};
/**
* Converts a specialized flatted string into a JS value.
* @param {string} text
* @param {(this: any, key: string, value: any) => any} [reviver]
* @returns {any}
*/
const parse = (text, reviver) => {
	const input = $parse(text, Primitives).map(primitives);
	const value = input[0];
	const $ = reviver || noop;
	const tmp = typeof value === object && value ? revive(input, /* @__PURE__ */ new Set(), value, $) : value;
	return $.call({ "": tmp }, "", tmp);
};
/**
* Converts a JS value into a specialized flatted string.
* @param {any} value
* @param {((this: any, key: string, value: any) => any) | (string | number)[] | null | undefined} [replacer]
* @param {string | number | undefined} [space]
* @returns {string}
*/
const stringify = (value, replacer, space) => {
	const $ = replacer && typeof replacer === object ? (k, v) => k === "" || -1 < replacer.indexOf(k) ? v : void 0 : replacer || noop;
	const known = /* @__PURE__ */ new Map();
	const input = [];
	const output = [];
	let i = +set(known, input, $.call({ "": value }, "", value));
	let firstRun = !i;
	while (i < input.length) {
		firstRun = true;
		output[i] = $stringify(input[i++], replace, space);
	}
	return "[" + output.join(",") + "]";
	function replace(key, value) {
		if (firstRun) {
			firstRun = !firstRun;
			return value;
		}
		const after = $.call(this, key, value);
		switch (typeof after) {
			case object: if (after === null) return after;
			case primitive: return known.get(after) || set(known, input, after);
		}
		return after;
	}
};

//#endregion
//#region node_modules/.pnpm/flat-cache@6.1.20/node_modules/flat-cache/dist/index.js
var FlatCache = class extends Hookified {
	_cache = new CacheableMemory();
	_cacheDir = ".cache";
	_cacheId = "cache1";
	_persistInterval = 0;
	_persistTimer;
	_changesSinceLastSave = false;
	_parse = parse;
	_stringify = stringify;
	constructor(options) {
		super();
		if (options) this._cache = new CacheableMemory({
			ttl: options.ttl,
			useClone: options.useClone,
			lruSize: options.lruSize,
			checkInterval: options.expirationInterval
		});
		if (options?.cacheDir) this._cacheDir = options.cacheDir;
		if (options?.cacheId) this._cacheId = options.cacheId;
		if (options?.persistInterval) {
			this._persistInterval = options.persistInterval;
			this.startAutoPersist();
		}
		if (options?.deserialize) this._parse = options.deserialize;
		if (options?.serialize) this._stringify = options.serialize;
	}
	/**
	* The cache object
	* @property cache
	* @type {CacheableMemory}
	*/
	get cache() {
		return this._cache;
	}
	/**
	* The cache directory
	* @property cacheDir
	* @type {String}
	* @default '.cache'
	*/
	get cacheDir() {
		return this._cacheDir;
	}
	/**
	* Set the cache directory
	* @property cacheDir
	* @type {String}
	* @default '.cache'
	*/
	set cacheDir(value) {
		this._cacheDir = value;
	}
	/**
	* The cache id
	* @property cacheId
	* @type {String}
	* @default 'cache1'
	*/
	get cacheId() {
		return this._cacheId;
	}
	/**
	* Set the cache id
	* @property cacheId
	* @type {String}
	* @default 'cache1'
	*/
	set cacheId(value) {
		this._cacheId = value;
	}
	/**
	* The flag to indicate if there are changes since the last save
	* @property changesSinceLastSave
	* @type {Boolean}
	* @default false
	*/
	get changesSinceLastSave() {
		return this._changesSinceLastSave;
	}
	/**
	* The interval to persist the cache to disk. 0 means no timed persistence
	* @property persistInterval
	* @type {Number}
	* @default 0
	*/
	get persistInterval() {
		return this._persistInterval;
	}
	/**
	* Set the interval to persist the cache to disk. 0 means no timed persistence
	* @property persistInterval
	* @type {Number}
	* @default 0
	*/
	set persistInterval(value) {
		this._persistInterval = value;
	}
	/**
	* Load a cache identified by the given Id. If the element does not exists, then initialize an empty
	* cache storage. If specified `cacheDir` will be used as the directory to persist the data to. If omitted
	* then the cache module directory `.cacheDir` will be used instead
	*
	* @method load
	* @param cacheId {String} the id of the cache, would also be used as the name of the file cache
	* @param cacheDir {String} directory for the cache entry
	*/
	load(cacheId, cacheDir) {
		try {
			const filePath = path.resolve(`${cacheDir ?? this._cacheDir}/${cacheId ?? this._cacheId}`);
			this.loadFile(filePath);
			this.emit("load");
		} catch (error) {
			this.emit("error", error);
		}
	}
	/**
	* Load the cache from the provided file
	* @method loadFile
	* @param  {String} pathToFile the path to the file containing the info for the cache
	*/
	loadFile(pathToFile) {
		if (fs.existsSync(pathToFile)) {
			const data = fs.readFileSync(pathToFile, "utf8");
			const items = this._parse(data);
			if (Array.isArray(items)) {
				for (const item of items) if (item && typeof item === "object" && "key" in item) if (item.expires) this._cache.set(item.key, item.value, { expire: item.expires });
				else if (item.timestamp) this._cache.set(item.key, item.value, { expire: item.timestamp });
				else this._cache.set(item.key, item.value);
			} else for (const key of Object.keys(items)) {
				const item = items[key];
				if (item && typeof item === "object" && "key" in item) this._cache.set(item.key, item.value, { expire: item.expires });
				else if (item && typeof item === "object" && item.timestamp) this._cache.set(key, item, { expire: item.timestamp });
				else this._cache.set(key, item);
			}
			this._changesSinceLastSave = true;
		}
	}
	loadFileStream(pathToFile, onProgress, onEnd, onError) {
		if (fs.existsSync(pathToFile)) {
			const total = fs.statSync(pathToFile).size;
			let loaded = 0;
			let streamData = "";
			const readStream = fs.createReadStream(pathToFile, { encoding: "utf8" });
			readStream.on("data", (chunk) => {
				loaded += chunk.length;
				streamData += chunk;
				onProgress(loaded, total);
			});
			readStream.on("end", () => {
				const items = this._parse(streamData);
				for (const key of Object.keys(items)) this._cache.set(items[key].key, items[key].value, { expire: items[key].expires });
				this._changesSinceLastSave = true;
				onEnd();
			});
			readStream.on("error", (error) => {
				this.emit("error", error);
				if (onError) onError(error);
			});
		} else {
			const error = /* @__PURE__ */ new Error(`Cache file ${pathToFile} does not exist`);
			this.emit("error", error);
			if (onError) onError(error);
		}
	}
	/**
	* Returns the entire persisted object
	* @method all
	* @returns {*}
	*/
	all() {
		const result = {};
		const items = [...this._cache.items];
		for (const item of items) result[item.key] = item.value;
		return result;
	}
	/**
	* Returns an array with all the items in the cache { key, value, expires }
	* @method items
	* @returns {Array}
	*/
	get items() {
		return [...this._cache.items];
	}
	/**
	* Returns the path to the file where the cache is persisted
	* @method cacheFilePath
	* @returns {String}
	*/
	get cacheFilePath() {
		return path.resolve(`${this._cacheDir}/${this._cacheId}`);
	}
	/**
	* Returns the path to the cache directory
	* @method cacheDirPath
	* @returns {String}
	*/
	get cacheDirPath() {
		return path.resolve(this._cacheDir);
	}
	/**
	* Returns an array with all the keys in the cache
	* @method keys
	* @returns {Array}
	*/
	keys() {
		return [...this._cache.keys];
	}
	/**
	* (Legacy) set key method. This method will be deprecated in the future
	* @method setKey
	* @param key {string} the key to set
	* @param value {object} the value of the key. Could be any object that can be serialized with JSON.stringify
	*/
	setKey(key, value, ttl) {
		this.set(key, value, ttl);
	}
	/**
	* Sets a key to a given value
	* @method set
	* @param key {string} the key to set
	* @param value {object} the value of the key. Could be any object that can be serialized with JSON.stringify
	* @param [ttl] {number} the time to live in milliseconds
	*/
	set(key, value, ttl) {
		this._cache.set(key, value, ttl);
		this._changesSinceLastSave = true;
	}
	/**
	* (Legacy) Remove a given key from the cache. This method will be deprecated in the future
	* @method removeKey
	* @param key {String} the key to remove from the object
	*/
	removeKey(key) {
		this.delete(key);
	}
	/**
	* Remove a given key from the cache
	* @method delete
	* @param key {String} the key to remove from the object
	*/
	delete(key) {
		this._cache.delete(key);
		this._changesSinceLastSave = true;
		this.emit("delete", key);
	}
	/**
	* (Legacy) Return the value of the provided key. This method will be deprecated in the future
	* @method getKey<T>
	* @param key {String} the name of the key to retrieve
	* @returns {*} at T the value from the key
	*/
	getKey(key) {
		return this.get(key);
	}
	/**
	* Return the value of the provided key
	* @method get<T>
	* @param key {String} the name of the key to retrieve
	* @returns {*} at T the value from the key
	*/
	get(key) {
		return this._cache.get(key);
	}
	/**
	* Clear the cache and save the state to disk
	* @method clear
	*/
	clear() {
		try {
			this._cache.clear();
			this._changesSinceLastSave = true;
			this.save();
			this.emit("clear");
		} catch (error) {
			this.emit("error", error);
		}
	}
	/**
	* Save the state of the cache identified by the docId to disk
	* as a JSON structure
	* @method save
	*/
	save(force = false) {
		try {
			if (this._changesSinceLastSave || force) {
				const filePath = this.cacheFilePath;
				const items = [...this._cache.items];
				const data = this._stringify(items);
				if (!fs.existsSync(this._cacheDir)) fs.mkdirSync(this._cacheDir, { recursive: true });
				fs.writeFileSync(filePath, data);
				this._changesSinceLastSave = false;
				this.emit("save");
			}
		} catch (error) {
			this.emit("error", error);
		}
	}
	/**
	* Remove the file where the cache is persisted
	* @method removeCacheFile
	* @return {Boolean} true or false if the file was successfully deleted
	*/
	removeCacheFile() {
		try {
			if (fs.existsSync(this.cacheFilePath)) {
				fs.rmSync(this.cacheFilePath);
				return true;
			}
		} catch (error) {
			this.emit("error", error);
		}
		return false;
	}
	/**
	* Destroy the cache. This will remove the directory, file, and memory cache
	* @method destroy
	* @param [includeCacheDir=false] {Boolean} if true, the cache directory will be removed
	* @return {undefined}
	*/
	destroy(includeCacheDirectory = false) {
		try {
			this._cache.clear();
			this.stopAutoPersist();
			if (includeCacheDirectory) fs.rmSync(this.cacheDirPath, {
				recursive: true,
				force: true
			});
			else fs.rmSync(this.cacheFilePath, {
				recursive: true,
				force: true
			});
			this._changesSinceLastSave = false;
			this.emit("destroy");
		} catch (error) {
			this.emit("error", error);
		}
	}
	/**
	* Start the auto persist interval
	* @method startAutoPersist
	*/
	startAutoPersist() {
		if (this._persistInterval > 0) {
			if (this._persistTimer) {
				clearInterval(this._persistTimer);
				this._persistTimer = void 0;
			}
			this._persistTimer = setInterval(() => {
				this.save();
			}, this._persistInterval);
		}
	}
	/**
	* Stop the auto persist interval
	* @method stopAutoPersist
	*/
	stopAutoPersist() {
		if (this._persistTimer) {
			clearInterval(this._persistTimer);
			this._persistTimer = void 0;
		}
	}
};
function createFromFile$1(filePath, options) {
	const cache = new FlatCache(options);
	cache.loadFile(filePath);
	return cache;
}
/* v8 ignore next -- @preserve */

//#endregion
//#region node_modules/.pnpm/file-entry-cache@11.1.2/node_modules/file-entry-cache/dist/index.js
function createFromFile(filePath, options) {
	return create(path.basename(filePath), path.dirname(filePath), options);
}
function create(cacheId, cacheDirectory, options) {
	const opts = {
		...options,
		cache: {
			cacheId,
			cacheDir: cacheDirectory
		}
	};
	const fileEntryCache = new FileEntryCache(opts);
	if (cacheDirectory) {
		const cachePath = `${cacheDirectory}/${cacheId}`;
		if (fs.existsSync(cachePath)) fileEntryCache.cache = createFromFile$1(cachePath, opts.cache);
	}
	return fileEntryCache;
}
var FileEntryCache = class {
	_cache = new FlatCache({ useClone: false });
	_useCheckSum = false;
	_hashAlgorithm = "md5";
	_cwd = process.cwd();
	_restrictAccessToCwd = false;
	_logger;
	_useAbsolutePathAsKey = false;
	_useModifiedTime = true;
	/**
	* Create a new FileEntryCache instance
	* @param options - The options for the FileEntryCache (all properties are optional with defaults)
	*/
	constructor(options) {
		if (options?.cache) this._cache = new FlatCache(options.cache);
		if (options?.useCheckSum) this._useCheckSum = options.useCheckSum;
		if (options?.hashAlgorithm) this._hashAlgorithm = options.hashAlgorithm;
		if (options?.cwd) this._cwd = options.cwd;
		if (options?.useModifiedTime !== void 0) this._useModifiedTime = options.useModifiedTime;
		if (options?.restrictAccessToCwd !== void 0) this._restrictAccessToCwd = options.restrictAccessToCwd;
		if (options?.useAbsolutePathAsKey !== void 0) this._useAbsolutePathAsKey = options.useAbsolutePathAsKey;
		if (options?.logger) this._logger = options.logger;
	}
	/**
	* Get the cache
	* @returns {FlatCache} The cache
	*/
	get cache() {
		return this._cache;
	}
	/**
	* Set the cache
	* @param {FlatCache} cache - The cache to set
	*/
	set cache(cache) {
		this._cache = cache;
	}
	/**
	* Get the logger
	* @returns {ILogger | undefined} The logger instance
	*/
	get logger() {
		return this._logger;
	}
	/**
	* Set the logger
	* @param {ILogger | undefined} logger - The logger to set
	*/
	set logger(logger) {
		this._logger = logger;
	}
	/**
	* Use the hash to check if the file has changed
	* @returns {boolean} if the hash is used to check if the file has changed (default: false)
	*/
	get useCheckSum() {
		return this._useCheckSum;
	}
	/**
	* Set the useCheckSum value
	* @param {boolean} value - The value to set
	*/
	set useCheckSum(value) {
		this._useCheckSum = value;
	}
	/**
	* Get the hash algorithm
	* @returns {string} The hash algorithm (default: 'md5')
	*/
	get hashAlgorithm() {
		return this._hashAlgorithm;
	}
	/**
	* Set the hash algorithm
	* @param {string} value - The value to set
	*/
	set hashAlgorithm(value) {
		this._hashAlgorithm = value;
	}
	/**
	* Get the current working directory
	* @returns {string} The current working directory (default: process.cwd())
	*/
	get cwd() {
		return this._cwd;
	}
	/**
	* Set the current working directory
	* @param {string} value - The value to set
	*/
	set cwd(value) {
		this._cwd = value;
	}
	/**
	* Get whether to use modified time for change detection
	* @returns {boolean} Whether modified time (mtime) is used for change detection (default: true)
	*/
	get useModifiedTime() {
		return this._useModifiedTime;
	}
	/**
	* Set whether to use modified time for change detection
	* @param {boolean} value - The value to set
	*/
	set useModifiedTime(value) {
		this._useModifiedTime = value;
	}
	/**
	* Get whether to restrict paths to cwd boundaries
	* @returns {boolean} Whether strict path checking is enabled (default: true)
	*/
	get restrictAccessToCwd() {
		return this._restrictAccessToCwd;
	}
	/**
	* Set whether to restrict paths to cwd boundaries
	* @param {boolean} value - The value to set
	*/
	set restrictAccessToCwd(value) {
		this._restrictAccessToCwd = value;
	}
	/**
	* Get whether to use absolute path as cache key
	* @returns {boolean} Whether cache keys use absolute paths (default: false)
	*/
	get useAbsolutePathAsKey() {
		return this._useAbsolutePathAsKey;
	}
	/**
	* Set whether to use absolute path as cache key
	* @param {boolean} value - The value to set
	*/
	set useAbsolutePathAsKey(value) {
		this._useAbsolutePathAsKey = value;
	}
	/**
	* Given a buffer, calculate md5 hash of its content.
	* @method getHash
	* @param  {Buffer} buffer   buffer to calculate hash on
	* @return {String}          content hash digest
	*/
	getHash(buffer) {
		return crypto$1.createHash(this._hashAlgorithm).update(buffer).digest("hex");
	}
	/**
	* Create the key for the file path used for caching.
	* @method createFileKey
	* @param {String} filePath
	* @return {String}
	*/
	createFileKey(filePath) {
		let result = filePath;
		if (this._useAbsolutePathAsKey && this.isRelativePath(filePath)) result = this.getAbsolutePathWithCwd(filePath, this._cwd);
		return result;
	}
	/**
	* Check if the file path is a relative path
	* @method isRelativePath
	* @param filePath - The file path to check
	* @returns {boolean} if the file path is a relative path, false otherwise
	*/
	isRelativePath(filePath) {
		return !path.isAbsolute(filePath);
	}
	/**
	* Delete the cache file from the disk
	* @method deleteCacheFile
	* @return {boolean}       true if the file was deleted, false otherwise
	*/
	deleteCacheFile() {
		return this._cache.removeCacheFile();
	}
	/**
	* Remove the cache from the file and clear the memory cache
	* @method destroy
	*/
	destroy() {
		this._cache.destroy();
	}
	/**
	* Remove and Entry From the Cache
	* @method removeEntry
	* @param filePath - The file path to remove from the cache
	*/
	removeEntry(filePath) {
		const key = this.createFileKey(filePath);
		this._cache.removeKey(key);
	}
	/**
	* Reconcile the cache
	* @method reconcile
	*/
	reconcile() {
		const { items } = this._cache;
		for (const item of items) if (this.getFileDescriptor(item.key).notFound) this._cache.removeKey(item.key);
		this._cache.save();
	}
	/**
	* Check if the file has changed
	* @method hasFileChanged
	* @param filePath - The file path to check
	* @returns {boolean} if the file has changed, false otherwise
	*/
	hasFileChanged(filePath) {
		let result = false;
		const fileDescriptor = this.getFileDescriptor(filePath);
		if ((!fileDescriptor.err || !fileDescriptor.notFound) && fileDescriptor.changed) result = true;
		return result;
	}
	/**
	* Get the file descriptor for the file path
	* @method getFileDescriptor
	* @param filePath - The file path to get the file descriptor for
	* @param options - The options for getting the file descriptor
	* @returns The file descriptor
	*/
	getFileDescriptor(filePath, options) {
		this._logger?.debug({
			filePath,
			options
		}, "Getting file descriptor");
		let fstat;
		const result = {
			key: this.createFileKey(filePath),
			changed: false,
			meta: {}
		};
		this._logger?.trace({ key: result.key }, "Created file key");
		const metaCache = this._cache.getKey(result.key);
		if (metaCache) this._logger?.trace({ metaCache }, "Found cached meta");
		else this._logger?.trace("No cached meta found");
		result.meta = metaCache ? { ...metaCache } : {};
		const absolutePath = this.getAbsolutePath(filePath);
		this._logger?.trace({ absolutePath }, "Resolved absolute path");
		const useCheckSumValue = options?.useCheckSum ?? this._useCheckSum;
		this._logger?.debug({ useCheckSum: useCheckSumValue }, "Using checksum setting");
		const useModifiedTimeValue = options?.useModifiedTime ?? this.useModifiedTime;
		this._logger?.debug({ useModifiedTime: useModifiedTimeValue }, "Using modified time (mtime) setting");
		try {
			fstat = fs.statSync(absolutePath);
			result.meta.size = fstat.size;
			result.meta.mtime = fstat.mtime.getTime();
			this._logger?.trace({
				size: result.meta.size,
				mtime: result.meta.mtime
			}, "Read file stats");
			if (useCheckSumValue) {
				const buffer = fs.readFileSync(absolutePath);
				result.meta.hash = this.getHash(buffer);
				this._logger?.trace({ hash: result.meta.hash }, "Calculated file hash");
			}
		} catch (error) {
			this._logger?.error({
				filePath,
				error
			}, "Error reading file");
			this.removeEntry(filePath);
			let notFound = false;
			if (error.message.includes("ENOENT")) {
				notFound = true;
				this._logger?.debug({ filePath }, "File not found");
			}
			return {
				key: result.key,
				err: error,
				notFound,
				meta: {}
			};
		}
		if (!metaCache) {
			result.changed = true;
			this._cache.setKey(result.key, result.meta);
			this._logger?.debug({ filePath }, "File not in cache, marked as changed");
			return result;
		}
		if (useModifiedTimeValue && metaCache?.mtime !== result.meta?.mtime) {
			result.changed = true;
			this._logger?.debug({
				filePath,
				oldMtime: metaCache.mtime,
				newMtime: result.meta.mtime
			}, "File changed: mtime differs");
		}
		if (metaCache?.size !== result.meta?.size) {
			result.changed = true;
			this._logger?.debug({
				filePath,
				oldSize: metaCache.size,
				newSize: result.meta.size
			}, "File changed: size differs");
		}
		if (useCheckSumValue && metaCache?.hash !== result.meta?.hash) {
			result.changed = true;
			this._logger?.debug({
				filePath,
				oldHash: metaCache.hash,
				newHash: result.meta.hash
			}, "File changed: hash differs");
		}
		this._cache.setKey(result.key, result.meta);
		if (result.changed) this._logger?.info({ filePath }, "File has changed");
		else this._logger?.debug({ filePath }, "File unchanged");
		return result;
	}
	/**
	* Get the file descriptors for the files
	* @method normalizeEntries
	* @param files?: string[] - The files to get the file descriptors for
	* @returns The file descriptors
	*/
	normalizeEntries(files) {
		const result = [];
		if (files) {
			for (const file of files) {
				const fileDescriptor = this.getFileDescriptor(file);
				result.push(fileDescriptor);
			}
			return result;
		}
		const keys = this.cache.keys();
		for (const key of keys) {
			const fileDescriptor = this.getFileDescriptor(key);
			if (!fileDescriptor.notFound && !fileDescriptor.err) result.push(fileDescriptor);
		}
		return result;
	}
	/**
	* Analyze the files
	* @method analyzeFiles
	* @param files - The files to analyze
	* @returns {AnalyzedFiles} The analysis of the files
	*/
	analyzeFiles(files) {
		const result = {
			changedFiles: [],
			notFoundFiles: [],
			notChangedFiles: []
		};
		const fileDescriptors = this.normalizeEntries(files);
		for (const fileDescriptor of fileDescriptors) if (fileDescriptor.notFound) result.notFoundFiles.push(fileDescriptor.key);
		else if (fileDescriptor.changed) result.changedFiles.push(fileDescriptor.key);
		else result.notChangedFiles.push(fileDescriptor.key);
		return result;
	}
	/**
	* Get the updated files
	* @method getUpdatedFiles
	* @param files - The files to get the updated files for
	* @returns {string[]} The updated files
	*/
	getUpdatedFiles(files) {
		const result = [];
		const fileDescriptors = this.normalizeEntries(files);
		for (const fileDescriptor of fileDescriptors) if (fileDescriptor.changed) result.push(fileDescriptor.key);
		return result;
	}
	/**
	* Get the file descriptors by path prefix
	* @method getFileDescriptorsByPath
	* @param filePath - the path prefix to match
	* @returns {FileDescriptor[]} The file descriptors
	*/
	getFileDescriptorsByPath(filePath) {
		const result = [];
		const keys = this._cache.keys();
		for (const key of keys) if (key.startsWith(filePath)) {
			const fileDescriptor = this.getFileDescriptor(key);
			result.push(fileDescriptor);
		}
		return result;
	}
	/**
	* Get the Absolute Path. If it is already absolute it will return the path as is.
	* When restrictAccessToCwd is enabled, ensures the resolved path stays within cwd boundaries.
	* @method getAbsolutePath
	* @param filePath - The file path to get the absolute path for
	* @returns {string}
	* @throws {Error} When restrictAccessToCwd is true and path would resolve outside cwd
	*/
	getAbsolutePath(filePath) {
		if (this.isRelativePath(filePath)) {
			const sanitizedPath = filePath.replace(/\0/g, "");
			const resolved = path.resolve(this._cwd, sanitizedPath);
			if (this._restrictAccessToCwd) {
				const normalizedResolved = path.normalize(resolved);
				const normalizedCwd = path.normalize(this._cwd);
				if (!(normalizedResolved === normalizedCwd || normalizedResolved.startsWith(normalizedCwd + path.sep))) throw new Error(`Path traversal attempt blocked: "${filePath}" resolves outside of working directory "${this._cwd}"`);
			}
			return resolved;
		}
		return filePath;
	}
	/**
	* Get the Absolute Path with a custom working directory. If it is already absolute it will return the path as is.
	* When restrictAccessToCwd is enabled, ensures the resolved path stays within the provided cwd boundaries.
	* @method getAbsolutePathWithCwd
	* @param filePath - The file path to get the absolute path for
	* @param cwd - The custom working directory to resolve relative paths from
	* @returns {string}
	* @throws {Error} When restrictAccessToCwd is true and path would resolve outside the provided cwd
	*/
	getAbsolutePathWithCwd(filePath, cwd) {
		if (this.isRelativePath(filePath)) {
			const sanitizedPath = filePath.replace(/\0/g, "");
			const resolved = path.resolve(cwd, sanitizedPath);
			if (this._restrictAccessToCwd) {
				const normalizedResolved = path.normalize(resolved);
				const normalizedCwd = path.normalize(cwd);
				if (!(normalizedResolved === normalizedCwd || normalizedResolved.startsWith(normalizedCwd + path.sep))) throw new Error(`Path traversal attempt blocked: "${filePath}" resolves outside of working directory "${cwd}"`);
			}
			return resolved;
		}
		return filePath;
	}
	/**
	* Rename cache keys that start with a given path prefix.
	* @method renameCacheKeys
	* @param oldPath - The old path prefix to rename
	* @param newPath - The new path prefix to rename to
	*/
	renameCacheKeys(oldPath, newPath) {
		const keys = this._cache.keys();
		for (const key of keys) if (key.startsWith(oldPath)) {
			const newKey = key.replace(oldPath, newPath);
			const meta = this._cache.getKey(key);
			this._cache.removeKey(key);
			this._cache.setKey(newKey, meta);
		}
	}
};
/* v8 ignore next -- @preserve */

//#endregion
//#region scripts/lint.ts
const PROTECTED_PATTERNS = [
	"eslint.config.",
	"oxlint.config.",
	".eslintrc",
	".oxlintrc."
];
function isProtectedFile(filename) {
	return PROTECTED_PATTERNS.some((pattern) => filename.startsWith(pattern) || filename === pattern);
}
const LINT_STATE_PATH = ".claude/state/lint-attempts.json";
const STOP_STATE_PATH = ".claude/state/stop-attempts.json";
const ESLINT_CACHE_PATH = ".eslintcache";
const DEFAULT_EXTENSIONS = [
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".mts"
];
const ENTRY_CANDIDATES = [
	"index.ts",
	"cli.ts",
	"main.ts"
];
const MAX_ERRORS = 5;
const SETTINGS_FILE = ".claude/sentinel.local.md";
const DEFAULT_CACHE_BUST = ["*.config.*", "**/tsconfig*.json"];
const DEFAULT_MAX_LINT_ATTEMPTS = 3;
const DEFAULT_MAX_STOP_ATTEMPTS = 3;
const DEFAULT_SETTINGS = {
	cacheBust: [...DEFAULT_CACHE_BUST],
	eslint: true,
	lint: true,
	maxLintAttempts: DEFAULT_MAX_LINT_ATTEMPTS,
	oxlint: false,
	runner: "pnpm exec"
};
function readSettings() {
	if (!existsSync(SETTINGS_FILE)) return { ...DEFAULT_SETTINGS };
	const fields = parseFrontmatter(readFileSync(SETTINGS_FILE, "utf-8"));
	const cacheBustRaw = fields.get("cache-bust") ?? "";
	const userPatterns = cacheBustRaw ? cacheBustRaw.split(",").map((entry) => entry.trim()).filter(Boolean) : [];
	const maxAttemptsRaw = fields.get("max-lint-attempts");
	const maxLintAttempts = maxAttemptsRaw !== void 0 ? Number(maxAttemptsRaw) : DEFAULT_MAX_LINT_ATTEMPTS;
	return {
		cacheBust: [...DEFAULT_CACHE_BUST, ...userPatterns],
		eslint: fields.get("eslint") !== "false",
		lint: fields.get("lint") !== "false",
		maxLintAttempts,
		oxlint: fields.get("oxlint") === "true",
		runner: fields.get("runner") ?? DEFAULT_SETTINGS.runner
	};
}
function getChangedFiles() {
	const options = {
		encoding: "utf-8",
		stdio: "pipe"
	};
	const changed = execSync("git diff --name-only --diff-filter=d HEAD", options);
	const untracked = execSync("git ls-files --others --exclude-standard", options);
	return [...changed.trim().split("\n"), ...untracked.trim().split("\n")].filter(Boolean);
}
function isLintableFile(filePath, extensions = DEFAULT_EXTENSIONS) {
	return extensions.some((extension) => filePath.endsWith(extension));
}
function findEntryPoints(sourceRoot) {
	return ENTRY_CANDIDATES.map((name) => join(sourceRoot, name)).filter((path) => {
		return existsSync(path);
	});
}
function getDependencyGraph(sourceRoot, entryPoints, runner = DEFAULT_SETTINGS.runner) {
	const output = execSync(`${runner} madge --json ${entryPoints.map((ep) => `"${ep}"`).join(" ")}`, {
		cwd: sourceRoot,
		encoding: "utf-8",
		stdio: [
			"pipe",
			"pipe",
			"pipe"
		],
		timeout: 3e4
	});
	return JSON.parse(output);
}
function invertGraph(graph, target) {
	const importers = [];
	for (const [file, dependencies] of Object.entries(graph)) if (dependencies.includes(target)) importers.push(file);
	return importers;
}
function findSourceRoot(filePath) {
	let current = dirname(filePath);
	while (current !== dirname(current)) {
		if (existsSync(join(current, "package.json"))) {
			const sourceDirectory = join(current, "src");
			if (existsSync(sourceDirectory)) return sourceDirectory;
			return current;
		}
		current = dirname(current);
	}
}
function readLintAttempts() {
	if (!existsSync(LINT_STATE_PATH)) return {};
	try {
		return JSON.parse(readFileSync(LINT_STATE_PATH, "utf-8"));
	} catch {
		return {};
	}
}
function writeLintAttempts(attempts) {
	mkdirSync(dirname(LINT_STATE_PATH), { recursive: true });
	writeFileSync(LINT_STATE_PATH, JSON.stringify(attempts));
}
function readStopAttempts() {
	if (!existsSync(STOP_STATE_PATH)) return 0;
	try {
		return JSON.parse(readFileSync(STOP_STATE_PATH, "utf-8"));
	} catch {
		return 0;
	}
}
function writeStopAttempts(count) {
	mkdirSync(dirname(STOP_STATE_PATH), { recursive: true });
	writeFileSync(STOP_STATE_PATH, JSON.stringify(count));
}
function stopDecision(input) {
	if (input.errorFiles.length === 0) {
		if (input.stopAttempts > 0) return { resetStopAttempts: true };
		return;
	}
	if (input.errorFiles.every((file) => {
		return findAttempts(file, input.lintAttempts) >= input.maxLintAttempts;
	})) return;
	if (input.stopAttempts >= DEFAULT_MAX_STOP_ATTEMPTS) return { reason: `Could not fix lint errors in: ${input.errorFiles.join(", ")}` };
	return {
		decision: "block",
		reason: `Lint errors remain in: ${input.errorFiles.join(", ")}. Fix them before stopping.`
	};
}
function clearStopAttempts() {
	if (existsSync(STOP_STATE_PATH)) unlinkSync(STOP_STATE_PATH);
}
function clearLintAttempts() {
	if (existsSync(LINT_STATE_PATH)) unlinkSync(LINT_STATE_PATH);
}
function resolveBustFiles(patterns) {
	const positive = patterns.filter((pattern) => !pattern.startsWith("!"));
	const negative = patterns.filter((pattern) => pattern.startsWith("!")).map((pattern) => pattern.slice(1));
	const matched = positive.flatMap((pattern) => globSync(pattern));
	if (negative.length === 0) return matched;
	const excluded = new Set(negative.flatMap((pattern) => globSync(pattern)));
	return matched.filter((file) => !excluded.has(file));
}
function shouldBustCache(patterns) {
	if (patterns.length === 0) return false;
	if (!existsSync(ESLINT_CACHE_PATH)) return false;
	const files = resolveBustFiles(patterns);
	if (files.length === 0) return false;
	const cacheMtime = statSync(ESLINT_CACHE_PATH).mtimeMs;
	return files.some((file) => statSync(file).mtimeMs > cacheMtime);
}
function clearCache() {
	if (existsSync(ESLINT_CACHE_PATH)) unlinkSync(ESLINT_CACHE_PATH);
}
function invalidateCacheEntries(filePaths) {
	if (filePaths.length === 0) return;
	if (!existsSync(ESLINT_CACHE_PATH)) return;
	const cache = createFromFile(ESLINT_CACHE_PATH);
	for (const file of filePaths) cache.removeEntry(file);
	cache.reconcile();
}
function runOxlint(filePath, extraFlags = [], runner = DEFAULT_SETTINGS.runner) {
	const flags = extraFlags.length > 0 ? `${extraFlags.join(" ")} ` : "";
	try {
		execSync(`${runner} oxlint ${flags}"${filePath}"`, { stdio: "pipe" });
		return;
	} catch (err_) {
		const err = err_;
		const stdout = err.stdout?.toString() ?? "";
		const stderr = err.stderr?.toString() ?? "";
		const message = err.message ?? "";
		return stdout || stderr || message;
	}
}
function runEslint(filePath, extraFlags = [], runner = DEFAULT_SETTINGS.runner) {
	const flags = ["--cache", ...extraFlags].join(" ");
	try {
		execSync(`${runner} eslint_d ${flags} "${filePath}"`, {
			env: {
				...process$1.env,
				ESLINT_IN_EDITOR: "true"
			},
			stdio: "pipe"
		});
		return;
	} catch (err_) {
		const err = err_;
		const stdout = err.stdout?.toString() ?? "";
		const stderr = err.stderr?.toString() ?? "";
		const message = err.message ?? "";
		return stdout || stderr || message;
	}
}
function restartDaemon(runner = DEFAULT_SETTINGS.runner) {
	const [command = "pnpm", ...prefixArgs] = runner.split(/\s+/);
	try {
		spawn(command, [
			...prefixArgs,
			"eslint_d",
			"restart"
		], {
			detached: true,
			env: {
				...process$1.env,
				ESLINT_IN_EDITOR: "true"
			},
			stdio: "ignore"
		}).on("error", () => {}).unref();
	} catch {}
}
function formatErrors(output) {
	return output.split("\n").filter((line) => /error/i.test(line)).slice(0, MAX_ERRORS);
}
function buildHookOutput(filePath, errors) {
	const errorText = errors.join("\n");
	const isTruncated = errors.length >= MAX_ERRORS;
	const userMessage = `⚠️ Lint errors in ${filePath}:\n${errorText}${isTruncated ? "\n..." : ""}`;
	return {
		decision: void 0,
		hookSpecificOutput: {
			additionalContext: `⚠️ Lint errors in ${filePath}:\n${errorText}${isTruncated ? "\n(run lint to view more)" : ""}`,
			hookEventName: "PostToolUse"
		},
		systemMessage: userMessage
	};
}
function lint(filePath, extraFlags = [], settings = DEFAULT_SETTINGS) {
	if (!isLintableFile(filePath)) return;
	if (shouldBustCache(settings.cacheBust)) clearCache();
	else invalidateCacheEntries(findImporters(filePath, settings.runner));
	const outputs = [];
	if (settings.oxlint) {
		const output = runOxlint(filePath, extraFlags, settings.runner);
		if (output !== void 0) outputs.push(output);
	}
	if (settings.eslint) {
		const output = runEslint(filePath, extraFlags, settings.runner);
		if (output !== void 0) outputs.push(output);
	}
	if (settings.eslint) restartDaemon(settings.runner);
	if (outputs.length > 0) {
		const errors = formatErrors(outputs.join("\n"));
		if (errors.length > 0) return buildHookOutput(filePath, errors);
	}
}
function main(targets, settings = DEFAULT_SETTINGS) {
	if (shouldBustCache(settings.cacheBust)) clearCache();
	else invalidateCacheEntries(getChangedFiles());
	let hasErrors = false;
	for (const target of targets) {
		const outputs = [];
		if (settings.oxlint) {
			const output = runOxlint(target, ["--color"], settings.runner);
			if (output !== void 0) outputs.push(output);
		}
		if (settings.eslint) {
			const output = runEslint(target, ["--color"], settings.runner);
			if (output !== void 0) outputs.push(output);
		}
		for (const output of outputs) {
			hasErrors = true;
			const filtered = output.split("\n").filter((line) => !line.startsWith("[")).join("\n").trim();
			if (filtered.length > 0) process$1.stderr.write(`${filtered}\n`);
		}
	}
	if (settings.eslint) restartDaemon(settings.runner);
	if (hasErrors) process$1.exit(1);
}
function parseFrontmatter(content) {
	const fields = /* @__PURE__ */ new Map();
	const frontmatter = /^---\n([\s\S]*?)\n---/m.exec(content)?.[1];
	if (frontmatter === void 0) return fields;
	for (const line of frontmatter.split("\n")) {
		const colon = line.indexOf(":");
		if (colon > 0) {
			const key = line.slice(0, colon).trim();
			const value = line.slice(colon + 1).trim().replace(/^["']|["']$/g, "");
			fields.set(key, value);
		}
	}
	return fields;
}
function endsWithSegment(haystack, needle) {
	if (haystack === needle) return true;
	if (!needle.includes("/")) return false;
	return haystack.endsWith(`/${needle}`);
}
function findAttempts(file, lintAttempts) {
	if (file in lintAttempts) return lintAttempts[file];
	const normalized = file.replaceAll("\\", "/");
	for (const [key, count] of Object.entries(lintAttempts)) {
		const normalizedKey = key.replaceAll("\\", "/");
		if (endsWithSegment(normalizedKey, normalized) || endsWithSegment(normalized, normalizedKey)) return count;
	}
	return 0;
}
function findImporters(filePath, runner = DEFAULT_SETTINGS.runner) {
	const absPath = resolve(filePath);
	const sourceRoot = findSourceRoot(absPath);
	if (sourceRoot === void 0) return [];
	const entryPoints = findEntryPoints(sourceRoot);
	if (entryPoints.length === 0) return [];
	try {
		return invertGraph(getDependencyGraph(sourceRoot, entryPoints, runner), relative(sourceRoot, absPath).replaceAll("\\", "/")).map((file) => join(sourceRoot, file));
	} catch {
		return [];
	}
}
if (process$1.argv[1]?.endsWith("scripts/lint.ts") === true) {
	const settings = readSettings();
	main(process$1.argv.length > 2 ? process$1.argv.slice(2) : ["."], settings);
}

//#endregion
export { runOxlint as C, writeStopAttempts as D, writeLintAttempts as E, runEslint as S, stopDecision as T, readLintAttempts as _, clearStopAttempts as a, resolveBustFiles as b, formatErrors as c, invalidateCacheEntries as d, invertGraph as f, main as g, lint as h, clearLintAttempts as i, getChangedFiles as l, isProtectedFile as m, buildHookOutput as n, findEntryPoints as o, isLintableFile as p, clearCache as r, findSourceRoot as s, DEFAULT_CACHE_BUST as t, getDependencyGraph as u, readSettings as v, shouldBustCache as w, restartDaemon as x, readStopAttempts as y };