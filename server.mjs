import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./public/', import.meta.url));
const port = Number(process.env.PORT) || 4173;
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

/**
 * 解析请求路径。任何畸形输入都返回 null，由调用方回 400。
 *
 * ⚠️ 这两步**都会抛**，而且都是在原来那个 try/catch 之外抛的：
 *   - `new URL('//', 'http://localhost')` → Invalid URL
 *   - `decodeURIComponent('%')`           → URI malformed
 * 本文件是 `async` 请求处理器，抛出的异常会变成 unhandled rejection，
 * 在 Node 里**直接结束进程**。实测 `curl //` 或 `curl /%` 就能把开发服务器打掉
 * （现象：进程退出、无任何错误输出，只有一个 exit code）。
 * 所以解析必须自己包起来，失败就回 400，绝不能让服务器倒掉——
 * 它还要给 test:browser / test:all-subjects 当靶子。
 */
function resolveRequestPath(rawUrl) {
  try {
    const { pathname } = new URL(rawUrl ?? '/', 'http://localhost');
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

function send(response, status, body, contentType = 'text/plain; charset=utf-8') {
  // 响应可能已经发出（例如流读取中途出错），重复写头会抛，这里一并兜住。
  try {
    if (!response.headersSent) response.writeHead(status, { 'Content-Type': contentType });
    response.end(body);
  } catch {
    // 连接已断开属正常情况，忽略。
  }
}

createServer(async (request, response) => {
  // 整个处理器包一层：任何未预料的异常都只影响这一个请求，不能拖垮进程。
  try {
    const requestPath = resolveRequestPath(request.url);
    if (requestPath === null) {
      send(response, 400, 'Bad request');
      return;
    }

    const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
    const filePath = normalize(join(root, relativePath));

    if (!filePath.startsWith(root)) {
      send(response, 403, 'Forbidden');
      return;
    }

    let fileStat;
    try {
      fileStat = await stat(filePath);
    } catch {
      send(response, 404, 'Not found');
      return;
    }
    if (!fileStat.isFile()) {
      send(response, 404, 'Not found');
      return;
    }

    try {
      response.writeHead(200, {
        'Content-Type': mimeTypes[extname(filePath)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
    } catch {
      return; // 头已发出（极少见），交给下面的流错误处理
    }

    const stream = createReadStream(filePath);
    // 文件在 stat 之后被删除/权限变化时，readStream 会发 error；
    // 不监听它同样会变成 unhandled error 结束进程。
    stream.on('error', () => send(response, 404, 'Not found'));
    stream.pipe(response);
  } catch (error) {
    send(response, 500, `Server error: ${error?.message ?? error}`);
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`速算训练本地服务器：http://127.0.0.1:${port}`);
});

// 兜底：即使还有漏网的异常，也先记下来而不是静默退出，便于定位。
process.on('unhandledRejection', (reason) => {
  console.error('[server] 未处理的 Promise 拒绝（已忽略，服务器继续运行）：', reason);
});
