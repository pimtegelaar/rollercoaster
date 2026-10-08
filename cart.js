(() => {
  'use strict';

  const worldUp = new THREE.Vector3(0, 1, 0);

  const materials = {
    cart: new THREE.MeshStandardMaterial({ color: 0xdc3545, roughness: 0.42 }),
    cartPanel: new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.38 }),
    cartTrim: new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.5 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x222a38, roughness: 0.55 }),
    safetyBar: new THREE.MeshStandardMaterial({ color: 0xffd166, metalness: 0.25, roughness: 0.28 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xffc49a, roughness: 0.58 }),
    hair: new THREE.MeshStandardMaterial({ color: 0x3b2417, roughness: 0.72 })
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

  function createCoasterCar(carIndex) {
    const car = new THREE.Group();
    car.name = `Coaster car ${carIndex + 1}`;

    const base = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.26, 1.24), materials.cart);
    base.position.set(0, 0.27, 0);
    base.castShadow = true;
    base.receiveShadow = true;
    car.add(base);

    const centerPanel = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.18, 1.05), materials.cartPanel);
    centerPanel.position.set(0.02, 0.44, 0);
    centerPanel.castShadow = true;
    centerPanel.receiveShadow = true;
    car.add(centerPanel);

    const frontPanel = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.62, 1.18), materials.cartTrim);
    frontPanel.position.set(1.08, 0.62, 0);
    frontPanel.castShadow = true;
    frontPanel.receiveShadow = true;
    car.add(frontPanel);

    const backPanel = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.52, 1.12), materials.cartTrim);
    backPanel.position.set(-1.05, 0.58, 0);
    backPanel.castShadow = true;
    backPanel.receiveShadow = true;
    car.add(backPanel);

    const leftSide = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.48, 0.1), materials.cartTrim);
    leftSide.position.set(0, 0.62, 0.67);
    leftSide.castShadow = true;
    leftSide.receiveShadow = true;
    car.add(leftSide);

    const rightSide = leftSide.clone();
    rightSide.position.z = -0.67;
    car.add(rightSide);

    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.32, 1.04), materials.cartPanel);
    hood.position.set(1.0, 0.82, 0);
    hood.rotation.z = -0.1;
    hood.castShadow = true;
    hood.receiveShadow = true;
    car.add(hood);

    const rowXs = [0.45, -0.45];
    const seatZs = [-0.3, 0.3];
    let riderNumber = carIndex * 4;

    for (const x of rowXs) {
      for (const z of seatZs) {
        const seat = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.18, 0.42), materials.seat);
        seat.position.set(x, 0.62, z);
        seat.castShadow = true;
        seat.receiveShadow = true;
        car.add(seat);

        const back = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.44, 0.42), materials.seat);
        back.position.set(x - 0.21, 0.82, z);
        back.castShadow = true;
        back.receiveShadow = true;
        car.add(back);

        const rider = createPassenger(riderNumber, x, z);
        car.add(rider);
        riderNumber += 1;
      }

      const bar = cylinderBetween(
        new THREE.Vector3(x + 0.08, 0.96, -0.55),
        new THREE.Vector3(x + 0.08, 0.96, 0.55),
        0.032,
        materials.safetyBar,
        10
      );
      bar.castShadow = true;
      bar.receiveShadow = true;
      car.add(bar);
    }

    addWheelSet(car, -0.72);
    addWheelSet(car, 0.72);

    const frontCoupler = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.18), materials.cartTrim);
    frontCoupler.position.set(1.25, 0.18, 0);
    frontCoupler.castShadow = true;
    car.add(frontCoupler);

    const rearCoupler = frontCoupler.clone();
    rearCoupler.position.x = -1.25;
    car.add(rearCoupler);

    return car;
  }

  function createPassenger(index, x, z) {
    const passenger = new THREE.Group();
    const shirt = riderShirtMaterials[index % riderShirtMaterials.length];

    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.34, 14), shirt);
    torso.position.set(x, 0.9, z);
    torso.castShadow = true;
    passenger.add(torso);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 18, 14), materials.skin);
    head.position.set(x, 1.15, z);
    head.castShadow = true;
    passenger.add(head);

    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.132, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), materials.hair);
    hair.position.set(x, 1.21, z);
    hair.castShadow = true;
    passenger.add(hair);

    const leftArm = cylinderBetween(
      new THREE.Vector3(x, 0.96, z + 0.1),
      new THREE.Vector3(x + 0.08, 0.96, z + 0.26),
      0.025,
      materials.skin,
      8
    );
    leftArm.castShadow = true;
    passenger.add(leftArm);

    const rightArm = cylinderBetween(
      new THREE.Vector3(x, 0.96, z - 0.1),
      new THREE.Vector3(x + 0.08, 0.96, z - 0.26),
      0.025,
      materials.skin,
      8
    );
    rightArm.castShadow = true;
    passenger.add(rightArm);

    return passenger;
  }

  function addWheelSet(car, x) {
    const wheelGeometry = new THREE.CylinderGeometry(0.13, 0.13, 0.13, 16);
    wheelGeometry.rotateX(Math.PI / 2);

    const wheelPositions = [
      [x, 0.13, -0.55],
      [x, 0.13,  0.55]
    ];

    for (const pos of wheelPositions) {
      const wheel = new THREE.Mesh(wheelGeometry.clone(), materials.cartTrim);
      wheel.position.set(pos[0], pos[1], pos[2]);
      wheel.castShadow = true;
      car.add(wheel);
    }

    const railGuide = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.78), materials.cartTrim);
    railGuide.position.set(x, 0.08, 0);
    railGuide.castShadow = true;
    car.add(railGuide);
  }

  window.CoasterCart = { createTrain };
})();
