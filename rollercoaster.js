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
  scene.fog = new THREE.Fog(0x8eb6ff, 250, 1500);

  const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 3000);
  const zoom = {
    minFov: 25,
    maxFov: 100,
    wheelSensitivity: 0.025,
    pinchSensitivity: 0.12,
    dollySpeed: 0.3
  };
  camera.position.set(18, 12, 22);
  camera.lookAt(7, 3, 0);
  camera.rotation.order = 'YXZ';

  let initialEuler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  let preRideCameraState = null;
  let cameraYaw = initialEuler.y;
  let cameraPitch = initialEuler.x;

  let rideLookYaw = 0;
  let rideLookPitch = 0;
  const rideLook = {
    maxYaw: Math.PI * 0.88,
    maxPitch: THREE.MathUtils.degToRad(70)
  };

  const worldUp = new THREE.Vector3(0, 1, 0);

  const grassTexture = (() => {
    const size = 512;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');

    ctx.fillStyle = '#5fa861';
    ctx.fillRect(0, 0, size, size);

    for (let i = 0; i < 60000; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const brightness = 0.85 + Math.random() * 0.3;
      const r = Math.floor(95 * brightness);
      const g = Math.floor((140 + Math.random() * 40) * brightness);
      const b = Math.floor(80 * brightness);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x, y, 1 + Math.random() * 1.5, 1 + Math.random() * 2.5);
    }

    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(320, 320);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();

  const materials = {
    ground: new THREE.MeshStandardMaterial({ map: grassTexture, roughness: 0.92 }),
    rail: new THREE.MeshStandardMaterial({ color: 0xdc2626, metalness: 0.55, roughness: 0.25 }),
    sleeper: new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.75 }),
    support: new THREE.MeshStandardMaterial({ color: 0x7c8799, metalness: 0.3, roughness: 0.42 }),
    centerLine: new THREE.MeshStandardMaterial({ color: 0x7f1d1d, roughness: 0.7 }),
    endpoint: new THREE.MeshStandardMaterial({ color: 0xffdf4d, emissive: 0xffb000, emissiveIntensity: 0.65 })
  };

  const TRACK_SAMPLES_PER_SECTION = 96;
  const TRAIN_CAR_SPACING = 2.55;
  const RAIL_DROP_OFFSET = 0.22;
  const TRAIN_RAIL_CLEARANCE = RAIL_DROP_OFFSET + 0.08;
  const STUNT_POINT_COUNT = 192;
  const SPINE_RADIUS = 0.11;
  const GRAVITY = 15.0;

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

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200), materials.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(800, 160, 0xffffff, 0xffffff);
  grid.material.opacity = 0.18;
  grid.material.transparent = true;
  // Fade the lines out with distance from the camera. Far away they bunch up
  // into a white haze at the horizon, which looks unnatural.
  grid.material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGridWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGridWorld = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGridWorld;')
      .replace(
        '#include <opaque_fragment>',
        'gl_FragColor = vec4(outgoingLight, diffuseColor.a * (1.0 - smoothstep(40.0, 160.0, distance(vGridWorld, cameraPosition))));'
      );
  };
  scene.add(grid);

  scene.add(window.CoasterMountains.mesh);

  const clouds = window.CoasterClouds;
  scene.add(clouds.group);

  const DEFAULT_TRACK_COLOR = '#dc2626';
  const START_MARKER_COLOR_ACTIVE = 0x2d6cdf;
  const START_MARKER_COLOR_INACTIVE = 0x7b8494;
  const startMarkerGeometry = new THREE.CylinderGeometry(0.45, 0.45, 0.18, 32);
  const hitMaterial = new THREE.MeshBasicMaterial({ visible: false });

  // Translucent start marker that follows the pointer while choosing where a
  // new coaster begins.
  const ghostMarker = new THREE.Mesh(
    startMarkerGeometry,
    new THREE.MeshStandardMaterial({ color: START_MARKER_COLOR_ACTIVE, transparent: true, opacity: 0.6 })
  );
  ghostMarker.visible = false;
  scene.add(ghostMarker);

  const ghostArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 2, 0), 3, 0xffe066, 0.7, 0.35);
  ghostArrow.visible = false;
  scene.add(ghostArrow);

  let trackGroup = new THREE.Group();
  scene.add(trackGroup);

  let previewGroup = new THREE.Group();
  scene.add(previewGroup);

  const endpointMarker = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 16), materials.endpoint);
  endpointMarker.castShadow = true;
  scene.add(endpointMarker);

  let directionArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 2, 0), 3, 0xffe066, 0.7, 0.35);
  scene.add(directionArrow);

  const cart = window.CoasterCart.createTrain(TRAIN_CAR_SPACING);
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
    lengthControl: document.getElementById('lengthControl'),
    angleControl: document.getElementById('angleControl'),
    stuntSizeControl: document.getElementById('stuntSizeControl'),
    status: document.getElementById('status'),
    viewModeFirst: document.getElementById('viewModeFirst'),
    viewModeThird: document.getElementById('viewModeThird'),
    viewModeFree: document.getElementById('viewModeFree'),
    placeSection: document.getElementById('placeSection'),
    snapStart: document.getElementById('snapStart'),
    testCoaster: document.getElementById('testCoaster'),
    addCoaster: document.getElementById('addCoaster'),
    trackColorInput: document.getElementById('trackColorInput'),
    coasterTitle: document.getElementById('coasterTitle'),
    fullscreenToggle: document.getElementById('fullscreenToggle'),
    clear: document.getElementById('clear'),
    undo: document.getElementById('undo'),
    redo: document.getElementById('redo')
  };

  // The working variables below always describe the active coaster; they are
  // swapped in and out of its record by activateCoaster().
  let initialPos = new THREE.Vector3(0, 2, 0);
  let initialDir = new THREE.Vector3(1, 0, 0);
  let trackSegments = [];
  let redoStack = [];
  let currentPos = initialPos.clone();
  let currentDir = initialDir.clone();
  let isClosedLoop = false;
  const coasters = [];
  let activeCoaster = null;
  let coasterCounter = 0;
  let placingCoaster = false;
  // Set while an imported coaster is being positioned before it is committed.
  let movingCoaster = null;
  let moveBase = null;
  let moveReturnTo = null;
  let moveReplace = null;
  let sampledPoints = [];
  let sampledDistances = [];
  let sampledFrames = [];
  let totalTrackLength = 0;

  let selectedSectionType = 'straight';
  let isTesting = false;
  let cartDistance = 0;
  let minCartSpeed = Number(ui.speedSlider.value);
  let cartSpeed = minCartSpeed;
  let isFlying = false;
  const flightPosition = new THREE.Vector3();
  const flightVelocity = new THREE.Vector3();
  const flightForward = new THREE.Vector3(0, 0, 1);
  const explosions = window.CoasterExplosions.create(scene, GRAVITY);
  let crashCameraHold = false;
  let crashCameraDelay = 0;
  const CRASH_CAMERA_EXTRA_HOLD = 1; // seconds to stay in ride view after the explosion ends
  let viewMode = 'third';

  const keys = new Set();
  let dragging = false;
  const doubleTap = {
    lastTime: 0,
    lastX: 0,
    lastY: 0,
    maxDelay: 300,
    maxDistance: 30
  };
  const raycaster = new THREE.Raycaster();
  const cameraGlide = {
    active: false,
    startTime: 0,
    duration: 450,
    fromPosition: new THREE.Vector3(),
    toPosition: new THREE.Vector3(),
    fromYaw: 0,
    toYaw: 0,
    fromPitch: 0,
    toPitch: 0
  };

  const touchState = {
    mode: 'none',
    lastX: 0,
    lastY: 0,
    lastCenterX: 0,
    lastCenterY: 0,
    lastPinchDistance: 0,
    tapCandidate: false,
    tapX: 0,
    tapY: 0,
    tapTime: 0
  };
  let lastTime = performance.now();
  let mouseDownPos = null;

  activateCoaster(createCoaster(initialPos.clone(), initialDir.clone(), {
    rail: materials.rail,
    sleeper: materials.sleeper,
    centerLine: materials.centerLine
  }));
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
    ui.placeSection.addEventListener('click', placeSelectedSection);
    document.getElementById('snapStart').addEventListener('click', snapToStart);
    ui.undo.addEventListener('click', undoSection);
    ui.redo.addEventListener('click', redoSection);
    document.getElementById('clear').addEventListener('click', () => {
      if (confirm('Are you sure you want to delete this roller coaster?')) {
        clearTrack();
      }
    });
    document.getElementById('exportTrack').addEventListener('click', exportTrack);
    document.getElementById('importTrack').addEventListener('click', () => {
      document.getElementById('importFile').click();
    });
    document.getElementById('movePlace').addEventListener('click', commitMove);
    document.getElementById('moveCancel').addEventListener('click', cancelMove);
    document.getElementById('importFile').addEventListener('change', (e) => {
      if (e.target.files.length) importTrack(e.target.files[0]);
      e.target.value = '';
    });
    const trackColorInput = document.getElementById('trackColorInput');
    document.getElementById('trackColorButton').addEventListener('click', () => {
      if (typeof trackColorInput.showPicker === 'function') trackColorInput.showPicker();
      else trackColorInput.click();
    });
    document.getElementById('renameCoaster').addEventListener('click', () => {
      const name = prompt('Name this roller coaster:', activeCoaster.name);
      if (name === null || !name.trim()) return;
      activeCoaster.name = name.trim().slice(0, 60);
      ui.coasterTitle.textContent = activeCoaster.name;
    });
    trackColorInput.addEventListener('input', () => setTrackColor(trackColorInput.value));
    ui.testCoaster.addEventListener('click', toggleTest);
    ui.addCoaster.addEventListener('click', () => setPlacingCoaster(!placingCoaster));
    ui.fullscreenToggle.addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', updateFullscreenButton);
    document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
    document.addEventListener('mozfullscreenchange', updateFullscreenButton);
    document.addEventListener('MSFullscreenChange', updateFullscreenButton);
    ui.viewModeFirst.addEventListener('click', () => setViewMode('first'));
    ui.viewModeThird.addEventListener('click', () => setViewMode('third'));
    ui.viewModeFree.addEventListener('click', () => setViewMode('free'));

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
      minCartSpeed = Number(ui.speedSlider.value);
    });

    window.addEventListener('keydown', (event) => {
      if (event.code === 'Escape') {
        if (placingCoaster) setPlacingCoaster(false);
        if (movingCoaster) cancelMove();
      }
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ControlLeft', 'ControlRight'].includes(event.code)) {
        keys.add(event.code);
        cancelCameraGlide();
        event.preventDefault();
      }
    });

    window.addEventListener('keyup', (event) => keys.delete(event.code));

    canvas.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      dragging = true;
      mouseDownPos = { x: event.clientX, y: event.clientY };
      cancelCameraGlide();
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

    canvas.addEventListener('click', (event) => {
      const down = mouseDownPos;
      mouseDownPos = null;
      if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
      handleCanvasTap(event.clientX, event.clientY, true);
    });

    canvas.addEventListener('mousemove', (event) => {
      if (!dragging) {
        if (placingCoaster || movingCoaster) updateGhost(event.clientX, event.clientY);
        return;
      }
      if (isRideCameraActive()) rotateRideLookByPixels(event.movementX, event.movementY);
      else rotateFreeCameraByPixels(event.movementX, event.movementY);
    });

    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      cancelCameraGlide();
      zoomCamera(event.deltaY);
    }, { passive: false });

    canvas.addEventListener('dblclick', (event) => {
      event.preventDefault();
      zoomToPoint(event.clientX, event.clientY);
    });

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
    updateSectionControls();
    updateTestButton();
    updateViewModeButton();
  }

  function createCoaster(position, direction, mats) {
    const coaster = {
      startPos: position,
      startDir: direction,
      segments: [],
      redo: [],
      currentPos: position.clone(),
      currentDir: direction.clone(),
      isClosedLoop: false,
      name: `Roller coaster ${++coasterCounter}`,
      color: DEFAULT_TRACK_COLOR,
      minSpeed: Number(ui.speedSlider.value),
      group: new THREE.Group(),
      mats: mats || {
        rail: materials.rail.clone(),
        sleeper: materials.sleeper.clone(),
        centerLine: materials.centerLine.clone()
      },
      marker: new THREE.Mesh(
        startMarkerGeometry,
        new THREE.MeshStandardMaterial({ color: START_MARKER_COLOR_ACTIVE, emissive: 0x163772, emissiveIntensity: 0.25 })
      )
    };
    if (!mats) paintTrackMaterials(coaster.mats, DEFAULT_TRACK_COLOR);

    coaster.group.userData.coaster = coaster;
    scene.add(coaster.group);
    coaster.marker.userData.coaster = coaster;
    coaster.marker.position.set(position.x, position.y - 0.08, position.z);
    coaster.marker.castShadow = true;
    scene.add(coaster.marker);
    coasters.push(coaster);
    return coaster;
  }

  function activateCoaster(coaster) {
    if (activeCoaster) {
      activeCoaster.currentPos = currentPos;
      activeCoaster.currentDir = currentDir;
      activeCoaster.isClosedLoop = isClosedLoop;
      activeCoaster.group = trackGroup;
      activeCoaster.minSpeed = minCartSpeed;
    }

    activeCoaster = coaster;
    trackSegments = coaster.segments;
    redoStack = coaster.redo;
    initialPos = coaster.startPos;
    initialDir = coaster.startDir;
    currentPos = coaster.currentPos.clone();
    currentDir = coaster.currentDir.clone();
    isClosedLoop = coaster.isClosedLoop;
    trackGroup = coaster.group;

    materials.rail = coaster.mats.rail;
    materials.sleeper = coaster.mats.sleeper;
    materials.centerLine = coaster.mats.centerLine;
    paintTrackMaterials(previewMaterials, coaster.color);
    ui.trackColorInput.value = coaster.color;
    ui.coasterTitle.textContent = coaster.name;

    minCartSpeed = coaster.minSpeed;
    ui.speedSlider.value = minCartSpeed;
    ui.speedValue.textContent = minCartSpeed;

    for (const other of coasters) {
      other.marker.material.color.setHex(other === coaster ? START_MARKER_COLOR_ACTIVE : START_MARKER_COLOR_INACTIVE);
    }

    rebuildTrackMeshes();
  }

  function removeCoaster(coaster) {
    coasters.splice(coasters.indexOf(coaster), 1);
    scene.remove(coaster.group);
    disposeGroup(coaster.group);
    scene.remove(coaster.marker);
    coaster.marker.material.dispose();
    for (const mat of Object.values(coaster.mats)) mat.dispose();
  }

  function setMovingUI(moving) {
    document.body.classList.toggle('moving-coaster', moving);
    const touchOnly = window.matchMedia('(hover: none)').matches;
    document.getElementById('placeHintText').textContent = moving
      ? (touchOnly ? 'Drag or tap to position the coaster, then press Place' : 'Click to place the coaster')
      : 'Tap the ground to start a new roller coaster';
    ghostMarker.visible = false;
    ghostArrow.visible = false;
  }

  function beginMove(coaster, returnTo) {
    movingCoaster = coaster;
    moveBase = coaster.startPos.clone();
    moveReturnTo = returnTo;
    // An untouched coaster would only be left behind as a stray start marker.
    moveReplace = returnTo && returnTo.segments.length === 0 ? returnTo : null;
    setMovingUI(true);
  }

  function moveCoasterTo(point) {
    const coaster = movingCoaster;
    coaster.group.position.set(point.x - moveBase.x, 0, point.z - moveBase.z);
    coaster.marker.position.set(point.x, point.y - 0.08, point.z);
  }

  function translateCoaster(coaster, dx, dz) {
    const vectors = new Set([coaster.startPos]);
    for (const seg of coaster.segments) {
      vectors.add(seg.start);
      vectors.add(seg.end);
      const curve = seg.curve;
      for (const v of [curve.v0, curve.v1, curve.v2, curve.v3, ...(curve.points || [])]) {
        if (v) vectors.add(v);
      }
    }
    for (const v of vectors) {
      v.x += dx;
      v.z += dz;
    }
  }

  function commitMove() {
    const coaster = movingCoaster;
    if (!coaster) return;
    const dx = coaster.group.position.x;
    const dz = coaster.group.position.z;
    coaster.group.position.set(0, 0, 0);
    translateCoaster(coaster, dx, dz);
    currentPos.x += dx;
    currentPos.z += dz;
    coaster.marker.position.set(coaster.startPos.x, coaster.startPos.y - 0.08, coaster.startPos.z);

    const replace = moveReplace;
    movingCoaster = null;
    moveReplace = null;
    moveReturnTo = null;
    setMovingUI(false);
    if (replace && replace.segments.length === 0) removeCoaster(replace);
    rebuildTrackMeshes();
    setStatus('Placed the imported coaster.');
  }

  function cancelMove() {
    const coaster = movingCoaster;
    if (!coaster) return;
    const back = coasters.includes(moveReturnTo) ? moveReturnTo : coasters.find((c) => c !== coaster);
    movingCoaster = null;
    moveReplace = null;
    moveReturnTo = null;
    setMovingUI(false);
    removeCoaster(coaster);
    activeCoaster = null;
    activateCoaster(back);
    setStatus('Import cancelled.');
  }

  function setPlacingCoaster(placing) {
    if (placing && (isTesting || movingCoaster)) return;
    placingCoaster = placing;
    ghostMarker.visible = false;
    ghostArrow.visible = false;
    document.body.classList.toggle('placing-coaster', placing);
    ui.addCoaster.classList.toggle('selected', placing);
    if (placing) setStatus('Pick a spot on the ground to start a new roller coaster.');
  }

  function newCoasterDirection() {
    const forward = camera.getWorldDirection(new THREE.Vector3());
    if (Math.abs(forward.x) >= Math.abs(forward.z)) return new THREE.Vector3(Math.sign(forward.x) || 1, 0, 0);
    return new THREE.Vector3(0, 0, Math.sign(forward.z));
  }

  function groundPointAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObject(ground, false)[0];
    if (!hit) return null;
    return new THREE.Vector3(Math.round(hit.point.x), initialPos.y, Math.round(hit.point.z));
  }

  function updateGhost(clientX, clientY) {
    const point = groundPointAt(clientX, clientY);
    if (movingCoaster) {
      if (point) moveCoasterTo(point);
      return;
    }
    ghostMarker.visible = !!point;
    ghostArrow.visible = !!point;
    if (!point) return;
    ghostMarker.position.set(point.x, point.y - 0.08, point.z);
    ghostArrow.position.copy(point);
    ghostArrow.setDirection(newCoasterDirection());
    ghostArrow.setLength(3, 0.7, 0.35);
  }

  function handleCanvasTap(clientX, clientY, fromMouse = false) {
    if (isTesting) return;

    if (movingCoaster) {
      // A mouse click places the coaster where it is hovering. Touch has no
      // hover, so a tap only repositions it and the Place button confirms.
      const point = groundPointAt(clientX, clientY);
      if (!point) return;
      moveCoasterTo(point);
      if (fromMouse) commitMove();
      return;
    }

    if (placingCoaster) {
      const point = groundPointAt(clientX, clientY);
      if (!point) return;
      const coaster = createCoaster(point, newCoasterDirection());
      setPlacingCoaster(false);
      activateCoaster(coaster);
      setStatus(`Started coaster ${coasters.length}. Build from the blue start marker.`);
      return;
    }

    const picked = pickCoaster(clientX, clientY);
    if (picked && picked !== activeCoaster) {
      activateCoaster(picked);
      setStatus(`Selected coaster ${coasters.indexOf(picked) + 1}. Sections: ${trackSegments.length}.`);
    }
  }

  function pickCoaster(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    ), camera);

    const targets = coasters.flatMap((coaster) => [coaster.group, coaster.marker]);
    const hit = raycaster.intersectObjects(targets, true)[0];
    for (let object = hit && hit.object; object; object = object.parent) {
      if (object.userData.coaster) return object.userData.coaster;
    }
    return null;
  }

  function selectSectionType(type) {
    selectedSectionType = type;
    updateDirectionButtons();
    updateSectionControls();
    updatePreviewSection();
    setStatus(`${labelForType(type)} selected. Press Place section to add it to the track.`);
  }

  function updateSectionControls() {
    const hasAngle = ['left', 'right', 'up', 'down'].includes(selectedSectionType);
    const hasLength = ['straight', 'left', 'right', 'up', 'down'].includes(selectedSectionType);
    const hasLoopSize = ['loopLeft', 'loopRight'].includes(selectedSectionType);

    ui.angleControl.classList.toggle('slot-hidden', !hasAngle);
    ui.lengthControl.classList.toggle('slot-hidden', !hasLength);
    ui.stuntSizeControl.classList.toggle('slot-hidden', !hasLoopSize);
  }

  function updateDirectionButtons() {
    const buttonsByType = {
      straight: document.getElementById('addStraight'),
      left: document.getElementById('addLeft'),
      right: document.getElementById('addRight'),
      up: document.getElementById('addUp'),
      down: document.getElementById('addDown'),
      loopLeft: document.getElementById('addLoopLeft'),
      loopRight: document.getElementById('addLoopRight')
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
    // Real loops aren't circular: a circle holds curvature (and so G-force at
    // a given speed) constant all the way round, but speed is highest at the
    // bottom and lowest at the top. Real loops use a wide, gentle radius at
    // the bottom and a much tighter one at the top - a "teardrop"/clothoid
    // shape that ends up taller than it is wide.
    const bottomRadius = size * 0.95;
    const topRadius = size * 0.45;
    const leadInLength = 3.8;
    const leadOutLength = 5.2;
    const loopDrift = 2.8 + Math.max(0, size - 12) * 0.08;
    const sideShift = THREE.MathUtils.clamp(bottomRadius * 0.42, 2.8, 5.6);
    const lateralSign = type === 'loopLeft' ? -1 : 1;
    const leadInPortion = 0.17;
    const leadOutPortion = 0.20;
    const loopStart = leadInPortion;
    const loopEnd = 1 - leadOutPortion;
    const points = [];

    // Radius of curvature as a function of tangent angle psi (0 = bottom
    // entry, PI = top of the loop, 2*PI = bottom exit). Integrating
    // cos(psi)*r and sin(psi)*r traces the actual teardrop path - unlike a
    // plain sin/cos circle, this makes the curve genuinely tighter up top.
    const loopRadius = (psi) => topRadius + (bottomRadius - topRadius) * (1 + Math.cos(psi)) / 2;

    let bodyX = 0;
    let bodyY = 0;
    let prevPsi = 0;
    let prevR = loopRadius(0);

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
        // Ease the angle traversal (rather than the radius) so the turn rate
        // - and so curvature - eases down to zero right at both ends. That's
        // what actually makes the join with the straight lead-in/out smooth;
        // easing the radius instead just blows up the point spacing there.
        const psi = smootherStep(u) * Math.PI * 2;
        const r = loopRadius(psi);

        // Trapezoidal integration of the teardrop path since the last sample.
        bodyX += (Math.cos(prevPsi) * prevR + Math.cos(psi) * r) / 2 * (psi - prevPsi);
        bodyY += (Math.sin(prevPsi) * prevR + Math.sin(psi) * r) / 2 * (psi - prevPsi);
        prevPsi = psi;
        prevR = r;

        forwardOffset = leadInLength + loopDrift * u + bodyX;
        verticalOffset = bodyY;
        sideOffset = smootherStep(u) * sideShift * lateralSign;
      } else {
        // bodyX/bodyY hold the teardrop's final integrated position (the
        // path doesn't return to sideOffset-relative zero the way a plain
        // circle did), so the lead-out has to continue from there.
        const u = (t - loopEnd) / leadOutPortion;
        forwardOffset = leadInLength + loopDrift + bodyX + leadOutLength * u;
        verticalOffset = bodyY;
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
      setStatus('This coaster is already closed. Press Undo to reopen the loop, or delete the coaster to start over.');
      return;
    }

    const segment = buildSectionData(type);
    trackSegments.push(segment);
    redoStack.length = 0;
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
      redoStack.length = 0;
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
    redoStack.length = 0;

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

    redoStack.push(trackSegments.pop());
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

  function redoSection() {
    if (isTesting) stopTest();
    if (redoStack.length === 0) {
      setStatus('There is no section to redo.');
      return;
    }

    const segment = redoStack.pop();
    trackSegments.push(segment);
    isClosedLoop = segment.isSnap === true;
    currentPos = segment.end ? segment.end.clone() : segment.curve.v3.clone();
    currentDir = segment.endDir.clone();
    rebuildTrackMeshes();
    setStatus(`Restored the section. Sections: ${trackSegments.length}.`);
  }

  function clearTrack() {
    if (isTesting) stopTest();

    // With other coasters around, clearing removes this one entirely (including
    // its start marker) and moves on to another coaster.
    if (coasters.length > 1) {
      removeCoaster(activeCoaster);
      activeCoaster = null;
      activateCoaster(coasters[coasters.length - 1]);
      setStatus('Coaster removed.');
      return;
    }

    trackSegments.length = 0;
    redoStack.length = 0;
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

    if (crashCameraHold) stopTest();

    preRideCameraState = {
      position: camera.position.clone(),
      fov: camera.fov,
      yaw: cameraYaw,
      pitch: cameraPitch,
    };

    setPlacingCoaster(false);
    isTesting = true;
    isFlying = false;
    cart.visible = true;
    cartDistance = 0;
    rideLookYaw = 0;
    rideLookPitch = 0;
    cartSpeed = minCartSpeed;
    updateTestButton();
    updatePreviewSection();
    updateCart(0);
    const viewLabel = viewMode === 'free' ? 'free camera' : `${viewMode} person`;
    setStatus(`Testing the two-car train in ${viewLabel}${isClosedLoop ? ' on a closed loop' : ''}. ${viewMode === 'free' ? 'WASD and drag to move the camera.' : 'Drag to look around.'} Press the stop button to return to free camera.`);
  }

  function stopTest() {
    crashCameraHold = false;
    isTesting = false;
    isFlying = false;
    cart.visible = false;
    camera.up.set(0, 1, 0);
    rideLookYaw = 0;
    rideLookPitch = 0;

    if (preRideCameraState) {
      camera.position.copy(preRideCameraState.position);
      camera.fov = preRideCameraState.fov;
      camera.updateProjectionMatrix();
      cameraYaw = preRideCameraState.yaw;
      cameraPitch = preRideCameraState.pitch;
      preRideCameraState = null;
    }

    updateTestButton();
    updatePreviewSection();
    setStatus(isClosedLoop ? 'Test stopped. The coaster remains closed; press Undo to reopen it or Play to ride again.' : 'Test stopped. WASD, mouse drag, and touch controls are back on the free camera.');
  }

  function updateTestButton() {
    if (ui.panel) ui.panel.classList.toggle('testing', isTesting);
    document.body.classList.toggle('riding', isTesting);
    if (!ui.testCoaster) return;
    ui.testCoaster.innerHTML = isTesting
      ? '<svg viewBox="0 0 24 24" class="fill-icon"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>'
      : '<svg viewBox="0 0 24 24" class="fill-icon"><path d="M6 4l14 8-14 8V4z"/></svg>';
    ui.testCoaster.setAttribute('aria-label', isTesting ? 'Stop test' : 'Start test');
    ui.testCoaster.title = isTesting ? 'Stop test' : 'Start test';
    ui.testCoaster.classList.toggle('good', !isTesting);
    ui.testCoaster.classList.toggle('warning', isTesting);
  }

  function getFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement
      || document.mozFullScreenElement || document.msFullscreenElement || null;
  }

  function toggleFullscreen() {
    const isFullscreen = !!getFullscreenElement() || document.body.classList.contains('fake-fullscreen');
    if (isFullscreen) {
      exitFullscreen();
    } else {
      enterFullscreen();
    }
  }

  function enterFullscreen() {
    const el = document.documentElement;
    const request = el.requestFullscreen || el.webkitRequestFullscreen
      || el.mozRequestFullScreen || el.msRequestFullscreen;
    if (request) {
      const result = request.call(el);
      if (result && typeof result.catch === 'function') {
        result.catch(() => enterFakeFullscreen());
      }
    } else {
      enterFakeFullscreen();
    }
  }

  function exitFullscreen() {
    const exit = document.exitFullscreen || document.webkitExitFullscreen
      || document.mozCancelFullScreen || document.msExitFullscreen;
    if (getFullscreenElement() && exit) {
      exit.call(document);
    }
    exitFakeFullscreen();
  }

  function enterFakeFullscreen() {
    document.body.classList.add('fake-fullscreen');
    // iOS Safari has no Fullscreen API for non-video elements. Scrolling the
    // page briefly nudges Safari into collapsing its address/toolbar chrome.
    window.scrollTo(0, 1);
    setTimeout(() => window.scrollTo(0, 0), 50);
    updateFullscreenButton();
  }

  function exitFakeFullscreen() {
    document.body.classList.remove('fake-fullscreen');
    updateFullscreenButton();
  }

  function updateFullscreenButton() {
    if (!ui.fullscreenToggle) return;
    const isFullscreen = !!getFullscreenElement() || document.body.classList.contains('fake-fullscreen');
    ui.fullscreenToggle.setAttribute('aria-label', isFullscreen ? 'Exit full screen' : 'Enter full screen');
    ui.fullscreenToggle.title = isFullscreen ? 'Exit full screen' : 'Enter full screen';
    ui.fullscreenToggle.classList.toggle('selected', isFullscreen);
  }

  function setViewMode(mode) {
    if (viewMode === mode) return;
    viewMode = mode;

    if (viewMode === 'free' && isTesting) {
      // Hand the current ride camera over to the free camera without a visible jump.
      const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
      cameraYaw = euler.y;
      cameraPitch = THREE.MathUtils.clamp(euler.x, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
      camera.up.set(0, 1, 0);
    }

    updateViewModeButton();
    const viewLabels = { first: 'first person', third: 'third person', free: 'free camera' };
    setStatus(`Camera view set to ${viewLabels[viewMode]}.`);
  }

  function updateViewModeButton() {
    const buttons = { first: ui.viewModeFirst, third: ui.viewModeThird, free: ui.viewModeFree };
    Object.entries(buttons).forEach(([mode, button]) => {
      if (!button) return;
      button.classList.toggle('selected', viewMode === mode);
      button.setAttribute('aria-pressed', viewMode === mode);
    });
  }

  function isRideCameraActive() {
    return isTesting && viewMode !== 'free';
  }

  function rebuildTrackMeshes() {
    scene.remove(trackGroup);
    disposeGroup(trackGroup);
    trackGroup = new THREE.Group();
    trackGroup.userData.coaster = activeCoaster;
    scene.add(trackGroup);
    activeCoaster.group = trackGroup;

    sampledPoints = sampleTrackPoints();
    sampledFrames = buildTrackFrames(sampledPoints);
    applyRollToFrames(sampledFrames, sampleRollAngles());
    rebuildDistanceTable();
    updateEndpointHelpers();

    if (sampledPoints.length >= 2) {
      const { left, right } = createRailPointSets(sampledPoints, 0.48, sampledFrames, RAIL_DROP_OFFSET);
      addTube(left, 0.075, materials.rail);
      addTube(right, 0.075, materials.rail);
      addTube(sampledPoints, SPINE_RADIUS, materials.centerLine);
      addStruts(sampledPoints, left, right);
      addSupports(sampledPoints, trackGroup, materials.support, true, sampledFrames);

      // Wide invisible tube so thin rails are easy to click when picking a coaster.
      addTube(sampledPoints, 1.1, hitMaterial, trackGroup, false).userData.hit = true;
    }

    updatePreviewSection();
  }

  function updatePreviewSection() {
    scene.remove(previewGroup);
    disposeGroup(previewGroup);
    previewGroup = new THREE.Group();
    scene.add(previewGroup);

    if (ui.placeSection) ui.placeSection.disabled = isClosedLoop;
    if (ui.snapStart) ui.snapStart.disabled = trackSegments.length === 0 || isClosedLoop;
    if (ui.testCoaster) ui.testCoaster.disabled = !isTesting && (sampledPoints.length < 2 || totalTrackLength < 2);
    if (ui.clear) ui.clear.disabled = trackSegments.length === 0 && coasters.length < 2;
    if (ui.undo) ui.undo.disabled = trackSegments.length === 0;
    if (ui.redo) ui.redo.disabled = redoStack.length === 0;

    if (isTesting || isClosedLoop || movingCoaster) {
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
    const { left, right } = createRailPointSets(previewPoints, 0.48, previewFrames, RAIL_DROP_OFFSET);
    addTube(left, 0.075, previewMaterials.rail, previewGroup, false);
    addTube(right, 0.075, previewMaterials.rail, previewGroup, false);
    addTube(previewPoints, SPINE_RADIUS, previewMaterials.centerLine, previewGroup, false);
    addStruts(previewPoints, left, right, previewGroup, previewMaterials.sleeper, false);
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

  function createRailPointSets(centerPoints, offset, frames = buildTrackFrames(centerPoints), dropOffset = 0) {
    const left = [];
    const right = [];

    for (let i = 0; i < centerPoints.length; i++) {
      const frame = frames[i] || frameFromDirection(
        centerPoints[Math.min(centerPoints.length - 1, i + 1)].clone().sub(centerPoints[Math.max(0, i - 1)])
      );
      const side = frame.side.clone().normalize();
      const normal = frame.normal.clone().normalize();
      const base = centerPoints[i].clone().addScaledVector(normal, dropOffset);
      left.push(base.clone().addScaledVector(side, offset));
      right.push(base.clone().addScaledVector(side, -offset));
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
    if (points.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(points);
    const geometry = new THREE.TubeGeometry(curve, Math.max(24, points.length * 3), radius, 10, false);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    group.add(mesh);
    return mesh;
  }

  function addStruts(centerPoints, left, right, group = trackGroup, material = materials.sleeper, shadows = true) {
    const spacing = 0.9;
    let sinceLast = spacing;
    for (let i = 0; i < centerPoints.length; i++) {
      if (i > 0) sinceLast += centerPoints[i].distanceTo(centerPoints[i - 1]);
      if (sinceLast < spacing) continue;
      sinceLast = 0;

      const strutLeft = cylinderBetween(centerPoints[i], left[i], 0.04, material, 8);
      strutLeft.castShadow = shadows;
      strutLeft.receiveShadow = shadows;
      group.add(strutLeft);

      const strutRight = cylinderBetween(centerPoints[i], right[i], 0.04, material, 8);
      strutRight.castShadow = shadows;
      strutRight.receiveShadow = shadows;
      group.add(strutRight);
    }
  }

  function addSupports(centerPoints, group = trackGroup, material = materials.support, shadows = true, frames = null) {
    const step = 16;
    for (let i = 0; i < centerPoints.length; i += step) {
      const point = centerPoints[i];
      if (point.y < 1.1) continue;

      const frame = frames ? frames[i] : (sampledFrames[i] || null);
      if (frame && frame.normal.y < 0.1) continue;

      const top = point.clone();
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

  function updateCart(dt) {
    if (isFlying) {
      updateFlight(dt);
      return;
    }

    const currentState = pointAtDistance(cartDistance);
    cartSpeed += -GRAVITY * currentState.tangent.y * dt;
    cartSpeed = Math.max(minCartSpeed, cartSpeed);

    cartDistance += cartSpeed * dt;

    if (cartDistance >= totalTrackLength) {
      if (isClosedLoop) {
        cartDistance %= totalTrackLength;
      } else {
        cartDistance = totalTrackLength;
        startFlight();
        return;
      }
    }

    const leadState = placeTrain(cartDistance);
    followCart(leadState.position, leadState.tangent, leadState.frame);
  }

  function releaseCrashCamera() {
    stopTest();
    setStatus('The train flew off the track and crashed! Add more sections, use Snap loop, or press Play again.');
  }

  function updateExplosions(dt) {
    if (crashCameraHold && !explosions.isActive()) {
      crashCameraDelay -= dt;
      if (crashCameraDelay <= 0) releaseCrashCamera();
    }

    explosions.update(dt);
  }

  function startFlight() {
    const endState = placeTrain(cartDistance);
    isFlying = true;
    flightPosition.copy(endState.position);
    flightForward.copy(endState.tangent).normalize();
    flightVelocity.copy(flightForward).multiplyScalar(cartSpeed);
    setStatus('The train flew off the end of the track!');
  }

  function updateFlight(dt) {
    flightVelocity.y -= GRAVITY * dt;
    flightPosition.addScaledVector(flightVelocity, dt);

    if (flightVelocity.lengthSq() > 0.01) {
      flightForward.copy(flightVelocity).normalize();
    }

    const frame = frameFromDirection(flightForward);

    cart.children.forEach((carObject) => {
      const offset = carObject.userData.trainOffset || 0;
      const carPosition = flightPosition.clone().addScaledVector(flightForward, -offset);
      placeCarOnTrack(carObject, carPosition, flightForward, frame);
    });

    followCart(flightPosition, flightForward, frame);

    if (flightPosition.y <= 0.4) {
      isFlying = false;
      cart.visible = false;
      explosions.spawn(flightPosition);
      // Stay in ride mode (isTesting) with the camera as it is until the explosion is over.
      crashCameraHold = true;
      crashCameraDelay = CRASH_CAMERA_EXTRA_HOLD;

      updateTestButton();
      updatePreviewSection();
      setStatus('The train flew off the track and crashed! Add more sections, use Snap loop, or press Play again.');
    }
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

  function rideLookDirection(direction, normal, side) {
    if (rideLookYaw === 0 && rideLookPitch === 0) return direction.clone();

    const yawQuat = new THREE.Quaternion().setFromAxisAngle(normal, rideLookYaw);
    const yawedForward = direction.clone().applyQuaternion(yawQuat);
    const yawedSide = side.clone().applyQuaternion(yawQuat);
    const pitchQuat = new THREE.Quaternion().setFromAxisAngle(yawedSide, rideLookPitch);
    return yawedForward.applyQuaternion(pitchQuat).normalize();
  }

  function followCart(position, tangent, trackFrame) {
    if (viewMode === 'free') return;

    const frame = trackFrame || makeTrackFrame(tangent);
    const direction = frame.forward;
    const normal = frame.normal;
    const lookDirection = rideLookDirection(direction, normal, frame.side);

    if (viewMode === 'first') {
      const eyeHeight = 1.08 + TRAIN_RAIL_CLEARANCE;
      const camPos = position.clone().addScaledVector(direction, 0.75).addScaledVector(normal, eyeHeight);
      camera.position.lerp(camPos, 0.42);
      camera.up.lerp(normal, 0.42).normalize();
      camera.lookAt(position.clone().addScaledVector(lookDirection, 8).addScaledVector(normal, eyeHeight - 0.26));
    } else {
      const camPos = position.clone().addScaledVector(direction, -9.25).addScaledVector(normal, 4.35);
      camera.position.lerp(camPos, 0.14);
      camera.up.lerp(normal, 0.14).normalize();
      camera.lookAt(camera.position.clone().addScaledVector(lookDirection, 13).addScaledVector(normal, 1.35));
    }
  }

  // Rails use the picked color; struts and core tube are darker shades of it.
  function setTrackColor(hex) {
    activeCoaster.color = hex;
    paintTrackMaterials(activeCoaster.mats, hex);
    paintTrackMaterials(previewMaterials, hex);
  }

  function paintTrackMaterials(mats, hex) {
    const hsl = {};
    new THREE.Color(hex).getHSL(hsl, THREE.SRGBColorSpace);
    const shades = {
      rail: 1,
      sleeper: 0.82,
      centerLine: 0.58
    };

    for (const [name, factor] of Object.entries(shades)) {
      mats[name].color.setHSL(hsl.h, hsl.s, hsl.l * factor, THREE.SRGBColorSpace);
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
    const desiredFov = camera.fov + deltaY * sensitivity;
    const nextFov = THREE.MathUtils.clamp(desiredFov, zoom.minFov, zoom.maxFov);

    if (nextFov !== camera.fov) {
      camera.fov = nextFov;
      camera.updateProjectionMatrix();
    }

    // Once the FOV hits its limit, keep zooming out (or back in) by moving the
    // camera itself instead of distorting the lens further.
    const overflow = desiredFov - nextFov;
    if (!isRideCameraActive() && overflow !== 0) {
      const forward = camera.getWorldDirection(new THREE.Vector3());
      camera.position.addScaledVector(forward, -overflow * zoom.dollySpeed);
      camera.position.y = Math.max(1.2, camera.position.y);
    }
  }

  function zoomToPoint(clientX, clientY) {
    if (isRideCameraActive()) return;

    const rect = canvas.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

    const targets = [...coasters.map((coaster) => coaster.group), ground, cart];
    const hits = raycaster.intersectObjects(targets, true).filter((hit) => !hit.object.userData.hit);

    const travelFraction = 0.5;
    let travelDistance;
    if (hits.length > 0) {
      travelDistance = hits[0].distance * travelFraction;
    } else {
      travelDistance = 12;
    }

    const targetPosition = camera.position.clone().addScaledVector(raycaster.ray.direction, travelDistance);
    targetPosition.y = Math.max(1.2, targetPosition.y);

    // Re-aim the free camera's yaw/pitch at the point we're zooming toward
    // so the glide ends looking at it, like Google Earth's double-click zoom.
    const dir = raycaster.ray.direction;
    const pitchLimit = Math.PI / 2 - 0.05;
    const targetYaw = Math.atan2(-dir.x, -dir.z);
    const targetPitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)), -pitchLimit, pitchLimit);

    startCameraGlide(targetPosition, targetYaw, targetPitch);
  }

  function startCameraGlide(targetPosition, targetYaw, targetPitch) {
    cameraGlide.active = true;
    cameraGlide.startTime = performance.now();
    cameraGlide.fromPosition.copy(camera.position);
    cameraGlide.toPosition.copy(targetPosition);
    cameraGlide.fromYaw = cameraYaw;
    cameraGlide.fromPitch = cameraPitch;
    // Take the shortest way around when interpolating yaw.
    let yawDelta = targetYaw - cameraYaw;
    yawDelta -= Math.round(yawDelta / (Math.PI * 2)) * Math.PI * 2;
    cameraGlide.toYaw = cameraYaw + yawDelta;
    cameraGlide.toPitch = targetPitch;
  }

  function cancelCameraGlide() {
    cameraGlide.active = false;
  }

  function updateCameraGlide(now) {
    if (!cameraGlide.active) return;

    const t = THREE.MathUtils.clamp((now - cameraGlide.startTime) / cameraGlide.duration, 0, 1);
    const eased = 1 - Math.pow(1 - t, 3);

    camera.position.lerpVectors(cameraGlide.fromPosition, cameraGlide.toPosition, eased);
    cameraYaw = THREE.MathUtils.lerp(cameraGlide.fromYaw, cameraGlide.toYaw, eased);
    cameraPitch = THREE.MathUtils.lerp(cameraGlide.fromPitch, cameraGlide.toPitch, eased);

    if (t >= 1) cameraGlide.active = false;
  }

  function rotateRideLookByPixels(deltaX, deltaY) {
    rideLookYaw = THREE.MathUtils.clamp(rideLookYaw - deltaX * 0.0022, -rideLook.maxYaw, rideLook.maxYaw);
    rideLookPitch = THREE.MathUtils.clamp(rideLookPitch - deltaY * 0.0022, -rideLook.maxPitch, rideLook.maxPitch);
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
      touchState.tapCandidate = true;
      touchState.tapX = touch.clientX;
      touchState.tapY = touch.clientY;
      touchState.tapTime = performance.now();
      cancelCameraGlide();

      const now = performance.now();
      const dx = touch.clientX - doubleTap.lastX;
      const dy = touch.clientY - doubleTap.lastY;
      if (now - doubleTap.lastTime < doubleTap.maxDelay && Math.hypot(dx, dy) < doubleTap.maxDistance) {
        touchState.tapCandidate = false;
        zoomToPoint(touch.clientX, touch.clientY);
        doubleTap.lastTime = 0;
      } else {
        doubleTap.lastTime = now;
        doubleTap.lastX = touch.clientX;
        doubleTap.lastY = touch.clientY;
      }
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

      if (Math.hypot(touch.clientX - touchState.tapX, touch.clientY - touchState.tapY) > 10) {
        touchState.tapCandidate = false;
      }
      const deltaX = touch.clientX - touchState.lastX;
      const deltaY = touch.clientY - touchState.lastY;
      touchState.lastX = touch.clientX;
      touchState.lastY = touch.clientY;

      if (movingCoaster) {
        // Dragging a finger stands in for hovering: it carries the coaster along.
        updateGhost(touch.clientX, touch.clientY);
      } else if (isRideCameraActive()) rotateRideLookByPixels(deltaX, deltaY);
      else rotateFreeCameraByPixels(deltaX, deltaY);
      return;
    }

    if (touchState.mode !== 'pinchPan') beginPinchPan(event.touches);

    const center = touchCenter(event.touches);
    const pinchDistance = touchDistance(event.touches);
    const centerDeltaX = center.x - touchState.lastCenterX;
    const centerDeltaY = center.y - touchState.lastCenterY;
    const pinchDelta = touchState.lastPinchDistance - pinchDistance;

    zoomCamera(pinchDelta, zoom.pinchSensitivity);
    if (!isRideCameraActive()) panFreeCameraByPixels(centerDeltaX, centerDeltaY);

    touchState.lastCenterX = center.x;
    touchState.lastCenterY = center.y;
    touchState.lastPinchDistance = pinchDistance;
  }

  function handleTouchEnd(event) {
    event.preventDefault();

    if (event.touches.length === 0 && touchState.tapCandidate && event.type === 'touchend'
        && event.changedTouches.length === 1 && performance.now() - touchState.tapTime < 500) {
      touchState.tapCandidate = false;
      handleCanvasTap(touchState.tapX, touchState.tapY);
    }

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
    cancelCameraGlide();
    touchState.tapCandidate = false;
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
    touchState.tapCandidate = false;
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
    if (keys.has('Space')) move.add(worldUp);
    if (keys.has('ControlLeft') || keys.has('ControlRight')) move.addScaledVector(worldUp, -1);

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

    endpointMarker.visible = !isTesting && !isClosedLoop && !movingCoaster;
    directionArrow.visible = !isTesting && !isClosedLoop && !movingCoaster;

    clouds.update(dt);
    if (isTesting && !crashCameraHold) updateCart(dt);
    updateExplosions(dt);
    if (!isRideCameraActive() && !crashCameraHold) {
      updateCameraGlide(now);
      updateFreeCamera(dt);
    }

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

  function exportTrack() {
    const data = {
      version: 1,
      name: activeCoaster.name,
      color: activeCoaster.color,
      minSpeed: Number(ui.speedSlider.value),
      segments: trackSegments.map(seg => {
        if (seg.isSnap) return { type: 'snap' };
        if (seg.isStunt) return { type: seg.type, stuntSize: seg.stuntSize };
        return { type: seg.type, length: seg.length, angle: seg.angle };
      })
    };
    const json = JSON.stringify(data, null, 2);
    const count = trackSegments.length;
    const label = `Exported ${count} segment${count !== 1 ? 's' : ''} as JSON.`;
    const fileName = (activeCoaster.name.replace(/[\\/:*?"<>|]/g, '').trim() || 'rollercoaster') + '.json';
    const file = new File([json], fileName, { type: 'application/json' });

    const downloadFallback = () => {
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      setStatus(label);
    };

    if (window.showSaveFilePicker) {
      window.showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: 'JSON file', accept: { 'application/json': ['.json'] } }]
      }).then(async (handle) => {
        const writable = await handle.createWritable();
        await writable.write(json);
        await writable.close();
        setStatus(label);
      }).catch(err => { if (err.name === 'AbortError') return; downloadFallback(); });
    } else if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: 'Roller Coaster' })
        .then(() => setStatus(label))
        .catch(err => { if (err.name === 'AbortError') return; downloadFallback(); });
    } else {
      downloadFallback();
    }
  }

  function importTrack(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      let data;
      try {
        data = JSON.parse(e.target.result);
      } catch {
        setStatus('Import failed: file is not valid JSON.');
        return;
      }
      if (!data || !Array.isArray(data.segments)) {
        setStatus('Import failed: missing segments array.');
        return;
      }

      // The import becomes a new coaster that follows the pointer until the
      // user places it.
      if (isTesting) stopTest();
      setPlacingCoaster(false);
      if (movingCoaster) cancelMove();
      const previous = activeCoaster;
      const center = groundPointAt(window.innerWidth / 2, window.innerHeight / 2) || initialPos.clone();
      const imported = createCoaster(center, newCoasterDirection());
      beginMove(imported, previous);
      activateCoaster(imported);

      if (typeof data.name === 'string' && data.name.trim()) {
        imported.name = data.name.trim().slice(0, 60);
        ui.coasterTitle.textContent = imported.name;
      }

      if (typeof data.color === 'string' && /^#[0-9a-f]{6}$/i.test(data.color)) {
        setTrackColor(data.color);
        ui.trackColorInput.value = data.color;
      }

      if (data.minSpeed != null) {
        const speed = Math.max(4, Math.min(28, Number(data.minSpeed)));
        ui.speedSlider.value = speed;
        ui.speedValue.textContent = speed;
        minCartSpeed = speed;
      }

      for (const saved of data.segments) {
        if (!saved.type) continue;

        if (saved.type === 'snap') {
          const snapStart = currentPos.clone();
          const snapEnd = initialPos.clone();
          const snapStartDir = currentDir.clone().normalize();
          const snapEndDir = initialDir.clone().normalize();
          const gap = snapStart.distanceTo(snapEnd);
          if (gap < 0.15) {
            isClosedLoop = true;
            currentPos = initialPos.clone();
            currentDir = initialDir.clone();
          } else {
            const handle = Math.max(2.5, Math.min(gap * 0.45, 20));
            const p1 = snapStart.clone().addScaledVector(snapStartDir, handle);
            const p2 = snapEnd.clone().addScaledVector(snapEndDir, -handle);
            const curve = new THREE.CubicBezierCurve3(snapStart, p1, p2, snapEnd);
            trackSegments.push({ type: 'snap', curve, startDir: snapStartDir, endDir: snapEndDir, start: snapStart, end: snapEnd, length: gap, angle: 0, isSnap: true });
            isClosedLoop = true;
            currentPos = initialPos.clone();
            currentDir = initialDir.clone();
          }
          break;
        }

        if (saved.type === 'loopLeft' || saved.type === 'loopRight' ||
            saved.type === 'corkscrewLeft' || saved.type === 'corkscrewRight') {
          const size = Math.max(7, Math.min(30, Number(saved.stuntSize) || 12));
          ui.stuntSizeSlider.value = size;
          ui.stuntSizeValue.textContent = size;
        } else {
          const length = Math.max(5, Math.min(30, Number(saved.length) || 14));
          const angle = Math.max(5, Math.min(60, Number(saved.angle) || 20));
          ui.lengthSlider.value = length;
          ui.angleSlider.value = angle;
          ui.lengthValue.textContent = length;
          ui.angleValue.textContent = angle + '°';
        }

        const segment = buildSectionData(saved.type);
        trackSegments.push(segment);
        currentPos = segment.end.clone();
        currentDir = segment.endDir.clone();
      }

      rebuildTrackMeshes();
      setStatus(`Imported ${trackSegments.length} segment${trackSegments.length !== 1 ? 's' : ''}. Move the coaster where you want it, then press Place.`);
    };
    reader.readAsText(file);
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
