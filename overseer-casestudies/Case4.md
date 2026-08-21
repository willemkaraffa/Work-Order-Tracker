# Case study: the AMH contact-capture regression

Repo: Work-Order-Tracker. File: `scrape_amh.py`. Fix commit: `de86cb9` (2026-08-21).
Regression introduced by: `cf86f56` (`feat(amh): revive bulk capture via Order/VendorAdminOrders`).

## Abstract

An AMH portal endpoint was retired upstream and the scraper was migrated to its
replacement. The migration ported the field names correctly but not the envelope
shape. The replacement list endpoint returns `customers` as an empty array on
every order, where the retired endpoint returned it populated. Contact extraction
kept working against an input that was now always empty, so every bulk capture
and every WO-number capture silently wrote `phone: ""` and `contactName: ""`.
The single-WO GUID path used a different endpoint that still carried `customers`,
and that was the only path anyone verified. The result was a change that worked
the day it shipped for the case that was checked, and was already broken for the
case that was not.

Three gates were green throughout: the deterministic verify gate, a purpose-built
regression test written for this exact migration, and an advisory code review.
None could see the defect, because none of them ever touched a real API response.
The failure is not "a test was missing." A test was written, for the right file,
in the right commit. It was built from envelopes the author invented, and an
invented envelope encodes the author's assumption about the payload, which is
precisely the thing that was wrong.

Generalizable lesson: when the input to a system is an external payload, the
only artifact that can falsify an assumption about that payload is a captured
copy of the real thing. Synthetic fixtures test the code against the belief that
produced the code.

## What the code did

`build_wo()` composes a tracker work order from one AMH order envelope:

```python
contacts = extract_contacts(item.get("customers"))
primary  = contacts[0] if contacts else None
...
"phone":       primary["phone"] if primary else "",
"contactName": primary["name"]  if primary else "",
```

`extract_contacts()` reads `firstName`, `lastName`, `phone`, `homePhone`,
`otherPhone`, `email`, `isPrimary`. Every one of those field names is correct
and was still correct after the migration. The function was never the defect.

Three capture paths feed `build_wo()`:

| Path | Source endpoint | `customers` present |
|---|---|---|
| All-open bulk | `POST Order/VendorAdminOrders` (list) | no, always `[]` |
| WO-number targeted | same list feed, then `Order/VendorAdminOrders` Posted search | no, always `[]` |
| Single-WO GUID | `GET Order/{guid}` (detail) | yes |

## What the live probe showed

Probed against the real API on 2026-08-21 with a minted Bearer, comparing the
list envelope and the detail envelope for the same three orders:

```
== WO 9845462
  LIST   customers=arr0 scoping=obj6 properties=null files=obj0 locations=obj0
         assets=obj10 condititionIssueInstances=obj1 inventory=obj0 remedyInstances=obj7
  DETAIL customers=arr2 scoping=obj6 properties=obj3 files=obj0 locations=obj0
         assets=obj10 condititionIssueInstances=obj1 inventory=obj0 remedyInstances=obj7
```

