export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.EMBEDDED_WORKER !== "true") return;
  const { startWorker } = await import("./server/worker");
  startWorker();
}
