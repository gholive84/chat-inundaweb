// Rate limit em memoria: max N mensagens por minuto por instance.
// Ring buffer simples — reseta a cada restart, mas o cliente sempre toma
// uma pausa quando esquentar demais, evitando bursts.
const buckets = new Map(); // instance_name → array de timestamps (ms)

function purgeOld(arr, windowMs) {
  const cutoff = Date.now() - windowMs;
  while (arr.length && arr[0] < cutoff) arr.shift();
}

/**
 * Retorna { allowed, waitMs }. Se !allowed, waitMs indica quanto esperar
 * antes de tentar de novo.
 */
function check(instanceName, maxPerMinute) {
  const arr = buckets.get(instanceName) || [];
  const windowMs = 60_000;
  purgeOld(arr, windowMs);
  if (arr.length < maxPerMinute) return { allowed: true, count: arr.length };
  const oldest = arr[0];
  const waitMs = (oldest + windowMs) - Date.now();
  return { allowed: false, waitMs: Math.max(0, waitMs) };
}

function record(instanceName) {
  const arr = buckets.get(instanceName) || [];
  arr.push(Date.now());
  buckets.set(instanceName, arr);
}

function counts(instanceName) {
  const arr = buckets.get(instanceName) || [];
  purgeOld(arr, 60_000);
  return arr.length;
}

module.exports = { check, record, counts };
