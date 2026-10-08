(() => {
  'use strict';

  // Fiery crash explosion: a point-light flash, a burst of glowing particles
  // and an expanding shockwave ring. Particles arc under reduced gravity.
  const PARTICLE_COUNT = 40;
  const DURATION = 1.4;
  const PARTICLE_COLORS = [0xfff2a0, 0xffb02e, 0xff6a00, 0xd62800, 0x444444];
  const particleGeometry = new THREE.SphereGeometry(1, 8, 6);
  const shockwaveGeometry = new THREE.RingGeometry(0.8, 1, 32);

  function createExplosions(scene, gravity) {
    const explosions = [];

    function spawn(position) {
      const group = new THREE.Group();
      group.position.copy(position);
      group.position.y = Math.max(position.y, 0.1);

      const flash = new THREE.PointLight(0xffaa33, 6, 25);
      group.add(flash);

      const particles = [];
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const material = new THREE.MeshBasicMaterial({
          color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)],
          transparent: true
        });
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
      explosions.push({ group, flash, particles, ring, age: 0, duration: DURATION });
    }

    function update(dt) {
      for (let i = explosions.length - 1; i >= 0; i--) {
        const explosion = explosions[i];
        explosion.age += dt;
        const t = explosion.age / explosion.duration;

        if (t >= 1) {
          explosion.particles.forEach(({ mesh }) => mesh.material.dispose());
          explosion.ring.material.dispose();
          scene.remove(explosion.group);
          explosions.splice(i, 1);
          continue;
        }

        explosion.flash.intensity = 6 * Math.pow(1 - t, 3);

        explosion.particles.forEach(({ mesh, velocity, size }) => {
          velocity.y -= gravity * 0.4 * dt;
          mesh.position.addScaledVector(velocity, dt);
          mesh.scale.setScalar(size * (1 + t * 1.5) * (1 - t * 0.6));
          mesh.material.opacity = 1 - t * t;
        });

        explosion.ring.scale.setScalar(0.5 + t * 8);
        explosion.ring.material.opacity = 0.8 * (1 - t);
      }
    }

    return { spawn, update, isActive: () => explosions.length > 0 };
  }

  window.CoasterExplosions = { create: createExplosions };
})();
