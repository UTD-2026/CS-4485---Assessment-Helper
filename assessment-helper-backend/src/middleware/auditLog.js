// Step 6: Audit logging for observation-assignment state transitions.
//
// Every successful transition writes an append-only row to
// observation_audit_log, recording who changed what state and when.
// This is called from inside the same transaction as the state update
// (see routes/observations.js) so an audit entry and its transition
// either both commit or both roll back — never one without the other.

const { getClient } = require('../config/db');

/**
 * Insert one audit row using the given (already-open) transaction client.
 * @param {import('pg').PoolClient} client
 * @param {{assignmentId: string, changedBy: string, fromStatus: string|null, toStatus: string, note?: string}} entry
 */
async function recordTransition(client, { assignmentId, changedBy, fromStatus, toStatus, note }) {
    await client.query(
        `INSERT INTO observation_audit_log (assignment_id, changed_by, from_status, to_status, note)
         VALUES ($1, $2, $3, $4, $5)`,
        [assignmentId, changedBy, fromStatus, toStatus, note || null]
    );
}

/**
 * Express middleware: requires the caller to identify themselves via an
 * `X-Actor-Id` header (in a real deployment this would come from an
 * authenticated session/JWT — see Stretch Goal: Role-based access
 * control). Attaches req.actorId for downstream route handlers.
 */
function requireActor(req, res, next) {
    const actorId = req.header('X-Actor-Id');
    if (!actorId) {
        return res.status(400).json({ error: 'X-Actor-Id header is required to attribute this change for the audit log.' });
    }
    req.actorId = actorId;
    next();
}

module.exports = { recordTransition, requireActor, getClient };
