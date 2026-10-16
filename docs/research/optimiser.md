# Research: what optimiser produces the Trade-off Ladder?

Ticket: #6 (parent map #1). Glossary terms (Want List, Store, Listing, Printing, Plan, Landed Cost, Trade-off Ladder, Not Found) follow `CONTEXT.md`.

## Answer

- **Use an exact MILP solved with HiGHS compiled to WebAssembly (the `highs` npm package, MIT).** Solve one MILP per Store count k. Each model minimises Landed Cost subject to a constraint that the Plan uses at most k Stores.
- **Run a fast greedy heuristic first.** It drops one Store at a time and then tries 1-swaps. It gives an instant draft Trade-off Ladder (about 60 ms) and a starting incumbent (best feasible Plan so far) for each MILP.
- **Give every rung a time limit and a relative MIP gap of 0.5%.** If a rung hits the time limit, show its best Plan with an "at most $X above the best possible" note. Never leave the rung blank.
- **Upper rungs are easy, low rungs are hard.** On synthetic instances (100 cards × 20–60 Stores, on a desktop), the unconstrained rung solves in 0.1–3.6 s. The tight 3–5 Store rungs take 2–16 s each, and a full ladder takes 13–43 s.
- **On a NAS, expect a few times slower** (single-threaded WASM on a weaker CPU), so rung time limits are required. Running rungs in parallel `worker_threads` is the main way to cut wall-clock time.
- **GLPK (`glpk.js`) is a workable but GPL-3.0 alternative.** It matched HiGHS on the one instance tested.
- **Do not use `javascript-lp-solver`.** It hit its 20 s timeout on every rung tried, and reported an objective below HiGHS's proven optimum, which suggests an integrality or feasibility tolerance problem.
- **OR-Tools has no official Node/JS binding.**

## 1. Problem structure and complexity

This problem is the **Internet Shopping Optimization Problem (ISOP)**. A buyer wants a multiset of products from m shops. Each shop has per-product prices and a delivery cost "d_l of any subset of the products". The problem is to choose disjoint selections that minimise product plus delivery cost [1].

- **ISOP is strongly NP-hard, even when all prices are 0 and all delivery costs are 1.** The proof reduces from Exact Cover by 3-Sets [1, Thm 1].
- **No polynomial (c·ln n)-approximation exists unless P = NP.** That special case is equivalent to Minimum Set Cover [1, Statement 1].
- **ISOP is polynomial when the number of products n or the number of shops m is a fixed constant** [1, §4].

Implication for MagicFinder: the low rungs of the Trade-off Ladder ("cover the Want List with at most 3 Stores") contain a set-cover feasibility problem. That is exactly the part that measured slowest (§5). For each fixed k, the ladder is ISOP with a cardinality limit on open shops, the same structure as uncapacitated facility location with a cap on the number of open facilities. Stores are facilities, Want List cards are customers, and postage is the fixed opening cost.

Two follow-up threads in the literature are relevant:
- **Price-sensitive discounts.** Błażewicz, Bouvry, Kovalyov and Musiał extend ISOP with a concave, increasing discount function of each shop's total [2]. A follow-up conference paper proposes heuristics and compares them with an exact branch-and-bound [3]. Free-postage thresholds are a step-function case of the same idea.
- **The Clever Shopper Problem.** Bulteau, Hermelin, Labarre and Vialette study a related variant and give exact algorithms for restricted cases [4].

I verified [1] from its full text. For [2]–[4] I relied on abstracts and publisher listings only.

## 2. MILP formulation

### Data (built from the Listings for the Want List)

| Symbol | Meaning |
|---|---|
| C | Want List cards (one entry per card name, or per locked Printing; see below) |
| q_c | wanted quantity of card c |
| S | Stores that have at least one usable Listing |
| L | usable Listings. Listing l has Store s(l), card c(l), unit price p_l and available quantity a_l |
| T_s | postage tiers of Store s. Tier t has a subtotal threshold lo_{s,t} and a postage charge f_{s,t} |
| P ⊆ S | pickup Stores: one tier, lo = 0, f = 0 |
| k | the ladder rung (the Store-count limit) |

