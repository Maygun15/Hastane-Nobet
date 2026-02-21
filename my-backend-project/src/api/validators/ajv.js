// src/api/validators/ajv.js
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const schema = require('../schemas/parsed-request.schema.json');

const ajv = new Ajv2020({
  allErrors: true,
  strict: false, // istersen true yapabilirsin
});
addFormats(ajv);

const validate = ajv.compile(schema);

function validateParsedRequest(data) {
  const ok = validate(data);
  return { ok: !!ok, errors: ok ? null : validate.errors };
}

module.exports = { validateParsedRequest };
