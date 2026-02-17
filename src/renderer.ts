import { GRID_SIZE, CELL_SIZE, GRID_OFFSET, PATH, NEXUS_X, NEXUS_Z, getPathCells } from './config';
import { Vec3 } from './types';

export class Renderer {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    groundMeshes: THREE.Mesh[] = [];
    nexusMesh!: THREE.Mesh;
    pathCells: Set<string>;

    // Reusable geometries
    boxGeo!: THREE.BoxGeometry;
    sphereGeo!: THREE.SphereGeometry;

    // Mouse/raycasting
    raycaster: THREE.Raycaster;
    mouse: THREE.Vector2;
    groundPlane!: THREE.Mesh;

    // Camera orbit
    private cameraAngle = Math.PI / 4;
    private cameraHeight = 28;
    private cameraDistance = 32;
    private targetPos = { x: GRID_SIZE * CELL_SIZE / 2 + GRID_OFFSET, z: GRID_SIZE * CELL_SIZE / 2 + GRID_OFFSET };
    private isDragging = false;
    private lastMouse = { x: 0, y: 0 };

    constructor(canvas: HTMLCanvasElement) {
        this.pathCells = getPathCells();

        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a1a2e);
        this.scene.fog = new THREE.Fog(0x1a1a2e, 50, 80);

