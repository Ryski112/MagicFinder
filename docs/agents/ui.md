# UI: layout rules and the owner's corrections

The owner judges UI by **parity** with the By Store Plan, which is the house style. A new view or control copies its look before it invents one. Each rule below was settled in review, most of them by the owner correcting a design. The log at the end records those corrections, so the next design starts where the last one finished.

## Building blocks

These live in `src/web/components/ui.tsx`. Reuse them so every view stays in step:

- `HoverCard`: a small card that shows the large one beside it on hover.
- `PriceAndListing`: the end of a line, made of `PriceCell` and `ListingButton`.
- `ListingButtonSpace`: puts a header's figure over the prices of the lines below it.
- `ActionsToggle`: the round ›.
- `PreferButton` / `Star`.
- `printingsLabel`.

## A line

A line is one card or Listing in a section: By Store, By card, or Browse by Store.

- **Left to right:** the small card (`HoverCard`), qty ×, name, tags, the Printing label under the name, the ›, then **price and yellow View listing at the very right**, always in that order.
- **Fixed-width price:** the price has a fixed width (`w-24`) so the › buttons form one straight column down a list.
- **Actions:** a click anywhere on the line opens its actions, as the › does. The actions open under the line.
- **Closing:** closing the actions also closes whatever they opened (Printings, other Listings). The buyer never needs two clicks to clear the view.
- **Counts:** say the count on the button: "46 Printings", "156 other Listings". The owner prefers this to "Other Printings" because it tells the buyer more. Count only what is true: identified Printings, not unidentified Listings.

## A section

A section is a Store in the Plan, a card in By card, or the open Store in Browse by Store.

- **Header:** a tinted bar. On its right, in this order: Exclude Store, I'll pick up, Prefer, the in-app action (indigo, e.g. "Plan these cards from here"), then the Store's cart button (yellow).
- **Header buttons:** they share one centre line. A note that belongs to a button ("replaces your … cart") goes on its own line under the whole row, never in a column with its button.
- **Totals:** a 230px column on the right (Cards, Postage, Store total). Labels in it may wrap, and amounts never do (`shrink-0 whitespace-nowrap`).
- **By card:** the card's actions open under the whole box, below all its lines, not per Listing.

## Colour

- **Yellow (`accent`):** going to a Store: View listing, Add all to cart, Open N Listings.
- **Indigo (`primary`):** an action inside MagicFinder. When both sit in one header, the in-app one is indigo, so there is only one yellow button.
- **Gold star:** marks a favourite (a preferred Store), filled gold when on.

## States

- **Show a state, don't hide its control:** when a control doesn't apply, show it disabled with a tooltip saying why. For example, a preferred Store's pickup toggle stays on and locked, and says the buyer is collecting it. The owner reads a control that vanishes as a bug.
- **Open the first item:** a view opens on its first item (the first Store in Browse by Store), so the buyer is never greeted by an empty page.
- **Say why something failed:** a failure says why, per item. A cart line the check couldn't confirm names the reason (page gone, Store busy, no matching version).

## Grids and big cards

- **Grids wrap and scroll down**, never sideways. This came from the card searcher, and Printings grids follow it too.
- **Big cards never cover what the buyer is reading:** a hover card opens beside its small card. In a dropdown that already spans the page, the big card sits in its own column (the card searcher).

## Widths

Check every layout at 375, about 815, 1024 and 1400px before presenting it. The owner tests narrow windows and phones.

- **Size by the panel:** a panel that sits beside a list is sized by its own width (`@container` and `@3xl:`), not the window's. A wide window does not make it wide.
- **Fold side lists below 1024px (`lg`):** at 768px the panel beside a 300px list was already too narrow. Folded, the list becomes a bar naming the open item, with "Change Store".
- **Narrow lines:** View listing goes under the price on a narrow screen, so the name keeps its room.

## Working with the owner

- **Prototype a new look first:** run the `prototype` skill, which puts variants on the real page behind `?variant=`. Commit them to `prototype/<name>`, add the owner's verdict as a commit there, and point to that branch from the spec.
- **Expect rounds:** after a variant wins, the owner refines it over several rounds of annotated screenshots. Each round is small. Check alignment, closing behaviour and narrow widths before presenting, because those are what the rounds caught.
- **Agree before you add:** when the owner asks for "parity", confirm whether they mean the look or the mechanics. They can differ when the unit differs, as with Listing and card.
- **Check the ports:** before `preview_start`, check that ports 5180 and 5191 are free (`ss -ltnp`). An older dev server from another session may hold them. It serves the same checkout, but its logs aren't yours.

## Corrections log

Each entry is a design the owner changed, whether it was already in the app or an agent had just presented it. Date, then what changed and the lesson.

- **2026-10-23 · View listing:** it was a small blue link. The owner wanted it as the yellow button, like the cart. *Lesson:* actions that leave for a Store all look the same.
- **2026-10-23 · Price position:** the actions and Printings button sat to the right of the price. The owner wanted price and View listing always at the very right. *Lesson:* the end of a line is fixed. Controls go before it.
- **2026-10-23 · Empty first page:** Browse by Store opened on an empty "Pick a Store" page. The owner wanted the first Store opened. *Lesson:* never open on an empty page.
- **2026-10-23 · By card actions:** Browse by Store first lacked the line actions that By Store had, and the owner asked for the same actions everywhere. For By card the agent moved the actions onto each Listing. The owner then reversed that: one set of actions per card, opening under the whole box. *Lesson:* parity means the same look and controls, but the unit of the actions follows what the view is about.
- **2026-10-23 · Misaligned ›:** the › buttons didn't line up because prices had different widths. *Lesson:* give the price a fixed width.
- **2026-10-23 · Two clicks to close:** closing a line's actions left its Printings open, so the buyer had to reopen the actions to close them. *Lesson:* closing closes everything the actions opened.
- **2026-10-23 · Hidden pickup toggle:** the toggle was hidden for a preferred Store. The owner called it a bug and wanted it left of Prefer. *Lesson:* show a state with its reason instead of hiding the control.
- **2026-10-23 · Wide window broke the layout:** the totals column switched on by window width, so it squeezed the panel beside the Store list. *Lesson:* size a panel by its container.
- **2026-10-23 · Mobile view:** the Store's details sat below a 103-Store list on a phone. Later the fold point (768px) proved too low. *Lesson:* fold side lists, at `lg`.
- **2026-10-23 · Header buttons out of line:** the cart button sat higher than its neighbours because its note shared its column. *Lesson:* notes go under the whole row.
- **2026-10-23 · Postage spilled out:** a `whitespace-nowrap` postage label ran past the 230px totals column. *Lesson:* narrow columns let labels wrap and keep amounts whole.
- **2026-10-23 · Prefer button:** the owner asked for more style: a star that turns gold, like a favourites button.
