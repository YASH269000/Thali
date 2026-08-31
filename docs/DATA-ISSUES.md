# Known data issues in `src/data/recipes.json`

Recorded, not fixed. Each is handled at the display layer so the app behaves
correctly today; the entry stays here until the source data is corrected.

## Cross-reference recipes (5)

Five Thali Originals carry a pointer to another recipe as the **entire**
contents of both `ingredients` and `preparation`, while `hasFullPreparation`
is `true`:

| id | dish | points at |
|----|------|-----------|
| W001 | Sabudana Khichdi (Monday) | E001 |
| F006 | Eid Sheer Khurma | R010 |
| F010 | Ganesh Chaturthi Puran Poli | J014 |
| D002 | Methi Thepla (Diabetic) | J007 |
| N006 | Sabudana Vada | E008 |

`src/lib/recipeRefs.js` follows the pointer when a plan is built, so the
shopping list and Cook Mode both use the target's real content. Filtering the
line out instead would have left these dishes contributing nothing at all.

The proper fix is to inline the referenced content into each row, keeping the
modification note as its own field.

## D002: the two fields disagree about the substitution

`D002` (Methi Thepla, Diabetic) borrows `J007` (Methi Thepla, Jain), which
contains `1 tbsp jaggery`. The two fields do not agree on what to do about it:

- `ingredients`: "substitute jaggery with **1 tsp** stevia"
- `preparation`: "skip jaggery entirely, or replace with stevia (**1/2 tsp**)"

Thali shows both verbatim and applies neither, because choosing one would
invent an amount the data does not contain. The shopping-list line for jaggery
is marked inline rather than silently resolved — this is a diabetic dish, and a
jaggery line that reads as an ordinary purchase is the failure that matters.

`api/generate-plan.js` logs this at startup with the `[thali:data]` prefix.

The proper fix is to decide the correct amount and make both fields say it.
