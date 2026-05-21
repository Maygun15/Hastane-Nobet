const { getHospitalContext, isSuperAdminRole } = require('../../middleware/hospital');

function resolveContext() {
  const ctx = getHospitalContext();
  const role = String(ctx?.role || '').toLowerCase();
  const hospitalId = ctx?.hospitalId ? String(ctx.hospitalId) : '';
  return { role, hospitalId };
}

function applyHospitalScope(schema) {
  if (!schema || schema.__hospitalScopeApplied) return;
  schema.__hospitalScopeApplied = true;

  const queryOps = [
    'countDocuments',
    'deleteMany',
    'deleteOne',
    'find',
    'findOne',
    'findOneAndDelete',
    'findOneAndUpdate',
    'updateMany',
    'updateOne',
  ];

  for (const op of queryOps) {
    schema.pre(op, function scopeQuery(next) {
      const { role, hospitalId } = resolveContext();
      if (!hospitalId || isSuperAdminRole(role)) return next();

      // Zaten doğru hospitalId ile filtreleniyorsa tekrar ekleme
      const filter = this.getFilter() || {};
      if (!Object.prototype.hasOwnProperty.call(filter, 'hospitalId')) {
        this.setQuery({ ...filter, hospitalId });
      }

      // Update operator'larında hospitalId override saldırısını engelle
      const upd = this.getUpdate();
      if (upd) {
        if (Array.isArray(upd)) {
          // Aggregation pipeline update — her $set/$unset stage'i tara
          for (const stage of upd) {
            const setFields = stage.$set || {};
            if (
              Object.prototype.hasOwnProperty.call(setFields, 'hospitalId') &&
              String(setFields.hospitalId) !== hospitalId
            ) {
              return next(new Error('hospitalId değiştirme yetkisi yok'));
            }
            if (stage.$unset && Object.prototype.hasOwnProperty.call(stage.$unset, 'hospitalId')) {
              return next(new Error('hospitalId silinemez'));
            }
          }
        } else {
          const setFields = upd.$set || upd;
          if (
            Object.prototype.hasOwnProperty.call(setFields, 'hospitalId') &&
            String(setFields.hospitalId) !== hospitalId
          ) {
            return next(new Error('hospitalId değiştirme yetkisi yok'));
          }
          // unset ile hospitalId silme girişimini engelle
          if (upd.$unset && Object.prototype.hasOwnProperty.call(upd.$unset, 'hospitalId')) {
            return next(new Error('hospitalId silinemez'));
          }
        }
      }

      if (this.options?.upsert && !Array.isArray(upd)) {
        const setOnInsert = { ...(upd?.$setOnInsert || {}) };
        if (!Object.prototype.hasOwnProperty.call(setOnInsert, 'hospitalId')) {
          setOnInsert.hospitalId = hospitalId;
          this.setUpdate({ ...(upd || {}), $setOnInsert: setOnInsert });
        }
      }
      return next();
    });
  }

  schema.pre('aggregate', function scopeAggregate(next) {
    const { role, hospitalId } = resolveContext();
    if (!hospitalId || isSuperAdminRole(role)) return next();

    const pipeline = this.pipeline();
    // Herhangi bir $match aşamasında hospitalId varsa ekleme
    const hasMatch = pipeline.some(
      (stage) => stage?.$match && Object.prototype.hasOwnProperty.call(stage.$match, 'hospitalId')
    );
    if (hasMatch) return next();

    // $geoNear her zaman ilk aşama olmalı, arkasına ekle
    if (pipeline[0]?.$geoNear) {
      pipeline.splice(1, 0, { $match: { hospitalId } });
    } else {
      pipeline.unshift({ $match: { hospitalId } });
    }
    return next();
  });

  schema.pre('save', function scopeSave(next) {
    const { role, hospitalId } = resolveContext();
    if (!hospitalId || isSuperAdminRole(role)) return next();
    if (!this.hospitalId) {
      this.hospitalId = hospitalId;
    } else if (String(this.hospitalId) !== hospitalId) {
      return next(new Error('hospitalId değiştirme yetkisi yok'));
    }
    return next();
  });

  schema.pre('insertMany', function scopeInsertMany(next, docs) {
    const { role, hospitalId } = resolveContext();
    if (!hospitalId || isSuperAdminRole(role)) return next();
    for (const doc of docs || []) {
      if (doc && !doc.hospitalId) doc.hospitalId = hospitalId;
    }
    return next();
  });
}

module.exports = { applyHospitalScope };
