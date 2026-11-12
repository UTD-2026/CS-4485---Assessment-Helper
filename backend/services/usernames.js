// Name-based login usernames (from main's routes/auth.js): first initial + last name,
// e.g. "Dr. Jane Smith" -> "jsmith". When two professors share that, each gets their
// middle initial added ("jasmith", "jbsmith").
function nameWords(name) {
  return String(name || "").normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[-']/g, "").replace(/[^a-zA-Z\s]/g, " ").trim().split(/\s+/).filter(Boolean)
    .filter((word, index) => !(index === 0 && /^(dr|prof|professor)$/i.test(word)));
}

function baseUsername(name) {
  const words = nameWords(name);
  return words.length < 2 ? null : `${words[0][0]}${words.at(-1)}`.toLowerCase();
}

/** Map of username -> professor for every professor whose name gives one. */
function makeUsernameMap(professors) {
  const grouped = new Map();
  for (const professor of professors) {
    const base = baseUsername(professor.name);
    if (base) grouped.set(base, [...(grouped.get(base) || []), professor]);
  }
  const result = new Map();
  for (const [base, members] of grouped) {
    if (members.length === 1) {
      result.set(base, members[0]);
      continue;
    }
    for (const professor of members) {
      const words = nameWords(professor.name);
      const middle = words.length > 2 ? words[1][0].toLowerCase() : "";
      result.set(`${words[0][0]}${middle}${words.at(-1)}`.toLowerCase(), professor);
    }
  }
  return result;
}

module.exports = { nameWords, baseUsername, makeUsernameMap };
