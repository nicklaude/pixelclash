/**
 * ECS Module Index
 *
 * Entity Component System implementation for PixelClash.
 * Provides data-oriented design with typed arrays for high performance.
 */

// Core types and array factories
export * from './types';

// Entity archetypes
export * from './archetypes';

// ECS World manager
export { ECSWorld } from './world';

// Systems
export * from './systems';

// Renderers
export { EnemyRenderer } from './EnemyRenderer';
export { ProjectileRenderer } from './ProjectileRenderer';
