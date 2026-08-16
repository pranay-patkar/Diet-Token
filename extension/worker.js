/**
 * Token-Diet Web Worker — offloads compression from main thread.
 * Imports engine.js logic for Worker context.
 */
"use strict";

try {
  importScripts("tokenizer.js", "instruction-detector.js", "diff.js", "engine.js");
} catch (e) {
  console.error("[Token-Diet Worker] Error importing scripts:", e);
}

self.onmessage = function (e) {
  var msg = e.data;
  if (!msg || msg.type !== "COMPRESS") return;

  var t0 = performance.now();
  try {
    if (!self.TokenDiet || !self.TokenDiet.compress) {
      throw new Error("TokenDiet engine is not initialized in worker");
    }

    var res = self.TokenDiet.compress(msg.text, msg.query, {
      keepFraction: msg.keepFraction,
      model: msg.model || "default",
      fidelityMode: msg.fidelityMode || false,
      profile: msg.profile || "chat-prompt",
      costPerMillion: msg.costPerMillion
    });

    var uiMs = performance.now() - t0;
    self.postMessage({
      type: "COMPRESS_RESULT",
      id: msg.id,
      success: true,
      result: res,
      workerMs: uiMs
    });
  } catch (err) {
    self.postMessage({
      type: "COMPRESS_RESULT",
      id: msg.id,
      success: false,
      error: err.message || String(err)
    });
  }
};
