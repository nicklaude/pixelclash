import type * as THREE_TYPES from 'three';

declare global {
    namespace THREE {
        export type Scene = THREE_TYPES.Scene;
        export type PerspectiveCamera = THREE_TYPES.PerspectiveCamera;
        export type WebGLRenderer = THREE_TYPES.WebGLRenderer;
        export type Mesh = THREE_TYPES.Mesh;
        export type BoxGeometry = THREE_TYPES.BoxGeometry;
        export type SphereGeometry = THREE_TYPES.SphereGeometry;
        export type Raycaster = THREE_TYPES.Raycaster;
        export type Vector2 = THREE_TYPES.Vector2;
        export type Vector3 = THREE_TYPES.Vector3;
        export type Color = THREE_TYPES.Color;
        export type Material = THREE_TYPES.Material;
        export type MeshLambertMaterial = THREE_TYPES.MeshLambertMaterial;
        export type MeshStandardMaterial = THREE_TYPES.MeshStandardMaterial;
        export type MeshBasicMaterial = THREE_TYPES.MeshBasicMaterial;
        export type AmbientLight = THREE_TYPES.AmbientLight;
        export type DirectionalLight = THREE_TYPES.DirectionalLight;
        export type HemisphereLight = THREE_TYPES.HemisphereLight;
        export type PointLight = THREE_TYPES.PointLight;
        export type Fog = THREE_TYPES.Fog;
        export type PlaneGeometry = THREE_TYPES.PlaneGeometry;
        export type RingGeometry = THREE_TYPES.RingGeometry;
    }

    const THREE: typeof THREE_TYPES;
}

export {};
