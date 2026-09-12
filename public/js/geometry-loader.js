/**
 * geometry.js 的加载包装层。
 *
 * ── 为什么需要这一层（不是过度设计）────────────────────────────────
 * 直接的 `import { cubeSection } from './geometry.js'` 有两个问题：
 *
 *   1. **静态依赖会拖垮整条链路**：figure.js 被 engine.js 静态 import，
 *      而 engine.js 被 app.js / quiz-page.js 静态 import。只要 geometry.js 缺席
 *      （或写错了语法），整个应用连首页都打不开，报的还是「模块找不到」这种
 *      与症状无关的错误。实测：geometry.js 尚未落地时 `npm test` 直接红了 1 项。
 *
 *   2. **顶层 await**：本模块用一条顶层 `await import()` 把几何模块**提前**取回来，
 *      于是 renderFigure 等函数对外仍然是**同步**的，调用方（引擎渲染路径）
 *      不需要 async——渲染函数一旦变异步，会顺带把 renderQuestion / goNext
 *      整条链路拖成异步，且 `innerHTML` 式的时序假设也会失效。
 *
 * 也就是说：这里用「一次性异步取模块 + 同步转发导出」换掉了「同步静态依赖」。
 * 代价是模块初始化多一次微任务；收益是几何模块缺失时只影响图形题本身。
 *
 * ⚠️ 几何函数是**转发引用**而不是解构值：用 `export { cubeSection }` 直接转发，
 * 保证调用方拿到的始终是几何模块里的那个函数，不会因为包装层而复制一份。
 * 若几何模块缺席，这里的函数会在调用时抛错（附带清晰原因），而不是静默返回空结果——
 * 静默空结果会让图形题渲染成空白，那是最危险的失败模式。
 */

const GEOMETRY_UNAVAILABLE = '几何模块 public/js/geometry.js 未能加载';

let geometry = null;
let loadError = null;

try {
  geometry = await import('./geometry.js');
} catch (error) {
  loadError = error;
  geometry = null;
}

function requireGeometry() {
  if (!geometry) {
    const reason = loadError ? `：${loadError?.message ?? loadError}` : '';
    throw new Error(`${GEOMETRY_UNAVAILABLE}${reason}`);
  }
  return geometry;
}

/** 几何模块是否可用（供 UI 做优雅降级与测试断言）。 */
export function geometryAvailable() {
  return geometry !== null;
}

/** 几何模块加载失败的原因（可用时返回 null）。 */
export function geometryError() {
  return loadError;
}

export function cubeSection(planeNormal, d) {
  return requireGeometry().cubeSection(planeNormal, d);
}

export function sectionSideCount(planeNormal, d) {
  const mod = requireGeometry();
  return typeof mod.sectionSideCount === 'function'
    ? mod.sectionSideCount(planeNormal, d)
    : (mod.cubeSection(planeNormal, d)?.length ?? 0);
}

export function sectionName(planeNormal, d) {
  const mod = requireGeometry();
  if (typeof mod.sectionName === 'function') return mod.sectionName(planeNormal, d);
  const NAMES = { 3: '三角形', 4: '四边形', 5: '五边形', 6: '六边形' };
  return NAMES[sectionSideCount(planeNormal, d)] ?? null;
}

export default { geometryAvailable, geometryError, cubeSection, sectionSideCount, sectionName };
