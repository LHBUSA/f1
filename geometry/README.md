# Circuit geometry

Derived from OpenStreetMap raceway ways by `scripts/circuit-geometry.mjs`.

**Licence:** Open Database License (ODbL) 1.0. © OpenStreetMap contributors — https://www.openstreetmap.org/copyright.
This directory is a Derivative Database under the ODbL and is offered under the same licence. Every file records the
OSM way ids it was built from, the lap length check against the published length, and how direction, timing line and
corner numbering were decided (`direction_basis`, `timing_line.basis`, `corner_numbering`).

Street circuits raced over public roads (only fragments tagged `highway=raceway`) are built from the OSM circuit relation
(`type=circuit`, recorded as `osm_relation_id`): its member ways are the lap, `role=pitlane` the pit lane and the `finish`
member node the timing line. Race direction comes only from `highway=raceway` oneway tags (a road's oneway is its traffic
direction). Where the ingested circuit row describes an older layout, `layout_basis` records the current configuration
and the published length the loop was checked against (e.g. Marina Bay since 2023).
