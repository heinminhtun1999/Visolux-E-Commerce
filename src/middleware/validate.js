function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse({
      body: req.body,
      query: req.query,
      params: req.params,
    });

    if (!result.success) {
      const err = new Error('Validation failed');
      err.status = 400;
      err.details = {
        flattened: result.error.flatten(),
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      };
      return next(err);
    }

    req.validated = result.data;
    return next();
  };
}

module.exports = { validate };
