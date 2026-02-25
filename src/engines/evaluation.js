/**
 * evaluation.js
 *
 * Métricas de avaliação do modelo probabilístico.
 *
 * MUDANÇAS:
 *   - Centraliza Brier Score (estava duplicado no backtest-engine)
 *   - Adiciona Log Loss (mais sensível a probabilidades extremas)
 *   - Adiciona `evaluatePredictions` (retorna todas as métricas de uma vez)
 *   - Exportações nomeadas para uso modular
 */

const EPSILON = 1e-15;

/**
 * Brier Score — média dos erros quadráticos por classe.
 * Bom modelo: < 0.50  |  Ruim: > 0.65
 * Menor = melhor.
 *
 * @param {Array<{prob:{home,draw,away}, result:"HOME"|"DRAW"|"AWAY"}>} predictions
 */
export function calculateBrierScore(predictions) {
  if (!predictions.length) return null;

  let total = 0;
  for (const p of predictions) {
    const o = _outcomeVector(p.result);
    total +=
      (p.prob.home - o.home) ** 2 +
      (p.prob.draw - o.draw) ** 2 +
      (p.prob.away - o.away) ** 2;
  }
  return total / predictions.length;
}

/**
 * Log Loss (Cross-entropy) — penaliza probabilidades muito erradas.
 * Bom modelo: < 0.95  |  Baseline ingênuo (33/33/33): ~1.099
 * Menor = melhor.
 */
export function calculateLogLoss(predictions) {
  if (!predictions.length) return null;

  let total = 0;
  for (const p of predictions) {
    const o = _outcomeVector(p.result);
    total -= (
      o.home * Math.log(Math.max(p.prob.home, EPSILON)) +
      o.draw * Math.log(Math.max(p.prob.draw, EPSILON)) +
      o.away * Math.log(Math.max(p.prob.away, EPSILON))
    );
  }
  return total / predictions.length;
}

/**
 * Acurácia — porcentagem de acertos do resultado mais provável.
 * Baseline ingênuo (sempre home): ~45%. Bom modelo: > 52%.
 */
export function calculateAccuracy(predictions) {
  if (!predictions.length) return null;

  let correct = 0;
  for (const p of predictions) {
    const predicted = _argmax(p.prob);
    if (predicted === p.result) correct++;
  }
  return correct / predictions.length;
}

/**
 * Retorna todas as métricas de uma vez.
 *
 * @param {Array<{prob:{home,draw,away}, result:"HOME"|"DRAW"|"AWAY"}>} predictions
 * @returns {{ brierScore, logLoss, accuracy, n }}
 */
export function evaluatePredictions(predictions) {
  return {
    n:          predictions.length,
    brierScore: calculateBrierScore(predictions),
    logLoss:    calculateLogLoss(predictions),
    accuracy:   calculateAccuracy(predictions),
  };
}

/* ─────────────────────────────────────────
   HELPERS INTERNOS
───────────────────────────────────────── */

function _outcomeVector(result) {
  return {
    home: result === "HOME" ? 1 : 0,
    draw: result === "DRAW" ? 1 : 0,
    away: result === "AWAY" ? 1 : 0,
  };
}

function _argmax({ home, draw, away }) {
  if (home >= draw && home >= away) return "HOME";
  if (draw >= away)                 return "DRAW";
  return "AWAY";
}
