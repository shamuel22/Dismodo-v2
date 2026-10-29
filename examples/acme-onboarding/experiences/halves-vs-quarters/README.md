# Halves vs quarters — `halves-vs-quarters@1.0.0`

A variant package by Acme Onboarding, a workplace training product. It uses the
same registered activity and evaluator as the reference package
(`set-selection.v1` with `fraction-of-set.v1`) and needs no engine changes. What
changes is the objective and the condition: instead of marking one quarter of a
set, the learner is shown a set with some items already marked and must
identify whether the marked part is one half, one quarter, or three quarters.

## What it teaches

Skill `halves-and-quarters` ("Halves and quarters of a set"): given a total and
a marked count, split the whole into 2 or 4 equal groups and name the marked
part as 1/2, 1/4, or 3/4. Equivalent answers are accepted by the evaluator, so
2/4 counts as one half and 2/8 counts as one quarter. Prompts state the total
and the marked count only; they never name the fraction, because naming it
would give the answer away.

The session starts with an unassisted baseline item, then short practice, then
independent items drawn from the reserved checks (8 minutes, at most 2 hints
per item). Totals run from 8 to 48, which leaves a large practice pool after
the 3 reserved checks are held out.

## Contexts, and why each one exists

All three contexts share the nouns `whole`, `item_singular`, `item_plural`,
and `state`, so the reviewed explanations and hints can be reused across them.

- **Shift roster** (shifts marked as covered): new starters read rosters early,
  and "half the shifts covered" is a phrase they will meet in week one. The
  limit notes that real shifts differ in length, so the fraction counts shifts,
  not hours.
- **Parcel delivery** (parcels marked as loaded): warehouse onboarding talks
  in fractions of a delivery. The limit notes that parcels differ in size and
  weight, so the fraction counts parcels, not space or weight.
- **Onboarding checklist** (steps marked as completed): every new starter has
  one, and progress is often described as half or a quarter done. The limit
  notes that steps differ in effort, so the fraction counts steps, not time.

Each scenario states the total and how many are marked, and asks which
fraction is marked. No scenario names the fraction itself.

## Confusions, and why each one exists

Confusions use only the error codes the evaluator reports for identify items.

- **Chose the unmarked part** (`chose_complement`): the learner names the
  fraction of the part left unmarked, for example three quarters when one
  quarter is marked. This is the central risk of an identify task, so the
  suggested response is a `contrast` between the marked and unmarked parts,
  backed by `essential`.
- **Wrong number of equal parts** (`wrong_numerator`): the grouping into
  quarters is right but the count of groups taken is wrong, for example two
  quarters for a three quarters marked part. A `worked-example` that counts
  groups of the marked part addresses it directly.
- **Fraction does not match the marked part** (`wrong_fraction`): the chosen
  fraction groups the whole differently, for example one quarter for a marked
  half. This points back to the key idea, so `essential` and `worked-example`
  are suggested, with `contrast` to separate halves from quarters.

Allowed interventions are `essential`, `worked-example`, and `contrast`
(reviewed editorial content is included for each), plus the engine-run
`swap-context` and `fade-support`, which need no editorial text.

## Validate and import

From the worktree root, validation runs offline and also runs the package
tests (7 tests: correct choices for 1/4 and 3/4, equivalent fractions 2/4 and
2/8, and one test per confusion code):

```sh
pnpm install --offline || pnpm install
pnpm dismodo validate examples/acme-onboarding/experiences/halves-vs-quarters/experience.json
```

A valid run prints that the file "is a valid package", with all tests passing,
3 reserved checks, and the practice pool left after holding them out.

Import is a separate step against a running API. It creates an immutable draft
version; publishing stays a reviewed step after import:

```sh
DISMODO_API_KEY=your-key pnpm dismodo import examples/acme-onboarding/experiences/halves-vs-quarters/experience.json
pnpm dismodo publish halves-vs-quarters@1.0.0 --reviewer "your name"
```

Import is idempotent for identical content and rejects a different package
under the same `halves-vs-quarters@1.0.0` version.
