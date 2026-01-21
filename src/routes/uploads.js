const fs = require('fs');
const path = require('path');
const express = require('express');

const orderRepo = require('../repositories/orderRepo');
const { canAccessOrder } = require('../utils/orderAccess');

const router = express.Router();

router.get('/uploads/slips/:file', (req, res, next) => {
  try {
    const file = path.basename(String(req.params.file || ''));
    if (!file) {
      const err = new Error('Not Found');
      err.status = 404;
      throw err;
    }

    const slipPath = `/uploads/slips/${file}`;
    const offlineRow = orderRepo.getOfflineTransferBySlipPath(slipPath);

    if (!offlineRow) {
      const err = new Error('Not Found');
      err.status = 404;
      throw err;
    }

    if (offlineRow.slip_deleted) {
      const err = new Error('Not Found');
      err.status = 404;
      throw err;
    }

    const order = orderRepo.getById(offlineRow.order_id);
    const isAdmin = Boolean(req.session?.user?.isAdmin);

    if (!isAdmin && !canAccessOrder(req.session, order)) {
      const err = new Error('Not Found');
      err.status = 404;
      throw err;
    }

    const abs = path.join(process.cwd(), 'storage', 'uploads', 'slips', file);
    const st = fs.statSync(abs);
    if (!st.isFile()) {
      const err = new Error('Not Found');
      err.status = 404;
      throw err;
    }

    res.setHeader('Cache-Control', 'private, no-store');
    return res.sendFile(abs);
  } catch (e) {
    if (String(e.code || '') === 'ENOENT') {
      return res.status(404).send('Not Found');
    }
    return next(e);
  }
});

module.exports = router;
