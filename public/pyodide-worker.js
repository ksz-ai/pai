/**
 * Pyodide 沙箱 Worker（SPEC M2-1）。
 * 在浏览器 WASM 中运行用户 Python 代码：stdout 捕获、matplotlib 图表收集、包白名单惰性加载。
 * 运行超时由主线程负责（terminate 本 worker），下次运行会自动重建。
 */

const PYODIDE_CDN = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js";

let pyodide = null;
let initPromise = null;

async function init() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    self.postMessage({ type: "status", msg: "正在下载 Python 运行时（首次约 10MB，已缓存则秒开）…" });
    importScripts(PYODIDE_CDN);
    pyodide = await loadPyodide();
    self.postMessage({ type: "ready" });
  })();
  return initPromise;
}

/** 包白名单：按代码内容惰性加载 */
async function ensurePackages(code) {
  const pkgs = [];
  if (/import\s+numpy|from\s+numpy/.test(code)) pkgs.push("numpy");
  if (/import\s+matplotlib|from\s+matplotlib/.test(code)) pkgs.push("matplotlib");
  if (pkgs.length) {
    self.postMessage({ type: "status", msg: `加载依赖包：${pkgs.join("、")}（首次约 40MB）…` });
    await pyodide.loadPackage(pkgs);
    // matplotlib 装完立即锁 AGG（无头后端，plt.show() 只产生无害 warning）
    if (pkgs.includes("matplotlib")) {
      await pyodide.runPython("import matplotlib; matplotlib.use('AGG')");
    }
  }
  if (/import\s+sympy|from\s+sympy/.test(code)) {
    self.postMessage({ type: "status", msg: "加载 sympy…" });
    await pyodide.loadPackage("micropip");
    const micropip = pyodide.pyimport("micropip");
    await micropip.install("sympy");
  }
}

self.onmessage = async (e) => {
  const { type, id, code } = e.data || {};
  if (type === "init") {
    await init();
    return;
  }
  if (type !== "run") return;

  try {
    await init();
    await ensurePackages(code);

    let stdoutBuf = "";
    let flushTimer = null;
    const flush = () => {
      if (stdoutBuf) {
        self.postMessage({ type: "stdout", id, text: stdoutBuf });
        stdoutBuf = "";
      }
      flushTimer = null;
    };
    const queue = (s) => {
      stdoutBuf += s + "\n";
      if (!flushTimer) flushTimer = setTimeout(flush, 60);
    };
    pyodide.setStdout({ batched: queue });
    pyodide.setStderr({ batched: queue });

    // 主线程收到 exec 才开始执行阶段 30s 熔断计时（前一段是运行时/依赖下载，不计入）
    self.postMessage({ type: "exec" });
    await pyodide.runPythonAsync(code);

    let images = [];
    const hasPlt = pyodide.runPython(
      "import sys; int('matplotlib.pyplot' in sys.modules)",
    );
    if (hasPlt) {
      const imgs = pyodide.runPython(
        [
          "import io, base64",
          "_imgs = []",
          "import matplotlib.pyplot as _plt",
          "for _num in _plt.get_fignums():",
          "    _buf = io.BytesIO()",
          "    _plt.figure(_num).savefig(_buf, format='png', dpi=110, bbox_inches='tight')",
          "    _imgs.append(base64.b64encode(_buf.getvalue()).decode())",
          "_plt.close('all')",
          "_imgs",
        ].join("\n"),
      );
      images = typeof imgs.toJs === "function" ? [...imgs.toJs()] : imgs;
    }

    flush();
    self.postMessage({ type: "result", id, ok: true, images });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    // Python 异常只保留 traceback 尾部（对学习者有用的部分）
    const tail = msg.split(/\n/).slice(-6).join("\n");
    self.postMessage({ type: "result", id, ok: false, error: tail });
  }
};
