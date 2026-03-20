const Joi = require('joi');

const scheduleGenerateSchema = Joi.object({
  year: Joi.number().integer().min(2000).required(),
  month: Joi.number().integer().min(1).max(12).required(),
  serviceId: Joi.string().trim().allow('').optional(),
  sectionId: Joi.string().trim().required(),
  role: Joi.string().trim().allow('').optional(),
  dryRun: Joi.boolean().optional(),
}).unknown(true);

const assignShiftSchema = Joi.object({
  personId: Joi.string().trim().required(),
  date: Joi.string().trim().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  shiftCode: Joi.string().trim().required(),
  shiftId: Joi.string().trim().optional(),
  sectionId: Joi.string().trim().optional(),
  serviceId: Joi.string().trim().allow('').optional(),
  role: Joi.string().trim().allow('').optional(),
  personName: Joi.string().trim().allow('').optional(),
  roleLabel: Joi.string().trim().allow('').optional(),
  note: Joi.string().allow('').optional(),
  previousShiftId: Joi.string().trim().allow('').optional(),
  pinned: Joi.alternatives().try(Joi.boolean(), Joi.number().valid(0, 1), Joi.string().valid('0', '1', 'true', 'false')).optional(),
}).unknown(true);

function validate(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body || {}, {
      abortEarly: false,
      stripUnknown: false,
      convert: true,
    });

    if (error) {
      return res.status(400).json({
        ok: false,
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: error.details.map((item) => ({
          message: item.message,
          path: item.path,
          type: item.type,
        })),
      });
    }

    req.body = value;
    return next();
  };
}

module.exports = {
  scheduleGenerateSchema,
  assignShiftSchema,
  validate,
};
