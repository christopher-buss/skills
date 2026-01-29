---
name: best-practices-change-tracking
description:
    Use when implementing change detection, dirty tracking, or delta updates in
    jecs
---

# Jecs Change Tracking

Patterns for detecting added, changed, and removed components.

## Previous Value Pattern

Store previous values as relationship pairs to detect changes.

```ts
import { pair, Rest } from "@rbxts/jecs";

const Position = ecs.component<Vector3>();
const Previous = Rest; // Built-in entity for "previous" pattern

// Cached queries for each state
const added = ecs.query(Position).without(pair(Previous, Position)).cached();

const changed = ecs.query(Position, pair(Previous, Position)).cached();

const removed = ecs.query(pair(Previous, Position)).without(Position).cached();
```

## Processing Changes

```ts
// Process newly added
for (const [entity, position] of added) {
	print(`Added ${entity}: ${position}`);
	ecs.set(entity, pair(Previous, Position), position);
}

// Process changed (compare values)
for (const [entity, current, previous] of changed) {
	if (current !== previous) {
		// or deep compare
		print(`Changed ${entity}: ${previous} -> ${current}`);
		ecs.set(entity, pair(Previous, Position), current);
	}
}

// Process removed
for (const [entity] of removed.iter()) {
	print(`Removed from ${entity}`);
	ecs.remove(entity, pair(Previous, Position));
}
```

## Signal-Based Tracking

Use signals for immediate notification:

```ts
interface ChangeRecord<T> {
	added: Map<Entity, T>;
	changed: Map<Entity, T>;
	removed: Set<Entity>;
}

function trackComponent<T>(component: Entity<T>): ChangeRecord<T> {
	const record: ChangeRecord<T> = {
		added: new Map(),
		changed: new Map(),
		removed: new Set(),
	};

	ecs.added(component, (entity, _, value) => {
		record.added.set(entity, value);
	});

	ecs.changed(component, (entity, _, value) => {
		record.changed.set(entity, value);
	});

	ecs.removed(component, (entity) => {
		record.removed.add(entity);
	});

	return record;
}

// Usage
const positionChanges = trackComponent(Position);

// After frame, process and clear
function flushChanges() {
	for (const [entity, value] of positionChanges.added) {
		// Handle added
	}

	positionChanges.added.clear();
	positionChanges.changed.clear();
	positionChanges.removed.clear();
}
```

## Networking Delta Sync

Combine signals with batched sending:

```ts
const Networked = tag();
const storages = new Map<Entity, Map<Entity, unknown>>();

// Setup tracking for all networked components
for (const component of ecs.each(Networked)) {
	const storage = new Map<Entity, unknown>();
	storages.set(component, storage);

	ecs.added(component, (entity, _, value) => {
		storage.set(entity, value);
	});

	ecs.changed(component, (entity, _, value) => {
		storage.set(entity, value);
	});

	ecs.removed(component, (entity) => {
		storage.set(entity, "REMOVED");
	});
}

// Send delta each frame
function sendDelta() {
	const delta: Record<string, unknown> = {};

	for (const [component, storage] of storages) {
		if (storage.size() > 0) {
			delta[tostring(component)] = storage;
			storage.clear();
		}
	}

	if (next(delta)[0] !== undefined) {
		remotes.replication.FireAllClients(delta);
	}
}
```

## Dirty Flag Pattern

Simple boolean tracking:

```ts
const Dirty = tag();
const Position = ecs.component<Vector3>();

// Mark dirty on change
ecs.set(Position, OnChange, (entity) => {
	ecs.add(entity, Dirty);
});

// Process dirty entities
const dirtyQuery = ecs.query(Position).with(Dirty).cached();

function processDirty() {
	for (const [entity, position] of dirtyQuery) {
		syncToNetwork(entity, position);
		ecs.remove(entity, Dirty);
	}
}
```

## Comparison Methods

| Method         | Pros                          | Cons                          |
| -------------- | ----------------------------- | ----------------------------- |
| Previous pairs | Query-based, batch processing | Extra storage, manual sync    |
| Signals        | Immediate, no polling         | Memory for callbacks          |
| Dirty flag     | Simple, query-friendly        | Boolean only, no old value    |
| Hooks          | Single handler, fast          | Can't have multiple listeners |

## Best Practices

1. **Use Previous pairs** for frame-by-frame systems needing old values
2. **Use Signals** for multiple subscribers or immediate reaction
3. **Use Dirty flags** for simple "needs update" tracking
4. **Batch changes** - don't process every signal immediately
5. **Clear tracking state** at end of frame to prevent accumulation

<!--
Source references:
- examples/queries/changetracking.luau
- examples/networking/networking_send.luau
-->
