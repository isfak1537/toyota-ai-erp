// Runs promises in parallel and splits the outcome so tests can assert on how
// many succeeded and what the failures were.
const settle = async (promises) => {
  const results = await Promise.allSettled(promises);

  return {
    ok: results.filter((r) => r.status === "fulfilled").map((r) => r.value),
    failed: results.filter((r) => r.status === "rejected").map((r) => r.reason),
  };
};

const times = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));

module.exports = { settle, times };
