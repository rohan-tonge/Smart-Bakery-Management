# Phase 4 recipe history decision

Recipes are mutable operational definitions. Every successful recipe edit increments its `revision`; recipe ingredient lines are stored in the unit selected for the referenced ingredient when the recipe is saved.

Future production records must copy the recipe revision, product and variant identifiers/names, expected yield, preparation and production times, and each ingredient identifier/name/quantity/unit into an immutable snapshot on the production record. They must not recalculate historical batches from the current `Recipe` document. This phase does not create production records or a full recipe-version archive.

The recipe calculation API treats `quantity` as a count of recipe batches. It multiplies each ingredient quantity and expected yield by that count. It only reads data and does not adjust inventory.
