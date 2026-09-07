# Test place packs

`synthetic-town.json` is **deliberately synthetic**. It is not a real town, not a
deployment target, and nothing in it is a claim about anywhere.

It exists so the test suite can drive a *second* pack through the same code that
serves Davis. Its geography is a made-up rectangle far from Davis, chosen so that a
point valid in one pack is invalid in the other — which is what makes "the map is
parameterised over its town" a checked fact rather than a claim. It also overlaps
its own two areas on purpose, so the ordered-boxes rule is exercised by more than
the shipped pack.

Adapting the map to a *real* second town is not a code change and is not this file:
it needs a named moderator roster and a privacy review first. See
[`docs/ADAPTING-A-TOWN.md`](../../../docs/ADAPTING-A-TOWN.md).
