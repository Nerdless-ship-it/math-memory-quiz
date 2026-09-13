// 真 3D 透视渲染：立体用连续四边形网格画，切面用解析交线画，靠深度排序表达遮挡。
//
// ── 为什么另起一个渲染器，而不是继续补 solid-view.js ────────────────────
// 斜二测把三维沿固定方向压平，切椭圆的前后两半在屏幕上几乎重叠，于是：
//   染色 ⇒ 像贴纸；求凸包 ⇒ 变成月牙；画完整交线 ⇒ 叠成一圈实线；
//   填成一块面 ⇒ 变成一条带子（还误导）。四版全败，根因是投影方式。
// 透视投影下前后自然分离，配合深度排序，才能真正表达「一刀切开、露出切口」。
//
// ── 与 solid-view.js 的分工 ──────────────────────────────────────────
//   solid-view.js  → 斜二测，风格与 figure.js 的静态图一致，用于题干/选项
//   本文件          → 透视，用于沙盒这种需要「看得懂三维关系」的场合
// 两者不互相替代。沙盒用本文件。
//
// ── 性能设计（和之前一样重要）────────────────────────────────────────
// 网格只在「换立体 / 换视角」时重算（~150ms），拖动切面时只做：
// 重排颜色 + 重算截面多边形（一次 marching squares）。所以拖动依然跟手。

import { compile, raycast, sectionLoops, planePointToWorld } from './csg.js';
import { createCamera, projectPoint, buildSurfaceQuads, vec } from './perspective.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 平面内正交基（把切面上的点摊到 2D）。 */
function planeBasis(planeNormal) {
  const n = vec.norm(planeNormal);
  const helper = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = vec.norm(vec.cross(n, helper));
  const v = vec.norm(vec.cross(n, u));
  return { u, v, n };
}

/**
 * 求出切面上**真正可见**的那部分，返回屏幕空间的多边形。
 *
 * 判定：对屏幕区域的每个像素发一条主光线，看最近的表面交点是否落在切面上。
 * 落上 ⇒ 该像素看到的就是切口。
 *
 * 为什么不能用画家算法：切面与立体表面在世界空间里真实相交，
 * 按图元中心深度排序无法决定谁挡谁，实测会把整个立体盖住。
 *
 * @returns {Array<{ points: {x:number,y:number}[], centerWorld: number[] }>}
 */
