/**
 * Generic object pool for reusing game objects and reducing GC pressure.
 * This is critical for particle systems where objects are created/destroyed rapidly.
 */
export class ParticlePool<T> {
    private pool: T[] = [];
    private factory: () => T;
    private reset: (obj: T) => void;
    private maxSize: number;

    constructor(
        factory: () => T,
        reset: (obj: T) => void,
        initialSize: number = 100,
        maxSize: number = 1000
    ) {
        this.factory = factory;
        this.reset = reset;
        this.maxSize = maxSize;

        // Pre-populate pool
        for (let i = 0; i < initialSize; i++) {
            this.pool.push(this.factory());
        }
    }

    /**
     * Get an object from the pool, creating a new one if needed
     */
    acquire(): T {
        if (this.pool.length > 0) {
            return this.pool.pop()!;
        }
        return this.factory();
    }

    /**
     * Return an object to the pool for reuse
     */
    release(obj: T): void {
        this.reset(obj);
        if (this.pool.length < this.maxSize) {
            this.pool.push(obj);
        }
    }

    /**
     * Release multiple objects at once
     */
    releaseAll(objects: T[]): void {
        for (const obj of objects) {
            this.release(obj);
        }
    }

    /**
     * Get current pool size (for debugging)
     */
    get size(): number {
        return this.pool.length;
    }
}
