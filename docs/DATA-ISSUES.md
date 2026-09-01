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


## An invented recipeId is a constraint failure, not a display bug

The model is told never to use a recipeId outside the candidate list. When it
does anyway, the dish arrives with no ingredients, no preparation and no
compliance flags — which means it passed no diet, allergy, religion or fasting
check on its way in. Every other dish on the plate was verified in code before
the model ever saw it. Nothing filtered or flagged the invented one, so it sat
beside them as though it had been checked, and quietly shortened the shopping
list: a plan of five dishes whose list covered four, with nothing saying why.

`api/generate-plan.js` now retries once, naming the invented id and restating
that every dish must use an id appearing verbatim in the candidate list — the
same shape as the duplicate-role retry. If the retry invents again the dish is
dropped and `unknownNote` says so, in the role note's style and place. Nothing
unknown can reach Cook Mode or the shopping list, because nothing unknown
survives to the response; `known` on a returned dish is now always true, and is
kept only so the guarantee stays checkable.

Dropping every dish would leave a plan that is not a plan, and the client reads
a dishless plan as nothing to show. That case returns 502 rather than an empty
plan — see the empty-plan trace above.

Both events log under `[thali:unknown]`, so the rate is measurable in
production. Across the 27 plans generated live while building this — 92
distinct dish ids — the model invented **zero**. The handling exists because
the failure is severe, not because it is common.

Pinned by `test/unknown-recipe.test.js`, which stubs the model at the fetch
boundary so the retry is observed as a second real request: a good retry is
accepted with no note, a repeat offence is dropped with a visible one, an
all-invented plan is a 502, and a clean answer is never retried.


## Role gaps in the International v2 set - CLOSED

Four cuisines could not furnish a full meal shape: Indo-Chinese had no sabzi
and no bread at all, Italian no sabzi, and East Asian and Thai were thin at
two of one and none or two of the other. A cuisine with no bread cannot answer
a lunch brief that asks for one, and the model padded with whatever else was
in the pool.

20 records were appended - Indo-Chinese 8, Thai 5, Italian 4, East Asian 3 -
taking the catalogue from 1,444 to 1,464 and the v2 set from 350 to 370. Every
cuisine now has at least 3 bread and 4 sabzi.

Appended, never re-imported. `scripts/import-international-v2.mjs --additions`
reads only the `*_ADDITIONS.json` files and refuses on any id already present.
The default mode still drops and rebuilds every v2 row, which would regenerate
every note from `noteFor()` and silently undo `scripts/clean-flag-notes.mjs` -
so a full re-import must be followed by that script. Both scripts say so.

The Jain pools widened but the picker did not change, and the reason is worth
recording: `bread` is a singleton role, so Thai's two new Jain-safe breads
contribute one usable slot between them, not two. Indo-Chinese went from 0
usable Jain lunch dishes to 1 and Thai from 1 to 2, both still under the
3-dish floor at which a cuisine becomes offerable. A Jain guest is still told
those two cuisines cannot fill a lunch, which remains true.


## Worcestershire sauce is treated as non-vegetarian

Classic Worcestershire is fermented with anchovy. Vegetarian versions are
common in India, but the app cannot know which bottle is in a reader's
kitchen, so the sauce is treated as non-veg. It costs one vegetarian row -
BFP096 barbeque sauce, the only recipe in the catalogue that uses it - and the
alternative is serving fish to a vegetarian who bought the classic bottle.

Reversing it is deleting `worcestershire` from `MEAT_RE` in
`src/lib/mealPlanRules.js`.

No user-facing surface carries this today, and none can: the reason a recipe
was excluded is computed by `evaluateRecipe` and thrown away by
`filterRecipes`, so a vegetarian family simply never sees the dish and is
never told why. That is the right behaviour for now - the sentence has nowhere
to go that a reader would encounter it. It belongs in the "why this meal"
panel, where the exclusion reason for this row would otherwise read
"non_veg dish, Asha is vegetarian" against a barbecue sauce, which is
baffling without the explanation.


## Allergies: soy, dairy and sesame join nuts

The `allergens` column records soy, gluten, dairy, sesame, peanuts and tree
nuts, and until now nothing read it but the nut check. Soy, dairy and sesame
are now health options and guest restrictions, and `evaluateRecipe` runs one
allergen loop rather than a branch per allergen.

**The column alone is not enough, and this is the part worth remembering.** It
exists on 370 of 1,464 recipes — the International v2 import carries it, the
988 INDB rows and 106 Thali Originals do not. A check reading only that column
would clear every Indian dish for a soy-allergic member. So each allergen is
also matched by keyword, exactly as the nut check always was, and where a
compliance flag covers the whole catalogue it answers instead because it is
better than either: `lactoseFree` for dairy, on all 1,464 rows.

