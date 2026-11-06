# payments-qa-framework

A test automation framework for a payments orchestrator. The payment flow is written once, and each way of paying just declares what it uses. A supermarket, a bank and a wallet don't work the same way, yet they share one base of cases and the same code.

What matters here is how it's built.

## The simulator: PayRef

A framework needs something to test, and it can't be a real system. That's why PayRef lives in this repo. It's a made-up payments orchestrator, names, contracts and data included, and it connects the merchant, who needs to get paid, with whoever collects from the customer.

Everything revolves around the payment reference. The merchant creates it, and the customer pays it wherever they prefer. It can be single or recurring, with a fixed or an open amount, with an expiry date or without one, which makes 8 types. The interesting part is that each way of paying reaches PayRef differently:

| Payment method  | How it pays                                                          | What makes it different                                     |
| --------------- | -------------------------------------------------------------------- | ----------------------------------------------------------- |
| The supermarket | Sends the request and the notice in one call                         | Looks up the reference before charging                      |
| The bank        | Sends the request, then the notice                                   | Has a 2-minute window to reverse the payment                |
| The wallet      | The merchant asks it for a QR, and it reports the payment by webhook | Signs what it sends, has no token and speaks its own format |

They share some common rules, like the credential, whether the reference exists, whether it's still valid and whether the amount is right, but each one has its own quirks. The bank protects its payment while the window runs, and the wallet validates everything again when its webhook arrives. Each rejection has its own code and travels with a 200, so a 200 doesn't mean the payment went through.

There are two regions, Mexico and South America, similar but with their differences, and each one has its own database. The wallet is simulated too: a separate process with its own API that makes the QR and sends its webhook to PayRef.

PayRef comes in two versions: 1.1 works fine, and 1.0 ships with 8 bugs, the way a release would.

## How the framework was abstracted

The real problem is that payment methods change a lot: by type, by region, or simply because each one works differently. This framework doesn't fight those differences. It turns them into data, and what doesn't change gets written once. What would be a headache somewhere else is a line of config here:

- Adding a new payment method is configuration.
- Adding a case is writing a JSON, no coding.
- It scales without copying: a case runs on every integration that can do it.
- It's easy to maintain: the flow, the judge and the evidence live in one place, so a change happens once.

### An integration is a JSON

This is how the bank came in, without a line of its own code:

```json
{
  "id": "bank",
  "name": "Bank",
  "region": "sa",
  "contract": "standard",
  "notice": "separate",
  "inquiry": false,
  "paymentMethod": { "id": "bank", "keyEnv": "SA_BANK_KEY" },
  "amountLimits": { "min": 10, "max": 50000 },
  "reversalWindow": { "minutes": 2 },
  "merchant": { "id": "merchant-sa-1", "keyEnv": "SA_MERCHANT_1_KEY" },
  "otherMerchants": {
    "another-merchant": { "id": "merchant-sa-2", "keyEnv": "SA_MERCHANT_2_KEY" }
  }
}
```

`notice` says how the notice arrives, together with the request, separately or by webhook, and the framework builds the flow from that. The reversal window is one line: whoever turns it on gets its cases, with whatever duration it sets. The step by step is in [how to add an integration or a case](docs/adding-an-integration.md).

### A case is a JSON

It says where it starts, where it ends and what it expects there. There isn't a single assertion in it:

```json
{
  "id": "F07-03",
  "title": "The reversal at the end of the window gets R-107, and the payment is confirmed",
  "flow": "transition",
  "reference": { "type": ["single", "recurring"], "amountType": "fixed" },
  "from": "pending",
  "after": "window-end",
  "objective": { "step": "reversal", "expect": "R-107" },
  "tags": ["us-10"]
}
```

A list makes one test per value. And what changes by region is written by what it is, like `window-end` or `extra-decimal`, and the framework fills in the number for each one.

### You choose what to run

Cases come from a shared base, and the framework crosses them with each integration, so each one runs wherever it can. That's 56 cases and 451 tests, and you can run everything, one integration, one family or a single case. What doesn't apply to an integration doesn't vanish: it shows up as Not run, with its reason, like "Bank has no webhook".

### The rest doesn't know about any integration

| Piece               | What it does                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| The flows and steps | The payment, written once. The config picks the variant                                                                                    |
| The templates       | How to read each API: which field holds the code, what a success needs, and a dictionary that translates its codes into PayRef's           |
| The judge           | Reads each response and says whether it's the one the case expected. The business code decides, not the 200, and no internal data can leak |
| The database check  | Has the last word: the movements have to match what the case expected and the API confirmed. A double charge fails there too               |
| The evidence        | Keeps every step, with the credentials hidden                                                                                              |
| The report          | Built from what the run saved, and lets you audit each case down to its requests                                                           |

That's why the wallet, with its different contract, only brought its client and its translation. Its webhook is tested two ways, signed by the framework or sent by the simulated wallet, so nothing depends on the third party being ready.

### How it's packaged

