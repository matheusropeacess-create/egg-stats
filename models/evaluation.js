// models/evaluation.js

export function calculateBrierScore(predictions) {
  let total = 0;

  for (const p of predictions) {

    const outcome = {
      home: p.result === "HOME" ? 1 : 0,
      draw: p.result === "DRAW" ? 1 : 0,
      away: p.result === "AWAY" ? 1 : 0
    };

    total +=
      Math.pow(p.prob.home - outcome.home, 2) +
      Math.pow(p.prob.draw - outcome.draw, 2) +
      Math.pow(p.prob.away - outcome.away, 2);
  }

  return total / predictions.length;
}