function visibleCutPolygons(loops, sdf, camera, view, nHat, d, options = {}) {
  if (!loops.length) return [];
  const width = view.width;
  const height = view.height;

  // 切面的屏幕包围盒（用于限定扫描范围，避免全屏光线步进）
  const screenPoints = [];
  for (const loop of loops) {
    for (const flat of loop) {
      const world = planePointToWorld(nHat, d, flat.x, flat.y);
      const s = projectPoint(world, camera, view);
      if (s.visible) screenPoints.push(s);
    }
  }
  if (screenPoints.length < 3) return [];
  const minX = Math.max(0, Math.floor(Math.min(...screenPoints.map((p) => p.x))));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(...screenPoints.map((p) => p.x))));
  const minY = Math.max(0, Math.floor(Math.min(...screenPoints.map((p) => p.y))));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(...screenPoints.map((p) => p.y))));
  if (maxX <= minX || maxY <= minY) return [];

  const cell = Number.isFinite(options.cutCell) ? options.cutCell : 3;
  const cols = Math.max(2, Math.floor((maxX - minX) / cell) + 1);
  const rows = Math.max(2, Math.floor((maxY - minY) / cell) + 1);
  const mask = new Float64Array(cols * rows);
  const onPlane = Number.isFinite(options.cutTolerance) ? options.cutTolerance : 0.035;

  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const sx = minX + i * cell;
      const sy = minY + j * cell;
      // 屏幕像素 → 相机空间方向 → 世界方向
      const ndcX = (sx - width / 2) / (Math.min(width, height) / 2) / view.focal;
      const ndcY = -(sy - height / 2) / (Math.min(width, height) / 2) / view.focal;
      const worldDir = vec.norm(vec.add(
        vec.mul(camera.right, ndcX),
        vec.add(vec.mul(camera.up, ndcY), camera.forward)
      ));
      const hit = raycast(sdf, camera.eye, worldDir, {
        maxDist: camera.distance * 2.4, maxSteps: 400, eps: 2.5e-3, start: 0
      });
      if (!hit) { mask[j * cols + i] = 1; continue; } // 没打到立体 ⇒ 该像素不属于立体，视为「非切口」
      // 最近的表面交点是否落在切面上
      mask[j * cols + i] = Math.abs(vec.dot(nHat, hit.point) - d) < onPlane ? -1 : 1;
    }
  }

  // marching squares 抽等值线（mask = -1 为内部）
  const segments = [];
  const lerpZero = (a, b) => (Math.abs(a - b) < 1e-12 ? 0.5 : a / (a - b));
  const at = (i, j) => mask[j * cols + i];
  for (let j = 0; j < rows - 1; j += 1) {
    for (let i = 0; i < cols - 1; i += 1) {
      const v00 = at(i, j); const v10 = at(i + 1, j);
      const v11 = at(i + 1, j + 1); const v01 = at(i, j + 1);
      const code = (v00 < 0 ? 1 : 0) | (v10 < 0 ? 2 : 0) | (v11 < 0 ? 4 : 0) | (v01 < 0 ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const x0 = minX + i * cell; const y0 = minY + j * cell;
      const bottom = { x: x0 + cell * lerpZero(v00, v10), y: y0 };
      const right = { x: x0 + cell, y: y0 + cell * lerpZero(v10, v11) };
      const top = { x: x0 + cell * lerpZero(v01, v11), y: y0 + cell };
      const left = { x: x0, y: y0 + cell * lerpZero(v00, v01) };
      switch (code) {
        case 1: case 14: segments.push([left, bottom]); break;
        case 2: case 13: segments.push([bottom, right]); break;
        case 3: case 12: segments.push([left, right]); break;
        case 4: case 11: segments.push([right, top]); break;
        case 6: case 9: segments.push([bottom, top]); break;
        case 7: case 8: segments.push([left, top]); break;
        case 5: segments.push([left, bottom], [right, top]); break;
        case 10: segments.push([left, top], [bottom, right]); break;
        default: break;
      }
    }
  }
  if (!segments.length) return [];

  // 接成闭合回路
  const tol = cell * 0.75;
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < tol;
  const used = new Array(segments.length).fill(false);
  const loopsOut = [];
  for (let s = 0; s < segments.length; s += 1) {
    if (used[s]) continue;
    used[s] = true;
    const loop = [segments[s][0], segments[s][1]];
    let grew = true;
    while (grew) {
      grew = false;
      const tail = loop[loop.length - 1];
      for (let t = 0; t < segments.length; t += 1) {
        if (used[t]) continue;
        if (near(segments[t][0], tail)) { loop.push(segments[t][1]); used[t] = true; grew = true; break; }
        if (near(segments[t][1], tail)) { loop.push(segments[t][0]); used[t] = true; grew = true; break; }
      }
    }
    if (loop.length >= 5) loopsOut.push(loop);
  }

  // 把 2D 屏幕点对应的世界点还原到切面上：从相机穿过该屏幕点作射线，与切面求交。
  // 深度排序需要一个「这块可见切口在三维里的代表位置」，用它的屏幕质心反投影最稳。
  const { n } = planeBasis(nHat);
  const planeOrigin = vec.mul(n, d / (vec.dot(n, n) || 1));
  // 屏幕 → 世界方向（与上面采样用同一套映射）
  const screenToWorldDir = (sx, sy) => {
    const ndcX = (sx - width / 2) / (Math.min(width, height) / 2) / view.focal;
    const ndcY = -(sy - height / 2) / (Math.min(width, height) / 2) / view.focal;
    return vec.norm(vec.add(
      vec.mul(camera.right, ndcX),
      vec.add(vec.mul(camera.up, ndcY), camera.forward)
    ));
  };
  const screenCenterToPlane = (sx, sy) => {
    const dir = screenToWorldDir(sx, sy);
    const denom = vec.dot(nHat, dir);
    if (Math.abs(denom) < 1e-9) return planeOrigin;
    const t = (d - vec.dot(nHat, camera.eye)) / denom;
    if (!(t > 0)) return planeOrigin;
    return vec.add(camera.eye, vec.mul(dir, t));
  };

  return loopsOut.map((points) => {
    const cx2 = points.reduce((a, p) => a + p.x, 0) / points.length;
    const cy2 = points.reduce((a, p) => a + p.y, 0) / points.length;
    return { points, centerWorld: screenCenterToPlane(cx2, cy2) };
  });
}