**Pre-processing.** These steps happen before modelling, and they shrink the model a lot.

1. **Locked Printings.** If the buyer locked card c to a Printing, drop every Listing of c with a different Printing. Otherwise any Printing is acceptable, and the cheapest wins on price alone. Handle locking by filtering Listings, not by adding constraints.
2. **Not Found and shortfall.** Set the demand to d_c = min(q_c, Σ_{l: c(l)=c} a_l). Cards with d_c = 0 are Not Found and are excluded. Report a partial shortfall (q_c > d_c) next to Not Found.
3. **Dominance pruning.** For each (Store, card) pair, sort the Listings by price and keep only the cheapest ones until their cumulative availability reaches d_c. A Store will never sell you a dearer copy of a card while a cheaper one is in stock there. Postage depends only on the Store, and thresholds only reward a larger subtotal, which a dearer copy elsewhere could not help with. In the benchmark this halved the number of Listings (3,411 → 1,741). For singletons (d_c = 1) at most one Listing per (Store, card) survives.

### Variables

- `x_l ∈ Z, 0 ≤ x_l ≤ u_l` where u_l = min(a_l, d_c(l)): copies bought from Listing l. These are binary when u_l = 1, which is most Commander lines.
- `y_s ∈ {0,1}`: Store s is in the Plan (one parcel, or one pickup).
- `z_{s,t} ∈ {0,1}`: Store s is charged postage tier t.

### Objective (Landed Cost)

    min  Σ_l p_l x_l  +  Σ_s Σ_{t∈T_s} f_{s,t} z_{s,t}

### Constraints

    (demand)        Σ_{l: c(l)=c} x_l = d_c                      ∀ c with d_c > 0
    (link)          x_l ≤ u_l · y_{s(l)}                          ∀ l
    (one tier)      Σ_{t∈T_s} z_{s,t} = y_s                       ∀ s
    (threshold)     Σ_{l: s(l)=s} p_l x_l ≥ Σ_t lo_{s,t} z_{s,t}  ∀ s with any lo_{s,t} > 0
    (rung k)        Σ_s y_s ≤ k

How each constraint works:

- **Split quantities.** The demand row sums over Listings in every Store, so 4× a card can come 2 + 1 + 1 from three Stores.
- **Disaggregated linking.** Writing one `link` row per Listing, rather than one big-M row per Store (`Σ x ≤ M·y_s`), gives a much tighter LP relaxation. This is the "strong" facility-location formulation.
- **Postage tiers and free-postage thresholds.** Write the tiers as a non-increasing step function of the Store subtotal, for example {lo = 0, f = $6} and {lo = $80, f = $0}. Then only the threshold lower bound is needed. Choosing a dearer tier than you qualify for only raises cost, so the optimiser never does it, and no upper-bound rows or big-M are required.
  - If a Store's postage *rises* with the order, for example a letter versus a tracked parcel by card count, add the matching upper bound `Σ_l n_l x_l ≤ hi_{s,t} + M(1 − z_{s,t})`, where n_l counts cards, or weight if known. That needs a big-M; keep M to the Store's maximum possible count.
- **Pickup Stores.** They have a single tier with f = 0. They still use `y_s`, so they count toward k. A pickup is still one more Store to deal with; confirm this in the product (open question Q2).
- **Rung constraint.** Use `≤ k`, not `= k`. Then rung k is "the best Plan using at most k Stores", Landed Cost cannot rise as k increases, and an optimum that actually uses fewer than k Stores fills all the rungs from its own Store count up to k.

### Building the ladder

