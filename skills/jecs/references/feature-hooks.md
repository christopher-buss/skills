---
name: feature-hooks
description:
    Use when reacting to component add/change/remove with OnAdd, OnChange,
    OnRemove hooks in jecs
---

# Jecs Component Hooks

Hooks define behavior when components are added, changed, or removed. One hook
per type per component.

## Hook Types

| Hook       | Triggers When                       | Signature                        |
| ---------- | ----------------------------------- | -------------------------------- |
| `OnAdd`    | Component added with value          | `(entity, id, data) => void`     |
| `OnChange` | Existing component value changes    | `(entity, id, data) => void`     |
| `OnRemove` | Component removed or entity deleted | `(entity, id, deleted?) => void` |

## Setting Up Hooks

```ts
import { Entity, Id, OnAdd, OnChange, OnRemove } from "@rbxts/jecs";

const Transform = world.component<CFrame>();

world.set(Transform, OnAdd, (entity: Entity, id: Id<CFrame>, data: CFrame) => {
	print(`Transform added to ${entity}`);
});

world.set(
	Transform,
	OnChange,
	(entity: Entity, id: Id<CFrame>, data: CFrame) => {
		print(`Transform changed on ${entity} to ${data}`);
	},
);

world.set(
	Transform,
	OnRemove,
	(entity: Entity, id: Id<CFrame>, deleted?: true) => {
		if (deleted) {
			return; // Entity being deleted, skip cleanup
		}

		print(`Transform removed from ${entity}`);
	},
);
```

## OnAdd

Fires after value is set. Receives the component ID and value.

```ts
const Health = world.component<number>();

world.set(Health, OnAdd, (entity, id, value) => {
	// Initialize related state
	print(`${entity} now has ${value} health`);
});

// Triggers hook
world.set(entity, Health, 100);
```

## OnChange

Fires when existing component value is updated (not on initial add).

```ts
world.set(Health, OnChange, (entity, id, value) => {
	print(`Health changed to ${value}`);
});

world.set(entity, Health, 100); // OnAdd (not OnChange)
world.set(entity, Health, 50); // OnChange fires
```

## OnRemove

Fires when component is removed OR entity is deleted.

```ts
const Dead = world.component();

world.set(Health, OnRemove, (entity, id, deleted) => {
	if (deleted) {
		// Entity is being deleted - minimal cleanup only
		return;
	}

	// Normal removal - full cleanup
	world.remove(entity, Dead);
});
```

**The `deleted` flag:**

- `true`: Entity being deleted (all components removed)
- `undefined`: Single component removed normally

## Structural Changes in Hooks

You CAN call `world.add`, `world.remove`, `world.set` in hooks with caveats:

```ts
world.set(Health, OnRemove, (entity, id, deleted) => {
	if (deleted) {
		return; // IMPORTANT: Skip during deletion
	}

	// Safe to make changes
	world.remove(entity, HealthBar);
});
```

**DEBUG mode** (`Jecs.world(true)`) throws error if you make structural changes
when `deleted` is true.

## Hook Order with ChildOf

When parent deleted, children's OnRemove hooks fire first (if no cycles).

```ts
import { ChildOf, pair } from "@rbxts/jecs";

// Setup hierarchy
world.add(child, pair(ChildOf, parent));

// When parent deleted:
// 1. Child's OnRemove hooks fire
// 2. Parent's OnRemove hooks fire
world.delete(parent);
```

## Hooks for Pairs

Hooks on relationship receive the full pair ID.

```ts
import { pair_second } from "@rbxts/jecs";

world.set(ChildOf, OnAdd, (entity, id, _) => {
	const parentEntity = pair_second(world, id);
	print(`${entity} now child of ${parentEntity}`);
});
```

## Common Patterns

**Resource cleanup:**

```ts
const Model = world.component<Instance>();

world.set(Model, OnRemove, (entity, id, deleted) => {
	const model = world.get(entity, Model);
	model?.Destroy();
});
```

**Syncing state:**

```ts
const Position = world.component<Vector3>();
const Model = world.component<BasePart>();

world.set(Position, OnChange, (entity, id, position) => {
	const model = world.get(entity, Model);
	if (model) {
		model.CFrame = new CFrame(position);
	}
});
```

## Hooks vs Signals

| Feature        | Hooks           | Signals              |
| -------------- | --------------- | -------------------- |
| Per component  | One             | Multiple             |
| Return cleanup | No              | Yes (disconnect)     |
| Performance    | Faster          | Slightly slower      |
| Use case       | Core invariants | Multiple subscribers |

See [feature-signals](feature-signals.md) for signal-based listeners.

<!--
Source references:
- how_to/110_hooks.luau
- examples/hooks/cleanup.luau
-->