Keyword and column agree exactly where both exist — 129 soy rows and 53 sesame
rows either way — and the keywords add 28 INDB soy rows and 17 non-v2 sesame
rows the column cannot see.

Nut behaviour is unchanged: 0 of 1,464 recipes classify differently before and
after, and the negation scrub still clears "crunchy clusters type, without
nuts".

### Dairy allergy is not lactose intolerance

`lactoseFree: conditional` means the only dairy is butter or ghee. That is a
lactose-tolerance distinction — many lactose-intolerant people manage ghee —
and not an allergy one. A dairy-allergic member treats `conditional` as
containing dairy and the dish is excluded outright, not offered as a swap.
This falls out of the design rather than being special-cased: the flag answers
"does this contain dairy", and `conditional` means yes.

### Gluten is one option, not two

`glutenFree: conditional` in this data means one swappable product — soy sauce
for tamari — which is a real path to a safe dish rather than a hopeful one, so
it stays a swap suggestion with the note visible rather than becoming a hard
exclusion the way the other allergies do.

That is the whole behaviour, and `gluten_sensitive` already had it. A separate
`gluten_allergy` option was shipped for one deploy and removed: two options
reading the same flag and offering the same swap read as a bug the first time
someone ticks both and nothing changes. The survivor is relabelled
**"Gluten (coeliac / sensitivity)"** so it covers both self-descriptions, and
the guest list's `gluten_free` — which already mapped to `gluten_sensitive`,
and had quietly become a third door to the same room — is relabelled to match.

`gluten_allergy` stays mapped in `HEALTH_FLAGS` as a read path only. An
unrecognised health id is silently ignored by `memberConstraints`, so a family
who ticked the option during that one deploy would have their gluten filter
quietly dropped: 1,132 servable recipes instead of 657. Nothing writes the key
any more, so the line costs nothing and can never mis-filter.

### Pool sizes

Vegetarian member, no fasts, out of 1,132 servable recipes:

| allergy | recipes containing it | servable left | of which v2 | swaps offered |
|---|---|---|---|---|
| nuts | 191 | 973 | 331 | 0 |
| soy | 157 | 987 | 241 | 0 |
| sesame | 70 | 1,062 | 317 | 0 |
| dairy | 840 | 542 | 210 | 0 |
| gluten | 658 | 657 | 135 | 93 |

Only gluten produces swaps, which is the conditional handling above working.

The picker's pool warning fires where it should. East Asian falls to 1 usable
lunch dish under a soy allergy and 0 under a gluten allergy — not offerable
either way — while Indo-Chinese at 4 and Continental at 4 (dairy) get the thin
warning. The warning also names the allergy now: an allergy carries no
compliance flag, so without that it said a cuisine could not fill a lunch and
gave no hint why, which is the one thing it exists to do.


## Unrecognised member ids fail open — every kind of them

`memberConstraints` skips a health id it does not recognise. That does not
weaken a filter, it removes it, and nothing on screen says so. The same is true
of every other id a member carries. Measured against a vegetarian member on a
catalogue of 1,132 servable recipes, one character wrong in each:

| id kind | correct | typo'd | effect |
|---|---|---|---|
| fasting | 185 | 1,132 | **+947 recipes** on a fast day |
| diet | 472 | 1,132 | +660 (`jain` -> `jian` loses jainSafe and onionGarlicFree) |
| religion | 601 | 1,132 | +531 (`Buddhist` -> `Budhist` loses onionGarlicFree and alcoholFree) |
| health | 657 | 1,132 | +475 (a coeliac sees the whole catalogue) |
| allergy | 987 | 1,132 | +145 (`soy_allergy` -> `soya_allergy`) |

Fasting is the worst of the five: an unmatched fast id is filtered out against
the day's active list before it can require anything, so an Ekadashi observer
with a typo'd id gets an unrestricted catalogue on exactly the day it matters.

One thing does fail safe. `DIET_ALLOWS[member.diet] || ['veg']` falls back to
the strictest kind, so an unknown diet can never be served meat — it is the
diet FLAGS (`jainSafe`, `onionGarlicFree`) that go missing, not the vegetarian
gate.

**Fixed.** `src/lib/memberValidation.js` checks every id against the set the
app offers, and `memberConstraints` treats one it cannot read as the strictest
thing it could have been rather than as nothing at all:

| kind | correct | unreadable, before | unreadable, now |
|---|---|---|---|
| fasting | 185 | 1,132 | **refuses** |
| diet | 472 | 1,132 | 155 |
| religion | 601 | 1,132 | 601 |
| health | 657 | 1,132 | 185 |
| allergy | 987 | 1,132 | 185 |

