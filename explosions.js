(() => {
  'use strict';

  // Fiery crash explosion: a point-light flash, a burst of glowing particles
  // and an expanding shockwave ring. Particles arc under reduced gravity.
  const PARTICLE_COUNT = 40;
  const DURATION = 1.4;
  const PARTICLE_COLORS = [0xfff2a0, 0xffb02e, 0xff6a00, 0xd62800, 0x444444];
  const particleGeometry = new THREE.SphereGeometry(1, 8, 6);
  const shockwaveGeometry = new THREE.RingGeometry(0.8, 1, 32);
  // Lights are created once up front: adding or removing a light changes the
  // light count and forces every material in the scene to recompile (a hitch).
  const FLASH_POOL_SIZE = 4;

  // Craters are permanent, real dents: the ground shader discards the fragments inside each
  // crater's hole (see patchGround) and a lathe-turned bowl with a raised rim fills it.
  const MAX_CRATERS = 48;
  // Profile of a blast crater (unit radius = lip crest, unit height = depth): a deep, smooth,
  // funnel-shaped bowl with a small rounded bottom, a narrow lip and a wide, lumpy ejecta apron.
  const CRATER_PROFILE = [
    [0, -1], [0.2, -0.97], [0.35, -0.86], [0.5, -0.66], [0.65, -0.43], [0.8, -0.2],
    [0.92, -0.04], [0.99, 0.08], [1.04, 0.12], [1.12, 0.09], [1.3, 0.05], [1.6, 0.02], [2, 0]
  ];
  const CRATER_EDGE = 2;      // unit radius where the apron meets the ground
  const CRATER_HOLE = 1.4;    // ground hole radius, inside the opaque part of the apron
  const CRATER_FADE = 1.5;    // unit radius where the apron starts fading to transparent
  const CRATER_COLORS = [
    [0, 0x3b2a1c], [0.5, 0x5c4129], [0.9, 0x6e4e32], [1.05, 0x7a583a], [1.3, 0x6e4e32], [1.6, 0x1c140e], [CRATER_EDGE, 0x1c140e]
  ].map(([r, hex]) => [r, new THREE.Color(hex)]);

  function craterColor(r, target) {
    for (let i = 1; i < CRATER_COLORS.length; i++) {
      if (r <= CRATER_COLORS[i][0] || i === CRATER_COLORS.length - 1) {
        const [r0, c0] = CRATER_COLORS[i - 1];
        const [r1, c1] = CRATER_COLORS[i];
        return target.copy(c0).lerp(c1, THREE.MathUtils.clamp((r - r0) / (r1 - r0), 0, 1));
      }
    }
    return target;
  }

  // Each crater gets its own geometry so its rim is irregular (lumpy outline, uneven crest).
  function createBowlGeometry() {
    const curve = new THREE.SplineCurve(CRATER_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)));
    const points = curve.getPoints(72).map((p) => new THREE.Vector2(Math.max(p.x, 0), p.y));
    const geometry = new THREE.LatheGeometry(points, 64);
    const position = geometry.attributes.position;
    const colors = new Float32Array(position.count * 4);
    const phase = Array.from({ length: 4 }, () => Math.random() * Math.PI * 2);
    const color = new THREE.Color();
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const y = position.getY(i);
      const r = Math.hypot(x, z);
      const angle = Math.atan2(z, x);
      // Wobble fades out towards the apron's edge so it still meets the circular hole.
      const weight = THREE.MathUtils.clamp((CRATER_EDGE - r) / (CRATER_EDGE - 0.9), 0, 1);
      const wobble = 1 + weight * (0.04 * Math.sin(3 * angle + phase[0]) + 0.03 * Math.sin(5 * angle + phase[1]) + 0.02 * Math.sin(9 * angle + phase[2]));
      const crest = y > 0 ? 1 + 0.2 * Math.sin(2 * angle + phase[3]) * weight : 1;
      // Hummocks of thrown-out earth on the apron, growing in and fading out across it.
      const apron = Math.sin(Math.PI * THREE.MathUtils.clamp((r - 1.05) / (CRATER_EDGE - 1.05), 0, 1));
      // Never below the ground, or the grass would show through the apron.
      const lumps = apron * 0.03 * Math.max(0, Math.sin(5 * x + phase[0]) * Math.sin(5 * z + phase[1]) + 0.5 * Math.sin(11 * x + 3 * z + phase[2]));
      position.setXYZ(i, x * wobble, y * crest + lumps, z * wobble);
      craterColor(r, color);
      // The apron fades out so the ground's own grass pattern shows through gradually.
      const alpha = 1 - THREE.MathUtils.smoothstep(r, CRATER_FADE, CRATER_EDGE);
      colors.set([color.r, color.g, color.b, alpha], i * 4);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    geometry.computeVertexNormals();
    return geometry;
  }

  const bowlMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, roughness: 1, side: THREE.DoubleSide, flatShading: false });

  function createExplosions(scene, gravity) {
    const explosions = [];
    const craters = [];
    const flashPool = [];
    // x, z, hole radius per crater; radius 0 means unused.
    const craterUniform = { value: Array.from({ length: MAX_CRATERS }, () => new THREE.Vector3()) };
    for (let i = 0; i < FLASH_POOL_SIZE; i++) {
      const light = new THREE.PointLight(0xffaa33, 0, 25);
      scene.add(light);
      flashPool.push({ light, inUse: false });
    }

    // Cuts a hole in the ground material wherever a crater is.
    function patchGround(material) {
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uCraters = craterUniform;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vCraterXZ;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCraterXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>
varying vec2 vCraterXZ;
uniform vec3 uCraters[${MAX_CRATERS}];`)
          .replace('void main() {', `void main() {
  for (int i = 0; i < ${MAX_CRATERS}; i++) {
    if (distance(vCraterXZ, uCraters[i].xy) < uCraters[i].z) discard;
  }`);
      };
      material.needsUpdate = true;
    }

    function removeCrater(crater) {
      scene.remove(crater.group);
      crater.geometry.dispose();
      craterUniform.value[crater.slot].set(0, 0, 0);
    }

    function addCrater(position) {
      const radius = 1.3 + Math.random() * 0.5;
      // Carts of one train crash a few units apart. Overlapping craters would lay one's flat
      // apron across the other's pit, so a crash inside an existing crater's reach adds nothing.
      const overlaps = craters.some((other) => {
        const distance = Math.hypot(other.x - position.x, other.z - position.z);
        return distance < CRATER_EDGE * other.radius + radius || distance < CRATER_EDGE * radius + other.radius;
      });
      if (overlaps) return;

      // Past the limit, the oldest crater makes room.
      let slot = craters.length;
      if (craters.length >= MAX_CRATERS) {
        const oldest = craters.shift();
        removeCrater(oldest);
        slot = oldest.slot;
      }

      const depth = radius * (1.15 + Math.random() * 0.2);
      const group = new THREE.Group();
      group.position.set(position.x, 0.005, position.z);
      group.rotation.y = Math.random() * Math.PI * 2;

      const geometry = createBowlGeometry();
      const bowl = new THREE.Mesh(geometry, bowlMaterial);
      bowl.scale.set(radius, depth, radius);
      bowl.receiveShadow = true;
      group.add(bowl);

      scene.add(group);
      craterUniform.value[slot].set(position.x, position.z, radius * CRATER_HOLE * 0.98);
      craters.push({ group, slot, geometry, radius, x: position.x, z: position.z });
    }

    function clearCraters() {
      craters.forEach(removeCrater);
      craters.length = 0;
    }

    function spawn(position) {
      addCrater(position);
      const group = new THREE.Group();
      group.position.copy(position);
      group.position.y = Math.max(position.y, 0.1);

      const flash = flashPool.find((entry) => !entry.inUse) || null;
      if (flash) {
        flash.inUse = true;
        flash.light.position.copy(group.position);
      }

      // Every particle of an explosion fades together, so they share one material per colour.
      const materials = PARTICLE_COLORS.map((color) => new THREE.MeshBasicMaterial({ color, transparent: true }));
      const particles = [];
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const material = materials[Math.floor(Math.random() * materials.length)];
        const mesh = new THREE.Mesh(particleGeometry, material);
        const size = 0.2 + Math.random() * 0.4;
        mesh.scale.setScalar(size);
        const velocity = new THREE.Vector3(
          Math.random() - 0.5,
          Math.random() * 0.9 + 0.1,
          Math.random() - 0.5
        ).normalize().multiplyScalar(3 + Math.random() * 7);
        group.add(mesh);
        particles.push({ mesh, velocity, size });
      }

      const ringMaterial = new THREE.MeshBasicMaterial({
        color: 0xffd080,
        transparent: true,
        side: THREE.DoubleSide
      });
      const ring = new THREE.Mesh(shockwaveGeometry, ringMaterial);
      ring.rotation.x = -Math.PI / 2;
      group.add(ring);

      scene.add(group);
      explosions.push({ group, flash, materials, particles, ring, age: 0, duration: DURATION });
    }

    function update(dt) {
      for (let i = explosions.length - 1; i >= 0; i--) {
        const explosion = explosions[i];
        explosion.age += dt;
        const t = explosion.age / explosion.duration;

        if (t >= 1) {
          explosion.materials.forEach((material) => material.dispose());
          if (explosion.flash) {
            explosion.flash.light.intensity = 0;
            explosion.flash.inUse = false;
          }
          explosion.ring.material.dispose();
          scene.remove(explosion.group);
          explosions.splice(i, 1);
          continue;
        }

        if (explosion.flash) explosion.flash.light.intensity = 6 * Math.pow(1 - t, 3);
        explosion.materials.forEach((material) => { material.opacity = 1 - t * t; });

        explosion.particles.forEach(({ mesh, velocity, size }) => {
          velocity.y -= gravity * 0.4 * dt;
          mesh.position.addScaledVector(velocity, dt);
          mesh.scale.setScalar(size * (1 + t * 1.5) * (1 - t * 0.6));
        });

        explosion.ring.scale.setScalar(0.5 + t * 8);
        explosion.ring.material.opacity = 0.8 * (1 - t);
      }
    }

    return { spawn, update, clearCraters, patchGround, isActive: () => explosions.length > 0 };
  }

  window.CoasterExplosions = { create: createExplosions };
})();
