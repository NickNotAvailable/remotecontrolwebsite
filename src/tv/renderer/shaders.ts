export const VERTEX = /* glsl */ `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

/**
 * One pass, one video texture. Order of operations mirrors an actual tube:
 *   power collapse → vertical roll → line tearing → chroma split → snow → scanlines → vignette.
 */
export const FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform sampler2D uTex;
uniform vec2  uScale;      // screen-uv → video-uv scale (cover / contain)
uniform float uHasTex;     // 0 when no frame is available yet
uniform vec2  uRes;        // canvas size in device px
uniform float uDpr;
uniform float uTime;
uniform float uSeed;

uniform float uNoise;
uniform float uGlitch;
uniform float uRgb;        // css px
uniform float uRoll;
uniform float uBright;
uniform float uPowerY;
uniform float uPowerX;
uniform float uGlow;
uniform float uDot;
uniform float uTracking;

uniform float uScan;
uniform float uGrain;
uniform float uVignette;
uniform float uCurve;
uniform float uAberration;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 video(vec2 uv) {
  vec2 t = (uv - 0.5) * uScale + 0.5;
  float inside = step(0.0, t.x) * step(t.x, 1.0) * step(0.0, t.y) * step(t.y, 1.0);
  return texture2D(uTex, clamp(t, 0.0, 1.0)).rgb * inside * uHasTex;
}

void main() {
  // Gentle barrel distortion — enough to feel like glass, not enough to warp the work.
  vec2 cc = vUv * 2.0 - 1.0;
  cc *= 1.0 + uCurve * dot(cc, cc) * 0.5;
  cc /= 1.0 + uCurve * 0.5;
  vec2 uv = cc * 0.5 + 0.5;
  vec2 tubeUv = uv;

  // CRT power animation: squeeze the raster to a line, then to a dot.
  vec2 p = uv - 0.5;
  p.y /= max(uPowerY, 0.0004);
  p.x /= max(uPowerX, 0.0004);
  float raster = step(abs(p.x), 0.5) * step(abs(p.y), 0.5);
  uv = p + 0.5;

  // Vertical roll (losing vertical hold).
  uv.y = fract(uv.y - uRoll);

  // Line tearing: random bands shoved sideways, re-rolled ~24×/s.
  float tick = floor(uTime * 24.0);
  float band = floor(uv.y * 64.0);
  float bandOn = step(1.0 - 0.45 * uGlitch, hash12(vec2(band * 0.37 + uSeed, tick)));
  float shift = (hash12(vec2(band, tick * 1.7 + uSeed)) - 0.5) * 0.22 * uGlitch * bandOn;
  shift += sin(uv.y * 28.0 + uTime * 42.0) * 0.004 * uGlitch;

  // VHS tracking band drifting down the frame.
  float trackPos = fract(uTime * 0.09 + uSeed);
  float track = exp(-pow((uv.y - trackPos) * 22.0, 2.0)) * uTracking;
  float lineRnd = hash12(vec2(floor(uv.y * uRes.y / (2.0 * uDpr)), tick));
  shift += track * (lineRnd - 0.5) * 0.05;
  uv.x += shift;

  // Chromatic separation (constant hint of convergence error + transition spikes).
  float split = (uAberration + uRgb * (1.0 + bandOn * uGlitch)) * uDpr / uRes.x;
  vec3 col;
  col.r = video(uv + vec2(split, 0.0)).r;
  col.g = video(uv).g;
  col.b = video(uv - vec2(split, 0.0)).b;

  // Snow: per-pixel noise + horizontal streaks, in ~1.5 css-px grains.
  vec2 grainPx = floor(gl_FragCoord.xy / (1.5 * uDpr));
  float n = hash12(grainPx + fract(uTime * 7.31) * 1931.0);
  float streak = hash12(vec2(floor(gl_FragCoord.y / (2.0 * uDpr)), floor(uTime * 60.0)));
  float snow = clamp(mix(n, streak, 0.28) * 1.15, 0.0, 1.0);
  float snowAmt = clamp(uNoise + track * 0.6, 0.0, 1.0);
  col = mix(col, vec3(snow), snowAmt);

  // Film grain (always on, very light).
  col += (n - 0.5) * uGrain;

  // Scanlines locked to css pixels (period 3px).
  float scan = 0.5 + 0.5 * cos(gl_FragCoord.y / uDpr * 6.28318 / 3.0);
  col *= 1.0 - uScan * scan;

  // Power-transition white-out.
  col = mix(col, vec3(1.0), uGlow);
  col *= uBright * raster;

  // Afterglow dot.
  vec2 d = (tubeUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  col += vec3(0.92, 0.97, 1.0) * uDot * exp(-dot(d, d) * 900.0) * 1.6;

  // Vignette + rounded tube edge.
  vec2 vv = tubeUv * (1.0 - tubeUv);
  float vig = pow(clamp(vv.x * vv.y * 16.0, 0.0, 1.0), uVignette);
  float edge = smoothstep(0.0, 0.004, min(min(tubeUv.x, 1.0 - tubeUv.x), min(tubeUv.y, 1.0 - tubeUv.y)));
  col *= vig * edge;

  gl_FragColor = vec4(col, 1.0);
}
`;
