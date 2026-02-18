/**
 * Spatial Hash Grid for efficient collision detection
 *
 * Instead of O(n*m) collision checks, spatial hashing provides O(n) average case
 * by only checking entities in the same or adjacent grid cells.
 *
 * Performance: With 500 projectiles and 100 enemies, we go from 50,000 checks
 * to approximately 500-1000 checks per frame (entities only check their cell + neighbors).
 */

export interface SpatialEntity {
    x: number;
    y: number;
}

export class SpatialHash<T extends SpatialEntity> {
    private cellSize: number;
    private cells: Map<number, T[]>;
    private entityCells: Map<T, number>;

    // Reusable arrays to avoid allocations
    private nearbyResult: T[] = [];

    constructor(cellSize: number = 64) {
        this.cellSize = cellSize;
        this.cells = new Map();
        this.entityCells = new Map();
    }

    /**
     * Get cell key from world coordinates
     */
    private getKey(x: number, y: number): number {
        const cellX = Math.floor(x / this.cellSize);
        const cellY = Math.floor(y / this.cellSize);
        // Use a large prime for y to minimize collisions
        return cellX + cellY * 10007;
    }

    /**
     * Clear all entities from the grid
     */
    clear(): void {
        this.cells.clear();
        this.entityCells.clear();
    }

    /**
     * Insert an entity into the grid
     */
    insert(entity: T): void {
        const key = this.getKey(entity.x, entity.y);

        let cell = this.cells.get(key);
        if (!cell) {
            cell = [];
            this.cells.set(key, cell);
        }
        cell.push(entity);
        this.entityCells.set(entity, key);
    }

    /**
     * Insert multiple entities (more efficient than individual inserts)
     */
    insertAll(entities: T[]): void {
        for (const entity of entities) {
            this.insert(entity);
        }
    }

    /**
     * Remove an entity from the grid
     */
    remove(entity: T): void {
        const key = this.entityCells.get(entity);
        if (key === undefined) return;

        const cell = this.cells.get(key);
        if (cell) {
            const idx = cell.indexOf(entity);
            if (idx !== -1) {
                // Swap-remove for O(1) removal
                const last = cell.pop()!;
                if (idx < cell.length) {
                    cell[idx] = last;
                }
            }
        }
        this.entityCells.delete(entity);
    }

    /**
     * Update an entity's position in the grid
     * Only re-hashes if the entity moved to a different cell
     */
    update(entity: T): void {
        const oldKey = this.entityCells.get(entity);
        const newKey = this.getKey(entity.x, entity.y);

        if (oldKey === newKey) return;

        // Remove from old cell
        if (oldKey !== undefined) {
            const oldCell = this.cells.get(oldKey);
            if (oldCell) {
                const idx = oldCell.indexOf(entity);
                if (idx !== -1) {
                    // Swap-remove
                    const last = oldCell.pop()!;
                    if (idx < oldCell.length) {
                        oldCell[idx] = last;
                    }
                }
            }
        }

        // Add to new cell
        let newCell = this.cells.get(newKey);
        if (!newCell) {
            newCell = [];
            this.cells.set(newKey, newCell);
        }
        newCell.push(entity);
        this.entityCells.set(entity, newKey);
    }

    /**
     * Get all entities in the same cell and neighboring cells as the given position.
     * Returns a reused array - do not store references to it!
     */
    getNearby(x: number, y: number): readonly T[] {
        // Clear result array (reuse to avoid allocation)
        this.nearbyResult.length = 0;

        const cellX = Math.floor(x / this.cellSize);
        const cellY = Math.floor(y / this.cellSize);

        // Check 3x3 grid of cells around the position
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const key = (cellX + dx) + (cellY + dy) * 10007;
                const cell = this.cells.get(key);
                if (cell) {
                    for (const entity of cell) {
                        this.nearbyResult.push(entity);
                    }
                }
            }
        }

        return this.nearbyResult;
    }

    /**
     * Get the number of occupied cells (for debugging)
     */
    get cellCount(): number {
        return this.cells.size;
    }

    /**
     * Get total entities tracked (for debugging)
     */
    get entityCount(): number {
        return this.entityCells.size;
    }
}
