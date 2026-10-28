// The audit log: an append-only record of who did what and when (TA feedback: "audit logging" on workflow changes).
//
//   await audit(req.user, 'observation.signed', { type: 'observation', id: sectionId, term, detail: { role: 'observer' } });
//
// Rules:
//  * It never stops the request it is describing: if writing the log fails, the error is printed and the action stands.
//  * It never records survey authorship. Survey submissions are logged with no actor at all (see services/surveys.js).
//  * `actor` may be a professor document, or null for the system (sweeps, the seed).
const { AuditLog } = require('../models');
const { now } = require('./clock');

async function audit(actor, action, { type = null, id = null, term = null, detail = null } = {}) {
  try {
    await AuditLog.create({
      at: now(),
      actor_email: actor ? actor.email : null,
      actor_role: actor ? (actor.is_ac_member ? 'committee' : 'professor') : 'system',
      action,
      target_type: type,
      target_id: id,
      term,
      detail,
    });
  } catch (err) {
    console.error('[audit] could not write the log entry:', err && err.message ? err.message : err);
  }
}

module.exports = { audit };
