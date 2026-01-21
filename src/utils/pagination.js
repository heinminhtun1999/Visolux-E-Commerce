function getPagination({ page, pageSize, maxPageSize = 48 }) {
  const p = Math.max(1, Number(page || 1));
  const ps = Math.min(maxPageSize, Math.max(1, Number(pageSize || 12)));
  const offset = (p - 1) * ps;
  return { page: p, pageSize: ps, offset, limit: ps };
}

function getPageCount(total, pageSize) {
  return Math.max(1, Math.ceil((total || 0) / pageSize));
}

module.exports = { getPagination, getPageCount };
