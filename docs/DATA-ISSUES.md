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

## International v2: the compliance flags carry no note text

The seven `thali_international_v2_*.json` files give each of the nine
compliance flags as a bare string — `"glutenFree": "conditional"` — while the
app's `flags` object is `{ status, note }` and the note is user-facing. It is
the swap instruction on a `conditional` dish, the caution on a `partial` one,
and the reason a member was excluded from a dish.

`scripts/import-international-v2.mjs` therefore **synthesises** all 3,150
notes from the recipe's own ingredients and `allergens` column. Nothing is
invented about the food: a `no` on `vegan` names the dairy the recipe really
lists, a `conditional` on `glutenFree` names the soy sauce it really contains.
But the wording is Thali's, not the dataset's.

The proper fix is a note column in the source files.

The synthesis is uniform where the data is uniform, which is worth knowing:

- `glutenFree: conditional` is soy sauce in 82 of its 83 records, so 82 dishes
  carry the same "use tamari" swap.
- `lactoseFree: conditional` is butter in all 13.
- `diabeticFriendly: partial` covers 257 of the 350 records and gets one
  generic portion caution, because the data holds no GI or carbohydrate figure
  to say anything sharper.

## International v2: composite recipes are matched by name, not by id

18 ingredient lines say "(see recipe)" outright; another ~45 name a sub-recipe
with no marker at all ("2 cups marinara sauce", "12 corn tortillas"). Neither
form carries the target's id.

`resolveComponents()` in `src/lib/recipeRefs.js` matches a closed list of 16
phrases against recipe names within the same cuisine. Two consequences:

- A sub-recipe outside that list is not followed. The list was built from the
  ~63 links that exist today; a re-import that adds a new composite dish needs
  a new entry.
- `Refried Beans (frijoles refritos)` is `role: sabzi`, not an accompaniment or
  snack, so matching runs across every role rather than only those two.

Quantities are the other half of this. A recipe asks for "3 tbsp curry paste"
and the paste recipe states no yield, so a batch is folded in, scaled by the
parent's own diner factor. That over-buys for a spoonful, which is why the
shopping list names every sub-recipe it folded in rather than letting the extra
lines appear unexplained. A yield field on the component recipes would fix it.

The "Buy for" control has to know about this. A batch already covers more than
one meal, so amounts that arrived from a component are held out of the 3-day
and 1-week multipliers — `buildShoppingEntries` tags them and each bucket
carries `{ total, fixed }`, where `fixed` is the component's share.

The interaction is messier than it sounds, and the number is worth recording:
**24 of the 42 composite dishes produce at least one mixed row — 55 rows in
total** — where one ingredient reaches the row from both the dish and its
sub-recipe's batch. Garlic in a lasagne comes partly from the lasagne and
partly from the marinara. Freezing the whole row would silently under-buy the
dish's own share, so only the component's share is held: Buy is
`fixed + (total - fixed) x multiplier`.

## Gelatine in INDB desserts — FIXED

35 INDB rows list `Gelatine`. `MEAT_RE` did not match it, so `dietKind()`
called 12 of them `veg` and they could reach a vegetarian, Jain or vegan
member; the other 23 were held back only by their egg content, so an
eggetarian could still be served them.

`gelatin`, `gelatine`, `isinglass`, `lard`, `tallow`, `suet` and
`worcestershire` are now in `MEAT_RE`. 37 rows re-classify, 13 of them out of
`veg`. No International v2 row changes.

One judgement call worth knowing: **Worcestershire sauce** (BFP096 Barbeque
sauce, 10 ml) contains anchovy in its classic form, but vegetarian versions are
widely sold in India. Thali excludes it, because for a safety net the cost of
being wrong in one direction is a barbecue sauce and in the other is serving
fish to a vegetarian. Remove `worcestershire` from `MEAT_RE` to reverse that.

The full audit — every recipe resolving to `veg`, checked against gelatine,
rendered fats, fish and shellfish, flesh and other animal derivatives, across
name, ingredients and preparation — comes back clean at 1,444 recipes.

Absence statements are handled alongside, in the words the files use:
"No lard — oil only" (MX035), "No fish sauce or shrimp" (EA043), "No shrimp
paste" (TH041). Without `MEAT_NEGATION_RE` those three would have been hidden
from vegetarians by sentences saying they are safe.


## Eligible dishes are not servable dishes

`internationalCuisineOptions()` used to count every recipe that passed the
dietary filter and fitted the meal type. That number is not what reaches the
table, and the gap is wide enough to make the picker wrong.

For a Buddhist member, Indo-Chinese had 4 eligible lunch dishes — two soups, a
pickled vegetable and a green tea. The plan came back with two. Both losses are
structural:

- `QUOTAS.lunch` has no `beverage` key, so the tea was never sampled;
- `soup` is a singleton role, so the second soup had to be dropped.

The count is now taken the way the planner builds — roles with no quota for
this meal type excluded, singleton roles capped at one — and both `available`
and the thin-pool warning are judged against it. `eligible` is still reported
alongside for transparency. Predicted and actual dish counts now agree: Jain
guest on Italian predicted 3 and returned 3; Buddhist on East Asian predicted 5
and returned 5.


## A parenthetical is usually a step, sometimes the product

`"Tomatoes (chopped)"` and `"Tomatoes"` are one purchase; `"Coriander (ground)"`
and `"Coriander leaves"` are two. Both `ingredientIdentity` (which the
shopping-list dedupe keys on) and `pantryIdentity` used to drop every
parenthetical before deciding what a thing was, so the second pair looked
identical to the first.

`stripNonIdentityParens()` now keeps a parenthetical whose every word is a
product word — ground, powdered, dried, dry, tinned, canned, frozen, smoked,
desiccated, flaked, with sun-/freeze- style modifiers allowed. Anything else is
still discarded, so the prep note survives.

