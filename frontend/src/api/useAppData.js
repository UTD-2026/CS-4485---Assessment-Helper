import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './client.js';
import {
  adaptProfessor, adaptCourse, adaptSignup, adaptRequest, adaptObservation,
  adaptEvaluation, adaptNotification, adaptDeadlines,
} from './adapters.js';

const POLL_MS = 15000;

const EMPTY = {
  loading: true,
  error: '',
  term: '',
  cycles: [],
  deadlines: { signup: '', observation: '', survey: '' },
  professors: [],
  courses: [],
  signups: [],
  requests: [],
  observations: [],
  evaluations: [],
  drafts: {},
  template: [],
  notifications: [],
  surveyStatus: null,
  surveyResponses: [],
  surveySubmissions: [],
  surveyExpected: 0,
};

/**
 * Loads everything the signed-in user's screens need from the API, in the shapes the UI expects.
 * refresh() reloads after every action; the data is also polled so other people's changes show up.
 */
export default function useAppData(user) {
  const [data, setData] = useState(EMPTY);
  const inFlight = useRef(null);

  const load = useCallback(async () => {
    if (!user) return;
    const cyclesRes = await api.cycles();
    const term = cyclesRes.meta?.current_term || '';
    const cycle = cyclesRes.data.find((c) => c.term === term);
    const isAc = user.is_ac_member;

    const [profRes, courseRes, obsRes, matchRes, templateRes, notifRes, surveyRes, responsesRes] = await Promise.all([
      api.professors(term),
      api.courseSections({ term }),
      api.observations(), // all terms: professors get only their own, so "My Evaluations" keeps history
      api.observerMatches({ term }),
      api.template(term),
      api.notifications(),
      api.surveyStatus(term, isAc),
      isAc ? api.surveyResponses(term) : Promise.resolve(null),
    ]);

    const professors = profRes.data.map(adaptProfessor);
    const directory = new Map(professors.map((p) => [p.email, p]));
    const termObs = obsRes.data.filter((o) => o.term === term);
    const matches = matchRes.data;

    const drafts = {};
    for (const o of obsRes.data) {
      if (o.evaluation_draft) drafts[o.id] = { answers: o.evaluation_draft, savedAt: new Date(o.evaluation_draft_saved).toLocaleString() };
    }

    setData({
      loading: false,
      error: '',
      term,
      cycles: cyclesRes.data,
      deadlines: adaptDeadlines(cycle),
      professors,
      courses: courseRes.data.map(adaptCourse),
      signups: termObs.map((o) => adaptSignup(o, matches, directory)),
      requests: matches.filter((m) => m.status !== 'suggested').map(adaptRequest),
      observations: termObs.filter((o) => o.observer_email).map((o) => adaptObservation(o, directory)),
      // Evaluations: this term for the committee views; every term the user took part in for "My Evaluations"
      evaluations: obsRes.data.filter((o) => o.ratings).map(adaptEvaluation),
      drafts,
      template: templateRes.data.criteria || [],
      notifications: notifRes.data.map(adaptNotification),
      surveyStatus: surveyRes.data,
      surveySubmissions: (surveyRes.data.submitted_by || []).map((email) => ({ professor_id: email })),
      surveyExpected: surveyRes.data.expected_count ?? responsesRes?.meta?.expected_count ?? 0,
      surveyResponses: responsesRes?.data || [],
    });
  }, [user]);

  const refresh = useCallback(async () => {
    if (inFlight.current) return inFlight.current;
    inFlight.current = load()
      .catch((error) => setData((d) => ({ ...d, loading: false, error: error.message })))
      .finally(() => { inFlight.current = null; });
    return inFlight.current;
  }, [load]);

  useEffect(() => {
    if (!user) { setData(EMPTY); return undefined; }
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [user, refresh]);

  return { ...data, refresh };
}
