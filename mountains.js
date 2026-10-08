(() => {
  'use strict';

  // A ring of mountains around the play area. The terrain is a polar height
  // field built from ridged noise, so it has sharp crests and valleys instead
  // of smooth blobs. Vertex colours give forested foothills, bare rock on the
  // steep faces and snow on the peaks. The mesh uses the scene fog, exactly
  // like the ground, so grass and foothills fade to sky at the same rate and
  // blend together without a seam.
  const INNER_RADIUS = 380;
  const OUTER_RADIUS = 1100;
  const FLAT_UNTIL = 400;
  const FULL_HEIGHT_AT = 620;
  const MAX_HEIGHT = 230;
  const ANGULAR_SEGMENTS = 512;
  const RADIAL_SEGMENTS = 72;

  // Seeded value noise so the skyline is the same on every load.
  const hash = (x, y) => {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  const valueNoise = (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const u = smooth(x - xi);
    const v = smooth(y - yi);
    const a = hash(xi, yi);
    const b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1);
    const d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const ridged = (x, y, octaves) => {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    let weight = 1;
    for (let o = 0; o < octaves; o++) {
      let n = 1 - Math.abs(valueNoise(x * freq + o * 31.7, y * freq - o * 17.3) * 2 - 1);
      n *= n;
      n *= weight;
      weight = THREE.MathUtils.clamp(n * 1.6, 0, 1);
      sum += n * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.1;
    }
    return sum / norm;
  };
  const fbm = (x, y, octaves) => {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += valueNoise(x * freq + o * 11.3, y * freq + o * 5.9) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };

  function heightAt(x, z, r) {
    const envelope = THREE.MathUtils.smoothstep(r, FLAT_UNTIL, FULL_HEIGHT_AT);
    // Low-frequency mask lets some stretches of the ring drop to foothills.
    const mask = THREE.MathUtils.smoothstep(fbm(x * 0.0035, z * 0.0035, 3), 0.3, 0.6);
    const peaks = ridged(x * 0.0042, z * 0.0042, 6);
    const rolling = fbm(x * 0.012, z * 0.012, 4) * 0.12;
    return envelope * (MAX_HEIGHT * (0.12 + 0.88 * mask) * peaks + MAX_HEIGHT * rolling) - 2;
  }

  const positions = [];
  const radii = [];
  for (let j = 0; j <= RADIAL_SEGMENTS; j++) {
    // Denser rings near the camera side, where detail is visible.
    const r = INNER_RADIUS + (OUTER_RADIUS - INNER_RADIUS) * Math.pow(j / RADIAL_SEGMENTS, 1.25);
    for (let i = 0; i < ANGULAR_SEGMENTS; i++) {
      const a = (i / ANGULAR_SEGMENTS) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      positions.push(x, heightAt(x, z, r), z);
      radii.push(r);
    }
  }

  const indices = [];
  for (let j = 0; j < RADIAL_SEGMENTS; j++) {
    for (let i = 0; i < ANGULAR_SEGMENTS; i++) {
      const i2 = (i + 1) % ANGULAR_SEGMENTS;
      const a = j * ANGULAR_SEGMENTS + i;
      const b = j * ANGULAR_SEGMENTS + i2;
      const c = (j + 1) * ANGULAR_SEGMENTS + i;
      const d = (j + 1) * ANGULAR_SEGMENTS + i2;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const forest = new THREE.Color(0x3d6638);
  const meadow = new THREE.Color(0x5fa861); // same as the ground texture so the foot of the hills blends in
  const rock = new THREE.Color(0x7d766b);
  const darkRock = new THREE.Color(0x5d5852);
  const snow = new THREE.Color(0xe8edf5);
  const color = new THREE.Color();
  const normals = geometry.attributes.normal;
  const colors = new Float32Array(radii.length * 3);

  for (let v = 0; v < radii.length; v++) {
    const x = positions[v * 3];
    const h = positions[v * 3 + 1];
    const z = positions[v * 3 + 2];
    const slope = 1 - normals.getY(v);
    const grain = valueNoise(x * 0.05, z * 0.05);

    color.copy(meadow).lerp(forest, THREE.MathUtils.smoothstep(h + grain * 25, 5, 120));
    // Tree line: rock takes over higher up and wherever the face is steep.
    const rockAmount = Math.max(
      THREE.MathUtils.smoothstep(h + grain * 40, 60, 120),
      THREE.MathUtils.smoothstep(slope, 0.18, 0.4)
    );
    color.lerp(grain > 0.5 ? rock : darkRock, rockAmount);
    // Snow settles on the high, gentler faces; steep faces shed it.
    const snowAmount =
      THREE.MathUtils.smoothstep(h + (grain - 0.5) * 60, 120, 150) *
      (1 - THREE.MathUtils.smoothstep(slope, 0.42, 0.6));
    color.lerp(snow, snowAmount);

    colors[v * 3] = color.r;
    colors[v * 3 + 1] = color.g;
    colors[v * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  window.CoasterMountains = { mesh };
})();
