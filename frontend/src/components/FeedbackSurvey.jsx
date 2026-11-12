import React, { useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { Badge, Notice } from './ui.jsx';

/**
 * End-of-process survey (professor side).
 *
 * The professor rates the process (Difficult / Manageable / Smooth); each rating has its own follow-up questions.
 *
 * Props:
 *  - hasSubmitted: true if this professor already submitted for the current cycle
 *  - onSubmit({ rating, answers: [{ key, question, answer }], notes, attachment_count }): hands the
 *    answers to App, which stores them WITHOUT any professor identity.
 *  - isClosed / deadline: the survey deadline set by the committee
 */

export const SURVEY_RATINGS = [
  { id: 'difficult', label: 'Difficult', tone: 'bad' },
  { id: 'manageable', label: 'Manageable', tone: 'yellow' },
  { id: 'smooth', label: 'Smooth', tone: 'good' },
];

const MORE = 'Not limited to one reason only; write more if necessary';

// The questions shown for a rating. For "Smooth", the follow-ups depend on the yes/no difficulties answer.
function questionsFor(rating, answers) {
  if (rating === 'difficult') {
    return [
      { key: 'challenges', question: 'What were the challenges that made this observation process difficult?', required: true },
      { key: 'improve', question: 'How can we improve this observation process moving forward?', required: true },
    ];
  }
  if (rating === 'manageable') {
    return [
      { key: 'went_well', question: 'What is one thing that this observation process did well?', sub: MORE, required: true },
      { key: 'issues', question: 'What are some issues that made this observation process manageable?', required: true },
      { key: 'improve', question: 'What is one thing we can improve in the observation process moving forward?', sub: MORE, required: true },
    ];
  }
  if (rating === 'smooth') {
    const had = answers.had_difficulties;
    return [
      { key: 'excelled', question: 'What is one thing this observation process excelled at?', sub: MORE, required: true },
      { key: 'had_difficulties', question: 'Were there any difficulties during this observation process?', type: 'yesno', required: true },
      ...(had === 'yes' ? [
        { key: 'difficulties_list', question: 'List the difficulties you experienced.', required: true },
        { key: 'improve', question: 'What is one thing we can improve in the observation process moving forward?', sub: MORE, required: true },
      ] : had === 'no' ? [
        { key: 'improve', question: 'Is there anything we can improve in the observation process moving forward?', sub: 'Leave this blank if you think the observation process is good as it is', required: false },
      ] : []),
    ];
  }
  return [];
}

const fileSize = (bytes) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);

