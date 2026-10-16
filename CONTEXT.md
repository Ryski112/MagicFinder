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
The individual seller who takes payment and supplies the cards, either by shipping a parcel (with its own postage charge) or by the buyer picking up in person. One Source can surface many Stores; minimising Stores means minimising the separate sellers the buyer deals with. Pickup is never assumed: a Store is costed with postage unless the buyer has chosen pickup for it.
_Avoid_: shop, vendor, seller account

**Listing**:
A specific Printing offered by one Store at a price, in a quantity and condition, found via a Source.
_Avoid_: offer, product, result

**Printing**:
A specific version of a card: its set, collector number and treatment (foil, showcase, etc.). The default choice is the cheapest Printing available.
_Avoid_: edition, version, variant

**Locked Printing**:
A Want List line the buyer has pinned to one exact Printing, including its finish; only Listings of that Printing can fill it. An unlocked line accepts any eligible Printing of the card, mixed freely.
_Avoid_: preferred printing, chosen version

**Plan**:
An assignment of every obtainable Want List card to Listings, with its total Landed Cost and Store count.
_Avoid_: solution, basket, route

**Landed Cost**:
The total the buyer pays for a Plan: card prices plus each Store's postage.
_Avoid_: total price, cost

**Trade-off Ladder**:
The best Plan for each Store count, from the fewest Stores that can supply every obtainable card up to the Store count of the cheapest Plan overall, presented side by side so the buyer chooses how many Stores a saving is worth. Each rung is the cheapest Plan using exactly that many Stores; a rung that saves nothing over the one below it is not shown.
_Avoid_: options, results

**Not Found**:
Want List cards with no Listing at any Store; reported, and excluded from every Plan.
_Avoid_: missing, unavailable
