(() => {
  'use strict';

  if (!window.THREE) {
    document.getElementById('no-three').style.display = 'flex';
    document.getElementById('ui').style.display = 'none';
    return;
  }

  const canvas = document.getElementById('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8eb6ff);
  scene.fog = new THREE.Fog(0x8eb6ff, 70, 190);

  const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 1000);
  const zoom = {
    minFov: 25,
    maxFov: 130,
    wheelSensitivity: 0.025,
    pinchSensitivity: 0.12
  };
  camera.position.set(18, 12, 22);
  camera.lookAt(7, 3, 0);
  camera.rotation.order = 'YXZ';

  let initialEuler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  let cameraYaw = initialEuler.y;
  let cameraPitch = initialEuler.x;

  const worldUp = new THREE.Vector3(0, 1, 0);

  const materials = {
    ground: new THREE.MeshStandardMaterial({ color: 0x5fa861, roughness: 0.92 }),
    rail: new THREE.MeshStandardMaterial({ color: 0xcdd4df, metalness: 0.55, roughness: 0.25 }),
    sleeper: new THREE.MeshStandardMaterial({ color: 0x6c4a2f, roughness: 0.75 }),
    support: new THREE.MeshStandardMaterial({ color: 0x7c8799, metalness: 0.3, roughness: 0.42 }),
    centerLine: new THREE.MeshStandardMaterial({ color: 0x2e3543, roughness: 0.7 }),
    endpoint: new THREE.MeshStandardMaterial({ color: 0xffdf4d, emissive: 0xffb000, emissiveIntensity: 0.65 }),
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

  const TRACK_SAMPLES_PER_SECTION = 96;
  const TRAIN_CAR_SPACING = 2.55;
  const TRAIN_RAIL_CLEARANCE = 0.015;
  const STUNT_POINT_COUNT = 192;

  const previewMaterials = {
    rail: makePreviewMaterial(materials.rail),
    sleeper: makePreviewMaterial(materials.sleeper),
    support: makePreviewMaterial(materials.support),
    centerLine: makePreviewMaterial(materials.centerLine)
  };

  const hemi = new THREE.HemisphereLight(0xffffff, 0x4d653f, 1.25);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 2.15);
  sun.position.set(25, 45, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), materials.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(260, 52, 0xffffff, 0xffffff);
  grid.material.opacity = 0.18;
  grid.material.transparent = true;
  scene.add(grid);

  const startMarker = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.45, 0.18, 32),
    new THREE.MeshStandardMaterial({ color: 0x2d6cdf, emissive: 0x163772, emissiveIntensity: 0.25 })
  );
  startMarker.position.set(0, 1.92, 0);
  startMarker.castShadow = true;
  scene.add(startMarker);

  let trackGroup = new THREE.Group();
  scene.add(trackGroup);

  let previewGroup = new THREE.Group();
  scene.add(previewGroup);

  const endpointMarker = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 16), materials.endpoint);
  endpointMarker.castShadow = true;
  scene.add(endpointMarker);

  let directionArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 2, 0), 3, 0xffe066, 0.7, 0.35);
  scene.add(directionArrow);

  const cart = createTrain();
  cart.visible = false;
  scene.add(cart);

  const ui = {
    panel: document.getElementById('ui'),
    lengthSlider: document.getElementById('lengthSlider'),
    angleSlider: document.getElementById('angleSlider'),
    speedSlider: document.getElementById('speedSlider'),
    stuntSizeSlider: document.getElementById('stuntSizeSlider'),
    lengthValue: document.getElementById('lengthValue'),
    angleValue: document.getElementById('angleValue'),
    speedValue: document.getElementById('speedValue'),
    stuntSizeValue: document.getElementById('stuntSizeValue'),
    status: document.getElementById('status'),
    viewMode: document.getElementById('viewMode'),
    placeSection: document.getElementById('placeSection'),
    testCoaster: document.getElementById('testCoaster')
  };

  const initialPos = new THREE.Vector3(0, 2, 0);
  const initialDir = new THREE.Vector3(1, 0, 0);
  const trackSegments = [];
  let currentPos = initialPos.clone();
  let currentDir = initialDir.clone();
  let isClosedLoop = false;
  let sampledPoints = [];
  let sampledDistances = [];
  let sampledFrames = [];
  let totalTrackLength = 0;

  let selectedSectionType = 'straight';
  let isTesting = false;
  let cartDistance = 0;
  let cartSpeed = Number(ui.speedSlider.value);
  let viewMode = 'third';

  const keys = new Set();
  let dragging = false;
  const touchState = {
    mode: 'none',
    lastX: 0,
    lastY: 0,
    lastCenterX: 0,
    lastCenterY: 0,
    lastPinchDistance: 0
  };
  let lastTime = performance.now();

  bindUI();
  rebuildTrackMeshes();
  animate();

  function bindUI() {
    document.getElementById('addStraight').addEventListener('click', () => selectSectionType('straight'));
    document.getElementById('addLeft').addEventListener('click', () => selectSectionType('left'));
    document.getElementById('addRight').addEventListener('click', () => selectSectionType('right'));
    document.getElementById('addUp').addEventListener('click', () => selectSectionType('up'));
    document.getElementById('addDown').addEventListener('click', () => selectSectionType('down'));
    document.getElementById('addLoopLeft').addEventListener('click', () => selectSectionType('loopLeft'));
    document.getElementById('addLoopRight').addEventListener('click', () => selectSectionType('loopRight'));
    document.getElementById('addCorkscrewLeft').addEventListener('click', () => selectSectionType('corkscrewLeft'));
    document.getElementById('addCorkscrewRight').addEventListener('click', () => selectSectionType('corkscrewRight'));
    ui.placeSection.addEventListener('click', placeSelectedSection);
    document.getElementById('snapStart').addEventListener('click', snapToStart);
    document.getElementById('undo').addEventListener('click', undoSection);
    document.getElementById('clear').addEventListener('click', clearTrack);
    ui.testCoaster.addEventListener('click', toggleTest);
    ui.viewMode.addEventListener('click', toggleViewMode);

    ui.lengthSlider.addEventListener('input', () => {
      ui.lengthValue.textContent = ui.lengthSlider.value;
      updatePreviewSection();
    });
    ui.angleSlider.addEventListener('input', () => {
      ui.angleValue.textContent = ui.angleSlider.value + '°';
      updatePreviewSection();
    });
    ui.stuntSizeSlider.addEventListener('input', () => {
      ui.stuntSizeValue.textContent = ui.stuntSizeSlider.value;
      updatePreviewSection();
    });
    ui.speedSlider.addEventListener('input', () => {
      ui.speedValue.textContent = ui.speedSlider.value;
      cartSpeed = Number(ui.speedSlider.value);
    });

    window.addEventListener('keydown', (event) => {
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) {
        keys.add(event.code);
        event.preventDefault();
      }
    });

    window.addEventListener('keyup', (event) => keys.delete(event.code));

    canvas.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      dragging = true;
      if (typeof canvas.setPointerCapture === 'function' && event.pointerId !== undefined) {
        canvas.setPointerCapture(event.pointerId);
      }
    });

    window.addEventListener('mouseup', () => dragging = false);
    window.addEventListener('blur', () => {
      dragging = false;
      resetTouchState();
      keys.clear();
    });

    canvas.addEventListener('mousemove', (event) => {
      if (!dragging || isTesting) return;
      rotateFreeCameraByPixels(event.movementX, event.movementY);
    });

    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      zoomCamera(event.deltaY);
    }, { passive: false });

    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', handleTouchEnd, { passive: false });

    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    updateDirectionButtons();
    updateTestButton();
    updateViewModeButton();
  }

  function selectSectionType(type) {
    selectedSectionType = type;
    updateDirectionButtons();
    updatePreviewSection();
    setStatus(`${labelForType(type)} selected. Press Place section to add it to the track.`);
  }

  function updateDirectionButtons() {
    const buttonsByType = {
      straight: document.getElementById('addStraight'),
      left: document.getElementById('addLeft'),
      right: document.getElementById('addRight'),
      up: document.getElementById('addUp'),
      down: document.getElementById('addDown'),
      loopLeft: document.getElementById('addLoopLeft'),
      loopRight: document.getElementById('addLoopRight'),
      corkscrewLeft: document.getElementById('addCorkscrewLeft'),
      corkscrewRight: document.getElementById('addCorkscrewRight')
    };

    for (const [type, button] of Object.entries(buttonsByType)) {
      button.classList.toggle('selected', type === selectedSectionType);
    }
  }

  function placeSelectedSection() {
    addSection(selectedSectionType);
  }

  function buildSectionData(type) {
    if (type === 'loopLeft' || type === 'loopRight') return buildLoopSectionData(type);
    if (type === 'corkscrewLeft' || type === 'corkscrewRight') return buildCorkscrewSectionData(type);

    const length = Number(ui.lengthSlider.value);
    const angle = THREE.MathUtils.degToRad(Number(ui.angleSlider.value));
    const start = currentPos.clone();
    const startDir = currentDir.clone().normalize();
    let endDir = startDir.clone();

    if (type === 'left') endDir.applyAxisAngle(worldUp, angle);
    if (type === 'right') endDir.applyAxisAngle(worldUp, -angle);

    if (type === 'up' || type === 'down') {
      let rightAxis = new THREE.Vector3().crossVectors(startDir, worldUp);
      if (rightAxis.lengthSq() < 0.0001) rightAxis.set(0, 0, 1);
      rightAxis.normalize();
      endDir.applyAxisAngle(rightAxis, type === 'up' ? angle : -angle);
      endDir = clampPitch(endDir, THREE.MathUtils.degToRad(75));
    }

    endDir.normalize();
    const end = calculateEndPoint(start, startDir, endDir, length, type);
    end.y = Math.max(0.7, end.y);

    const handle = length * 0.36;
    const p1 = start.clone().addScaledVector(startDir, handle);
    const p2 = end.clone().addScaledVector(endDir, -handle);
    const curve = new THREE.CubicBezierCurve3(start, p1, p2, end);

    return { type, curve, startDir, endDir, start, end, length, angle: Number(ui.angleSlider.value) };
  }

  function buildLoopSectionData(type) {
    const start = currentPos.clone();
    const startDir = currentDir.clone().normalize();
    const frame = frameFromDirection(startDir);
    const size = Number(ui.stuntSizeSlider.value);

    // Keep the approach and exit fairly stable while the slider mostly changes
    // the loop body. This avoids giant lead-ins/lead-outs when the loop gets big.
    const radius = size * 0.78;
    const leadInLength = 3.8;
    const leadOutLength = 5.2;
    const loopDrift = 2.8 + Math.max(0, size - 12) * 0.08;
    const sideShift = THREE.MathUtils.clamp(radius * 0.42, 2.8, 5.6);
    const lateralSign = type === 'loopLeft' ? -1 : 1;
    const leadInPortion = 0.17;
    const leadOutPortion = 0.20;
    const loopStart = leadInPortion;
    const loopEnd = 1 - leadOutPortion;
    const points = [];

    for (let i = 0; i <= STUNT_POINT_COUNT; i++) {
      const t = i / STUNT_POINT_COUNT;
      let forwardOffset = 0;
      let verticalOffset = 0;
      let sideOffset = 0;

      if (t < loopStart) {
        const u = t / loopStart;
        forwardOffset = leadInLength * u;
      } else if (t <= loopEnd) {
        const u = (t - loopStart) / (loopEnd - loopStart);
        const theta = u * Math.PI * 2;

        // Circular loop body: same tangent at start and finish, rounder shape.
        forwardOffset = leadInLength + loopDrift * u + Math.sin(theta) * radius;
        verticalOffset = (1 - Math.cos(theta)) * radius;
        sideOffset = smootherStep(u) * sideShift * lateralSign;
      } else {
        const u = (t - loopEnd) / leadOutPortion;
        forwardOffset = leadInLength + loopDrift + leadOutLength * u;
        sideOffset = sideShift * lateralSign;
      }

      const point = start.clone()
        .addScaledVector(frame.forward, forwardOffset)
        .addScaledVector(frame.normal, verticalOffset)
        .addScaledVector(frame.side, sideOffset);
      point.y = Math.max(0.7, point.y);
      points.push(point);
    }

    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.25);
    const end = points[points.length - 1].clone();
    const endDir = startDir.clone();
    return { type, curve, startDir, endDir, start, end, length: estimatePointLength(points), angle: 360, stuntSize: size, isStunt: true };
  }

  function buildCorkscrewSectionData(type) {
    const start = currentPos.clone();
    const startDir = currentDir.clone().normalize();
    const frame = frameFromDirection(startDir);
    const size = Number(ui.stuntSizeSlider.value);

    const span = 10 + size * 0.5;
    const humpHeight = 3 + size * 0.2;
    const sideAmplitude = 3 + size * 0.25;
    const twistSign = type === 'corkscrewLeft' ? -1 : 1;
    const totalRoll = Math.PI * 2 * -twistSign;
    const points = [];

    for (let i = 0; i <= STUNT_POINT_COUNT; i++) {
      const u = i / STUNT_POINT_COUNT;
      const vertEnv = u < 0.5 ? smootherStep(2 * u) : smootherStep(2 * (1 - u));
      const verticalOffset = vertEnv * humpHeight;
      const lateralOffset = Math.sin(u * Math.PI * 2) * vertEnv * sideAmplitude * twistSign;

      const point = start.clone()
        .addScaledVector(frame.forward, span * u)
        .addScaledVector(frame.normal, verticalOffset)
        .addScaledVector(frame.side, lateralOffset);
      point.y = Math.max(0.7, point.y);
      points.push(point);
    }

    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.45);
    const end = points[points.length - 1].clone();
    const endDir = startDir.clone();
    return { type, curve, startDir, endDir, start, end, length: estimatePointLength(points), angle: 360, stuntSize: size, isStunt: true, roll: totalRoll };
  }

  function smoothStep(t) {
    t = THREE.MathUtils.clamp(t, 0, 1);
    return t * t * (3 - 2 * t);
  }

  function smootherStep(t) {
    t = THREE.MathUtils.clamp(t, 0, 1);
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function frameFromDirection(direction) {
    const forward = direction.clone().normalize();
    let side = new THREE.Vector3().crossVectors(forward, worldUp);
    if (side.lengthSq() < 0.0001) side.set(0, 0, 1);
    else side.normalize();

    const normal = new THREE.Vector3().crossVectors(side, forward).normalize();
    return { forward, side, normal };
  }

  function estimatePointLength(points) {
    let length = 0;
    for (let i = 1; i < points.length; i++) length += points[i].distanceTo(points[i - 1]);
    return length;
  }

  function addSection(type) {
    if (isTesting) stopTest();

    if (isClosedLoop) {
      setStatus('This coaster is already closed. Press Undo to reopen the loop, or Clear track to start over.');
      return;
    }

    const segment = buildSectionData(type);
    trackSegments.push(segment);
    currentPos = segment.end.clone();
    currentDir = segment.endDir.clone();
    rebuildTrackMeshes();
    setStatus(`Placed ${labelForType(type)} section. Sections: ${trackSegments.length}. Track length: ${totalTrackLength.toFixed(1)} units.`);
  }

  function snapToStart() {
    if (isTesting) stopTest();

    if (isClosedLoop) {
      setStatus('The end is already snapped to the start. Press Test coaster to run it as a loop.');
      return;
    }

    if (trackSegments.length === 0) {
      setStatus('Add at least one section before closing the loop.');
      return;
    }

    const start = currentPos.clone();
    const end = initialPos.clone();
    const gap = start.distanceTo(end);

    if (gap < 0.15) {
      isClosedLoop = true;
      currentPos = initialPos.clone();
      currentDir = initialDir.clone();
      rebuildTrackMeshes();
      setStatus('Closed loop enabled. The endpoint was already on the start marker, so the cart will keep cycling.');
      return;
    }

    const startDir = currentDir.clone().normalize();
    const endDir = initialDir.clone().normalize();
    const handle = Math.max(2.5, Math.min(gap * 0.45, 20));
    const p1 = start.clone().addScaledVector(startDir, handle);
    const p2 = end.clone().addScaledVector(endDir, -handle);
    const curve = new THREE.CubicBezierCurve3(start, p1, p2, end);

    trackSegments.push({
      type: 'snap',
      curve,
      startDir,
      endDir,
      start,
      end,
      length: gap,
      angle: 0,
      isSnap: true
    });

    isClosedLoop = true;
    currentPos = initialPos.clone();
    currentDir = initialDir.clone();
    rebuildTrackMeshes();
    setStatus(`Snapped the end back to the start with a ${gap.toFixed(1)} unit connector. The coaster is now a closed loop and the cart will keep cycling.`);
  }

  function calculateEndPoint(start, startDir, endDir, length, type) {
    if (type === 'straight') {
      return start.clone().addScaledVector(startDir, length);
    }

    const blended = startDir.clone().add(endDir);
    if (blended.lengthSq() < 0.0001) blended.copy(endDir);
    blended.normalize();

    const bendFactor = type === 'left' || type === 'right' ? 0.98 : 1.0;
    return start.clone().addScaledVector(blended, length * bendFactor);
  }

  function clampPitch(vector, maxPitch) {
    const v = vector.clone().normalize();
    const horizontalLength = Math.sqrt(v.x * v.x + v.z * v.z);
    let pitch = Math.atan2(v.y, Math.max(0.0001, horizontalLength));

    if (Math.abs(pitch) <= maxPitch) return v;

    pitch = Math.sign(pitch) * maxPitch;
    const horizontal = new THREE.Vector3(v.x, 0, v.z);
    if (horizontal.lengthSq() < 0.0001) horizontal.set(1, 0, 0);
    horizontal.normalize().multiplyScalar(Math.cos(pitch));
    horizontal.y = Math.sin(pitch);
    return horizontal.normalize();
  }

  function undoSection() {
    if (isTesting) stopTest();
    if (trackSegments.length === 0) {
      setStatus('There is no section to undo.');
      return;
    }

    trackSegments.pop();
    isClosedLoop = trackSegments.length > 0 && trackSegments[trackSegments.length - 1].isSnap === true;
    if (trackSegments.length === 0) {
      currentPos = initialPos.clone();
      currentDir = initialDir.clone();
    } else {
      const last = trackSegments[trackSegments.length - 1];
      currentPos = last.end ? last.end.clone() : last.curve.v3.clone();
      currentDir = last.endDir.clone();
    }
    rebuildTrackMeshes();
    setStatus(`Removed the last section. Sections: ${trackSegments.length}.`);
  }

  function clearTrack() {
    if (isTesting) stopTest();
    trackSegments.length = 0;
    isClosedLoop = false;
    currentPos = initialPos.clone();
    currentDir = initialDir.clone();
    rebuildTrackMeshes();
    setStatus('Track cleared. Start building from the blue start marker.');
  }

  function toggleTest() {
    if (isTesting) stopTest();
    else startTest();
  }

  function startTest() {
    if (sampledPoints.length < 2 || totalTrackLength < 2) {
      setStatus('Build at least one track section before testing.');
      return;
    }

    isTesting = true;
    cart.visible = true;
    cartDistance = 0;
    cartSpeed = Number(ui.speedSlider.value);
    updateTestButton();
    updatePreviewSection();
    updateCart(0);
    setStatus(`Testing the two-car train in ${viewMode === 'first' ? 'first' : 'third'} person${isClosedLoop ? ' on a closed loop' : ''}. Press the stop button to return to free camera.`);
  }

  function stopTest() {
    isTesting = false;
    cart.visible = false;
    updateTestButton();
    updatePreviewSection();
    setStatus(isClosedLoop ? 'Test stopped. The coaster remains closed; press Undo to reopen it or Play to ride again.' : 'Test stopped. WASD, mouse drag, and touch controls are back on the free camera.');
  }

  function updateTestButton() {
    if (ui.panel) ui.panel.classList.toggle('testing', isTesting);
    if (!ui.testCoaster) return;
    ui.testCoaster.textContent = isTesting ? '■' : '▶';
    ui.testCoaster.setAttribute('aria-label', isTesting ? 'Stop test' : 'Start test');
    ui.testCoaster.title = isTesting ? 'Stop test' : 'Start test';
    ui.testCoaster.classList.toggle('good', !isTesting);
    ui.testCoaster.classList.toggle('warning', isTesting);
  }

  function toggleViewMode() {
    viewMode = viewMode === 'third' ? 'first' : 'third';
    updateViewModeButton();
    setStatus(`Camera view set to ${viewMode === 'third' ? 'third person' : 'first person'}.`);
  }

  function updateViewModeButton() {
    if (!ui.viewMode) return;
    ui.viewMode.textContent = viewMode === 'third' ? '3rd' : '1st';
    ui.viewMode.setAttribute('aria-label', viewMode === 'third' ? 'Switch to first person view' : 'Switch to third person view');
    ui.viewMode.title = viewMode === 'third' ? 'Switch to first person view' : 'Switch to third person view';
  }

  function rebuildTrackMeshes() {
    scene.remove(trackGroup);
    disposeGroup(trackGroup);
    trackGroup = new THREE.Group();
    scene.add(trackGroup);

    sampledPoints = sampleTrackPoints();
    sampledFrames = buildTrackFrames(sampledPoints);
    applyRollToFrames(sampledFrames, sampleRollAngles());
    rebuildDistanceTable();
    updateEndpointHelpers();

    if (sampledPoints.length >= 2) {
      const { left, right } = createRailPointSets(sampledPoints, 0.48, sampledFrames);
      addTube(left, 0.075, materials.rail);
      addTube(right, 0.075, materials.rail);
      addTube(sampledPoints, 0.035, materials.centerLine);
      addSleepers(left, right);
      addSupports(sampledPoints, trackGroup, materials.support, true, sampledFrames);
    }

    updatePreviewSection();
  }

  function updatePreviewSection() {
    scene.remove(previewGroup);
    disposeGroup(previewGroup);
    previewGroup = new THREE.Group();
    scene.add(previewGroup);

    if (ui.placeSection) ui.placeSection.disabled = isClosedLoop;

    if (isTesting || isClosedLoop) {
      previewGroup.visible = false;
      return;
    }

    const previewSegment = buildSectionData(selectedSectionType);
    const previewPoints = previewSegment.curve.getPoints(previewSegment.isStunt ? STUNT_POINT_COUNT : TRACK_SAMPLES_PER_SECTION);
    if (previewPoints.length < 2) return;

    const previewFrames = buildTrackFrames(previewPoints);
    if (previewSegment.roll) {
      const previewRolls = [];
      const divisions = previewPoints.length - 1;
      for (let j = 0; j < previewPoints.length; j++) {
        previewRolls.push(smootherStep(j / divisions) * previewSegment.roll);
      }
      applyRollToFrames(previewFrames, previewRolls);
    }
    const { left, right } = createRailPointSets(previewPoints, 0.48, previewFrames);
    addTube(left, 0.075, previewMaterials.rail, previewGroup, false);
    addTube(right, 0.075, previewMaterials.rail, previewGroup, false);
    addTube(previewPoints, 0.035, previewMaterials.centerLine, previewGroup, false);
    addSleepers(left, right, previewGroup, previewMaterials.sleeper, false);
    addSupports(previewPoints, previewGroup, previewMaterials.support, false, previewFrames);
  }

  function sampleTrackPoints() {
    const points = [];
    for (let i = 0; i < trackSegments.length; i++) {
      const divisions = trackSegments[i].isStunt ? STUNT_POINT_COUNT : TRACK_SAMPLES_PER_SECTION;
      const segmentPoints = trackSegments[i].curve.getPoints(divisions);
      if (i > 0) segmentPoints.shift();
      points.push(...segmentPoints);
    }
    return points;
  }

  function sampleRollAngles() {
    const rolls = [];
    for (let i = 0; i < trackSegments.length; i++) {
      const seg = trackSegments[i];
      const divisions = seg.isStunt ? STUNT_POINT_COUNT : TRACK_SAMPLES_PER_SECTION;
      const startJ = i > 0 ? 1 : 0;
      for (let j = startJ; j <= divisions; j++) {
        rolls.push(seg.roll !== undefined ? smootherStep(j / divisions) * seg.roll : null);
      }
    }
    return rolls;
  }

  function applyRollToFrames(frames, rolls) {
    for (let i = 0; i < frames.length; i++) {
      if (rolls[i] === null || rolls[i] === undefined) continue;
      const roll = rolls[i];
      const frame = frames[i];
      const fwd = frame.forward;

      let upN = worldUp.clone().sub(fwd.clone().multiplyScalar(worldUp.dot(fwd)));
      if (upN.lengthSq() < 0.0001) upN.set(0, 0, 1);
      upN.normalize();
      const upS = new THREE.Vector3().crossVectors(fwd, upN).normalize();

      const c = Math.cos(roll);
      const s = Math.sin(roll);
      frame.normal.set(c * upN.x + s * upS.x, c * upN.y + s * upS.y, c * upN.z + s * upS.z);
      frame.side.set(-s * upN.x + c * upS.x, -s * upN.y + c * upS.y, -s * upN.z + c * upS.z);
    }
  }

  function rebuildDistanceTable() {
    sampledDistances = [];
    totalTrackLength = 0;
    for (let i = 0; i < sampledPoints.length; i++) {
      if (i > 0) totalTrackLength += sampledPoints[i].distanceTo(sampledPoints[i - 1]);
      sampledDistances.push(totalTrackLength);
    }
  }

  function createRailPointSets(centerPoints, offset, frames = buildTrackFrames(centerPoints)) {
    const left = [];
    const right = [];

    for (let i = 0; i < centerPoints.length; i++) {
      const frame = frames[i] || frameFromDirection(
        centerPoints[Math.min(centerPoints.length - 1, i + 1)].clone().sub(centerPoints[Math.max(0, i - 1)])
      );
      const side = frame.side.clone().normalize();
      left.push(centerPoints[i].clone().addScaledVector(side, offset));
      right.push(centerPoints[i].clone().addScaledVector(side, -offset));
    }

    return { left, right };
  }

  function buildTrackFrames(points) {
    if (points.length < 2) return [];

    const tangents = [];
    for (let i = 0; i < points.length; i++) {
      const prev = points[Math.max(0, i - 1)];
      const next = points[Math.min(points.length - 1, i + 1)];
      let tangent = next.clone().sub(prev);
      if (tangent.lengthSq() < 0.0001) tangent = i > 0 ? tangents[i - 1].clone() : currentDir.clone();
      tangents.push(tangent.normalize());
    }

    const frames = [];
    let normal = worldUp.clone().sub(tangents[0].clone().multiplyScalar(worldUp.dot(tangents[0])));
    if (normal.lengthSq() < 0.0001) normal.set(0, 0, 1);
    normal.normalize();

    for (let i = 0; i < points.length; i++) {
      if (i > 0) {
        const previousTangent = tangents[i - 1];
        const tangent = tangents[i];
        const axis = new THREE.Vector3().crossVectors(previousTangent, tangent);
        const axisLength = axis.length();

        if (axisLength > 0.0001) {
          const angle = Math.atan2(axisLength, THREE.MathUtils.clamp(previousTangent.dot(tangent), -1, 1));
          normal.applyAxisAngle(axis.normalize(), angle);
        }
      }

      const forward = tangents[i].clone().normalize();
      normal.sub(forward.clone().multiplyScalar(normal.dot(forward)));
      if (normal.lengthSq() < 0.0001) normal.copy(frameFromDirection(forward).normal);
      normal.normalize();

      // On straight, mostly level exit pieces, gently restore the rails to upright.
      // This prevents loops/corkscrews from leaving the next section banked sideways.
      const previousForCurvature = tangents[Math.max(0, i - 1)];
      const nextForCurvature = tangents[Math.min(tangents.length - 1, i + 1)];
      const curvature = Math.max(
        previousForCurvature.angleTo(forward),
        forward.angleTo(nextForCurvature)
      );
      const uprightNormal = worldUp.clone().sub(forward.clone().multiplyScalar(worldUp.dot(forward)));
      if (uprightNormal.lengthSq() > 0.0001 && Math.abs(forward.dot(worldUp)) < 0.32 && curvature < 0.025) {
        normal.lerp(uprightNormal.normalize(), 0.055).normalize();
      }

      const side = new THREE.Vector3().crossVectors(forward, normal).normalize();
      frames.push({ forward, normal: normal.clone(), side });
    }

    return frames;
  }

  function frameAtSample(index, tangent) {
    if (!sampledFrames[index]) return frameFromDirection(tangent);
    const frame = sampledFrames[index];
    return {
      forward: tangent.clone().normalize(),
      normal: frame.normal.clone(),
      side: frame.side.clone()
    };
  }

  function blendedFrame(indexA, indexB, amount, tangent) {
    const frameA = sampledFrames[indexA] || frameFromDirection(tangent);
    const frameB = sampledFrames[indexB] || frameA;
    const forward = tangent.clone().normalize();
    let normal = frameA.normal.clone().lerp(frameB.normal, amount);
    normal.sub(forward.clone().multiplyScalar(normal.dot(forward)));
    if (normal.lengthSq() < 0.0001) normal = frameFromDirection(forward).normal;
    normal.normalize();
    const side = new THREE.Vector3().crossVectors(forward, normal).normalize();
    return { forward, normal, side };
  }

  function addTube(points, radius, material, group = trackGroup, shadows = true) {
    if (points.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(points);
    const geometry = new THREE.TubeGeometry(curve, Math.max(24, points.length * 3), radius, 10, false);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    group.add(mesh);
  }

  function addSleepers(left, right, group = trackGroup, material = materials.sleeper, shadows = true) {
    const step = 7;
    for (let i = 0; i < left.length; i += step) {
      const sleeper = cylinderBetween(left[i], right[i], 0.045, material, 8);
      sleeper.castShadow = shadows;
      sleeper.receiveShadow = shadows;
      group.add(sleeper);
    }
  }

  function addSupports(centerPoints, group = trackGroup, material = materials.support, shadows = true, frames = null) {
    const step = 16;
    for (let i = 0; i < centerPoints.length; i += step) {
      const point = centerPoints[i];
      if (point.y < 1.1) continue;

      const frame = frames ? frames[i] : (sampledFrames[i] || null);
      if (frame && frame.normal.y < 0.1) continue;

      const top = point.clone().add(new THREE.Vector3(0, -0.15, 0));
      const bottom = new THREE.Vector3(point.x, 0.05, point.z);
      const post = cylinderBetween(bottom, top, 0.055, material, 10);
      post.castShadow = shadows;
      post.receiveShadow = shadows;
      group.add(post);

      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.1, 18), material);
      base.position.copy(bottom);
      base.castShadow = shadows;
      base.receiveShadow = shadows;
      group.add(base);
    }
  }

  function updateEndpointHelpers() {
    endpointMarker.position.copy(currentPos);
    endpointMarker.visible = !isTesting && !isClosedLoop;

    directionArrow.position.copy(currentPos);
    directionArrow.setDirection(currentDir.clone().normalize());
    directionArrow.setLength(3, 0.7, 0.35);
    directionArrow.visible = !isTesting && !isClosedLoop;
  }

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

  function createTrain() {
    const train = new THREE.Group();
    train.name = 'Two car coaster train';

    const frontCar = createCoasterCar(0);
    frontCar.userData.trainOffset = 0;
    train.add(frontCar);

    const rearCar = createCoasterCar(1);
    rearCar.userData.trainOffset = TRAIN_CAR_SPACING;
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

  function updateCart(dt) {
    cartDistance += cartSpeed * dt;

    if (cartDistance >= totalTrackLength) {
      if (isClosedLoop) {
        cartDistance %= totalTrackLength;
      } else {
        cartDistance = totalTrackLength;
        const endState = placeTrain(cartDistance);
        followCart(endState.position, endState.tangent, endState.frame);
        isTesting = false;
        cart.visible = false;
        updateTestButton();
        updatePreviewSection();
        setStatus('The train reached the end of the track. Add more sections, use Snap loop, or press Play again.');
        return;
      }
    }

    const leadState = placeTrain(cartDistance);
    followCart(leadState.position, leadState.tangent, leadState.frame);
  }

  function placeTrain(distance) {
    const leadState = pointAtDistance(trackDistanceForCar(distance, 0));

    cart.children.forEach((carObject) => {
      const carDistance = trackDistanceForCar(distance, carObject.userData.trainOffset || 0);
      const state = pointAtDistance(carDistance);
      placeCarOnTrack(carObject, state.position, state.tangent, state.frame);
    });

    return leadState;
  }

  function trackDistanceForCar(baseDistance, carOffset) {
    let distance = baseDistance - carOffset;

    if (isClosedLoop && totalTrackLength > 0) {
      distance = ((distance % totalTrackLength) + totalTrackLength) % totalTrackLength;
    } else {
      distance = THREE.MathUtils.clamp(distance, 0, totalTrackLength);
    }

    return distance;
  }

  function placeCarOnTrack(carObject, position, tangent, trackFrame) {
    const frame = trackFrame || makeTrackFrame(tangent);
    carObject.position.copy(position).addScaledVector(frame.normal, TRAIN_RAIL_CLEARANCE);

    const matrix = new THREE.Matrix4().makeBasis(frame.forward, frame.normal, frame.side);
    carObject.quaternion.setFromRotationMatrix(matrix);
  }

  function makeTrackFrame(tangent) {
    return frameFromDirection(tangent);
  }

  function pointAtDistance(distance) {
    if (sampledPoints.length === 0) {
      const frame = makeTrackFrame(currentDir);
      return { position: currentPos.clone(), tangent: currentDir.clone(), frame };
    }

    if (distance <= 0) {
      return {
        position: sampledPoints[0].clone(),
        tangent: sampledPoints[1] ? sampledPoints[1].clone().sub(sampledPoints[0]).normalize() : currentDir.clone(),
        frame: frameAtSample(0, sampledPoints[1] ? sampledPoints[1].clone().sub(sampledPoints[0]).normalize() : currentDir.clone())
      };
    }

    if (distance >= totalTrackLength) {
      const last = sampledPoints.length - 1;
      return {
        position: sampledPoints[last].clone(),
        tangent: sampledPoints[last].clone().sub(sampledPoints[Math.max(0, last - 1)]).normalize(),
        frame: frameAtSample(last, sampledPoints[last].clone().sub(sampledPoints[Math.max(0, last - 1)]).normalize())
      };
    }

    let low = 0;
    let high = sampledDistances.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (sampledDistances[mid] < distance) low = mid + 1;
      else high = mid;
    }

    const i = Math.max(1, low);
    const beforeDistance = sampledDistances[i - 1];
    const afterDistance = sampledDistances[i];
    const span = Math.max(0.0001, afterDistance - beforeDistance);
    const t = (distance - beforeDistance) / span;
    const position = sampledPoints[i - 1].clone().lerp(sampledPoints[i], t);
    const tangent = sampledPoints[i].clone().sub(sampledPoints[i - 1]).normalize();
    const frame = blendedFrame(i - 1, i, t, tangent);
    return { position, tangent, frame };
  }

  function followCart(position, tangent, trackFrame) {
    const frame = trackFrame || makeTrackFrame(tangent);
    const direction = frame.forward;
    const normal = frame.normal;

    if (viewMode === 'first') {
      const camPos = position.clone().addScaledVector(direction, 0.75).addScaledVector(normal, 1.08);
      camera.position.lerp(camPos, 0.42);
      camera.lookAt(position.clone().addScaledVector(direction, 8).addScaledVector(normal, 0.82));
    } else {
      const camPos = position.clone().addScaledVector(direction, -9.25).addScaledVector(normal, 4.35);
      camera.position.lerp(camPos, 0.14);
      camera.lookAt(position.clone().addScaledVector(direction, 4.2).addScaledVector(normal, 1.35));
    }
  }

  function makePreviewMaterial(baseMaterial) {
    const material = baseMaterial.clone();
    material.transparent = true;
    material.opacity = 0.5;
    material.depthWrite = false;
    return material;
  }

  function zoomCamera(deltaY, sensitivity = zoom.wheelSensitivity) {
    const nextFov = THREE.MathUtils.clamp(
      camera.fov + deltaY * sensitivity,
      zoom.minFov,
      zoom.maxFov
    );

    if (nextFov === camera.fov) return;

    camera.fov = nextFov;
    camera.updateProjectionMatrix();
  }

  function rotateFreeCameraByPixels(deltaX, deltaY) {
    cameraYaw -= deltaX * 0.0022;
    cameraPitch -= deltaY * 0.0022;
    const limit = Math.PI / 2 - 0.05;
    cameraPitch = Math.max(-limit, Math.min(limit, cameraPitch));
  }

  function panFreeCameraByPixels(deltaX, deltaY) {
    const panSpeed = Math.max(0.018, camera.fov / 2600);
    const yawForward = new THREE.Vector3(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw)).normalize();
    const yawRight = new THREE.Vector3().crossVectors(yawForward, worldUp).normalize();

    // Two-finger drag acts like grabbing the world: drag right to see farther left,
    // drag up to move forward across the coaster park.
    camera.position.addScaledVector(yawRight, -deltaX * panSpeed);
    camera.position.addScaledVector(yawForward, -deltaY * panSpeed);
    camera.position.y = Math.max(1.2, camera.position.y);
  }

  function handleTouchStart(event) {
    if (event.touches.length === 0) return;
    event.preventDefault();
    dragging = false;

    if (event.touches.length === 1) {
      const touch = event.touches[0];
      touchState.mode = 'rotate';
      touchState.lastX = touch.clientX;
      touchState.lastY = touch.clientY;
      return;
    }

    beginPinchPan(event.touches);
  }

  function handleTouchMove(event) {
    if (event.touches.length === 0) return;
    event.preventDefault();

    if (event.touches.length === 1) {
      const touch = event.touches[0];
      if (touchState.mode !== 'rotate') {
        touchState.mode = 'rotate';
        touchState.lastX = touch.clientX;
        touchState.lastY = touch.clientY;
        return;
      }

      const deltaX = touch.clientX - touchState.lastX;
      const deltaY = touch.clientY - touchState.lastY;
      touchState.lastX = touch.clientX;
      touchState.lastY = touch.clientY;

      if (!isTesting) rotateFreeCameraByPixels(deltaX, deltaY);
      return;
    }

    if (touchState.mode !== 'pinchPan') beginPinchPan(event.touches);

    const center = touchCenter(event.touches);
    const pinchDistance = touchDistance(event.touches);
    const centerDeltaX = center.x - touchState.lastCenterX;
    const centerDeltaY = center.y - touchState.lastCenterY;
    const pinchDelta = touchState.lastPinchDistance - pinchDistance;

    zoomCamera(pinchDelta, zoom.pinchSensitivity);
    if (!isTesting) panFreeCameraByPixels(centerDeltaX, centerDeltaY);

    touchState.lastCenterX = center.x;
    touchState.lastCenterY = center.y;
    touchState.lastPinchDistance = pinchDistance;
  }

  function handleTouchEnd(event) {
    event.preventDefault();

    if (event.touches.length >= 2) {
      beginPinchPan(event.touches);
      return;
    }

    if (event.touches.length === 1) {
      const touch = event.touches[0];
      touchState.mode = 'rotate';
      touchState.lastX = touch.clientX;
      touchState.lastY = touch.clientY;
      return;
    }

    resetTouchState();
  }

  function beginPinchPan(touches) {
    const center = touchCenter(touches);
    touchState.mode = 'pinchPan';
    touchState.lastCenterX = center.x;
    touchState.lastCenterY = center.y;
    touchState.lastPinchDistance = touchDistance(touches);
  }

  function touchCenter(touches) {
    const a = touches[0];
    const b = touches[1] || touches[0];
    return {
      x: (a.clientX + b.clientX) * 0.5,
      y: (a.clientY + b.clientY) * 0.5
    };
  }

  function touchDistance(touches) {
    const a = touches[0];
    const b = touches[1] || touches[0];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }

  function resetTouchState() {
    touchState.mode = 'none';
    touchState.lastX = 0;
    touchState.lastY = 0;
    touchState.lastCenterX = 0;
    touchState.lastCenterY = 0;
    touchState.lastPinchDistance = 0;
  }

  function updateFreeCamera(dt) {
    camera.rotation.order = 'YXZ';
    camera.rotation.set(cameraPitch, cameraYaw, 0);

    const speed = 15;
    const yawForward = new THREE.Vector3(Math.sin(cameraYaw), 0, Math.cos(cameraYaw) * -1).normalize();
    yawForward.set(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw)).normalize();
    const yawRight = new THREE.Vector3().crossVectors(yawForward, worldUp).normalize();
    const move = new THREE.Vector3();

    if (keys.has('KeyW')) move.add(yawForward);
    if (keys.has('KeyS')) move.addScaledVector(yawForward, -1);
    if (keys.has('KeyD')) move.add(yawRight);
    if (keys.has('KeyA')) move.addScaledVector(yawRight, -1);

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed * dt);
      camera.position.add(move);
      camera.position.y = Math.max(1.2, camera.position.y);
    }
  }

  function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    endpointMarker.visible = !isTesting && !isClosedLoop;
    directionArrow.visible = !isTesting && !isClosedLoop;

    if (isTesting) updateCart(dt);
    else updateFreeCamera(dt);

    renderer.render(scene, camera);
  }

  function disposeGroup(group) {
    group.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
    });
  }

  function setStatus(message) {
    if (ui.status) ui.status.textContent = message;
    else if (window.console && typeof console.info === 'function') console.info(message);
  }

  function labelForType(type) {
    const labels = {
      straight: 'Straight',
      left: 'Left',
      right: 'Right',
      up: 'Up',
      down: 'Down',
      loopLeft: 'Left loop',
      loopRight: 'Right loop',
      corkscrewLeft: 'Left corkscrew',
      corkscrewRight: 'Right corkscrew',
      snap: 'Snap / close loop'
    };
    return labels[type] || (type.charAt(0).toUpperCase() + type.slice(1));
  }
})();