1. **Find the smallest feasible rung, k_min.** Solve the pure cover MILP: `min Σ y_s` subject to `Σ_s min(d_c, A_{c,s}) y_s ≥ d_c` for every c, where A_{c,s} is Store s's available quantity of card c. It has only |S| binaries and proves which rungs are infeasible. In the benchmark, HiGHS spent 0.1–4.6 s proving that k = 2 or k = 3 was infeasible inside the full model; the cover model should do this much faster (not measured).
2. **Solve the unconstrained rung (k = |S|).** Its Plan uses k* Stores, and every rung k ≥ k* shows that Plan.
3. **Solve each remaining rung k = k* − 1 down to k_min.** After a rung returns a Plan with u Stores, skip straight to k = u − 1.
4. **Re-use one HiGHS model.** Keep a persistent model, `highs.createModel()`, and change only the RHS of the rung row with `changeRowBounds`. Seed each solve with `setSolution` from the heuristic Plan for that k [5].
5. **Keep rung costs consistent.** If a time-limited rung k returns a dearer Plan than a rung below it, show the lower rung's Plan.

## 3. Expected problem sizes

| Quantity | Typical (Commander, NZ) | Notes |
|---|---|---|
| Want List lines | ~100 (99 + commander, fewer once basics are dropped) | most d_c = 1; a few lines (basics, multiples) have d_c > 1 |
| Stores | 20–60 ("tens") | across Fetch TCG and MtgSingles |
| Raw Listings | ~1.8k–4.4k (synthetic) | several Printings and conditions per (Store, card) |
| Listings after pruning | ~0.9k–2.2k | at most \|C\|·\|S\| for singletons |
| MILP columns | Listings + ~2·\|S\| | ~1k–2.4k |
| MILP rows | Listings + \|C\| + ~2·\|S\| + 1 | similar |

This is a small MILP by solver standards. What makes it hard is the combinatorial structure of the low rungs, not the size.

## 4. Solver options for TypeScript/Node

| Solver | Package / version checked | Licence | MIP | Notes |
|---|---|---|---|---|
| **HiGHS (WASM)** | `highs` 1.15.3, repo lovasoa/highs-js | MIT | branch-and-cut with presolve, cutting planes, heuristics, restarts and symmetry detection [5] | Input is CPLEX LP text (`highs.solve`), or a persistent model built from LP, MPS or CSC/CSR arrays. Options include `time_limit`, `mip_rel_gap` and `mip_heuristic_effort`. The persistent model has `changeRowBounds`, `setSolution` and MIP callbacks. The WASM build is single-threaded; run independent solves in Workers. Persistent models must be `dispose()`d or Wasm memory leaks [5]. The package is 3.9 MB. |
| GLPK (WASM) | `glpk.js` 5.0.0, repo jvail/glpk.js | **GPL-3.0** | yes (`binaries`, `generals`) | JSON model. The Node entry point is `glpk.js/node` and solves synchronously after `await GLPK()`. Options include `tmlim` (seconds), `mipgap` and `presol` [6]. The GPL may matter if MagicFinder is ever redistributed. |
| javascript-lp-solver | `javascript-lp-solver` 1.0.3, repo JWally/jsLPSolver | Unlicense | simplex plus branch-and-cut | Pure JS, JSON model, `timeout` in ms, `tolerance` as an accepted % gap [7]. Its README reports 23 of 30 MIPLIB 3 problems solved within 30 s, and that its own benchmark compares against the stronger HiGHS-WASM [7]. |
| OR-Tools | n/a | Apache-2.0 | (CP-SAT, MIP wrappers) | The official languages are C++, Python, Java and C#. There is no official JavaScript/Node binding [8]. It would need a Python sidecar process, which is not worth it at this size. |

## 5. Benchmark (throwaway, synthetic)

**Setup.** Node 22, Ryzen 9 5950X, single-threaded WASM, `time_limit: 20` s per rung. The instance generator:
- 100 cards; the first 5 lines want 1–8 copies, the rest want 1.
- 25% of Stores are large, stocking each card with probability 0.7; the others stock with probability 0.15–0.45.
- 1–3 Listings per stocked (Store, card), each with 1–4 copies.
- Two pickup Stores.
- Half the other Stores charge $4–8 postage with a free-postage threshold of $50–100; the rest charge a flat $5–8.