        // Camera
        this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 200);
        this.updateCamera();

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        // Raycaster
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        // Shared geometries
        this.boxGeo = new THREE.BoxGeometry(1, 1, 1);
        this.sphereGeo = new THREE.SphereGeometry(0.3, 6, 6);

        this.setupLighting();
        this.setupGround();
        this.setupNexus();
        this.setupPath();
        this.setupInputs(canvas);

        window.addEventListener('resize', () => this.onResize());
    }

    private setupLighting() {
        // Ambient light
        const ambient = new THREE.AmbientLight(0x404060, 0.6);
        this.scene.add(ambient);

        // Directional light (sun)
        const dir = new THREE.DirectionalLight(0xffeedd, 1.0);
        dir.position.set(20, 30, 10);
        dir.castShadow = true;
        dir.shadow.mapSize.width = 2048;
        dir.shadow.mapSize.height = 2048;
        dir.shadow.camera.near = 1;
        dir.shadow.camera.far = 80;
        dir.shadow.camera.left = -30;
        dir.shadow.camera.right = 30;
        dir.shadow.camera.top = 30;
        dir.shadow.camera.bottom = -30;
        this.scene.add(dir);

        // Hemisphere for nice ambient fill
        const hemi = new THREE.HemisphereLight(0x6688cc, 0x223344, 0.3);
        this.scene.add(hemi);
    }

    private setupGround() {
        // Invisible plane for raycasting
        const planeGeo = new THREE.PlaneGeometry(200, 200);
        const planeMat = new THREE.MeshBasicMaterial({ visible: false });
        this.groundPlane = new THREE.Mesh(planeGeo, planeMat);
        this.groundPlane.rotation.x = -Math.PI / 2;
        this.groundPlane.position.y = 0;
        this.scene.add(this.groundPlane);

        // Grid tiles
        for (let x = 0; x < GRID_SIZE; x++) {
            for (let z = 0; z < GRID_SIZE; z++) {
                const key = `${x},${z}`;
                const isPath = this.pathCells.has(key);
                const isNexus = x === NEXUS_X && z === NEXUS_Z;
                if (isPath || isNexus) continue;

                const color = ((x + z) % 2 === 0) ? 0x2a3a2a : 0x253525;
                const mat = new THREE.MeshLambertMaterial({ color });
                const mesh = new THREE.Mesh(this.boxGeo, mat);
                mesh.scale.set(CELL_SIZE * 0.95, 0.2, CELL_SIZE * 0.95);
                mesh.position.set(
                    x * CELL_SIZE + CELL_SIZE / 2 + GRID_OFFSET,
                    -0.1,
                    z * CELL_SIZE + CELL_SIZE / 2 + GRID_OFFSET
                );
                mesh.receiveShadow = true;
                mesh.userData = { gridX: x, gridZ: z, type: 'ground' };
                this.scene.add(mesh);
                this.groundMeshes.push(mesh);
            }
        }
    }

    private setupPath() {
        for (const key of this.pathCells) {
            const [x, z] = key.split(',').map(Number);
            const mat = new THREE.MeshLambertMaterial({ color: 0x3d3328 });
            const mesh = new THREE.Mesh(this.boxGeo, mat);
            mesh.scale.set(CELL_SIZE * 0.95, 0.15, CELL_SIZE * 0.95);
            mesh.position.set(
                x * CELL_SIZE + CELL_SIZE / 2 + GRID_OFFSET,
                -0.15,
                z * CELL_SIZE + CELL_SIZE / 2 + GRID_OFFSET
            );
            mesh.receiveShadow = true;
            this.scene.add(mesh);
        }
    }

    private setupNexus() {
        // Nexus: glowing central tower
        const mat = new THREE.MeshStandardMaterial({
            color: 0x4488ff,
            emissive: 0x2244aa,
            emissiveIntensity: 0.5,
            metalness: 0.3,
            roughness: 0.4,
        });
        this.nexusMesh = new THREE.Mesh(this.boxGeo, mat);
        this.nexusMesh.scale.set(CELL_SIZE * 1.5, 4, CELL_SIZE * 1.5);
        this.nexusMesh.position.set(
            NEXUS_X * CELL_SIZE + CELL_SIZE / 2 + GRID_OFFSET,
            2,
            NEXUS_Z * CELL_SIZE + CELL_SIZE / 2 + GRID_OFFSET
        );
        this.nexusMesh.castShadow = true;
        this.scene.add(this.nexusMesh);

        // Nexus glow point light
        const light = new THREE.PointLight(0x4488ff, 1.5, 15);
        light.position.copy(this.nexusMesh.position);
        light.position.y = 4;
        this.scene.add(light);
    }

    private setupInputs(canvas: HTMLCanvasElement) {
        // Right-click drag to orbit
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        canvas.addEventListener('mousedown', (e) => {
            if (e.button === 2) {
                this.isDragging = true;
                this.lastMouse = { x: e.clientX, y: e.clientY };
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                const dx = e.clientX - this.lastMouse.x;
                const dy = e.clientY - this.lastMouse.y;
                this.cameraAngle += dx * 0.005;
                this.cameraHeight = Math.max(8, Math.min(50, this.cameraHeight - dy * 0.1));
                this.lastMouse = { x: e.clientX, y: e.clientY };
                this.updateCamera();
            }
        });

        window.addEventListener('mouseup', (e) => {
            if (e.button === 2) this.isDragging = false;
        });

        // Scroll to zoom
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            this.cameraDistance = Math.max(15, Math.min(60, this.cameraDistance + e.deltaY * 0.03));
            this.updateCamera();
        }, { passive: false });
    }

    private updateCamera() {
        this.camera.position.set(
            this.targetPos.x + Math.cos(this.cameraAngle) * this.cameraDistance,
            this.cameraHeight,
            this.targetPos.z + Math.sin(this.cameraAngle) * this.cameraDistance
        );
        this.camera.lookAt(this.targetPos.x, 0, this.targetPos.z);
    }

    gridToWorld(gx: number, gz: number): Vec3 {
        return {
            x: gx * CELL_SIZE + CELL_SIZE / 2 + GRID_OFFSET,
            y: 0,
            z: gz * CELL_SIZE + CELL_SIZE / 2 + GRID_OFFSET,
        };
    }

    worldToGrid(wx: number, wz: number): { x: number; z: number } | null {
        const gx = Math.floor((wx - GRID_OFFSET) / CELL_SIZE);
        const gz = Math.floor((wz - GRID_OFFSET) / CELL_SIZE);
        if (gx < 0 || gx >= GRID_SIZE || gz < 0 || gz >= GRID_SIZE) return null;
        return { x: gx, z: gz };
    }

    getMouseGridPos(event: MouseEvent): { x: number; z: number } | null {
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const hits = this.raycaster.intersectObject(this.groundPlane);
        if (hits.length === 0) return null;
        const point = hits[0].point;
        return this.worldToGrid(point.x, point.z);
    }

    createTowerMesh(type: string, color: number, height: number): THREE.Mesh {
        const mat = new THREE.MeshStandardMaterial({
            color,
            metalness: 0.4,
            roughness: 0.5,
        });
        const mesh = new THREE.Mesh(this.boxGeo, mat);
        mesh.scale.set(CELL_SIZE * 0.6, height, CELL_SIZE * 0.6);
        mesh.castShadow = true;
        this.scene.add(mesh);
        return mesh;
    }

    createRangeIndicator(range: number): THREE.Mesh {
        const geo = new THREE.RingGeometry(0, range * CELL_SIZE, 32);
        const mat = new THREE.MeshBasicMaterial({
            color: 0x4488ff,
            transparent: true,
            opacity: 0.15,
            side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = 0.05;
        this.scene.add(mesh);
        return mesh;
    }

    createEnemyMesh(color: number, size: number): THREE.Mesh {
        const mat = new THREE.MeshStandardMaterial({
            color,
            metalness: 0.2,
            roughness: 0.6,
        });
        const mesh = new THREE.Mesh(this.boxGeo, mat);
        mesh.scale.set(size * CELL_SIZE * 0.7, size * CELL_SIZE * 0.7, size * CELL_SIZE * 0.7);
        mesh.castShadow = true;
        this.scene.add(mesh);
        return mesh;
    }

    createHealthBar(): THREE.Mesh {
        const geo = new THREE.PlaneGeometry(1.5, 0.15);
        const mat = new THREE.MeshBasicMaterial({ color: 0x44ff44, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = -Math.PI / 2;
        this.scene.add(mesh);
        return mesh;
    }

    createProjectileMesh(type: string): THREE.Mesh {
        let color = 0xffcc00;
        if (type === 'zap') color = 0x44bbee;
        if (type === 'cannonball') color = 0xff6622;

        const mat = new THREE.MeshBasicMaterial({ color });
        const mesh = new THREE.Mesh(this.sphereGeo, mat);
        if (type === 'cannonball') mesh.scale.set(1.5, 1.5, 1.5);
        this.scene.add(mesh);
        return mesh;
    }

    removeMesh(mesh: THREE.Mesh) {
        this.scene.remove(mesh);
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
            if (Array.isArray(mesh.material)) {
                mesh.material.forEach(m => m.dispose());
            } else {
                (mesh.material as THREE.Material).dispose();
            }
        }
    }

    highlightCell(gx: number, gz: number, valid: boolean) {
        // Find ground mesh at this position
        for (const m of this.groundMeshes) {
            if (m.userData.gridX === gx && m.userData.gridZ === gz) {
                (m.material as THREE.MeshLambertMaterial).emissive = new THREE.Color(
                    valid ? 0x004400 : 0x440000
                );
                return;
            }
        }
    }

    clearHighlights() {
        for (const m of this.groundMeshes) {
            (m.material as THREE.MeshLambertMaterial).emissive = new THREE.Color(0x000000);
        }
    }

    render() {
        // Animate nexus
        if (this.nexusMesh) {
            this.nexusMesh.rotation.y += 0.005;
            const pulse = 0.5 + Math.sin(Date.now() * 0.003) * 0.2;
            (this.nexusMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse;
        }

        this.renderer.render(this.scene, this.camera);
    }

    private onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
}
