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

## International set: one ingredient string copied across a dish family

95 international recipes carry only **66 distinct ingredient strings**. 15 of
those strings are shared by two or more recipes, covering **44 recipes (46% of
the set)**. The string appears to have been written once per dish *family* and
copied to every member.

This is **not** a row/column misalignment. On INT034 and INT035 every other
field is correct for the dish — name, category (`Snack`), region
(`Continental`), serves, and all eight compliance flags. Only `ingredients` is
wrong. So a repair cannot be done by shifting a column back.

**9 of the 15 shared groups mix declared dietKinds**, which is where it turns
into a safety problem: the group's single string was usually written for the
non-vegetarian member.

| shared string | members |
|---|---|
| `chicken breast, herbs, butter/olive oil, pepper sauce` | **INT034 Grilled Cheese Sandwich (veg)**, **INT035 Bombay Grilled Sandwich (veg)**, INT042 Grilled Chicken Steak (non_veg) |
| `flat rice noodles, tamarind, peanuts, bean sprouts` | INT048 Thai Red Curry (veg), INT049 Thai Green Curry (veg), INT050 Thai Green Curry Chicken, **INT052 Thai Jasmine / Sticky Rice (veg)**, INT051 Pad Thai (veg), INT053 Pad Krapow |
| `bun, veg/aloo/chicken patty, …` | INT031 Veg Burger, INT032 Chicken Burger, INT033 Aloo Tikki Burger |
| `Hakka/egg noodles, …` | INT001 Veg Hakka Noodles, INT002 Chicken Hakka Noodles, INT011 Schezwan Noodles |
| `penne/spaghetti/fusilli; white sauce = …` | INT020–INT023 (4 veg pastas), INT024 Chicken Alfredo |
| `cooked basmati/long-grain rice, mixed veg, …` | INT003, INT004, INT015 (veg), INT005 Chicken Fried Rice |
| `roti/tortilla, paneer or chicken filling, …` | INT036 Veg Frankie, INT037 Chicken Wrap |
| `maida wrapper, cabbage/carrot/paneer or minced chicken, …` | INT013 Veg Momos, INT014 Chicken Momos |
| `pizza base (maida) …` | INT017, INT018 (veg), INT019 Chicken Pizza |

**17 veg-named dishes carry an ingredient string containing a meat word.**

Two grouping errors stand out because the shared string is not even generic
enough to cover the family:

- **INT034 / INT035** were grouped with INT042 *Grilled Chicken Steak* —
  apparently on the shared word "Grilled". Two grilled sandwiches inherited the
  steak's ingredients verbatim.
- **INT052 Thai Jasmine / Sticky Rice** inherited Pad Thai's string, so a rice
  dish lists `flat rice noodles, tamarind, peanuts, bean sprouts` and no rice.

The `dietKind` fix (commit b43c643) contains the safety consequence — these
dishes now resolve to `non_veg` and a vegetarian cannot be served them — but at
the cost of removing genuinely vegetarian dishes from the pool on the strength
of an ingredient string that was never theirs. The set needs replacing with
per-dish ingredients; see also the zero-quantity problem below.

## International set: no quantities at all

Across the 95 international recipes, **0 of 459 ingredient entries carry an
amount** (Thali Original: 1034/1094; INDB: 9912/9915). All 95 therefore produce
an unshoppable list. 11 contain vague catch-alls (`herbs`×6, `sauces`×2,
`spices`×2, `broth`×2, `veg`, `assorted veg`, `veg/herbs`).

These are one-line menu descriptions in a recipe-shaped field, not thin recipes.
