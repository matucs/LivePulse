/**
 * Cross-provider team identity reconciliation, by name.
 *
 * Why this exists at all: LivePulse's internal ids are deterministic
 * per-provider (`deriveId(providerCode, kind, externalId)` —
 * domain/deriveId.ts), which is exactly right for matches (API-Football is
 * the one authoritative source for match identity). But football-data.org's
 * standings response has no relationship to API-Football's team ids — it's
 * a different provider's own numbering. A standings row must attach to the
 * SAME `teams` row that API-Football's match ingestion already created for
 * that club, or the standings table and the live match data would silently
 * refer to two different "Manchester United" rows with no link between
 * them.
 *
 * There is no general solution to this without a real cross-provider entity
 * resolution system (a canonical team-identity table with per-provider
 * aliases — the schema-level fix, not built here; see the ADR-007 addendum
 * for why this is a deliberate scope decision, not an oversight). What's
 * here is a pragmatic, honest one: normalize both names and match exactly,
 * scoped to the teams that have actually appeared in matches for the
 * relevant league (bounding the candidate set to ~20 teams keeps false
 * positive collisions unlikely even with a fairly aggressive normalization).
 * A team that doesn't match is skipped for that standings poll — logged
 * clearly, not silently dropped — rather than risk creating a duplicate,
 * disconnected team row under the wrong provider's identity.
 */

const CLUB_AFFIXES = /\b(fc|cf|afc|ac|sc|cd|ud|sd|rc|calcio|club)\b/g;

export function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics (München -> munchen, not "munich" — see limitation below)
    .replace(CLUB_AFFIXES, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export interface TeamCandidate {
  id: string;
  name: string;
}

/**
 * Returns the candidate whose normalized name exactly matches, or null if
 * none does. Deliberately not fuzzy/distance-based — an approximate match
 * risks silently attaching a standings row to the wrong team, which is
 * worse than an honestly-missing row for one team this poll.
 *
 * Known gap, stated rather than hidden: this does not bridge translated
 * club names (e.g. football-data.org's "FC Bayern München" vs
 * API-Football's "Bayern Munich" — different words, not just an affix or
 * accent difference). Those teams' standings rows are skipped until a
 * proper alias table exists.
 */
export function findMatchingTeam(candidates: TeamCandidate[], targetName: string): TeamCandidate | null {
  const target = normalizeTeamName(targetName);
  return candidates.find((c) => normalizeTeamName(c.name) === target) ?? null;
}
