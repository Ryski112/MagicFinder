# MagicFinder

Finds the cheapest way for a buyer in New Zealand to acquire a list of Magic: The Gathering singles, accounting for postage, and shows how cost trades off against the number of stores ordered from.

## Language

**Want List**:
The cards the buyer wants, each with a quantity, as supplied to the tool.
_Avoid_: deck, decklist, cart

**Source**:
A website searched for stock (Fetch TCG, MtgSingles). A Source is where Listings are found, never who is paid.
_Avoid_: site, store, provider

**Store**:
The individual seller who takes payment and ships a parcel, with its own postage charge. One Source can surface many Stores; minimising Stores means minimising parcels.
_Avoid_: shop, vendor, seller account

**Listing**:
A specific Printing offered by one Store at a price, in a quantity and condition, found via a Source.
_Avoid_: offer, product, result

**Printing**:
A specific version of a card: its set, collector number and treatment (foil, showcase, etc.). The default choice is the cheapest Printing available.
_Avoid_: edition, version, variant

**Plan**:
An assignment of every obtainable Want List card to Listings, with its total Landed Cost and Store count.
_Avoid_: solution, basket, route

**Landed Cost**:
The total the buyer pays for a Plan: card prices plus each Store's postage.
_Avoid_: total price, cost

**Trade-off Ladder**:
The best Plan for each possible Store count (1 Store, 2 Stores, …), presented side by side so the buyer chooses how many parcels a saving is worth.
_Avoid_: options, results

**Not Found**:
Want List cards with no Listing at any Store; reported, and excluded from every Plan.
_Avoid_: missing, unavailable
