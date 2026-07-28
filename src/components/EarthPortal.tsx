"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { properties, type Property } from "@/data/properties";
import { BackButton } from "./BackButton";
import { ImageSlot } from "./ImageSlot";
import styles from "./EarthPortal.module.css";

// Cross-origin-friendly mirror of three.js's own example textures (jsDelivr
// serves GitHub raw files with Access-Control-Allow-Origin: *, which a plain
// raw.githubusercontent.com URL does not, which is required for WebGL to read pixels
// out of a texture loaded from another origin). These are the exact assets
// used by three.js's own official "webgpu_tsl_earth" reference demo (built
// on the well-known Three.js Journey earth-shader lesson): 4K day/night maps
// plus a single packed texture (R = bump, G = roughness, B = cloud mask).
const TEXTURE_BASE =
  "https://cdn.jsdelivr.net/gh/mrdoob/three.js/examples/textures/planets/";

const ENTER_DURATION_MS = 1500;
const SUN_DIR = new THREE.Vector3(5, 2, 5).normalize();
const ATMOSPHERE_DAY = new THREE.Color(0x4db2ff);
const ATMOSPHERE_TWILIGHT = new THREE.Color(0xbc490b);

// Ported from three.js's official TSL earth example into plain GLSL for the
// classic WebGLRenderer: real day/night blending, clouds baked in from the
// packed texture's blue channel, an ocean glint masked by the roughness
// channel, and a day/twilight atmosphere tint driven by real sun geometry
// (the reddish limb glow you see in ISS photos at the terminator) rather
// than a flat-coloured rim.
const EARTH_VERTEX_SHADER = `
  varying vec2 vUv;
  varying vec3 vNormalWorld;
  void main() {
    vUv = uv;
    vNormalWorld = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const EARTH_FRAGMENT_SHADER = `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform sampler2D bumpRoughnessCloudsMap;
  uniform vec3 sunDirection;
  uniform vec3 atmosphereDayColor;
  uniform vec3 atmosphereTwilightColor;
  varying vec2 vUv;
  varying vec3 vNormalWorld;

  void main() {
    vec3 normal = normalize(vNormalWorld);
    float sunOrientation = dot(normal, sunDirection);

    // Textures are sRGB-encoded; decode to linear before lighting math, then
    // let the renderer's sRGB output pass re-encode the final pixel.
    vec3 day = pow(texture2D(dayMap, vUv).rgb, vec3(2.2));
    vec3 night = pow(texture2D(nightMap, vUv).rgb, vec3(2.2));
    vec3 brc = texture2D(bumpRoughnessCloudsMap, vUv).rgb; // r=bump g=roughness b=clouds

    float cloudsStrength = smoothstep(0.2, 1.0, brc.b);
    vec3 dayColor = mix(day, vec3(1.0), clamp(cloudsStrength * 2.0, 0.0, 1.0));

    // Soft-edged terminator rather than a hard day/night cut, matching how
    // sunlight actually grazes off a curved surface.
    float dayStrength = smoothstep(-0.25, 0.5, sunOrientation);
    vec3 surfaceColor = mix(night * 2.2, dayColor, dayStrength);

    gl_FragColor = vec4(surfaceColor, 1.0);
  }
