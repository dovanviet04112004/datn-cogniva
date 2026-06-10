/**
 * NeuralNetworkScene — 3D neural network animation cho landing hero.
 *
 * Render N particle node trong cầu (sphere distribution random), connect các
 * cặp gần nhau bằng line semi-transparent → trông như brain neural network.
 * Auto-rotate camera + pulse màu chậm để có cảm giác "alive".
 *
 * Performance:
 *   - Particles dùng `THREE.Points` với BufferGeometry (1 draw call).
 *   - Lines dùng `THREE.LineSegments` (1 draw call cho tất cả edges).
 *   - LOD: mobile (width < 768) giảm 50% particle.
 *   - Pause animation khi tab hidden (Page Visibility API).
 *
 * Theme-aware: detect `prefers-color-scheme` qua matchMedia, hoặc đọc CSS var.
 * Dark: nodes sáng (cyan), light: nodes tối (indigo).
 */
'use client';

import * as React from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

type Props = {
  /** Số node particle. Default 80 desktop / 40 mobile. */
  nodeCount?: number;
  /** Khoảng cách tối đa giữa 2 node để vẽ edge connect (world units). */
  connectDistance?: number;
  /** ClassName wrap canvas. */
  className?: string;
};

export function NeuralNetworkScene({
  nodeCount,
  connectDistance = 1.2,
  className,
}: Props) {
  // Detect mobile để giảm node count + tắt antialias
  const [isMobile, setIsMobile] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    setIsMobile(mq.matches);
    const handler = () => setIsMobile(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const effectiveNodeCount = nodeCount ?? (isMobile ? 40 : 80);

  return (
    <div className={className}>
      <Canvas
        camera={{ position: [0, 0, 5], fov: 50 }}
        dpr={isMobile ? 1 : Math.min(window.devicePixelRatio, 2)}
        gl={{ antialias: !isMobile, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.4} />
        <pointLight position={[5, 5, 5]} intensity={1} />
        <NeuralNet count={effectiveNodeCount} connectDistance={connectDistance} />
      </Canvas>
    </div>
  );
}

/**
 * Inner scene — generate random positions trong sphere, compute edges, animate.
 */
function NeuralNet({ count, connectDistance }: { count: number; connectDistance: number }) {
  const groupRef = React.useRef<THREE.Group>(null);
  const pointsRef = React.useRef<THREE.Points>(null);
  const linesRef = React.useRef<THREE.LineSegments>(null);

  // Detect dark mode 1 lần lúc mount
  const isDark = React.useMemo(() => {
    if (typeof window === 'undefined') return true;
    return document.documentElement.classList.contains('dark');
  }, []);

  // Pause khi tab hidden
  const isVisibleRef = React.useRef(true);
  React.useEffect(() => {
    const onVis = () => {
      isVisibleRef.current = document.visibilityState === 'visible';
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Generate positions trong sphere (Fibonacci spiral cho distribution đều)
  const positions = React.useMemo(() => {
    const arr = new Float32Array(count * 3);
    const radius = 2;
    for (let i = 0; i < count; i++) {
      // Random trong sphere bằng spherical coordinates
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const r = radius * Math.cbrt(Math.random()); // uniform trong volume
      arr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      arr[i * 3 + 2] = r * Math.cos(phi);
    }
    return arr;
  }, [count]);

  // Compute edges: cặp (i,j) với distance < connectDistance
  const edges = React.useMemo(() => {
    const edgeList: number[] = [];
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const dx = positions[i * 3]! - positions[j * 3]!;
        const dy = positions[i * 3 + 1]! - positions[j * 3 + 1]!;
        const dz = positions[i * 3 + 2]! - positions[j * 3 + 2]!;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < connectDistance) {
          edgeList.push(
            positions[i * 3]!,
            positions[i * 3 + 1]!,
            positions[i * 3 + 2]!,
            positions[j * 3]!,
            positions[j * 3 + 1]!,
            positions[j * 3 + 2]!,
          );
        }
      }
    }
    return new Float32Array(edgeList);
  }, [positions, count, connectDistance]);

  // Velocity per node — slow drift
  const velocities = React.useMemo(() => {
    const v = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) {
      v[i] = (Math.random() - 0.5) * 0.002;
    }
    return v;
  }, [count]);

  // Animate: rotate group + drift particles + recompute edges mỗi frame N
  const frameCount = React.useRef(0);
  useFrame((_, delta) => {
    if (!isVisibleRef.current) return;
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.1;
      groupRef.current.rotation.x += delta * 0.05;
    }

    // Drift particles
    if (pointsRef.current) {
      const pos = pointsRef.current.geometry.attributes.position as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < count; i++) {
        arr[i * 3]! += velocities[i * 3]!;
        arr[i * 3 + 1]! += velocities[i * 3 + 1]!;
        arr[i * 3 + 2]! += velocities[i * 3 + 2]!;
        // Bounce ngược nếu ra ngoài sphere bán kính 2.5
        const r = Math.sqrt(
          arr[i * 3]! ** 2 + arr[i * 3 + 1]! ** 2 + arr[i * 3 + 2]! ** 2,
        );
        if (r > 2.5) {
          velocities[i * 3]! *= -1;
          velocities[i * 3 + 1]! *= -1;
          velocities[i * 3 + 2]! *= -1;
        }
      }
      pos.needsUpdate = true;
    }

    // Recompute edges mỗi 10 frame (đủ smooth, không expensive)
    frameCount.current++;
    if (frameCount.current % 10 === 0 && pointsRef.current && linesRef.current) {
      const pos = pointsRef.current.geometry.attributes.position!.array as Float32Array;
      const newEdges: number[] = [];
      for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
          const dx = pos[i * 3]! - pos[j * 3]!;
          const dy = pos[i * 3 + 1]! - pos[j * 3 + 1]!;
          const dz = pos[i * 3 + 2]! - pos[j * 3 + 2]!;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d < connectDistance) {
            newEdges.push(
              pos[i * 3]!,
              pos[i * 3 + 1]!,
              pos[i * 3 + 2]!,
              pos[j * 3]!,
              pos[j * 3 + 1]!,
              pos[j * 3 + 2]!,
            );
          }
        }
      }
      const newArr = new Float32Array(newEdges);
      linesRef.current.geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(newArr, 3),
      );
      (linesRef.current.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
  });

  // Color scheme — Cogniva primary = indigo/violet
  const nodeColor = isDark ? '#a5b4fc' : '#6366f1'; // indigo-300 vs indigo-500
  const edgeColor = isDark ? '#6366f1' : '#a5b4fc';

  return (
    <group ref={groupRef}>
      {/* Particle nodes */}
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={count}
            array={positions}
            itemSize={3}
            args={[positions, 3]}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.08}
          color={nodeColor}
          transparent
          opacity={0.9}
          sizeAttenuation
        />
      </points>

      {/* Edges */}
      <lineSegments ref={linesRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={edges.length / 3}
            array={edges}
            itemSize={3}
            args={[edges, 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial color={edgeColor} transparent opacity={0.25} />
      </lineSegments>

      {/* Glow effect — sphere mờ trong tâm */}
      <CenterGlow isDark={isDark} />
    </group>
  );
}

function CenterGlow({ isDark }: { isDark: boolean }) {
  const meshRef = React.useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (meshRef.current) {
      // Pulse scale chậm
      const t = state.clock.getElapsedTime();
      const s = 1 + Math.sin(t * 0.5) * 0.1;
      meshRef.current.scale.setScalar(s);
    }
  });
  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[0.4, 32, 32]} />
      <meshBasicMaterial
        color={isDark ? '#818cf8' : '#6366f1'}
        transparent
        opacity={0.15}
      />
    </mesh>
  );
}

