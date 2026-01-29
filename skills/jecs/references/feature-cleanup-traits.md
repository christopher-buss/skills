---
name: feature-cleanup-traits
description:
    Use when configuring automatic cleanup behavior for component/entity
    deletion in jecs
---

# Jecs Cleanup Traits

Cleanup traits define what happens when components or relationship targets are
deleted.

## Cleanup Actions

| Action   | Effect                                           |
| -------- | ------------------------------------------------ |
| `Remove` | Remove the component from all entities (default) |
| `Delete` | Delete all entities that have the component      |

## Cleanup Conditions

| Condition        | Triggers When                       |
| ---------------- | ----------------------------------- |
| `OnDelete`       | The component/tag itself is deleted |
| `OnDeleteTarget` | A relationship target is deleted    |

## Configuration

Apply traits as pairs on components:

```ts
import { Delete, OnDelete, OnDeleteTarget, pair, Remove } from "@rbxts/jecs";

// (OnDelete, Remove) - Default behavior
const Tag = ecs.entity();
ecs.add(Tag, pair(OnDelete, Remove));

// (OnDelete, Delete) - Cascade deletion
const Critical = ecs.entity();
ecs.add(Critical, pair(OnDelete, Delete));
```

## OnDelete Behaviors

### OnDelete + Remove (Default)

When component deleted, remove it from all entities.

```ts
const Buff = ecs.entity();
ecs.add(Buff, pair(OnDelete, Remove));

const entity = ecs.entity();
ecs.add(entity, Buff);

ecs.delete(Buff);
ecs.has(entity, Buff); // false (removed)
ecs.contains(entity); // true (still exists)
```

### OnDelete + Delete

When component deleted, delete all entities that have it.

```ts
const Temporary = ecs.entity();
ecs.add(Temporary, pair(OnDelete, Delete));

const entity = ecs.entity();
ecs.add(entity, Temporary);

ecs.delete(Temporary);
ecs.contains(entity); // false (deleted)
```

## OnDeleteTarget Behaviors

For relationships - trigger when target entity is deleted.

### OnDeleteTarget + Remove

Remove relationship when target deleted.

```ts
const OwnedBy = ecs.component();
ecs.add(OwnedBy, pair(OnDeleteTarget, Remove));

const loot = ecs.entity();
const player = ecs.entity();
ecs.add(loot, pair(OwnedBy, player));

ecs.delete(player);
ecs.has(loot, pair(OwnedBy, player)); // false
ecs.contains(loot); // true (loot still exists)
```

### OnDeleteTarget + Delete (Hierarchy)

Delete entities when their relationship target is deleted.

```ts
// ChildOf has this built-in
const CustomChildOf = ecs.component();
ecs.add(CustomChildOf, pair(OnDeleteTarget, Delete));

const parent = ecs.entity();
const child = ecs.entity();
ecs.add(child, pair(CustomChildOf, parent));

ecs.delete(parent);
ecs.contains(child); // false (cascaded)
```

**Note:** `ChildOf` has this trait built-in.

## Built-in Traits

| Component | Traits                                  |
| --------- | --------------------------------------- |
| `ChildOf` | `(OnDeleteTarget, Delete)`, `Exclusive` |

## Common Patterns

**Faction membership:**

```ts
const MemberOf = ecs.component();
ecs.add(MemberOf, pair(OnDeleteTarget, Remove));
// Deleting faction removes membership, keeps entities
```

**Scene hierarchy:**

```ts
const InScene = ecs.component();
ecs.add(InScene, pair(OnDeleteTarget, Delete));
// Deleting scene deletes all entities in it
```

**Equipment slots:**

```ts
const EquippedBy = ecs.component();
ecs.add(EquippedBy, pair(OnDeleteTarget, Remove));
// Player deletion removes equipment reference, keeps items
```

## Performance Note

Relationships increase archetype count. Each `pair(Relation, target)` creates
new archetypes. Cleanup traits help manage this but consider fragmentation for
heavy relationship use.

See [best-practices-archetypes](best-practices-archetypes.md) for fragmentation
details.

<!--
Source references:
- how_to/100_cleanup_traits.luau
-->
