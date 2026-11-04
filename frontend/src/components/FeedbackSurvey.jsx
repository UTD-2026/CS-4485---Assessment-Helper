import React, { useState } from 'react';
import Icon from './Icon.jsx';
import { Badge, Notice } from './ui.jsx';

/**
 * End-of-process survey (professor side).
 *
 * Props:
 *  - hasSubmitted: true if this professor already submitted for the current cycle
 *  - onSubmit({ process_ok, difficulties, improvements, has_attachment }): hands the
 *    answers to App, which stores them WITHOUT any professor identity.
 *  - isClosed / deadline: the survey deadline set by the committee
 */
export default function FeedbackSurvey({ hasSubmitted, onSubmit, isClosed = false, deadline }) {
  const [processOk, setProcessOk] = useState('');
  const [difficulties, setDifficulties] = useState('');
  const [improvements, setImprovements] = useState('');
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');

  // "No, the process was not OK" makes both written answers required
  const needsDetails = processOk === 'not_ok';

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isClosed) return; // deadline passed--block submission
    if (!processOk) {
      setError('Please say whether the observation process was OK.');
      return;
    }
    if (needsDetails && (!difficulties.trim() || !improvements.trim())) {
      setError('Since the process was not OK, please list your difficulties and how the process could improve.');
      return;
    }
    setError('');
    onSubmit({
      process_ok: processOk === 'ok',
      difficulties: difficulties.trim(),
      improvements: improvements.trim(),
      has_attachment: Boolean(file), // the file name itself is never stored (could identify the sender)
    });
  };

  if (hasSubmitted) {
    return (
      <div className="max-760">
        <Notice tone="good" title="Survey submitted. Thank you.">
          Your feedback is recorded. Your answers are anonymous: the Assessment Committee can see that you completed the survey, but not which responses are yours.
        </Notice>
      </div>
    );
  }

  if (isClosed) {
    return (
      <div className="max-760">
        <Notice tone="bad" icon="lock" title="Survey closed">
          The survey deadline{deadline ? ` (${deadline})` : ''} has passed, so new responses can no longer be submitted. Contact the Assessment Committee if you believe this is an error.
        </Notice>
      </div>
    );
  }

  return (
    <section className="card card-lg max-760">
      <div className="row section-gap-lg">
        <Badge tone="good">Anonymous</Badge>
        {deadline && <Badge tone="warn">Closes {deadline}</Badge>}
      </div>
      <form onSubmit={handleSubmit} className="stack" noValidate>
        {error && <Notice tone="bad">{error}</Notice>}

        <fieldset className="plain-fieldset">
          <legend className="field-legend">Was this observation process OK?</legend>
          <div className="choice-group">
            <label className={`choice${processOk === 'ok' ? ' selected' : ''}`}>
              <input type="radio" name="process-ok" value="ok" checked={processOk === 'ok'} onChange={() => setProcessOk('ok')} />
              Yes, it was OK
            </label>
            <label className={`choice${processOk === 'not_ok' ? ' selected' : ''}`}>
              <input type="radio" name="process-ok" value="not_ok" checked={processOk === 'not_ok'} onChange={() => setProcessOk('not_ok')} />
              No, it was not OK
            </label>
          </div>
        </fieldset>

        <label className="field" htmlFor="survey-difficulties">
          Difficulties you ran into{needsDetails && <span className="field-error"> Required when the process was not OK</span>}
          <textarea id="survey-difficulties" rows="3" required={needsDetails} value={difficulties} onChange={(e) => setDifficulties(e.target.value)} placeholder="Describe any issues during the observation process" />
        </label>

        <label className="field" htmlFor="survey-improvements">
          How could the process improve?{needsDetails && <span className="field-error"> Required when the process was not OK</span>}
          <textarea id="survey-improvements" rows="3" required={needsDetails} value={improvements} onChange={(e) => setImprovements(e.target.value)} placeholder="Share your suggestions" />
        </label>

        <label className="field file-drop">
          <span className="row"><Icon name="paperclip" size={16} /> Troubleshooting file (optional)</span>
          <span className="field-hint">Upload something that sheds light on a problem. Leave out anything that identifies you.</span>
          <input type="file" onChange={(e) => setFile(e.target.files[0] || null)} />
        </label>

        <div><button type="submit" className="btn btn-primary btn-lg">Submit survey</button></div>
      </form>
    </section>
  );
}
