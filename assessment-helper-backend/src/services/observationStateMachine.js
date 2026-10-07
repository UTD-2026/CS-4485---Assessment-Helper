// Step 6: Observation Assignment State Machine
//
// Enforces the pipeline: PROPOSED -> CONFIRMED -> SUBMITTED -> COMPLETED,
// with CANCELLED reachable from any non-terminal state. Guard clauses
// live here, independent of the HTTP layer, so the same rules can be
// unit tested or reused by a future scheduler/notification job.

const VALID_STATUSES = ['PROPOSED', 'CONFIRMED', 'SUBMITTED', 'COMPLETED', 'CANCELLED'];

// Adjacency list of legal forward transitions. Nothing outside this map
// is permitted — steps can never be skipped, and completed/cancelled
// assignments are terminal.
const ALLOWED_TRANSITIONS = {
    PROPOSED: ['CONFIRMED', 'CANCELLED'],
    CONFIRMED: ['SUBMITTED', 'CANCELLED'],
    SUBMITTED: ['COMPLETED', 'CANCELLED'],
    COMPLETED: [],
    CANCELLED: [],
};

class InvalidTransitionError extends Error {
    constructor(fromStatus, toStatus) {
        super(`Cannot transition observation assignment from ${fromStatus} to ${toStatus}.`);
        this.name = 'InvalidTransitionError';
        this.statusCode = 409;
        this.fromStatus = fromStatus;
        this.toStatus = toStatus;
    }
}

/**
 * Throws InvalidTransitionError if the transition is not allowed;
 * otherwise returns silently.
 */
function assertValidTransition(fromStatus, toStatus) {
    if (!VALID_STATUSES.includes(toStatus)) {
        const err = new Error(`Unknown target status "${toStatus}".`);
        err.statusCode = 400;
        throw err;
    }
    const allowedNext = ALLOWED_TRANSITIONS[fromStatus] || [];
    if (!allowedNext.includes(toStatus)) {
        throw new InvalidTransitionError(fromStatus, toStatus);
    }
}

/**
 * Returns the timestamp column that should be stamped for a given
 * target status, or null if that status has no dedicated timestamp.
 */
function timestampColumnFor(toStatus) {
    return {
        CONFIRMED: 'confirmed_at',
        SUBMITTED: 'submitted_at',
        COMPLETED: 'completed_at',
    }[toStatus] || null;
}

module.exports = {
    VALID_STATUSES,
    ALLOWED_TRANSITIONS,
    InvalidTransitionError,
    assertValidTransition,
    timestampColumnFor,
};
