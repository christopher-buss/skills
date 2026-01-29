---
name: feature-signals
description:
    Use when subscribing to component changes with multiple listeners via
    added/changed/removed signals in jecs
---

# Jecs Signals

Signals allow multiple listeners for component lifecycle events. Unlike hooks,
you can have many subscribers and disconnect them.

## Signal Types

| Signal    | Triggers When           | Signature                        |
| --------- | ----------------------- | -------------------------------- |
| `added`   | Component added         | `(entity, id, value) => void`    |
| `changed` | Component value changed | `(entity, id, value) => void`    |
| `removed` | Component removed       | `(entity, id, deleted?) => void` |

## Basic Usage

```ts
const Position = world.component<Vector3>();

// Subscribe - returns disconnect function
const disconnect = world.added(Position, (entity, id, value) => {
	print(`Position added to ${entity}: ${value}`);
});

// Later: unsubscribe
disconnect();
```

## Multiple Listeners

```ts
const Health = world.component<number>();

// UI listener
const disconnectUI = world.changed(Health, (entity, id, value) => {
	updateHealthBar(entity, value);
});

// Sound listener
const disconnectSFX = world.changed(Health, (entity, id, value) => {
	playDamageSound();
});

// Remove individual listeners
disconnectUI();
```

## Signals for Pairs

Signals work with relationship pairs - receive full pair ID.

```ts
import { pair_second } from "@rbxts/jecs";

const Owns = world.component<number>();

// Listen to any ownership changes
world.added(Owns, (entity, id, value) => {
	const target = pair_second(world, id);
	print(`${entity} now owns ${target}`);
});
```

## Networking Example

Common pattern for replication:

```ts
type Storage = Record<number, unknown>;

const Networked = world.component();
const storages = new Map<Entity, Storage>();

for (const component of world.each(Networked)) {
	const storage: Storage = {};
	storages.set(component, storage);

	world.added(component, (entity, _, value) => {
		storage[entity] = value;
	});

	world.changed(component, (entity, _, value) => {
		storage[entity] = value;
	});

	world.removed(component, (entity) => {
		storage[entity] = "REMOVED";
	});
}
```

## Removed Signal

The `removed` signal receives a `deleted` flag like hooks.

```ts
world.removed(Health, (entity, id, deleted) => {
	if (deleted) {
		// Entity being deleted
		return;
	}

	// Component removed normally
	cleanupHealthEffects(entity);
});
```

## Signals vs Hooks

| Feature                 | Hooks                        | Signals                 |
| ----------------------- | ---------------------------- | ----------------------- |
| Listeners per component | 1                            | Multiple                |
| Disconnect support      | No                           | Yes                     |
| When to use             | Core behavior                | External observers      |
| Set via                 | `world.set(comp, OnAdd, fn)` | `world.added(comp, fn)` |

**Use hooks for:** Enforcing invariants, core component behavior **Use signals
for:** UI updates, networking, audio, multiple systems reacting to same change

## Quick Reference

```ts
// Subscribe
const dc1 = world.added(Component, fn);
const dc2 = world.changed(Component, fn);
const dc3 = world.removed(Component, fn);

// Unsubscribe
dc1();
dc2();
dc3();
```

<!--
Source references:
- src/jecs.d.ts (World.added, World.changed, World.removed)
- examples/networking/networking_send.luau
-->