The "every word" test matters. Removing the prep words first and judging what
was left was tried and is wrong: `"(grated and squeezed dry)"` reduces to
`"dry"`, which reads as a product and would have stopped
`"Potatoes (grated and squeezed dry)"` matching Potato.

Three names in the catalogue carry a product parenthetical — `Rose petals
(dried)`, `Sichuan peppercorns (ground)`, `Roasted peanuts (ground) or smooth
peanut butter`. None currently shares a list with the plain form, so the
rendered shopping list is unchanged (verified byte-for-byte over 5,932
generated lists). The dedupe had the identical hole and is fixed by the same
helper.

One asymmetry worth knowing: `Sichuan peppercorns (ground)` is now a different
identity from `Sichuan peppercorns (toasted and ground)`, because the second
mixes an instruction in and so reads as a step. Defensible — "(ground)" alone
can mean buy it ground — but it is a distinction the source data did not
intend to draw.


## Flag notes were written in the nutrition table's dialect

`flags[*].note` is the sentence a family reads when Thali explains why a dish
does or does not suit them. The INDB notes named their ingredients the way
ICMR-NIN names them:

    No (Carrot, orange (Daucus carota), Onion, big (Allium cepa),
        Potato, brown skin, big (Solanum tuberosum))

`scripts/clean-flag-notes.mjs` rewrote 4,920 notes — statuses untouched, and it
throws rather than writing if one moves. That line now reads
`No - contains carrot, onion and potato`.

The ingredient names are recovered by matching each note against the recipe's
OWN ingredient list, not by splitting on commas. An INDB name contains commas
of its own ("Chicken, whole, corn-fed, raw, meat and skin, weighed with bone"),
so no comma reliably separates one ingredient from the next; matching against
the source list parsed all 3,636 of them with nothing left over.

Also done: 1,023 notes that only restated their status were blanked - the 700
templates saying a cuisine "falls outside the Ekadashi fasting rules", which
tell a reader what the cuisine label already did, and 323 bare "No"s that gave
no reason at all. The 4,832 bare "Yes" notes are deliberately left: a redundant
"Yes" is harmless, while a bare "No" invites "why not?" and answers nothing.
And 261 International v2 Jain notes called onion and garlic root vegetables;
they are bulbs, excluded under a different rule, and are now simply named.

**None of this renders yet.** Only `conditional` notes (through
`possibleSwaps`) and `diabeticFriendly: partial` notes (through
`dish.caveats`) reach the screen today; `evaluateRecipe` computes the reason a
recipe was excluded and `filterRecipes` throws it away. Those reasons are the
material for a "why this meal" panel, which is why they are worth having in
readable shape first.

`diabeticFriendly: partial` is untouched. 257 records share one generic
caution because the data carries no GI or carbohydrate figure to say anything
sharper, and inventing specificity would be worse than repeating a true
sentence. It belongs to the health-conditions data regeneration.


## INDB sampling words on the shopping list

`cleanIngredientName` already dropped the lab qualifiers it knew about, but not
all of them, so a shopping list said "Orange carrot", "Bulbs and tops spring
onions" and "Breast skinless chicken". 16 ingredient names now read as food:
1,192 lines across 936 of the 5,932 generated lists in the regression set.

Colour is kept wherever it is load-bearing. It is dropped only through
`NOISE_FOR_HEAD`, on the four heads where INDB records the one colour the
vegetable comes in — carrot, pumpkin, cucumber, gourd. "Green chillies" and
"Red chillies" are untouched, because there the colour is the whole
difference.

This merges seven identity keys that were separate only because of the
qualifier: INDB's carrot with the International v2 carrot, its cucumber with
theirs, and so on. All seven are the same vegetable and should always have been
one line. Nothing splits, and the pantry matcher is unchanged — 51 cases pass
and the full sweep is identical at 207 pairs / 3,674 lines.

One word was tried and backed out. Adding `white` to `SUFFIX_QUALIFIERS` tidies
"White egg" into "Egg white", but it also turns "Pepper, white" into "Pepper
white", which splits it from the "white pepper" the International v2 records
write and breaks the pantry chip that matches them. A tidier egg is not worth a
spice that stops matching itself, so "White egg" stays.

Still ugly, and left alone: "Breakfast cereal, crunchy clusters type, without
nuts, unfortified" reads as "Crunchy clusters type without nuts breakfast
cereal". Dropping `unfortified` moved it from three trailing qualifiers to two,
which is the threshold at which qualifiers move in front of the head instead of
staying in source order. It affects 20 lines and the fix is a change to that
threshold, which would churn names this cleanup has no other reason to touch.


## `ingredientsAggregated` looks redundant and is not

The shopping section's visibility is gated on `plan.ingredientsAggregated`,
while the rows inside it are rebuilt in the browser from `plan.dishes`. The
field's strings are never rendered, so it reads as dead weight — and deleting
it would silently delete the entire shopping section.

The two answer different questions, which is the whole point:

    plan.ingredientsAggregated   did this meal need anything at all?
    shopping.rows                what is left after the pantry?

Only the unfiltered list can answer the first. Collapsing them into one test
would make "Everything is already in your pantry" unreachable: a family who
owns every ingredient would get no section rather than the one message that
tells them they are done.

Pinned by `test/shopping-visibility.test.js`, which asserts the section is
hidden — not blank — when a meal needs nothing, and visible with the pantry
message when the pantry covers everything. The tests assert the data
conditions the JSX guard reads rather than the JSX itself; there is no DOM
renderer in this project, and the conditions are where the meaning lives.

`npm test` runs them through node:test. No test dependency was added.
