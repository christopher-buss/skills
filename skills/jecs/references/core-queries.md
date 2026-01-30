---
name: core-queries
description:
    Use when querying entities by components, filtering, or caching queries in
    jecs
---

# Jecs Queries

Query, filter, and iterate entities with specific component combinations.

## Basic Query

```ts
const Position = world.component<Vector3>();
const Velocity = world.component<Vector3>();

// Iterate entities with both components
for (const [entity, position, velocity] of world.query(Position, Velocity)) {
	world.set(entity, Position, position.add(velocity));
}
```

Query returns entities that have **all** specified components.

## Query Filters

Refine queries with `with()` and `without()`.

```ts
const Walking = world.component();
const Flying = world.component();

// Must have Position, Velocity, Walking - exclude Flying
for (const [entity, position, velocity] of world
	.query(Position, Velocity)
	.with(Walking)
	.without(Flying)) {
	// Process walking entities
	world.set(entity, Position, position.add(velocity));
}
```

- `with(...)`: Must have these components (no values returned)
- `without(...)`: Must NOT have these components

## Cached Queries

Cache for repeated iteration (systems). Faster iteration, slightly slower
creation.

```ts
// Create once, reuse every frame
const movementQuery = world.query(Position, Velocity).cached();

// Fast iteration
for (const [entity, position, velocity] of movementQuery) {
	world.set(entity, Position, position.add(velocity));
}

// Also supports .iter()
for (const [entity, position, velocity] of movementQuery.iter()) {
	world.set(entity, Position, position.add(velocity));
}
```

**When to cache:**

- Frame-by-frame systems: **Cache**
- Ad-hoc/one-time queries: **Don't cache**
- Dynamic runtime conditions: **Don't cache**

## Query Methods

```ts
const query = world.query(Position, Velocity);

// Iterate
for (const [entity, position, velocity] of query) {
	world.set(entity, Position, position.add(velocity));
}

// Check entity membership
query.has(someEntity);

// Get archetypes directly (advanced)
const archetypes = query.archetypes();
```

## Direct Archetype Access

Maximum performance for hot paths - eliminates function call overhead.

```ts
const cached = world.query(Position, Velocity).cached();

for (const archetype of cached.archetypes()) {
	const entities = archetype.entities;
	const positions = archetype.columns_map[Position];
	const velocities = archetype.columns_map[Velocity];

	for (const [index, entity] of ipairs(entities)) {
		positions[index] = positions[index].add(velocities[index]);
	}
}
```

60-80% faster than iterator for tight loops.

## Entity Lookup

Find entities with specific tag/component.

```ts
// All entities with a component
for (const entity of world.each(Position)) {
	print(entity);
}

// All children of parent (ChildOf shortcut)
for (const child of world.children(parent)) {
	print(child);
}
```

## Wildcard Queries

Query relationships with any target.

```ts
import { pair, Wildcard } from "@rbxts/jecs";

const Likes = world.component();

// All entities that like something
for (const [entity] of world.query(pair(Likes, Wildcard))) {
	const target = world.target(entity, Likes);
	print(`${entity} likes ${target}`);
}
```

See [feature-pairs](feature-pairs.md) for relationship details.

## Query Tradeoffs

| Type             | Creation | Iteration | Best For          |
| ---------------- | -------- | --------- | ----------------- |
| Uncached         | Fast     | Normal    | Ad-hoc queries    |
| Cached           | Slow     | Fast      | Per-frame systems |
| Archetype access | -        | Fastest   | Hot paths         |

## Common Patterns

**System pattern:**

```ts
const physicsQuery = world.query(Position, Velocity, Mass).cached();

function physicsSystem(dt: number): void {
	for (const [entity, position, velocity, mass] of physicsQuery) {
		// Update physics
	}
}
```

**Find first matching entity:**

```ts
function findFirstTarget(): Entity | undefined {
	// eslint-disable-next-line no-unreachable-loop -- Intended to return first match
	for (const [entity] of world.query(Target).with(Active)) {
		return entity;
	}

	return undefined;
}
```

<!--
Source references:
- how_to/020_queries.luau
- how_to/021_query_operators.luau
- how_to/022_query_caching.luau
-->
