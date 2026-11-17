// Shared by the professor "Rank Change" tab and the committee "Ranks" tab.
export const RANK_OPTIONS = [
  { value: 'assistant', label: 'Assistant' },
  { value: 'associate', label: 'Associate' },
  { value: 'full', label: 'Full' },
];

export const RANK_STATUS = {
  pending: ['Pending review', 'warn'],
  approved: ['Approved', 'good'],
  rejected: ['Not approved', 'bad'],
};

export const fmtDate = (value) => (value ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