```text
framework/
  engine/        the judge, the runner, the evidence and the report. It knows nothing about payments
  payments/      the catalog, the flows, the steps, the clients and the database checks
  cases/base/    the cases, one file per family
  integrations/  one folder per integration, with its config
payref/          the simulator, with its two versions
wallet-sim/      the simulated wallet, a third party of its own
tests/           the framework's own tests and the spec that runs the cases
tools/           what's behind npm test and npm run report
docs/            requirements, test analysis, case matrix, framework tests and the step by step
```

The framework never imports PayRef's code. It talks to it over HTTP and reads its database with a user that can only read, and a lint rule keeps it that way.

## Why it's fast

Fast to grow:

- A new integration is config on both sides, and it gets the whole catalog.
- A new case is a JSON and its row in the matrix.
- A typo fails at load time, before anything runs, and says which file and which field.

Fast to run:

- The bank's window is tested right at its edge, one second before it closes and as it closes, without waiting 2 minutes. PayRef takes the time of each request from a header, only in test mode.
- No test sleeps. What arrives later, like the webhook, gets polled for, up to a limit.
- An integration takes 2 to 17 seconds on this machine.
- The framework's own 166 tests run in under a second, with no PayRef and no Docker.

## How it was put to the test

While it was being built, the framework was put to the test to watch it fail. 55 of its pieces were broken on purpose, one at a time, and each one made the right test fail. PayRef got broken too, and the expected results in the cases were changed, to check that each failure said what it expected and what it got.

The framework doesn't know which version it's running against. The version only decides which PayRef starts and what the report says.

## Bug list

PayRef 1.0 ships with these 8. Against it, 17 tests fail on the supermarket, 21 on the bank and 33 on the wallet. Against 1.1, none do.

| The bug in 1.0                                        | Caught by                                            | Fails in                                         |
| ----------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------ |
| A repeated notice registers another payment           | F05-02, the repeated notice on a recurring reference | The response and the database                    |
| An amount with extra decimals is rounded and accepted | F03-05, one decimal more than the region allows      | The response, and the database where it got paid |
| A reference expires a day early                       | F06-01 and F06-03, the last second of its day        | The response                                     |
| Errors leak the stack trace                           | F11-05 and F10-07, what PayRef rejects with a 400    | The response                                     |
| A webhook with a bad signature is accepted            | F08-05, signed with a key PayRef doesn't know        | The response and the database                    |
| A late webhook doesn't check the expiry again         | F08-01, the webhook of an expired reference          | The response and the database                    |
| The bridge tells the wallet a rejection was accepted  | F08-02, when the framework sends the webhook         | The response                                     |
| The bank reverses a payment after its window closed   | F07-03, the reversal right as it closes              | The response and the database                    |

## How to run it

You need Node 24 (the version is in `.nvmrc`) and Docker Desktop running.

```bash
nvm use
npm install
npm test           # runs against the simulator without bugs
npm run test:bugs  # runs against the simulator with bugs
```

There's no `.env` to copy. The first run downloads the MySQL image, so it takes longer. After that, `npm test` starts the database if it's down, runs the three integrations one after the other, and starts and stops PayRef and the simulated wallet. Before the first case, a quick check makes sure Docker, the database and the ports are fine. If something's missing, the run doesn't start and tells you what.

| Command                         | What it does                                                   |
| ------------------------------- | -------------------------------------------------------------- |
| `npm test`                      | Runs the three integrations against the simulator without bugs |
| `npm run test:bugs`             | The same against the simulator with bugs                       |
| `npm test -- bank`              | Runs one integration                                           |
| `npm test -- wallet --grep F08` | Runs some cases, with Playwright options                       |
| `npm run report`                | Writes the report of the last run again                        |
| `npm run verify`                | Formatting, types, lint and the framework's tests              |
| `npm run db:down`               | Stops the database                                             |

## The report

Every run gets its own folder in `artifacts/runs/`, and the console says where its report is. The summary comes first: how many tests are approved, and how many came out Passed, Failed, Inconclusive or Not run. Then each case opens down to its steps, its database checks and the requests that traveled.

There are four results because two aren't enough. Failed means PayRef did something else. Inconclusive means it couldn't be tested, like a timeout. Not run comes with its reason. And a Passed with incomplete evidence isn't approved, because a green test nobody can audit doesn't prove much.

## What's next

- A CI pipeline with GitHub Actions.
- A contract test set for PayRef's APIs, apart from the business cases.
- An adapter: a payment method with a contract of its own, behind a second bridge.
- Sending the results to TestRail.

## Docs

- [Requirements](docs/requirements.md)
- [Test analysis](docs/test-analysis.md)
- [Case matrix](docs/test-matrix.md)
- [Framework tests](docs/framework-tests.md)
- [How to add an integration or a case](docs/adding-an-integration.md)

## Resumen

Un framework para automatizar las pruebas de un orquestador de pagos. El pago se programa una sola vez, y cada forma de pagar nada más dice qué usa, así que un súper, un banco y una wallet comparten una misma base de casos. Prueba PayRef, un simulador que vive en este repo, con una versión bien y otra con 8 bugs. Para correrlo necesitas Node 24 y Docker Desktop prendido, y estos comandos: `nvm use`, `npm install` y `npm test`. Con `npm run test:bugs` corre contra el simulador con bugs.
