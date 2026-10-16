(() => {
  'use strict';

  const worldUp = new THREE.Vector3(0, 1, 0);

  // Flames licking back from the nose. The gradient runs light (front, right) to dark (back, left).
  // Shell UVs are the side-profile coordinates, so the texture is stretched once over the car.
  function createFlameTexture() {
    const width = 512;
    const height = 256;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    function gradient(shift) {
      const g = ctx.createLinearGradient(0, 0, width, 0);
      g.addColorStop(0, `hsl(${2 + shift * 6}, 80%, ${12 + shift * 14}%)`);
      g.addColorStop(0.45, `hsl(${10 + shift * 8}, 90%, ${32 + shift * 14}%)`);
      g.addColorStop(0.8, `hsl(${28 + shift * 10}, 95%, ${52 + shift * 12}%)`);
      g.addColorStop(1, `hsl(${48 + shift * 6}, 100%, ${70 + shift * 12}%)`);
      return g;
    }

    ctx.fillStyle = gradient(0);
    ctx.fillRect(0, 0, width, height);

    // Layers from outer (darker) to inner (lighter); each is a row of backward-pointing tongues.
    const layers = [
      { count: 9, len: 0.8, halfWidth: 30, shift: 0.35 },
      { count: 8, len: 0.6, halfWidth: 24, shift: 0.7 },
      { count: 7, len: 0.4, halfWidth: 17, shift: 1.0 }
    ];
    layers.forEach((layer, li) => {
      ctx.fillStyle = gradient(layer.shift);
      for (let i = 0; i < layer.count; i++) {
        const y = ((i + 0.5) / layer.count) * height + Math.sin(i * 12.9 + li * 4.1) * 10;
        const len = width * layer.len * (0.7 + 0.3 * Math.abs(Math.sin(i * 7.3 + li)));
        const bx = width * (1.02 - 0.08 * Math.abs(Math.sin(i * 3.7 + li)));
        const hw = layer.halfWidth * (0.8 + 0.3 * Math.abs(Math.sin(i * 5.1 + li)));
        const curl = Math.sin(i * 9.7 + li * 2.3) * 22;
        ctx.beginPath();
        ctx.moveTo(bx, y - hw);
        ctx.bezierCurveTo(bx - len * 0.35, y - hw * 1.1, bx - len * 0.65, y - hw * 0.3 + curl, bx - len, y + curl * 1.3);
        ctx.bezierCurveTo(bx - len * 0.6, y + hw * 0.2 + curl * 0.6, bx - len * 0.35, y + hw * 1.1, bx, y + hw);
        ctx.closePath();
        ctx.fill();
      }
    });

    const texture = new THREE.CanvasTexture(canvas);
    // Map shell x in [-1.08, 1.2] and y in [0.16, 0.9] onto the full texture.
    texture.repeat.set(1 / 2.34, 1 / 0.8);
    texture.offset.set(1.1 / 2.34, -0.12 / 0.8);
    texture.anisotropy = 4;
    return texture;
  }

  const materials = {
    cart: new THREE.MeshStandardMaterial({ color: 0xdc3545, roughness: 0.42 }),
    cartPanel: new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.38 }),
    cartTrim: new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.5 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x222a38, roughness: 0.55 }),
    safetyBar: new THREE.MeshStandardMaterial({ color: 0xffd166, metalness: 0.25, roughness: 0.28 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xffc49a, roughness: 0.58 }),
    hair: new THREE.MeshStandardMaterial({ color: 0x3b2417, roughness: 0.72 }),
    flames: new THREE.MeshStandardMaterial({ map: createFlameTexture(), roughness: 0.35, metalness: 0.15 }),
    shellEdge: new THREE.MeshStandardMaterial({ color: 0x8f1d2c, roughness: 0.4, metalness: 0.15 }),
    headrest: new THREE.MeshStandardMaterial({ color: 0x7a4a2b, roughness: 0.6 }),
    harness: new THREE.MeshStandardMaterial({ color: 0x15181f, roughness: 0.6 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xb8bec8, metalness: 0.8, roughness: 0.3 }),
    tire: new THREE.MeshStandardMaterial({ color: 0xd9dde3, roughness: 0.45 })
  };

  const riderShirtMaterials = [
    new THREE.MeshStandardMaterial({ color: 0x3d6dff, roughness: 0.55 }),
    new THREE.MeshStandardMaterial({ color: 0x27965f, roughness: 0.55 }),
    new THREE.MeshStandardMaterial({ color: 0xbd3fd1, roughness: 0.55 }),
    new THREE.MeshStandardMaterial({ color: 0xff7a45, roughness: 0.55 }),
    new THREE.MeshStandardMaterial({ color: 0x12b8a6, roughness: 0.55 }),
    new THREE.MeshStandardMaterial({ color: 0xf2c94c, roughness: 0.55 }),
    new THREE.MeshStandardMaterial({ color: 0xe8505b, roughness: 0.55 }),
    new THREE.MeshStandardMaterial({ color: 0x6c63ff, roughness: 0.55 })
  ];

  function cylinderBetween(a, b, radius, material, radialSegments) {
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const direction = b.clone().sub(a);
    const length = direction.length();
    const geometry = new THREE.CylinderGeometry(radius, radius, length, radialSegments || 12);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(mid);
    mesh.quaternion.setFromUnitVectors(worldUp, direction.normalize());
    return mesh;
  }

  function shadowed(mesh) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  function createTrain(carSpacing) {
    const train = new THREE.Group();
    train.name = 'Two car coaster train';

    const frontCar = createCoasterCar(0);
    frontCar.userData.trainOffset = 0;
    train.add(frontCar);

    const rearCar = createCoasterCar(1);
    rearCar.userData.trainOffset = carSpacing;
    train.add(rearCar);

    return train;
  }

  // Side profile of the car shell (x forward, y up) with a sloped, rounded nose.
  function createShellGeometry() {
    const shape = new THREE.Shape();
    shape.moveTo(-1.05, 0.22);
    shape.lineTo(0.85, 0.22);
    shape.quadraticCurveTo(1.15, 0.24, 1.2, 0.42);
    shape.quadraticCurveTo(1.14, 0.62, 0.7, 0.78);
    shape.lineTo(-0.9, 0.84);
    shape.quadraticCurveTo(-1.08, 0.84, -1.08, 0.7);
    shape.lineTo(-1.05, 0.22);

    const depth = 1.0;
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelThickness: 0.07,
      bevelSize: 0.06,
      bevelSegments: 3,
      curveSegments: 12
    });
    geometry.translate(0, 0, -depth / 2);
    return geometry;
  }

  function createCoasterCar(carIndex) {
    const car = new THREE.Group();
    car.name = `Coaster car ${carIndex + 1}`;

    // Flame-textured shell: the flanks (caps) get the pattern, bevel and edges stay plain.
    car.add(shadowed(new THREE.Mesh(createShellGeometry(), [materials.flames, materials.shellEdge])));

    // Rounded rim along the top of the shell.
    for (const side of [-1, 1]) {
      const rim = cylinderBetween(
        new THREE.Vector3(-0.9, 0.88, side * 0.5),
        new THREE.Vector3(0.7, 0.82, side * 0.5),
        0.03,
        materials.cartTrim,
        8
      );
      car.add(shadowed(rim));
    }

    const rowXs = [0.35, -0.55];
    const seatZs = [-0.28, 0.28];
    let riderNumber = carIndex * 4;

    for (const x of rowXs) {
      for (const z of seatZs) {
        car.add(createSeat(x, z));
        car.add(createHarness(x, z));
        car.add(createPassenger(riderNumber, x, z));
        riderNumber += 1;
      }
    }

    addWheelSet(car, -0.72);
    addWheelSet(car, 0.72);

    const frontCoupler = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.18), materials.cartTrim));
    frontCoupler.position.set(1.25, 0.18, 0);
    car.add(frontCoupler);

    const rearCoupler = frontCoupler.clone();
    rearCoupler.position.x = -1.25;
    car.add(rearCoupler);

    return car;
  }

  // Bucket seat: cushion, tall back, brown headrest and small side wings.
  function createSeat(x, z) {
    const seat = new THREE.Group();

    const cushion = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.12, 0.4), materials.seat));
    cushion.position.set(x, 0.55, z);
    seat.add(cushion);

    const back = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.55, 0.4), materials.seat));
    back.position.set(x - 0.22, 0.85, z);
    back.rotation.z = -0.1;
    seat.add(back);

    const headrest = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 0.3), materials.headrest));
    headrest.position.set(x - 0.27, 1.2, z);
    headrest.rotation.z = -0.1;
    seat.add(headrest);

    for (const side of [-1, 1]) {
      const wing = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.05), materials.seat));
      wing.position.set(x - 0.03, 0.72, z + side * 0.2);
      seat.add(wing);
    }
    return seat;
  }

  // Over-the-shoulder restraint: an inverted U rising from a lap bar.
  function createHarness(x, z) {
    const harness = new THREE.Group();
    const hx = x + 0.17;

    for (const side of [-1, 1]) {
      const post = cylinderBetween(
        new THREE.Vector3(hx + 0.04, 0.62, z + side * 0.13),
        new THREE.Vector3(hx - 0.02, 1.0, z + side * 0.14),
        0.035,
        materials.harness,
        10
      );
      harness.add(shadowed(post));
    }

    const shoulderBar = cylinderBetween(
      new THREE.Vector3(hx - 0.02, 1.0, z - 0.14),
      new THREE.Vector3(hx - 0.02, 1.0, z + 0.14),
      0.04,
      materials.harness,
      10
    );
    harness.add(shadowed(shoulderBar));

    const lapBar = cylinderBetween(
      new THREE.Vector3(hx + 0.06, 0.66, z - 0.15),
      new THREE.Vector3(hx + 0.06, 0.66, z + 0.15),
      0.045,
      materials.steel,
      10
    );
    harness.add(shadowed(lapBar));
    return harness;
  }

  function createPassenger(index, x, z) {
    const passenger = new THREE.Group();
    const shirt = riderShirtMaterials[index % riderShirtMaterials.length];

    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.36, 14), shirt);
    torso.position.set(x, 0.86, z);
    torso.castShadow = true;
    passenger.add(torso);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 18, 14), materials.skin);
    head.position.set(x, 1.15, z);
    head.castShadow = true;
    passenger.add(head);

    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.135, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), materials.hair);
    hair.position.set(x - 0.01, 1.18, z);
    hair.castShadow = true;
    passenger.add(hair);

    // Thighs resting on the cushion.
    for (const side of [-1, 1]) {
      const thigh = cylinderBetween(
        new THREE.Vector3(x - 0.05, 0.68, z + side * 0.07),
        new THREE.Vector3(x + 0.25, 0.66, z + side * 0.08),
        0.055,
        shirt,
        8
      );
      passenger.add(thigh);
    }

    // Alternate riders: arms thrown up vs. gripping the harness.
    const armsUp = index % 2 === 0;
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Vector3(x, 0.98, z + side * 0.17);
      const hand = armsUp
        ? new THREE.Vector3(x + 0.05, 1.45, z + side * 0.28)
        : new THREE.Vector3(x + 0.2, 1.0, z + side * 0.13);
      const arm = cylinderBetween(shoulder, hand, 0.03, materials.skin, 8);
      arm.castShadow = true;
      passenger.add(arm);
    }

    return passenger;
  }

  // Running wheels plus smaller side-friction wheels, like a tubular-track bogie.
  function addWheelSet(car, x) {
    const wheelGeometry = new THREE.CylinderGeometry(0.15, 0.15, 0.1, 20);
    wheelGeometry.rotateX(Math.PI / 2);
    const hubGeometry = new THREE.CylinderGeometry(0.06, 0.06, 0.115, 12);
    hubGeometry.rotateX(Math.PI / 2);

    for (const z of [-0.5, 0.5]) {
      const wheel = shadowed(new THREE.Mesh(wheelGeometry, materials.tire));
      wheel.position.set(x, 0.15, z);
      car.add(wheel);

      const hub = new THREE.Mesh(hubGeometry, materials.steel);
      hub.position.set(x, 0.15, z);
      car.add(hub);

      const sideWheel = shadowed(new THREE.Mesh(wheelGeometry, materials.tire));
      sideWheel.scale.set(0.6, 0.6, 1);
      sideWheel.position.set(x, 0.14, z * 0.78);
      car.add(sideWheel);
    }

    const axle = cylinderBetween(
      new THREE.Vector3(x, 0.15, -0.5),
      new THREE.Vector3(x, 0.15, 0.5),
      0.03,
      materials.steel,
      8
    );
    car.add(axle);

    const bogie = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.7), materials.cartTrim));
    bogie.position.set(x, 0.2, 0);
    car.add(bogie);
  }

  window.CoasterCart = { createTrain };
})();
