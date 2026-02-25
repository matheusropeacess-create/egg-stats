export function calculateConfidence({ ev, edge, lambdaDiff, sampleSize }) {
  
  let score = 50;

  // Edge weight
  score += edge * 200;

  // EV weight
  score += ev * 150;

  // Diferença de força
  score += lambdaDiff * 10;

  // Tamanho da amostra
  score += Math.log(sampleSize) * 2;

  // Clamp
  if (score > 100) score = 100;
  if (score < 0) score = 0;

  return Number(score.toFixed(1));
}
