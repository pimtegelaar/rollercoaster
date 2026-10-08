(() => {
  'use strict';

  // Cumulus clouds built from many camera-facing puff sprites. Each puff
  // texture is a cluster of small overlapping blobs, so the edges look
  // cauliflower-like instead of a smooth circle. Clouds have a flat base and a
  // domed top, with the underside shaded grey-blue and the top lit white.
  const CLOUD_COUNT = 28;
  const CLOUD_RANGE = 400;
  const CLOUD_SPEED = 2.5;
  const cloudTextures = Array.from({ length: 4 }, () => {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    const blob = (x, y, r, alpha) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255,255,255,${alpha})`);
      g.addColorStop(0.7, `rgba(255,255,255,${alpha * 0.85})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    };
    blob(size / 2, size / 2, size * 0.34, 1);
    for (let i = 0; i < 26; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = size * (0.12 + Math.random() * 0.2);
      const r = size * (0.08 + Math.random() * 0.1);
      blob(size / 2 + Math.cos(angle) * dist, size / 2 + Math.sin(angle) * dist, r, 0.95);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
  const clouds = new THREE.Group();

  for (let i = 0; i < CLOUD_COUNT; i++) {
    const cloud = new THREE.Group();
    const width = 18 + Math.random() * 26;
    const depth = width * (0.35 + Math.random() * 0.3);
    const height = width * (0.28 + Math.random() * 0.22);
    const puffs = 30 + Math.floor(Math.random() * 20);
    for (let p = 0; p < puffs; p++) {
      // Sample a dome: wide at the base, narrowing toward the top.
      const h = Math.pow(Math.random(), 1.4);
      const spread = Math.sqrt(1 - h * h) * (0.4 + Math.random() * 0.6);
      const angle = Math.random() * Math.PI * 2;
      const x = Math.cos(angle) * spread * width * 0.5;
      const z = Math.sin(angle) * spread * depth * 0.5;
      const y = h * height;

      // Shade by height, and a little by facing the sun (+x side is brighter).
      const sunSide = THREE.MathUtils.clamp(x / (width * 0.5), -1, 1) * 0.04;
      const shade = THREE.MathUtils.clamp(0.74 + 0.26 * Math.pow(h, 0.6) + sunSide, 0, 1);
      const material = new THREE.SpriteMaterial({
        map: cloudTextures[p % cloudTextures.length],
        color: new THREE.Color(shade, shade + (1 - shade) * 0.15, Math.min(1, shade + (1 - shade) * 0.45 + 0.03)),
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        rotation: Math.random() * Math.PI * 2
      });
      const puff = new THREE.Sprite(material);
      const size = width * (0.22 + Math.random() * 0.2) * (1 - h * 0.45);
      puff.scale.set(size, size, 1);
      puff.position.set(x, y, z);
      cloud.add(puff);
    }
    cloud.position.set(
      (Math.random() * 2 - 1) * CLOUD_RANGE,
      70 + Math.random() * 50,
      (Math.random() * 2 - 1) * CLOUD_RANGE
    );
    clouds.add(cloud);
  }

  function updateClouds(dt) {
    for (const cloud of clouds.children) {
      cloud.position.x += CLOUD_SPEED * dt;
      if (cloud.position.x > CLOUD_RANGE) cloud.position.x = -CLOUD_RANGE;
    }
  }

  window.CoasterClouds = { group: clouds, update: updateClouds };
})();