An unreadable diet requires every diet flag any diet asks for, so it lands
stricter than Jain — the union includes `vegan`. An unreadable health id
requires every filtering health flag AND assumes all four allergies, since it
could have been any of them.

Fasting refuses, and it is the only kind that does. The others have a
meaningful strictest reading; fasting does not. Only Ekadashi and Navratri
carry a compliance flag at all, so requiring "both flags" would look like
caution while covering none of Ramadan, Paryushana or the weekly vrats the
member might have meant. There is no strict reading to fall back to, only a
guess, on the one day of the year it matters most. `generate-plan` returns 422
naming the member and the id.

Both screens say so: the Family Profile flags the member, and the plan header
repeats it, because that is where a narrower-than-expected meal would
otherwise look arbitrary. Non-blocking ids reach the client as
`unreadableSettings` on both the plan and the cuisine-options response.

Ids reach these functions from localStorage, so they outlive any deploy that
renames one. `src/lib/family.js` migrates renamed health ids on load and writes
the repaired roster back, which is why `gluten_allergy` could be deleted
outright rather than left mapped as an orphan.


## Gemini answers 503 under load

"This model is currently experiencing high demand" is a transient failure and
was surfaced as a dead end. Two mitigations, both client-side.

`MealPlan.jsx` retries a 502 or 503 three times, waiting 1s, 3s and 6s. A 4xx
is never retried — a 422 for an unreadable fast id says the same thing however
long you wait, and the retry would only delay the answer. The waiting screen
stays as it is and gains one quiet line after the first failure: "Model is busy
— retrying (2 of 3)".

The retry is here and not in `api/generate-plan.js` because the point is
telling the user what is happening between attempts, which only the client can
do. Keeping it on one side also means a bad minute costs 4 calls against the
free tier's 10 RPM rather than 16.

Each attempt has its own 40s ceiling and the sequence has a 90s budget, both
enforced through the same AbortController the effect cleanup uses. A request
that never answers was what turned a slow model into a frozen screen.

When every retry fails, `src/lib/planCache.js` offers the last plan that
worked for this exact combination — keyed by the same `planKey` the generation
effect uses, so it can only be offered for the meal type, cuisine and set of
diners it was made for. It is never handed over quietly: a banner says
"Couldn't reach the model. Here's the last plan we generated for this
combination (earlier today, 3:45 pm)" with a Try again button, and a "Saved
plan" chip sits beside the meal header for as long as it is on screen.

The cache stores at most six combinations and drops `alternates` first: a full
plan is 119 KB and 107 KB of that is twelve swap candidates per role, each
carrying its whole recipe. A cached plan is a fallback, not a working surface,
so it lands at 13 KB.

A 4xx never reaches the cache. Someone whose fast id cannot be read must see
that, not a stale plan standing in for it.


## Dessert: an optional course, not a widened pool

153 dessert-role recipes were reachable from no meal at all — lunch and dinner
do not admit the role, and no dessert name reads as breakfast. Adding `dessert`
to the lunch/dinner role list would have fixed the reachability and broken the
meal: a gulab jamun would compete with the dal for a savoury slot.

"Include a dessert" is off by default and adds exactly one dessert-role dish
alongside the meal. It is chosen in `api/generate-plan.js` rather than by the
model, which guarantees three things a prompt could only request: exactly one,
actually of the dessert role, and drawn from `mains` — the pool that has
already passed every diet, allergen, religion and fasting check the savoury
dishes passed. "The dessert passes every constraint the meal passes" is
therefore structural, not a second rule that could drift.

Its ingredients reach the shopping list and Buy-for by the same route as any
other dish, because it is simply another entry in `plan.dishes`.

### Two reasons it is withheld, and both are common

**Every one of the 26 International v2 desserts is `diabeticFriendly: no`.** One
diabetic member therefore removes dessert from all seven non-Indian cuisines,
and the toggle says so rather than greying out: "Every Italian dessert Thali
knows is high-GI, so none suits a member who needs low-GI food." The Indian
catalogue keeps 24.

**A fast day removes every non-Indian dessert**, because none is ekadashiSafe.
But it does NOT remove dessert altogether: 17 Indian sweets survive an Ekadashi
fast, and they are the ones made for it — Makhana Kheer, Sabudana Kheer,
Singhare Ka Halwa, Rajgira Ladoo. Offering one of those on a vrat is correct,
not a leak; the fast forbids certain ingredients, not sweetness.

`dessertAvailability()` never returns a bare no. It distinguishes "no such
dessert exists", "the fast rules them out", "they are all high-GI" and "none
fits today", because a greyed-out toggle teaches nobody anything.


