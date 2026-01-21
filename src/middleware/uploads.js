const path = require('path');
const multer = require('multer');

const { env } = require('../config/env');

const upload = multer({
  dest: path.join(process.cwd(), 'storage', 'uploads', 'tmp'),
  limits: {
    fileSize: env.uploadMaxBytes,
  },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Only JPG, PNG, or WEBP images are allowed.'));
    }
    return cb(null, true);
  },
});

module.exports = { upload };