export default function FeedbackSurvey({ hasSubmitted, onSubmit, isClosed = false, deadline }) {
  const [rating, setRating] = useState('');
  const [answers, setAnswers] = useState({});
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [showMissing, setShowMissing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInput = useRef(null);

  const questions = questionsFor(rating, answers);
  const setAnswer = (key, value) => setAnswers((a) => ({ ...a, [key]: value }));
  const missing = questions.filter((q) => q.required && !String(answers[q.key] || '').trim()).map((q) => q.key);

  const addFiles = (list) => {
    const added = [...list];
    // Same name + size counts as the same file, so picking it twice doesn't list it twice.
    setFiles((current) => [...current, ...added.filter((f) => !current.some((c) => c.name === f.name && c.size === f.size))]);
    if (fileInput.current) fileInput.current.value = '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isClosed || submitting) return; // deadline passed, or already sending
    if (!rating) {
      setError('Please rate the observation process.');
      return;
    }
    if (missing.length) {
      setShowMissing(true);
      setError('Please answer every required question.');
      return;
    }
    setError('');
    setSubmitting(true); // from main: block double submits while the request is in flight
    try {
      await onSubmit({
        rating,
        answers: questions.map((q) => ({ key: q.key, question: q.question, answer: String(answers[q.key] || '').trim() })),
        notes: notes.trim(),
        attachment_count: files.length, // file names are never stored (they could identify the sender)
      });
    } catch (submitError) {
      setError(submitError.message || 'The survey could not be submitted.');
    } finally {
      setSubmitting(false);
    }
  };

  if (hasSubmitted) {
    return (
      <Notice tone="good" title="Survey submitted. Thank you.">
        Your feedback is recorded. Your answers are anonymous: the Assessment Committee can see that you completed the survey, but not which responses are yours.
      </Notice>
    );
  }

  if (isClosed) {
    return (
      <Notice tone="bad" icon="lock" title="Survey closed">
        The survey deadline{deadline ? ` (${deadline})` : ''} has passed, so new responses can no longer be submitted. Contact the Assessment Committee if you believe this is an error.
      </Notice>
    );
  }

  return (
    <section className="card card-lg">
      <div className="row section-gap-lg">
        <Badge tone="good">Anonymous</Badge>
        {deadline && <Badge tone="warn">Closes {deadline}</Badge>}
      </div>
      <form onSubmit={handleSubmit} className="stack" noValidate>
        {error && <Notice tone="bad">{error}</Notice>}

        <fieldset className="plain-fieldset">
          <legend className="field-legend">How do you rate this observation process?</legend>
          <div className="choice-group">
            {SURVEY_RATINGS.map((r) => (
              <label key={r.id} className={`choice choice-soft-${r.tone}${rating === r.id ? ' selected' : ''}`}>
                <input type="radio" name="process-rating" value={r.id} checked={rating === r.id}
                  onChange={() => { setRating(r.id); setShowMissing(false); setError(''); }} />
                {r.label}
              </label>
            ))}
          </div>
        </fieldset>

        {questions.map((q) => {
          const flagged = showMissing && missing.includes(q.key);
          const tag = q.required ? <span className="faint"> (required)</span> : <span className="faint"> (optional)</span>;
          if (q.type === 'yesno') {
            return (
              <fieldset key={q.key} className="plain-fieldset">
                <legend className="field-legend">{q.question}{tag}{flagged && <span className="field-error"> Please choose one</span>}</legend>
                <div className="choice-group">
                  {[['no', 'No', 'bad'], ['yes', 'Yes', 'good']].map(([value, label, tone]) => (
                    <label key={value} className={`choice choice-soft-${tone}${answers[q.key] === value ? ' selected' : ''}`}>
                      <input type="radio" name={`survey-${q.key}`} value={value} checked={answers[q.key] === value} onChange={() => setAnswer(q.key, value)} />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          }
          return (
            <label key={q.key} className="field" htmlFor={`survey-${q.key}`}>
              <span className="field-head">
                <span>{q.question}{tag}{flagged && <span className="field-error"> Required</span>}</span>
                {q.sub && <span className="field-hint">{q.sub}</span>}
              </span>
              <textarea id={`survey-${q.key}`} rows="3" required={q.required} aria-invalid={flagged || undefined}
                value={answers[q.key] || ''} onChange={(e) => setAnswer(q.key, e.target.value)} placeholder="Write your answer" />
            </label>
          );
        })}

        {rating && (
          <>
            <div className="field">
              <label className="field-head" htmlFor="survey-notes">
                <span>Additional notes<span className="faint"> (optional)</span></span>
                <span className="field-hint">If you have anything else to say that needs more explanation, feel free to upload a file or two regarding that explanation</span>
              </label>
              <textarea id="survey-notes" rows="3" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything else you'd like the committee to know" />
              {/* File names are never sent to the committee, only how many files were added */}
              <input ref={fileInput} type="file" multiple aria-label="Attach files to your notes (optional)" onChange={(e) => addFiles(e.target.files)} />
              {files.length > 0 && (
                <ul className="file-list" aria-label="Files you added">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${f.size}`} className="file-list-item">
                      <Icon name="paperclip" size={14} />
                      <span className="file-list-name">{f.name}</span>
                      <span className="faint">{fileSize(f.size)}</span>
                      <button type="button" className="icon-button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>
                        <Icon name="x" size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        <div><button type="submit" className="btn btn-primary btn-lg" disabled={!rating || submitting}>{submitting ? 'Submitting…' : 'Submit survey'}</button></div>
      </form>
    </section>
  );
}
