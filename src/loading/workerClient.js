const DEFAULT_PRIORITY = "normal";
const PRIORITY_ORDER = ["critical", "visible", "high", "normal", "background"];

function normalizePriority(priority) {
  if (priority === true) return "high";
  if (priority === false || priority == null) return "background";
  return PRIORITY_ORDER.includes(priority) ? priority : DEFAULT_PRIORITY;
}

function priorityRank(priority) {
  const normalized = normalizePriority(priority);
  const index = PRIORITY_ORDER.indexOf(normalized);
  return index >= 0 ? index : PRIORITY_ORDER.indexOf(DEFAULT_PRIORITY);
}

export function comparePriority(a, b) {
  return priorityRank(a) - priorityRank(b);
}

/**
 * Creates a priority-aware request client for a module worker.
 *
 * Requests are dispatched by priority with a bounded in-flight count. This
 * keeps PDF and image workers on the same scheduling contract while still
 * letting each worker choose its own concurrency.
 */
export function createWorkerClient(workerFile, label, { maxInFlight = 1 } = {}) {
  let worker = null;
  let workerPromise = null;
  let nextRequestId = 1;
  let inFlight = 0;
  const pending = new Map();
  const queues = new Map(PRIORITY_ORDER.map(priority => [priority, []]));

  async function createWorker() {
    const workerUrl = new URL(workerFile, import.meta.url);
    let scriptUrl;
    if (workerUrl.origin === self.location.origin) {
      // Same origin (dev mode or self-hosted): load the worker file directly.
      // Cache-bust per page load — Firefox in particular caches module
      // workers aggressively and hard-reload doesn't always invalidate them.
      workerUrl.searchParams.set("v", String(Date.now()));
      scriptUrl = workerUrl.href;
    } else {
      // Cross-origin (CDN-hosted): browsers refuse to spawn a Worker from a
      // different origin even with permissive CORS. Fetch the worker source
      // and wrap it in a same-origin Blob URL.
      const response = await fetch(workerUrl, { mode: "cors" });
      if (!response.ok) throw new Error(`Failed to fetch ${workerFile}: ${response.status}`);
      const source = await response.text();
      const blob = new Blob([source], { type: "application/javascript" });
      scriptUrl = URL.createObjectURL(blob);
    }
    const w = new Worker(scriptUrl, { type: "module" });
    w.addEventListener("message", event => {
      if (event.data?.debug) {
        console.log(`[${label}]`, ...event.data.debug);
        return;
      }
      const { id, ok, result, error } = event.data || {};
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      inFlight = Math.max(0, inFlight - 1);
      if (ok) entry.resolve(result);
      else entry.reject(new Error(error));
      dispatch();
    });
    w.addEventListener("error", event => {
      console.error(`${label} worker error:`, event.message || event);
    });
    return w;
  }

  function ensureWorker() {
    if (worker) return Promise.resolve(worker);
    if (workerPromise) return workerPromise;
    workerPromise = createWorker().then(w => {
      worker = w;
      return w;
    });
    return workerPromise;
  }

  function shiftNextEntry() {
    for (const priority of PRIORITY_ORDER) {
      const queue = queues.get(priority);
      if (queue?.length) return queue.shift();
    }
    return null;
  }

  function dispatch() {
    while (inFlight < maxInFlight) {
      const entry = shiftNextEntry();
      if (!entry) return;
      inFlight += 1;
      const id = nextRequestId++;
      pending.set(id, { resolve: entry.resolve, reject: entry.reject });
      ensureWorker().then(
        w => w.postMessage({ id, type: entry.type, payload: entry.payload }, entry.transfer),
        err => {
          pending.delete(id);
          inFlight = Math.max(0, inFlight - 1);
          entry.reject(err);
          dispatch();
        },
      );
    }
  }

  return function call(type, payload, { transfer = [], priority = DEFAULT_PRIORITY } = {}) {
    return new Promise((resolve, reject) => {
      const entry = { type, payload, transfer, resolve, reject };
      queues.get(normalizePriority(priority)).push(entry);
      dispatch();
    });
  };
}