`customers` is the only sub-collection the list feed strips. Scoping, assets,
condition issues, remedies and bids are byte-identical between the two shapes,
which is why notes, trade classification and bid totals all kept working and
made the WO look fully captured. `properties` is also null on the list feed but
is unused (`build_wo` reads `order.property`, not the envelope's `properties`).

A populated detail record, for contrast:

```json
{"firstName":"Herbert","lastName":"Pollard","email":"...","phone":"8134782093",
 "homePhone":null,"otherPhone":null,"isPrimary":true,"id":"dd099025-..."}
```

The narrowness is what made this expensive. A payload that broke everything
would have been reported in an hour. A payload that breaks one field out of
fifteen looks like a working capture.

## Why it worked for about a day

The old endpoint `GET Order/Query` returned a single envelope shape that carried
`customers`. It began returning 403 to a valid token (observed 2026-08-11) and
was retired. The bulk path moved to `POST Order/VendorAdminOrders`. Contacts
captured correctly right up to that migration and never again on those paths.
The user experienced this as "it worked for a day and then stopped," which is
exactly right: the break tracks an upstream endpoint retirement, not a code
change the user made or saw.

## Why every gate stayed green

**1. The verify gate cannot see this file.** `npm run verify` runs eslint over
`src`, `test` and `extension`, builds the renderer with esbuild, then runs
`test/run.js`. `scrape_amh.py` is Python and is linted by nothing. The gate was
honestly green and was never evidence about the scraper.

**2. The regression test for this migration was built from invented envelopes.**
`test/fetch-open-orders.test.js` was written for the VendorAdminOrders migration.
It monkeypatches the shipped `api_post` and runs the real `_fetch_bucket` and
`fetch_open_orders`. That is a good harness. Its fixtures are:

```python
{"orders": [{"order": {"name": "1"}}], "hasNextPage": True}
```

An envelope with a name and nothing else. It proves pagination terminates and
buckets dedup, and it can never observe a field going empty, because the fixture
has no fields. The author's model of the payload went into the fixture, so the
test agreed with the bug and stayed green.

**3. The review gate saw a diff, not a payload.** An advisory reviewer reading
`item.get("customers")` sees correct code. The defect is not visible in the
diff at any level of scrutiny; it lives in the difference between two JSON
documents that were never placed side by side.

**4. Verification exercised the one path that still worked.** The single-WO GUID
capture hits the detail endpoint, which still returns `customers`. Checking one
representative path is normally sound. It is not sound when the paths differ in
the exact dimension that changed, and here the migration changed the endpoint on
two of three paths while leaving the third alone. A per-path check was the
minimum the change called for, and it was not done.

## Failure classes

**F1. Ported the field map, not the envelope shape.** The existing rule says port
the mechanism, not the surface. This is a narrower and sharper instance: when a
data source is swapped, the payload contract is part of the mechanism. Matching
field names prove nothing about whether the fields are populated.

**F2. Synthetic fixtures for external payloads.** A hand-written fixture is a
recording of the author's assumption. When the question under test is "what does
the remote actually send," a synthetic fixture is not evidence. Only a captured
response is. This is the same shape as the existing lesson that an author-written
test agrees with its author's bug, specialized to integration boundaries.

**F3. Representative-path verification across a divergence.** One path was
verified while three existed and the change made them non-equivalent. The correct
trigger: if a change alters which endpoint or transport a path uses, every path
that differs must be exercised, not one exemplar.

**F4. A green gate reported as coverage it does not have.** `npm run verify` was
run and passed, and the change was called verified. The gate has no reach into
Python. Naming which paths a gate does and does not cover, at the moment of the
claim, would have made the gap visible while it was still cheap.

**F5. Silent degradation to empty rather than failure.** `primary["phone"] if
primary else ""` turns "no data" into a valid-looking blank. A field that the
source is contractually expected to carry should warn when it arrives empty. The
scraper already emits a `warnings` list for missing bid items and emitted nothing
here.

## The fix

`hydrate_customers(token, item)` refetches `GET Order/{guid}` when the list feed
left `customers` empty, and is called on both bulk paths. Best effort: a failed
hydrate logs to stderr and the WO still imports without a contact.

```python
def hydrate_customers(token: str, item: dict) -> dict:
    if not isinstance(item, dict) or (item.get("customers") or []):
        return item
    order = item.get("order") or item
    oid = normalize_text(order.get("id"))
    if not oid:
        return item
    try:
        detail = api_get("Order/" + oid, token, {"today": today_api_value()})
    except Exception as exc:
        print(f"[API] customer hydrate failed for {normalize_text(order.get('name'))} ({exc}).",
              file=sys.stderr)
        return item
    cust = (detail or {}).get("customers") or []
    if cust:
        item["customers"] = cust
    return item
```

Live proof, real API, not a mock:

- Targeted: `9845462` to `8134782093` (Herbert Pollard), `9846389` to `7085285314` (Drew Dunker).
- All-open: 20 of 20 work orders captured a phone, 0 hydrate failures, 54s total run.
- `npm run verify`: 39 pass, 0 fail, 1 skip.

Cost of the hydration is one extra GET per open work order. Measured at 20 orders
in a 54s run including the six-bucket enumeration.

## Controls worth adding

1. **Record real envelopes as fixtures.** Save one redacted list envelope and one
   detail envelope per endpoint, and assert against those. A recorded pair would
   have failed the moment `customers` went empty.
2. **Contract assertion on capture.** Emit a warning when a work order imports
   with no contact, alongside the existing no-bid-items warning. Empty should be
   loud when the source is expected to carry the field.
3. **Path-divergence checklist on any endpoint swap.** Enumerate every code path
   reaching the changed source and verify each. One exemplar is insufficient when
   the change is what made the paths differ.
4. **State a gate's reach when citing it.** "Verify passed" should carry "verify
   does not cover the Python scraper" whenever the change is in Python.
5. **Regression test for this specific hole.** DONE:
   `test/amh-hydrate-customers.test.js`. Monkeypatches the shipped
   `scrape_amh.api_get` and runs the real `hydrate_customers` + `build_wo`. Nine
   checks: the hydrate fires and the PRIMARY contact lands, an already-populated
   envelope pays no extra GET, a failed or empty detail response still imports the
   WO, a missing `order.id` makes no call. Two of the nine exist because of this
   case study specifically:
   - a **fixture guard** asserting the list envelope still has a `customers` key and
     that it is still empty, so a future refresh cannot quietly turn the fixture into
     something that tests nothing;
   - a **wiring guard** asserting both bulk call sites route through
     `hydrate_customers`, because the original defect was never in the helper, it was
     that the paths fed it an empty list. A green unit test on the helper alone would
     have repeated the original mistake.
   The fixtures are shaped from the real captured envelopes, redacted. Their
   provenance is recorded in the file header, with an instruction to re-probe rather
   than hand-edit them.

## Residual risk

The fixture is a recording, and recordings go stale. If AMH changes the list payload
again, the suite stays green while reality moves, exactly as it did before. The
fixture guard narrows this to "the shape we recorded is still the shape we assert,"
which is not the same as "the shape we assert is still what the remote sends." Only a
periodic live probe closes that gap; nothing in the test suite can.