## Dessert coverage gap: no low-GI or fast-safe international sweets

Two facts about the dessert set, both worth knowing before the next import.

**All 26 International v2 desserts are `diabeticFriendly: no`.** Not most —
every one. Tiramisu, churros, mango sticky rice, baklava, mochi. So a single
diabetic member removes dessert from all seven non-Indian cuisines at once, and
the toggle can only explain itself rather than offer anything. The Indian
catalogue keeps 24 of its 80 under the same constraint, because it contains
things like fruit chaat and roasted makhana that the v2 set has no equivalent
of.

**All 17 desserts that survive a fast are Indian.** Makhana Kheer, Vrat Wale
Chaawal Ki Kheer, Singhare Ka Halwa, Rajgira Ladoo, Peanut Ladoo (Vrat),
Sabudana Kheer, Shrikhand. Every international dessert is `ekadashiSafe: no`
and `navratriSafe: no`, which is correct — a tiramisu is not a vrat sweet —
but it means the fast-day dessert experience is Indian-only by construction.

Neither is a bug, and neither is worth patching in the data by hand: a
`diabeticFriendly` flag flipped without a recipe behind it would be a lie. The
fix is on the next dessert set, which should include some low-GI options —
a fruit-based dessert, an unsweetened or jaggery-sweetened one, something
portion-sized — so that "include a dessert" is answerable for a diabetic
member eating Italian or Thai.

Fast-safe international sweets are a harder ask and probably not worth
chasing: the fasting rules are Indian rules, and a cuisine that has no concept
of them has no dish that satisfies them. Indian-only on a vrat is the honest
answer.

## Only two of the fasting traditions narrow the dish pool

The "why this meal" panel made this visible, which is what it is for.

A member's active fasts are shown as a constraint everywhere — the fast banner,
the member chips, the panel's "what everyone needs today" — but only two of
them narrow anything. `fastFlags()` in `src/lib/mealPlanRules.js` maps a fast id
to a compliance flag by substring, and the recipe schema has exactly two:
`ekadashiSafe` and `navratriSafe`. Every other tradition — the weekly vrats,
Karwa Chauth, Chhath, Paryushana, Ramadan, Uposatha — reaches the model as
prompt context and reaches the family as a banner, but the deterministic filter
does not act on it.

Measured on a vegetarian member, the whole catalogue of 1,464:

| Active fast | Servable after filtering |
| --- | --- |
| Ekadashi Vrat | 185 |
| Mangalvar Vrat (Tuesday Fast) | 1,132 — the same as no fast at all |

The gap is a data gap, not a logic one, and it must not be closed by aliasing:
mapping a Tuesday vrat onto `ekadashiSafe` would apply the wrong rules under
the right name, and a Paryushana member is not served by being handed Navratri
food. The honest fix is per-tradition flags on the recipes, added by someone
who knows the tradition. Until then the panel reports what actually happened,
which is that the fast narrowed nothing — better than implying work that was
never done.

### Partly closed by per-person observance — 601, not 1,132

