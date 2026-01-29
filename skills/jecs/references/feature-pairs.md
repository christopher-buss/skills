---
name: feature-pairs
description:
    Use when creating entity relationships, parent-child hierarchies, or
    querying pairs in jecs
---

# Jecs Pairs and Relationships

Pairs encode entity-to-entity relationships: `(Relationship, Target)`.

## Creating Pairs

```ts
import { IS_PAIR, pair, pair_first, pair_second, Wildcard } from "@rbxts/jecs";

const Likes = world.component();
const alice = world.entity();
const bob = world.entity();

// Add relationship
world.add(bob, pair(Likes, alice)); // bob likes alice

// Check relationship
world.has(bob, pair(Likes, alice)); // true
world.has(bob, pair(Likes, Wildcard)); // true (likes anyone)
```

## Pairs with Data

First element determines data type.

```ts
interface OwnershipData {
	since: string;
}

const Owns = world.component<OwnershipData>();
const car = world.entity();

world.set(bob, pair(Owns, car), { since: "2024-01-01" });

const data = world.get(bob, pair(Owns, car));
print(data?.since); // "2024-01-01"
```

## Built-in Relationships

### ChildOf (Parent-Child Hierarchy)

```ts
import { ChildOf, pair } from "@rbxts/jecs";

const parent = world.entity();
const child = world.entity();

world.add(child, pair(ChildOf, parent));

// Get parent
world.parent(child); // returns parent
world.target(child, ChildOf); // same thing

// Iterate children
for (const childEntity of world.children(parent)) {
	print(childEntity);
}

// Or via query
for (const [childEntity] of world.query(pair(ChildOf, parent))) {
	print(childEntity);
}
```

**Note:** ChildOf is exclusive (one parent only) and cascades deletion.

### Exclusive Relationships

Only one target allowed per relationship type.

```ts
import { Exclusive } from "@rbxts/jecs";

const BelongsTo = world.component();
world.add(BelongsTo, Exclusive);

world.add(item, pair(BelongsTo, player1));
world.add(item, pair(BelongsTo, player2));
// Now item belongs to player2 only (replaced)
```

## Querying Relationships

### Specific Target

```ts
// All entities that like alice
for (const [entity] of world.query(pair(Likes, alice))) {
	print(entity);
}
```

### Wildcard Target

```ts
// All entities that like someone
for (const [entity] of world.query(pair(Likes, Wildcard))) {
	const target = world.target(entity, Likes);
	print(`${entity} likes ${target}`);
}
```

### Wildcard Relationship

```ts
// All relationships with alice as target
for (const [entity] of world.query(pair(Wildcard, alice))) {
	print(`${entity} has relationship with alice`);
}
```

### Multiple Targets

Entity can have multiple targets for same relationship.

```ts
world.add(bob, pair(Likes, alice));
world.add(bob, pair(Likes, charlie));

// Iterate all targets
let nth = 0;
let target = world.target(bob, Likes, nth);
while (target !== undefined) {
	print(`bob likes ${target}`);
	nth++;
	target = world.target(bob, Likes, nth);
}
```

## Pair Introspection

```ts
const likesPair = pair(Likes, alice);

// Check if ID is a pair
IS_PAIR(likesPair); // true

// Extract parts
pair_first(world, likesPair); // Likes
pair_second(world, likesPair); // alice

// Raw extraction (no world needed)
ECS_PAIR_FIRST(likesPair); // raw ID
ECS_PAIR_SECOND(likesPair); // raw ID
```

## Combining with Components

```ts
const Position = world.component<Vector3>();
const Health = world.component<number>();

// Query children with Position and Health
for (const [entity, position, health] of world.query(
	Position,
	Health,
	pair(ChildOf, parent),
)) {
	print(`Child ${entity}: pos=${position}, health=${health}`);
}
```

## Use Cases

| Pattern     | Example                  |
| ----------- | ------------------------ |
| Hierarchy   | `pair(ChildOf, parent)`  |
| Ownership   | `pair(OwnedBy, player)`  |
| Targeting   | `pair(Targets, enemy)`   |
| Tagging     | `pair(InZone, zone)`     |
| Graph edges | `pair(ConnectsTo, node)` |

## Multi-Position Pattern

Use pairs for multiple values of same type.

```ts
const Begin = world.entity();
const End = world.entity();

world.set(entity, pair(Begin, Position), new Vector3(0, 0, 0));
world.set(entity, pair(End, Position), new Vector3(10, 20, 30));
```

<!--
Source references:
- how_to/013_pairs.luau
- how_to/041_entity_relationships.luau
- examples/queries/wildcards.luau
- examples/entities/hierarchy.luau
-->
