// services/schedulerJobRunner.js — fire-and-forget background schedule generation
const mongoose = require('mongoose');
const SchedulerJob = require('../models/SchedulerJob');
const { generateSchedule } = require('./schedulerService');

// Simple in-process queue: queue a job and return its id immediately.
// The actual work runs after the current event-loop tick.
async function enqueueScheduleJob({ sectionId, serviceId = '', role = '', year, month, dryRun = false, userId, payload = {}, hospitalId = null }) {
  const safeUserId = mongoose.isValidObjectId(userId) ? userId : null;
  const job = await SchedulerJob.create({
    hospitalId: hospitalId || null,
    createdBy:  safeUserId,
    status: 'queued',
    params: { sectionId, serviceId, role, year, month, dryRun },
  });

  const jobId = String(job._id);

  setImmediate(async () => {
    const started = Date.now();
    try {
      await SchedulerJob.findByIdAndUpdate(jobId, { status: 'running', startedAt: new Date() });
      const result = await generateSchedule({ sectionId, serviceId, role, year, month, dryRun, userId, payload, hospitalId });
      const ms = Date.now() - started;
      await SchedulerJob.findByIdAndUpdate(jobId, {
        status: 'done',
        result,
        finishedAt: new Date(),
        durationMs: ms,
      });
    } catch (err) {
      await SchedulerJob.findByIdAndUpdate(jobId, {
        status: 'failed',
        error: err?.message || String(err),
        finishedAt: new Date(),
        durationMs: Date.now() - started,
      }).catch(() => {});
    }
  });

  return jobId;
}

async function getJob(jobId) {
  return SchedulerJob.findById(jobId).lean();
}

module.exports = { enqueueScheduleJob, getJob };