Per-person observance (`src/lib/observanceProfile.js`) narrowed the second row
without aliasing anything. Every vrat's baseline is `alliumScope:
'none_all_day'` — the strictest reading, and a true one: a vrat day is a
sattvic day — so a Tuesday-fasting member now contributes `onionGarlicFree`
and the same measurement gives 601 rather than 1,132.

### Closed by ingredient rules — FIXED

`src/lib/ingredientRules.js` gives a tradition keyword lists instead of a
tenth compliance flag, evaluated against the ingredient text by the PANTRY
matcher — `splitIngredients` → `parseIngredient` → `matchPantryLine`, the same
three functions in the same order that decide whether a family already has
something in the kitchen. No second matcher exists, which is what keeps
`potato` off `sweet potato`, `onion` off `spring onion`, and `salt` off
`sendha namak`.

Measured on a vegetarian member against 1,132 servable:

| tradition | before | after | what does it |
| --- | --- | --- | --- |
| Ekadashi | 185 | **177** | no grains, pulses, allium, vinegar |
| Navratri | 215 | **200** | the same rules |
| Paryushana | **1,132** | **460** | jainSafe + onionGarlicFree + alcoholFree, plus roots, brinjal, honey |
| Das Lakshana | **1,132** | **460** | the same rules |
| Sawan Somvar | 601 | **558** | leafy greens and brinjal, for the month |
| Jain diet, year round | 472 | **460** | the roots the flag alone missed |

Paryushana and Das Lakshana are the headline: they required nothing at all, so
a Jain member observing them was served exactly what an unfasting member was.

The gap is not fully closed. Ramadan, Karwa Chauth, Chhath, Uposatha and the
weekly vrats still have no ingredient rules, and the honest reason is the same
as before — writing them needs someone who knows the tradition, not someone
who can write a keyword list.

### Sendha namak is a swap, not an exclusion — and the measurement that decided it

"Only sendha namak" is the rule Ekadashi is best known for, and enforcing it
literally would have been wrong. Of 1,464 recipes:

| | count | source |
| --- | --- | --- |
| names sendha or rock salt | 19 | 100% Thali Original |
| says bare `salt` | 985 | overwhelmingly INDB |
| names another salt | 13 | mixed |
| no salt at all | 447 | mixed |

The split is a partition, not a tendency. Every recipe naming sendha namak is
hand-written; the bare-`salt` rows are machine imports whose ingredient
strings read `plain: 100g; salt: 0.17tsp` and `sunflower: 0.5tsp; salt:
0.25tsp; water`. That is a nutrition table listing sodium chloride as an
analysed component, not a cook choosing a salt — and of the 78 bare-salt
Ekadashi recipes, **none** names sendha namak in `preparation` or `tips`
either.

Excluding on bare `salt` would have taken the Ekadashi pool from 185 to 106,
and the demo family's from 83 to 24. So bare salt attaches a swap note — "use
sendha namak (rock salt)" — and only an explicitly named table or iodised salt
excludes. Honey splits the same way: `honey (optional)` and `honey or jaggery`
get a swap; Honey Noodles and Baklava do not.

### Turmeric and ginger are deliberately absent from the Jain rules

Both are underground and both are genuinely excluded fresh. But
`pantryIdentity('fresh turmeric').base` is `turmeric`, because the
canonicaliser strips `fresh` as a qualifier — correctly, everywhere else it
fires. So a `fresh turmeric` keyword matches the plain "turmeric" that means
powdered haldi, which Jain cooking uses freely, and it excluded **31** recipes
that were correctly flagged `jainSafe`.

**Do not special-case the canonicaliser to fix this.** A recipe that says only
"turmeric" carries no information about which one it means, and no matcher can
recover what the text does not contain; stripping `fresh` is right for every
other ingredient it touches. The keywords are dropped and the four recipes
where bare "ginger" really was the fresh root were corrected at the flag
instead. This paragraph exists so that a later "improvement" to the
canonicaliser does not quietly reintroduce 31 wrong exclusions.

## Nine compliance flags corrected — FIXED

Found by running the new ingredient rules against the flags and reporting
every disagreement. Each is a recipe whose flag said one thing and whose own
ingredient list said another; in these nine the flag was wrong.

| recipe | flag | was | evidence |
| --- | --- | --- | --- |
| ASC480 Vegetable soup | `ekadashiSafe` | yes | `Peas, fresh (Pisum sativum)` — a pulse |
| OSR056 Small onion pickle | `ekadashiSafe` | yes | `Shallots, raw` — allium |
| OSR056 Small onion pickle | `jainSafe` | yes | `Shallots, raw` — underground allium |
| OSR009 Semolina milk drink | `jainSafe` | yes | `Shallots, raw` |
| BFP264 Masala arbi | `jainSafe` | yes | arbi is a corm, and the dish is named for it |
| W008 Urad Dal Vada | `jainSafe` | yes | `ginger` |
| B014 Curd Rice | `jainSafe` | yes | `ginger (grated)` |
| D003 Moong Dal Chilla | `jainSafe` | yes | `ginger` |
| D006 Brown Rice Khichdi | `jainSafe` | yes | `ginger` |

The four ginger rows turn on a reading: unqualified "ginger" in an Indian
recipe is the fresh root, not dry sonth. Each correction carries its evidence
in the flag's own `note`, and `test/ingredient-rules.test.js` asserts the nine
stay corrected and stay explained.

### Eleven more, from the sweep — FIXED

The nine above were found one ingredient at a time. These came from asking the
question the other way round: not "what do the rules exclude?" but "what do
the FLAGS still pass?", swept systematically across four categories — pulse,
grain, allium, fermented — with a deliberately wider keyword net than the
rules enforce, against both `ekadashiSafe` and `navratriSafe`.

| recipe | flags | evidence |
| --- | --- | --- |
| N004 Samo Rice Pulao | `ekadashiSafe`, `navratriSafe` | `green peas` — a legume |
| ASC512 Plum chutney | `ekadashiSafe`, `navratriSafe` | `Vinegar` |
| ASC513 Raw mango chutney | `ekadashiSafe`, `navratriSafe` | `Vinegar, distilled` |
| BFP163 Green chilli sauce | `ekadashiSafe`, `navratriSafe` | `Vinegar` |
| BFP306 Jellied sunshine fruit salad | `ekadashiSafe`, `navratriSafe` | `Vinegar` |
| BFP310 French dressing | `ekadashiSafe`, `navratriSafe` | `Vinegar` |
| BFP312 Mayonnaise without eggs | `ekadashiSafe`, `navratriSafe` | `Vinegar` |
| OSR058 Pickled cabbage | `ekadashiSafe`, `navratriSafe` | `Vinegar` |
| ASC173 Cabbage and peas | `navratriSafe` | `Peas, fresh (Pisum sativum)` |
| ASC480 Vegetable soup | `navratriSafe` | `Peas, fresh` — its `ekadashiSafe` was corrected first |
| OSR056 Small onion pickle | `navratriSafe` | `Shallots, raw` — its `ekadashiSafe` and `jainSafe` were corrected first |

Nineteen flag corrections across eleven recipes. Vinegar goes for the same
reason allium does: it is fermented, and fermented foods are set aside on a
vrat under the sattvic reasoning. Green peas go because a legume is a pulse,
and N004 is the case that settles it — a hand-written Thali Original that
hedges on its own carrot ("use bottle gourd (lauki) cubed instead if strict"),
which is an author who knew the dish sat near the line. Either peas are vrat
food and ASC480 stands too, or they are not and both go. They cannot differ.

**The last three are the ones worth learning from.** Every earlier sweep
looked at `ekadashiSafe` alone, so `navratriSafe` was never audited — and an
onion pickle sat there flagged safe for Navratri, including on two recipes
whose *other* flags had just been corrected. A half-corrected recipe reads as
a considered one. The audit now runs over both flags and lives in
`test/ingredient-rules.test.js` rather than in somebody's terminal, so a
recipe added next month with a flag derived rather than considered fails the
build. It comes back clean at 181 `ekadashiSafe` and 204 `navratriSafe`
recipes, across all four categories.

No grain violation was found at any point, and nothing was found that the
shipped rules do not already exclude — the flags were the stale half, not the
rules.

### The standing principle: the rule wins, the flag gets corrected

Where an ingredient rule and a compliance flag disagree, the rule is right and
the flag is fixed — with the evidence written into the flag's own `note`, in
the format above.

This is not a preference for one mechanism over the other. A flag is an
annotation somebody made once, often derived rather than considered: seven of
the eight vinegar and peas rows are INDB imports whose flags were filled in
wholesale. A rule reads the ingredient list the recipe itself carries. When
they disagree, one of them is looking at the food.

The reason to *correct* rather than to leave the rule enforcing over a stale
flag: a standing disagreement is how a future reader concludes the flag is
authoritative. Someone will read `ekadashiSafe: yes` on a vinegar chutney,
find that the app never serves it, and conclude the filter is broken. Both
halves have to say the same thing.

## Fourteen dates fall a day apart between the eight cities

A tithi is the same instant everywhere; only the sunrise it is measured
against is local. Kolkata's is about fifty minutes earlier than Delhi's, and
that is enough to move an observance whose tithi boundary sits near dawn.

Measured across 352 observances, 2026 and 2027, all eight cities in
`panchanga/locations.js`:

| Delhi's date | observance | margin | falls elsewhere on |
| --- | --- | --- | --- |
| 2026-04-28 | Pradosh Vrat | 552 min | Kolkata, Chennai, Bengaluru, Varanasi: 04-29 |
| 2026-05-15 | Jain Chaturdashi | 16 min | Kolkata: 05-16 |
| 2026-06-03 | Sankashti Chaturthi | 319 min | Kolkata, Chennai, Bengaluru: 06-04 |
| 2026-06-12 | Pradosh Vrat | 554 min | Kolkata: 06-13 |
| 2026-07-10 | Yogini Ekadashi | 24 min | Kolkata, Varanasi: 07-11 |
| 2026-10-03 | Kalashtami | 23 min | Kolkata, Varanasi: 10-04 |
| 2026-11-20 | Devutthana Ekadashi | 39 min | Kolkata, Chennai, Bengaluru, Varanasi: 11-21 |
| 2026-12-23 | Purnima | 45 min | Kolkata, Chennai, Bengaluru, Varanasi: 12-24 |
| 2026-12-26 | Sankashti Chaturthi | 609 min | Kolkata, Varanasi: 12-27 |
| 2027-03-03 | Vijaya Ekadashi | 71 min | Kolkata, Varanasi: 03-04 |
| 2027-04-19 | Mahavir Jayanti | 10 min | **Mumbai, Ahmedabad: 04-18** |
| 2027-07-29 | Kamika Ekadashi | 7 min | Kolkata: 07-30 |
| 2027-09-30 | Sharad Navratri | 8 min | Kolkata: 10-01 |
| 2027-12-01 | Vinayaka Chaturthi | 340 min | Kolkata: 12-02 |

Twelve of the fourteen are Kolkata, the easternmost of the eight. Two move the
other way, in Mumbai and Ahmedabad, the westernmost — Mahavir Jayanti 2027
falls a day EARLIER there. No observance is present in one city and absent in
another; every difference is exactly one day.

Note that margin does not predict this. Four of the fourteen have margins over
five hours, which is not a tight boundary by any reading — the Pradosh and
moonrise rows are resolved at sunset and moonrise, and the margin measures a
distance to sunrise, which is not the quantity deciding them. That is the same
lesson the perturbation analysis taught in the verification report.

Three of the fourteen — 2026-07-10, 2026-12-23, 2026-12-26 — are already among
the five dates that move under a perturbed ephemeris. The other eleven are
stable in Delhi and simply different in Kolkata.

### The dates stay Delhi's; the family is asked

The app ships one precomputed table and a per-city recompute costs about a
second a year in the browser. More to the point, a date that silently differed
from the all-India panchang would be worse than one that asks. So the
generator records where each date moves to, and a family outside Delhi is
offered their own city's date beside Delhi's — through the same confirmation
prompt, in the same override slot, as the perturbation-unstable dates. There
is no second mechanism and no second source of dates.

`test/location.test.js` asserts the invariant directly: `observancesOn` takes
no location and must never learn to.

## Uposatha had a tradition row and no dates — the inverse of the others

`jain_chaturdashi`, `kalashtami` and `vinayaka_chaturthi` computed 100
occurrences between them across 2026-27 and could be selected by nobody.
Uposatha was the opposite: a selectable Buddhist tradition with **no engine
rule at all**, so it produced zero dates.

It needed no new astronomy. Uposatha is kept on the ashtami, purnima and
amavasya of each lunar month — four days — and the engine already computes all
four under other names. So the fix was a mapping, not a rule:

| engine observance | now also reaches |
| --- | --- |
| `masik_durgashtami` (24) | `uposatha_observance` |
| `kalashtami` (25) | `uposatha_observance` |
| `purnima` (25) | `uposatha_observance` |
| `amavasya` (25) | `uposatha_observance` |

That gives Uposatha 50 days in 2026, at the quarter-lunar-month rhythm the
tradition keeps, and it gives Durgashtami and Kalashtami somebody who can
select them.

**Uposatha is a mealCount, not a timing slot.** It was handed to the timing
work as one — "nothing after noon" — but that rule maps exactly onto WHICH of
the standard three meals are eaten, which `mealCount` already answers. Its
baseline is `before_noon`: breakfast and lunch stand, dinner is the meal that
goes. `two_meals` was the previous baseline and was wrong for exactly that
reason — it means breakfast and *dinner*.

What it does need is the cutoff computed. "Noon" here is madhyahna, the
midpoint between sunrise and sunset, which is 11:36 AM in Kolkata and 12:38 PM
in Mumbai on the same day. An hour apart, and a clock noon is wrong in both.

### Vinayaka Chaturthi and Jain Chaturdashi now have rows

The cost was one `masterIndex` row each plus one `OBSERVANCE_FASTS` entry —
small enough that leaving them unreachable was the stranger choice. Both also
took a baseline and a guidance entry; Jain Chaturdashi took the Jain ingredient
rules, which narrow it from 1,132 to 460 for a vegetarian.

`test/location.test.js` used to assert their unreachability with a note that
making one reachable should make it fail. It did. The assertion is now the
other way round: every observance that varies by city must be reachable by
somebody, or nobody is ever asked about it.

## Theravada intercalation is not modelled, and four dates depend on it

Vesak, Asalha Puja and Magha Puja are full moons, and Vassa runs three lunar
months from one. The engine resolves a purnima to the minute, so all four were
— or would have been — marked `computed`, the same confidence as an Ekadashi
checked 24 of 24 against Drik Panchang.

**That is not equivalent evidence, and the difference is not the astronomy.**
These are Theravada observances. The Thai, Burmese and Sri Lankan calendars
intercalate on a different rule from the Indian one: this engine implements
"a lunar month containing no solar ingress", while the Thai calendar inserts a
second Ashadha on a fixed cycle. Nothing in this repository models the
Theravada reckoning, so nothing has ever checked which month the engine's
Ashadha corresponds to in Bangkok or Colombo.

### The worked example: 2026

2026 carries Adhika Jyeshtha — an intercalary month sitting **immediately
before Ashadha**, which is the worst possible position for this.

| | Indian reckoning (what the engine gives) | a calendar that does not intercalate there |
| --- | --- | --- |
| Asalha Puja 2026 | 29 July | **roughly 30 June** |

A month apart, from one difference in an intercalation rule. Not the day-either-
side uncertainty that a tithi boundary produces — a different lunation.

All four are therefore `provisional`, carry `provisionalReason` on the row, and
are override-able through the same prompt and the same slot as the Islamic
dates. The structural cause is identical: a calendar the engine does not model
decides the real answer.

**Vesak was already shipping at `computed` before this.** It is the one that
mattered, because it was live data claiming evidence it did not have. A future
fix — modelling Thai or Burmese intercalation — addresses all four together;
they have one cause, not four.

### The derived dates, for the record

| | 2026 | 2027 | derived from |
| --- | --- | --- | --- |
| Magha Puja | 1 Feb | 20 Feb | Magha Purnima |
| Vesak | 1 May | 20 May | Vaishakha Purnima |
| Asalha Puja | 29 Jul | 18 Jul | Ashadha Purnima |
| Vassa | 30 Jul – 26 Oct | 19 Jul – 15 Oct | day after Asalha, to Ashwin Purnima |

Vassa comes out at 89 days in both years, which is three lunar months and is
the arithmetic checking itself. It is derived in the generator rather than
written as a tithi rule, for the same reason Sawan Somvar is: it spans lunar
months, and a tithi rule resolves one tithi inside one of them.

### A note on provenance

These three were not found in this repository, and no Buddhist date here was
ever marked MED. They were carried in from an external research document. The
only `MED` in the codebase is a source-confidence column in
`test/reference/ekadashi2026.js`, on Parama Ekadashi 2026-06-11 — a Hindu date
from a single source rather than a cross-checked one. Recorded so that nobody
later reads "the three MED-confidence Buddhist dates" as something that was
once true of this code.

### A long observance is context on its first day and noise after it

Vassa spans 89 days, and naming it in the meal-plan brief on every one of them
— to households with no Buddhist member — is a page the model reads past.
`calendarNotesOn` now takes the traditions actually kept at the table, and an
observance running two weeks or more has to be one of them to be mentioned.
Shorter ones are unfiltered, so Navratri and Paryushana behave as before.

## Fajr at 18 degrees, and the two other conventions

Maghrib is sunset and needs no convention. Fajr does: it is the moment the sun
reaches a stated depression below the horizon, and the stated angle differs.

| convention | angle | used by |
| --- | --- | --- |
| **18°** | what Thali will use | Umm al-Qura, MWL, the majority standard |
| 15° | ISNA (North America) | |
| 19.5° | Egyptian General Authority | |

The spread is real — 15° and 19.5° put Fajr about ten to fifteen minutes
either side of 18° in Delhi in February — and it decides when suhoor ends. It
will be printed as a stated assumption beside the time rather than hidden,
the same way the two-meals guess is printed on the who-is-eating screen.
Recorded here now so that the choice is a decision on the record rather than
whatever the first implementation happened to pick.

## Lent, Easter and a religion the app does not offer

The premise is every religion, and Christianity has no option. `RELIGIONS` is
`Hindu, Jain, Muslim, Sikh, Buddhist, none`; the tradition database has zero
Christian rows; no member can select one.

The dates already exist and nothing consumes them. `panchanga/computus.js`
exports `easter` and `christianDates`, and the verification report checks
Easter 2026 and 2027 against known values and passes. Lenten Friday, Ash
Wednesday and Good Friday would need a religion option, tradition rows, food
rules and calendar wiring.

Ingredient rules for those were written and measured — no meat, mammal or
poultry, fish permitted; it removes 27 of 1,464 for a non-vegetarian — and
then deliberately NOT shipped. Half of a religion is worse than none of it: a
family would find Lenten food rules with no way to say anyone is Christian.
This is its own step.

## "Why this meal" is explanation, not advice

The panel restates settings the family entered ("Sumitra needs low-GI food")
and describes food ("contains unsalted butter"). It makes no claim about anyone's
health, recommends nothing, and repeats the plan's disclaimer at its foot. The
wording comes from `FLAG_PHRASE` and `DIET_PHRASE` in `mealPlanRules.js` — if a
new flag is added without a phrase there it falls back to `needs <flagKey>`,
which is a flag key on screen and should be caught in review.

Counts in the panel are real totals; the dishes under each are a sample of three,
spread evenly across the group so the sample is not all one source. The sampling
is documented in `src/lib/explainPlan.js` and pinned by `test/explain-plan.test.js`.
