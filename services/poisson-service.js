// services/poisson-service.js

function factorial(n) {
  if (n === 0) return 1;
  return n * factorial(n - 1);
}

function poisson(lambda, k) {
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

// Dixon-Coles adjustment
function dixonColesAdjustment(i, j, lambdaHome, lambdaAway, rho = -0.05) {
  if (i === 0 && j === 0) {
    return 1 - (lambdaHome * lambdaAway * rho);
  }
  if (i === 0 && j === 1) {
    return 1 + (lambdaHome * rho);
  }
  if (i === 1 && j === 0) {
    return 1 + (lambdaAway * rho);
  }
  if (i === 1 && j === 1) {
    return 1 - rho;
  }
  return 1;
}

export function calculateMatchProbabilities(lambdaHome, lambdaAway) {

  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  const maxGoals = 6;

  for (let i = 0; i <= maxGoals; i++) {
    for (let j = 0; j <= maxGoals; j++) {

      const baseProb =
        poisson(lambdaHome, i) *
        poisson(lambdaAway, j);

      const adjustedProb =
        baseProb *
        dixonColesAdjustment(i, j, lambdaHome, lambdaAway);

      if (i > j) homeWin += adjustedProb;
      else if (i === j) draw += adjustedProb;
      else awayWin += adjustedProb;
    }
  }

  const total = homeWin + draw + awayWin;

  return {
    homeProb: homeWin / total,
    drawProb: draw / total,
    awayProb: awayWin / total
  };
}
