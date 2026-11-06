# How to add an integration or a case

## An integration

It's config on both sides, PayRef's and the framework's. This is for an integration on the standard contract. One with a contract of its own, like the wallet, also brings its client and its translation.

1. Add its payment method to the config of its region in PayRef, `payref/config/mx.json` or `payref/config/sa.json`: its id, its name, `"kind": "standard"`, the variable that holds its key, the operations it can use and its amount limits. A bank-like one can also turn on `"reversalWindow": { "minutes": 2 }`.
2. Add its key to `.env.example`.
3. Create `framework/integrations/<id>/integration.json`. Copy the one from the integration that looks most like yours and change what's different. If PayRef turns on its window, add the same one here.
4. Run `npm test -- <id>`.

The whole catalog runs on it right away, and what doesn't apply shows up as Not run, with its reason.

## A case

Add it to its family in `framework/cases/base/`. For example, a fixed single reference paid with the usual amount of its region:

```json
{
  "id": "F01-02",
  "title": "A fixed single reference is paid",
  "flow": "payment",
  "reference": { "type": "single", "amountType": "fixed" },
  "objective": { "step": "notice", "expect": "OK" },
  "tags": ["us-01"]
}
```

Then add its row to [the case matrix](test-matrix.md). The framework's tests check that every case has its row, with the same stories as its tags.