`;

// Atmosphere shell: fresnel-based rim intensity (view-space, so it stays a
// clean ring regardless of the globe's own rotation) tinted by the same
// sun-orientation day/twilight mix as the surface shader above.
const ATMOSPHERE_VERTEX_SHADER = `
  varying vec3 vNormalView;
  varying vec3 vNormalWorld;
  void main() {
    vNormalView = normalize(normalMatrix * normal);
    vNormalWorld = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ATMOSPHERE_FRAGMENT_SHADER = `
  uniform vec3 sunDirection;
  uniform vec3 atmosphereDayColor;
  uniform vec3 atmosphereTwilightColor;
  varying vec3 vNormalView;
  varying vec3 vNormalWorld;

  void main() {
    float rim = clamp(pow(0.6 - dot(vNormalView, vec3(0.0, 0.0, 1.0)), 4.0), 0.0, 1.0);
    float sunOrientation = dot(normalize(vNormalWorld), sunDirection);
    vec3 tint = mix(atmosphereTwilightColor, atmosphereDayColor, smoothstep(-0.25, 0.75, sunOrientation));
    gl_FragColor = vec4(tint, rim * 0.55);
  }
`;

/**
 * The screen between a successful login and the property tour: a slowly
 * spinning, realistically lit Earth with day/night shading, lit-up cities
 * on the dark side, baked-in clouds, and a day/twilight atmosphere rim,
 * ported from three.js's own official earth reference shader. Picking a
 * project dives the camera toward the surface while the view washes out to
 * daylight, then opens that property's site.
 */
export function EarthPortal() {
  const hostRef = useRef<HTMLDivElement>(null);
  const enterRef = useRef<((onComplete: () => void) => void) | null>(null);
  const [ready, setReady] = useState(false);
  const [entering, setEntering] = useState(false);
  const [openProperty, setOpenProperty] = useState<Property | null>(null);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [featuredFading, setFeaturedFading] = useState(false);
  const fadeTimeoutRef = useRef<number | undefined>(undefined);
  const autoTimeoutRef = useRef<number | undefined>(undefined);

  // Crossfades the featured slot instead of hard-cutting to the new card:
  // fade out, swap which project is shown, fade back in. Same duration as
  // the CSS transition on .featuredWrap below. Clears any fade already in
  // flight first — otherwise two rotations picked close together (a manual
  // click landing mid-auto-rotate) race, and whichever timeout resolves
  // first silently drops the other's fade-out.
  const FEATURED_FADE_MS = 420;
  const rotateFeatured = (next: (current: number) => number) => {
    window.clearTimeout(fadeTimeoutRef.current);
    setFeaturedFading(true);
    fadeTimeoutRef.current = window.setTimeout(() => {
      setFeaturedIndex(next);
      setFeaturedFading(false);
      scheduleAutoRotate();
    }, FEATURED_FADE_MS);
  };

  // Rotates which project holds the large "featured" spot, so all 6 get a
  // turn instead of the first one always winning it. Off entirely under
  // reduced-motion rather than just skipping the transition, since this is
  // an unprompted auto-advancing change, not a user-driven one. Reschedules
  // itself from whenever the slot last actually changed (see rotateFeatured
  // above), so a manual pick gets its own full 5s rather than being undone
  // by a timer that was still counting down from before the click.
  const scheduleAutoRotate = () => {
    window.clearTimeout(autoTimeoutRef.current);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    autoTimeoutRef.current = window.setTimeout(() => {
      rotateFeatured((i) => (i + 1) % properties.length);
    }, 5000);
  };

  useEffect(() => {
    scheduleAutoRotate();
    return () => {
      window.clearTimeout(autoTimeoutRef.current);
      window.clearTimeout(fadeTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      45,
      host.clientWidth / host.clientHeight,
      0.1,
      1000,
    );
    camera.position.set(0, 0, 4.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    // Filmic tone mapping compresses highlights the way a camera would,
    // instead of the flat, clipped look of the default linear output.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    // Bloom is what sells the sun glint, city lights and atmosphere rim as
    // actual light sources rather than flat bright pixels. Threshold is high
    // so only the brightest highlights bleed, not the whole lit hemisphere.
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(host.clientWidth, host.clientHeight),
      0.5,
      0.5,
      0.9,
    );
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());

    const loader = new THREE.TextureLoader();
    let loadedCount = 0;
    const totalTextures = 3;
    const onTextureLoaded = () => {
      loadedCount += 1;
      if (loadedCount === totalTextures) setReady(true);
    };

    const sharedUniforms = {
      sunDirection: { value: SUN_DIR },
      atmosphereDayColor: { value: ATMOSPHERE_DAY },
      atmosphereTwilightColor: { value: ATMOSPHERE_TWILIGHT },
    };

    const earthUniforms = {
      dayMap: { value: null as THREE.Texture | null },
      nightMap: { value: null as THREE.Texture | null },
      bumpRoughnessCloudsMap: { value: null as THREE.Texture | null },
      ...sharedUniforms,
    };
    const earthMaterial = new THREE.ShaderMaterial({
      uniforms: earthUniforms,
      vertexShader: EARTH_VERTEX_SHADER,
      fragmentShader: EARTH_FRAGMENT_SHADER,
    });
    loader.load(`${TEXTURE_BASE}earth_day_4096.jpg`, (tex) => {
      earthUniforms.dayMap.value = tex;
      onTextureLoaded();
    });
    loader.load(`${TEXTURE_BASE}earth_night_4096.jpg`, (tex) => {
      earthUniforms.nightMap.value = tex;
      onTextureLoaded();
    });
    loader.load(`${TEXTURE_BASE}earth_bump_roughness_clouds_4096.jpg`, (tex) => {
      earthUniforms.bumpRoughnessCloudsMap.value = tex;
      onTextureLoaded();
    });

    // A group (not the meshes directly) so the dive-in animation can still
    // zoom straight down -Z from the camera's own position while the globe's
    // resting position sits right-of-centre, leaving the left third of the
    // screen clear for the welcome copy below.
    const globe = new THREE.Group();
    globe.position.x = 1.15;
    scene.add(globe);

    const earthGeometry = new THREE.SphereGeometry(0.92, 96, 96);
    const earth = new THREE.Mesh(earthGeometry, earthMaterial);
    // Earth's real axial tilt, a small authenticity detail that also keeps
    // the terminator from cutting the globe in a perfectly vertical line.
    earth.rotation.z = THREE.MathUtils.degToRad(23.4);
    globe.add(earth);

    const atmosphereMaterial = new THREE.ShaderMaterial({
      uniforms: sharedUniforms,
      vertexShader: ATMOSPHERE_VERTEX_SHADER,
      fragmentShader: ATMOSPHERE_FRAGMENT_SHADER,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      transparent: true,
    });
    const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(0.966, 64, 64), atmosphereMaterial);
    globe.add(atmosphere);

    let raf = 0;
    let enterStart: number | null = null;
    const cameraStartZ = 4.2;

    const animate = (time: number) => {
      if (!reduceMotion && enterStart === null) {
        earth.rotation.y += 0.0016;
      }

      if (enterStart !== null) {
        const t = Math.min(1, (time - enterStart) / ENTER_DURATION_MS);
        // Ease-in: starts slow, accelerates hard toward the surface.
        const eased = t * t * t;
        // Converge toward the globe's off-centre resting position (not
        // straight down -Z) so the dive actually plunges into the sphere
        // instead of past it.
        camera.position.x = eased * globe.position.x;
        camera.position.z = cameraStartZ - eased * (cameraStartZ - 0.07);
        camera.fov = 45 + eased * 55;
        camera.updateProjectionMatrix();
        earth.rotation.y += 0.002 + eased * 0.02;
      }

      composer.render();
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    const handleResize = () => {
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(host.clientWidth, host.clientHeight);
      composer.setSize(host.clientWidth, host.clientHeight);
    };
    window.addEventListener("resize", handleResize);

    let enterTimeout: number | undefined;

    const resetCamera = () => {
      camera.position.x = 0;
      camera.position.z = cameraStartZ;
      camera.fov = 45;
      camera.updateProjectionMatrix();
      enterStart = null;
      setEntering(false);
    };

    // Plays the dive animation first, then calls onComplete (opens the panel)
    // and resets the camera so another project can be picked afterwards
    // without leaving this screen.
    enterRef.current = (onComplete) => {
      if (enterStart !== null) return;
      enterStart = performance.now();
      setEntering(true);
      enterTimeout = window.setTimeout(() => {
        resetCamera();
        onComplete();
      }, ENTER_DURATION_MS);
    };

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", handleResize);
      window.clearTimeout(enterTimeout);
      enterRef.current = null;
      host.removeChild(renderer.domElement);
      earthGeometry.dispose();
      earthMaterial.dispose();
      atmosphere.geometry.dispose();
      atmosphereMaterial.dispose();
      composer.dispose();
      renderer.dispose();
    };
  }, []);

  const closePanel = () => setOpenProperty(null);

  const renderProjectCard = (property: Property, extraClass?: string) => (
    <a
      key={property.slug}
      className={`${styles.projectCard} ${extraClass ?? ""}`}
      href={property.href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => {
        e.preventDefault();
        enterRef.current?.(() => {
          setFrameLoaded(false);
          setOpenProperty(property);
        });
      }}
    >
      <div className={styles.projectMedia}>
        <ImageSlot
          src={property.image}
          placeholder={`${property.name || "Property"} image`}
          alt={`${property.name || "Property"}, ${property.location}`}
        />
      </div>
      <div className={styles.projectBody}>
        <div className={styles.projectName}>{property.name}</div>
        <div className={styles.projectLocation}>{property.location}</div>
      </div>
    </a>
  );

  return (
    <div className={styles.page}>
      {!openProperty && <BackButton />}
      <div ref={hostRef} className={styles.canvasHost} />

      <div className={`${styles.welcome} ${entering ? styles.hidden : ""}`}>
        <div>
          <div className={styles.eyebrowRow}>
            <div className={styles.eyebrow}>Hiranandani Portfolio</div>
            <div className={styles.dots}>
              {properties.map((property, i) => (
                <button
                  key={property.slug}
                  type="button"
                  className={`${styles.dot} ${i === featuredIndex ? styles.dotActive : ""}`}
                  aria-label={`Feature ${property.name}`}
                  aria-current={i === featuredIndex}
                  onClick={() => {
                    if (i !== featuredIndex) rotateFeatured(() => i);
                  }}
                />
              ))}
            </div>
          </div>
          <div className={`${styles.featuredWrap} ${featuredFading ? styles.featuredFading : ""}`}>
            {renderProjectCard(properties[featuredIndex], styles.featured)}
          </div>
          <div className={styles.projectGrid}>
            {properties
              .filter((_, i) => i !== featuredIndex)
              .map((property) => renderProjectCard(property))}
          </div>
        </div>
      </div>

      {!ready && (
        <div className={styles.status}>
          <span className={styles.loading}>Entering orbit&hellip;</span>
        </div>
      )}

      <div className={`${styles.flash} ${entering ? styles.flashOn : ""}`} />

      {openProperty && (
        <div className={styles.panelOverlay} onClick={closePanel}>
          <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
            <div className={styles.panelHeader}>
              <span>{openProperty.name}</span>
              <button
                type="button"
                className={styles.panelClose}
                onClick={closePanel}
                aria-label="Close"
              >
                &#10005;
              </button>
            </div>
            <div className={styles.panelBody}>
              {!frameLoaded && (
                <div className={styles.panelSkeleton}>
                  <div className={styles.panelShimmer} />
                </div>
              )}
              <iframe
                className={styles.panelFrame}
                src={openProperty.href}
                title={openProperty.name}
                onLoad={() => setFrameLoaded(true)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