**HiGHS, `mip_rel_gap` 0.5%** (ms per rung; "–" means the rung is not applicable):

| Instance (cards × Stores, seed) | Pruned Listings | unconstrained (k*) | k*−1 | … | k = 5 | k = 4 | k = 3 | k = 2 | Ladder total |
|---|---|---|---|---|---|---|---|---|---|
| 100 × 20 (s3) | 922 | 760 (k* = 7) | 1,540 | – | 3,044 | 5,690 | 1,762 | infeasible, 41 | 12.8 s |
| 100 × 40 (s1) | 1,741 | 1,068 (k* = 8) | 494 | 379 (k = 6) | 2,032 | 1,903 | 14,037 | infeasible, 95 | 20.0 s |
| 100 × 40 (s2) | 1,780 | 1,467 (k* = 8) | 1,485 | 5,125 (k = 6) | 11,092 | 16,353 | 6,916 | infeasible, 100 | 42.5 s |
| 100 × 60 (s4) | 2,249 | 3,622 (k* = 9) | 4,064 | 2,947 / 1,771 (k = 7 / 6) | 4,172 | 8,532 | 6,764 | infeasible, 225 | 32.1 s |

Other results:
- **The MIP gap made little difference to time.** Gaps of 1e-6, 0.1% and 0.5% gave 22.1 s, 22.1 s and 20.0 s on s1. The time goes into searching store combinations, not into closing the last cents of gap.
- **Higher `mip_heuristic_effort` (0.3) made s2 slower** (47.7 s, and rung 4 hit the time limit).
- **Flat postage only (no thresholds)** gave a 13.0 s ladder on a comparable instance, so thresholds are not the main cost.
- **Peak RSS was about 0.47 GB** for a full ladder, using one-shot `highs.solve` repeatedly on the same runtime. Budget about 0.5 GB for the container, or use a persistent model with `dispose()`.
- **GLPK (`glpk.js`), s1:** unconstrained 1.35 s, k = 6 0.36 s, k = 3 14.0 s, all optimal and matching HiGHS. That is comparable on this instance.
- **javascript-lp-solver, s1:** the unconstrained and k = 6 rungs both stopped at the 20 s timeout. It reported 424.97 for the unconstrained rung, below HiGHS's proven optimum of 425.26. That points to tolerance or feasibility issues, so do not use it.

**Greedy-drop plus 1-swap heuristic** (algorithm in §6). Its draft ladder takes about 60 ms per instance. Compared with the MILP optimum:

| | k = 6 | k = 5 | k = 4 | k = 3 |
|---|---|---|---|---|
| s1 | +1.6% | +0.9% | 0% | **missed** (no feasible 3-Store Plan found) |
| s2 | +1.4% | +0.1% | +0.4% | +2.7% |

The heuristic is good enough as a warm start and as a timeout fallback. It is not good enough to be the only answer: it misses feasible tight rungs, and at the top of the ladder it ignores how thresholds interact with assignment. On s1 its unconstrained Plan came out about 1.9% above optimal.

**Caveats.** The instances are synthetic, so re-run on real Fetch TCG and MtgSingles Listings once the Source adapters exist. A NAS CPU (for example a Celeron or Ryzen Embedded) runs single-thread code roughly 2–4× slower than a 5950X; this is an estimate, not a measurement.

## 6. Recommended approach

1. **Pre-process:** lock Printings, compute Not Found and shortfall, and prune dominated Listings (§2).
2. **Heuristic draft ladder (in milliseconds).** This step can be shown immediately as "Draft".
   - Start from the set of Stores used by the per-card cheapest assignment.
   - Evaluate a Store set by buying each card's demand from the cheapest Listings inside the set, then adding each Store's tiered postage for its subtotal.
   - Run a 1-swap local search: close one Store, open another, and keep the change if Landed Cost falls.
   - Record the result as rung |open|. Then greedily drop the Store whose removal costs least, and repeat until no feasible set remains.
