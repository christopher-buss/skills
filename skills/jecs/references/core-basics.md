---
name: core-basics
description: |
    Use when creating worlds, entities, components, tags, or singletons in jecs
---

# Jecs Core Basics

World, entities, components, tags, and singletons in jecs ECS.

## World Creation

```ts
import Jecs from "@rbxts/jecs";

const world = Jecs.world();
```

## Entities

Entities are unique IDs (48-bit: 24-bit index + 24-bit generation).

```ts
import { ECS_GENERATION, ECS_ID, Entity } from "@rbxts/jecs";

// Create entity
const entity = world.entity();

// Create at specific ID
world.entity(42 as Entity);

// Check existence
world.contains(entity); // true if alive with correct generation
world.exists(entity); // true if ID exists (ignores generation)

// Delete entity (removes all components, triggers cleanup)
world.delete(entity);

// Entity ID introspection
const index = ECS_ID(entity);
const generation = ECS_GENERATION(entity);
```

**Generation:** When entities are recycled, generation increments. Stale
references fail `contains()` check.

## Components

Components are typed data attached to entities. IDs occupy range 1-256.

```ts
import { Entity } from "@rbxts/jecs";

// Create typed component
const Position = world.component<Vector3>();
const Health = world.component<number>();

// Set component data
world.set(entity, Position, new Vector3(10, 20, 30));
world.set(entity, Health, 100);

// Get component data (returns T | undefined)
const position = world.get(entity, Position);
const health = world.get(entity, Health);
assert(health, "Entity must have health");

// Check component presence (up to 4)
world.has(entity, Position);
world.has(entity, Position, Health);

// Remove component
world.remove(entity, Position);

// Clear all components (keeps entity)
world.clear(entity);
```

**Mental Model:** Components = columns, Entities = rows, `set`/`get`/`remove` =
cell operations.

## Tags

Tags are components with no data (zero storage cost).

```ts
import { tag, Tag } from "@rbxts/jecs";

// Create tag (before world)
const Dead = tag();

// Or use regular entity as tag
const Enemy = world.entity();

// Add tag (not set!)
world.add(entity, Dead);
world.add(entity, Enemy);

// Check/remove same as components
world.has(entity, Dead);
world.remove(entity, Dead);
```

**Key Difference:** `world.add()` for tags, `world.set()` for data components.

## Singletons

Use component ID as both key and entity for global resources.

```ts
const TimeOfDay = world.component<number>();

// Set singleton
world.set(TimeOfDay, TimeOfDay, 12.5);

// Get singleton
const time = world.get(TimeOfDay, TimeOfDay);
```

## Entity Ranges

Reserve ID ranges for client/server separation.

```ts
// Restrict entity creation to range [1000, 5000]
world.range(1000, 5000);

// Open-ended range (5000+)
world.range(5000);
```

## Component Metadata

Components are entities - set metadata using standard APIs.

```ts
import { Component, Name } from "@rbxts/jecs";

world.set(Position, Name, "Position");
print(world.has(Position, Component)); // true
```

## Quick Reference

| Operation        | Method                      |
| ---------------- | --------------------------- |
| Create world     | `world()`                   |
| Create entity    | `world.entity()`            |
| Create component | `world.component<T>()`      |
| Create tag       | `tag()`                     |
| Set data         | `world.set(e, comp, value)` |
| Add tag          | `world.add(e, tag)`         |
| Get data         | `world.get(e, comp)`        |
| Has component    | `world.has(e, comp...)`     |
| Remove           | `world.remove(e, comp)`     |
| Delete entity    | `world.delete(e)`           |
| Clear entity     | `world.clear(e)`            |

<!--
Source references:
- how_to/001_hello_world.luau
- how_to/002_entities.luau
- how_to/003_components.luau
- how_to/004_tags.luau
- how_to/005_entity_singletons.luau
- how_to/010_how_components_works.luau
-->