function svgElement(tagName, attributes = {}, text) {
  const node = document.createElementNS(SVG_NS, tagName);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;
    node.setAttribute(key, String(value));
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * 建立透视渲染缓存：采样立体表面 → 连成四边形网格。
 *
 * @param {object} solid SDF 描述
 * @param {object} options width/height/cols/rows/camera 参数
 */
export function createPerspectiveView(solid, options = {}) {
  const sdf = compile(solid);
  const width = Number.isFinite(options.width) ? options.width : 360;
  const height = Number.isFinite(options.height) ? options.height : 340;
  const cols = Number.isFinite(options.cols) ? options.cols : 118;
  const rows = Number.isFinite(options.rows) ? options.rows : 112;
  const camera = createCamera(options);
  const view = { width, height, focal: camera.focal, near: options.near ?? 0.05 };

  // 主光线步进：透视下每条射线的方向都不同（从 eye 指向该像素）
  const samples = new Map();
  for (let i = 0; i < cols; i += 1) {
    for (let j = 0; j < rows; j += 1) {
      const sx = i / (cols - 1) - 0.5;
      const sy = 1 - j / (rows - 1) - 0.5;
      // 屏幕点 → 相机空间方向 → 世界方向
      const camDir = vec.norm([sx * (width / Math.min(width, height)) * 2 / camera.focal,
        sy * 2 / camera.focal, 1]);
      const worldDir = vec.add(
        vec.mul(camera.right, camDir[0]),
        vec.add(vec.mul(camera.up, camDir[1]), vec.mul(camera.forward, camDir[2]))
      );
      const hit = raycast(sdf, camera.eye, worldDir, {
        maxDist: camera.distance * 2.4, maxSteps: 400, eps: 2.5e-3, start: 0
      });
      if (hit) samples.set(`${i},${j}`, { point: hit.point, normal: hit.normal });
    }
  }

  const quads = buildSurfaceQuads(samples, cols, rows);
  const light = vec.norm([0.45, 0.72, 0.55]);   // 主光（右上偏前）
  const fill = vec.norm([-0.55, 0.15, 0.4]);    // 补光（左下，压暗部）

  /** 四边形中心的屏幕坐标与深度（预计算，拖切面时不必重算投影）。 */
  const projected = quads.map((q) => {
    const corners = q.corners.map((c) => projectPoint(c, camera, view));
    if (corners.some((c) => !c.visible)) return null;
    const center = projectPoint(q.center, camera, view);
    // 背面剔除：法向背对相机就把顶点顺序反过来（保持填充正确，但保留该面用于遮挡）
    const toCamera = vec.norm(vec.sub(camera.eye, q.center));
    const facing = vec.dot(q.normal, toCamera);
    return {
      // ⚠️ polygon 的 points 属性是**空格分隔的坐标对**，不是 path 的 d 属性。
      // 我一开始写成了 `x,yLx,yL...`（用了路径的连接符 L），浏览器只解析出第一个点，
      // 于是每个四边形都退化成零面积、整片灰色实体完全画不出来——
      // 而且 3529 个 polygon 都在 DOM 里、fill 也正常，从属性上看不出问题，
      // 是逐点核对坐标范围时才发现的。
      d: corners.map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(' '),
      depth: center.z,
      normal: q.normal,
      facing,
      world: q.center
    };
  }).filter(Boolean);

  return {
    width, height, camera, view,
    quadCount: projected.length,
    /**
     * 画一帧。拖动切面时只走这里。
     * @param {object} renderOptions planeNormal / planeD / showCut
     */
    render(renderOptions = {}) {
      const normal = renderOptions.planeNormal ?? [0, 0, 1];
      const d = Number.isFinite(renderOptions.planeD) ? renderOptions.planeD : 0;
      const showCut = renderOptions.showCut === true;
      const nHat = vec.norm(normal);

      // ── 把所有图元（立体四边形 + 切面）放进同一个列表，按深度从远到近排 ──
      // 画家算法必须一次排完再画。之前想把切面「插进」已经排好的序列里，
      // 结果在 splice 的同时又用原索引去查 ordered，索引错位、插入位置是错的。
      const primitives = [];

      for (const q of projected) {
        const lambert = Math.max(0, vec.dot(q.normal, light));
        const ambient = Math.max(0, vec.dot(q.normal, fill)) * 0.28;
        const toEye = vec.norm(vec.sub(camera.eye, q.world));
        // 高光：法向与「光照 + 视线」半程向量越接近越亮
        const half = vec.norm(vec.add(light, toEye));
        const spec = Math.pow(Math.max(0, vec.dot(q.normal, half)), 24) * 0.22;
        const lum = Math.min(1, 0.34 + 0.52 * lambert + ambient + spec);
        // 背面稍暗，透过去看时层次更清楚
        const damp = q.facing >= 0 ? 1 : 0.82;
        const shade = Math.round(255 * lum * damp);
        primitives.push({
          depth: q.depth,
          kind: 'solid',
          points: q.d,
          fill: `rgb(${Math.round(shade * 0.9)}, ${shade}, ${Math.round(shade * 0.95)})`
        });
      }

      if (showCut) {
        const section = sectionLoops(solid, nHat, d, {
          extent: camera.distance * 0.62,
          resolution: 220
        });
        const loops = section.ok ? [...section.outer, ...section.holes] : [];

        // ⚠️ 这里必须**逐像素判定可见性**，不能用画家算法。
        // 切面与立体表面在世界空间里是真实**相交**的，按「图元中心深度」排序无法决定谁挡谁
        // （画家算法只在图元互不相交时成立）。实测：把切面按中心深度插进序列后，
        // 它盖住了整个立体，屏幕上只剩一块绿色。
        //
        // 可靠做法：对切面所在屏幕区域的每个像素发一条主光线，
        // 看**最近的表面交点是否落在切面上**——是则该像素属于可见切口。
        // 这一步既判定可见性，也天然处理了「切面在立体内部」这个事实。
        const cutPolygons = visibleCutPolygons(loops, sdf, camera, view, nHat, d, renderOptions);
        for (const polygon of cutPolygons) {
          const points = polygon.points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
          const depth = camera.toCameraSpace(polygon.centerWorld)[2];
          // 切面就在立体表面所在的位置；稍微前移，同深度时保证它压在立体面之上
          primitives.push({ depth: depth - 1e-3, kind: 'cut-face', points });
          primitives.push({ depth: depth - 1e-3, kind: 'cut-edge', points });
        }
      }

      // 从远到近画
      primitives.sort((a, b) => b.depth - a.depth);

      const children = primitives.map((p) => svgElement('polygon', {
        points: p.points,
        ...(p.fill ? { fill: p.fill } : {}),
        class: p.kind === 'solid' ? undefined
          : (p.kind === 'cut-face' ? 'p3d-cut-face' : 'p3d-cut-edge'),
        'shape-rendering': 'geometricPrecision',
        'aria-hidden': 'true'
      }));

      const svg = svgElement('svg', {
        viewBox: `0 0 ${width} ${height}`,
        width: '100%',
        preserveAspectRatio: 'xMidYMid meet',
        role: 'img',
        'aria-label': renderOptions.ariaLabel ?? '组合立体的三维透视图，绿色是切面',
        class: 'solid-svg p3d-svg'
      });
      svg.style.maxWidth = `${width}px`;
      svg.style.aspectRatio = `${width} / ${height}`;
      for (const child of children) svg.append(child);
      return svg;
    }
  };
}

export default { createPerspectiveView };