3. **Find k_min** with the cover MILP.
4. **Exact rungs with HiGHS.**
   - Use one persistent model and the `changeRowBounds` loop above. Seed each rung with the heuristic Plan via `setSolution`.
   - Set `mip_rel_gap = 0.005`, and a per-rung `time_limit` sized to the NAS. Start at about 20 s and tune on real data.
   - Run rungs in parallel `worker_threads`, each with its own Wasm instance, up to the container's CPU count.
   - Stream each rung to the UI as it finishes.
5. **Label each rung** as Optimal or "within $X". Use the MIP gap (`mip_gap` in model info) when a time limit is hit, and keep the cost check that a rung is never dearer than the rung below it.
6. **Isolate the solver behind a `planLadder(wantList, listings, stores) → TradeoffLadder` module.** The solver can then be swapped (GLPK, or a Python/OR-Tools sidecar) without touching callers.

**Fallback if HiGHS-WASM is unusable** (crashes, memory, licensing): use the heuristic ladder alone, add a few random restarts, and add an exact enumeration for k ≤ 2. The number of Store pairs is C(60, 2) = 1,770; with postage thresholds each pair is a tiny assignment problem. Label those rungs "Best found".

## 7. Open questions for the map (#1)

- **Q1. What does a rung below k_min show?** If no k Stores can supply every obtainable card, the rung is infeasible. Options: hide it, or show the best *partial* Plan with a list of missing cards. This changes the model, because demand becomes `≤` with a penalty.
- **Q2. Does a pickup Store count toward the Store count?** The formulation assumes yes. To exclude it, drop pickup `y_s` from the rung row.
- **Q3. Postage shape per Store.** Is postage tiered by subtotal only, or also by card count or weight (letter vs parcel)? Is it per Store or per Source? This decides whether big-M upper-bound rows are needed (§2). The answer belongs to the Source research tickets.
- **Q4. Condition and language preferences.** Like locked Printings, these are best handled as Listing filters before modelling.

## Sources

1. Błażewicz, Kovalyov, Musiał, Urbański, Wojciechowski, "Internet Shopping Optimization Problem", *Int. J. Appl. Math. Comput. Sci.* 20(2):385–390, 2010, doi:10.2478/v10006-010-0028-0. Full text: https://zbc.uz.zgora.pl/repozytorium/Content/46859/download (definition §2, Theorem 1, Statement 1, §4).
2. Błażewicz, Bouvry, Kovalyov, Musiał, "Internet shopping with price-sensitive discounts", *4OR* 12(1):35–48, 2014; erratum 12(4):403–406. https://orbilu.uni.lu/handle/10993/30195 (abstract only).
3. Musiał, Pecero, Lopez, Fraire, Bouvry, Błażewicz, "How to Efficiently Solve Internet Shopping Optimization Problem with Price Sensitive Discounts?", ICE-B 2014. https://www.scitepress.org/Papers/2014/51126/ (abstract only).
4. Bulteau, Hermelin, Labarre, Vialette, "The Clever Shopper Problem", 2018. https://cris.bgu.ac.il/en/publications/the-clever-shopper-problem/ (abstract only).
5. highs-js README and `types.d.ts`, `highs` npm 1.15.3: https://github.com/lovasoa/highs-js (persistent models, `changeRowBounds`, `setSolution`, `time_limit` and `mip_rel_gap` options, single-threaded build, `dispose()`).
6. glpk.js README and `dist/types.d.ts`, `glpk.js` npm 5.0.0: https://github.com/jvail/glpk.js (`tmlim`, `mipgap`, `presol`, `glpk.js/node` sync API, GPL-3.0).
7. jsLPSolver README, `javascript-lp-solver` npm 1.0.3: https://github.com/JWally/jsLPSolver (`timeout`, `tolerance`, MIPLIB results).
8. OR-Tools install page: https://developers.google.com/optimization/install (supported languages: C++, Python, Java, C#).
9. Benchmark: a throwaway script in the session scratch area (not committed); method and numbers as described in §5.
