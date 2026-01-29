---
name: best-practices-archetypes
description: |
    Use when understanding archetype storage, entity transitions, or dealing
    with fragmentation in jecs
---

# Jecs Archetypes

Archetypes are the core storage unit. Understanding them helps optimize
performance.

## What is an Archetype?

An archetype represents a unique combination of components. All entities with
exactly the same component set belong to the same archetype.

```ts
const Position = ecs.component<Vector3>();
const Velocity = ecs.component<Vector3>();
const Mass = ecs.component<number>();

const e1 = ecs.entity();
ecs.set(e1, Position, Vector3.zero); // creates archetype [Position]
ecs.set(e1, Velocity, Vector3.zero); // moves to archetype [Position, Velocity]

const e2 = ecs.entity();
ecs.set(e2, Position, Vector3.zero); // archetype [Position] exists
ecs.set(e2, Velocity, Vector3.zero); // archetype [Position, Velocity] exists
ecs.set(e2, Mass, 100); // creates archetype [Position, Velocity, Mass]

// e1 in [Position, Velocity]
// e2 in [Position, Velocity, Mass]
```

## Archetype Transitions

When adding/removing components, entities move between archetypes:

1. Remove entity from old archetype's entity list
2. Copy component data to new archetype's columns
3. Add entity to new archetype's entity list
4. Update entity record (archetype pointer, row index)

**This is why add/remove is more expensive than set.** Setting values doesn't
change archetypes.

## Archetype Graph

Archetypes form a cached graph:

```text
ROOT_ARCHETYPE
    └── +Position → [Position]
                        └── +Velocity → [Position, Velocity]
                                            └── +Mass → [Position, Velocity, Mass]
```

Edges are cached bidirectionally. Adding a component follows an edge; if no edge
exists, a new archetype is created.

## Fragmentation

Fragmentation occurs when entities spread across many archetypes, especially
with relationships.

```ts
const Likes = ecs.component();

ecs.add(e1, pair(Likes, alice)); // archetype [pair(Likes, alice)]
ecs.add(e2, pair(Likes, bob)); // archetype [pair(Likes, bob)]
ecs.add(e3, pair(Likes, charlie)); // archetype [pair(Likes, charlie)]
// 3 different archetypes!
```

**Impact:**

- More archetypes = more archetype creation overhead
- Queries must iterate more archetypes
- Wildcard indices add registration overhead

## Reducing Fragmentation

**Use shared components instead of unique relationships:**

```ts
// BAD: One archetype per target
ecs.add(entity, pair(Likes, uniqueTarget));

// BETTER: Shared tag when relationship data isn't needed
const LikesSomeone = tag();
ecs.add(entity, LikesSomeone);
ecs.set(entity, LikesTarget, targetEntity); // Store target as data
```

**Batch component additions:**

```ts
import { bulk_insert } from "@rbxts/jecs";

// BAD: Multiple archetype transitions
ecs.set(entity, Position, Vector3.zero);
ecs.set(entity, Velocity, Vector3.zero);
ecs.set(entity, Mass, 100);

// BETTER: Single transition
bulk_insert(
	ecs,
	entity,
	[Position, Velocity, Mass],
	[Vector3.zero, Vector3.zero, 100],
);
```

## Archetype Access

For maximum performance, access archetype data directly:

```ts
const query = ecs.query(Position, Velocity).cached();

for (const archetype of query.archetypes()) {
	const entities = archetype.entities;
	const positions = archetype.columns_map[Position];
	const velocities = archetype.columns_map[Velocity];

	// Direct column access - no function call overhead
	for (let index = 0; index < entities.size(); index++) {
		positions[index] = positions[index].add(velocities[index]);
	}
}
```

## Archetype Cleanup

Empty archetypes persist (for recycling). Call `cleanup()` to remove them:

```ts
// Remove empty archetypes
ecs.cleanup();
```

Useful after bulk entity deletion to free memory.

## Performance Guidelines

| Operation                  | Cost     | Notes                            |
| -------------------------- | -------- | -------------------------------- |
| `set` (existing component) | Low      | Same archetype                   |
| `add`/`remove`             | Medium   | Archetype transition             |
| New archetype creation     | High     | Graph update, query cache update |
| Query iteration            | Very low | Especially cached                |
| Direct archetype access    | Lowest   | No iterator overhead             |

**Rules of thumb:**

1. Minimize component add/remove during gameplay
2. Prefer `set` over `add`+`set`
3. Cache frequently-used queries
4. Use `bulk_insert` for entity initialization
5. Call `cleanup()` after mass deletions

<!--
Source references:
- how_to/030_archetypes.luau
- how_to/040_fragmentation.luau
-->
