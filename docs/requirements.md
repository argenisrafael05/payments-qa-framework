# Requirements

| Version | Date          | Change                                                                                                                                                                                                          |
| ------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1     | October 2026  | Initial version                                                                                                                                                                                                 |
| 0.2     | October 2026  | Changes from the static review and the [test analysis](test-analysis.md)                                                                                                                                        |
| 0.3     | October 2026  | The inquiry only informs, and the payment always validates (US-08)                                                                                                                                              |
| 0.4     | October 2026  | Cancelling an expired reference answers R-103 (US-07)                                                                                                                                                           |
| 0.5     | October 2026  | Each integration's config brings its merchants, each one with an alias (US-03)                                                                                                                                  |
| 0.6     | October 2026  | What changes by region in a case is filled in by the framework (US-03)                                                                                                                                          |
| 0.7     | November 2026 | The inquiry reports an expired reference as expired (US-08), another amount gets another resource (US-11), the database matches what the case expected (US-01) and the README links to the step by step (US-06) |
| 1.0     | November 2026 | Version published with the project                                                                                                                                                                              |

## 1. Vision

This project is a framework to automate the testing of a payments orchestrator. It automates what a QA does by hand over and over: create a reference, pay it through each integration, and check that the orchestrator applies its rules and that the database ends up with what it should.

What matters most is how it's built. The payment flow is written once, and each integration just declares what it uses. That makes adding an integration or a case cheap, and keeps the code maintainable.

The orchestrator under test is called PayRef. It's a simulated system that lives in this same repo. It connects the merchant, who needs to get paid, with the payment methods that collect from the customer: a supermarket, a bank and a wallet. What ties them together is the payment reference: the merchant creates it, and the customer pays it wherever they prefer. PayRef ships with bugs seeded on purpose, to show that the tests catch them.

Each run generates an execution report with a summary of the results at the top. Opening a case lets you audit its steps, its checks and its evidence. The Playwright report is kept too.

## 2. Users

**Of what we build (the framework and its report)**

| User               | Goal                                                                                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| QA team            | Automate the payment flows of each integration, with their validations, and know after every change whether everything still works. Also add new integrations and cases without much work |
| Lead               | Check the result and the scope of a run, and review the cases with their evidence                                                                                                         |
| Technical reviewer | Clone the repo, run it and understand how it's built                                                                                                                                      |

**Of what we test (PayRef)**

| User                                        | Goal                                                                                                                                                                                                           |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Merchant                                    | Needs to get paid: logs in with its own key, creates payment references, checks their status, asks for the wallet's QR or link, and cancels them when they no longer apply                                     |
| Standard payment method, like a supermarket | Look up the reference and report the payment once the customer has paid                                                                                                                                        |
| Bank, a customized payment method           | Uses the standard contract and turns on a special business rule in its config, the reversal window: it validates before confirming and can reverse within the window if something fails. Not every bank has it |
| Wallet, a digital payment method            | Generates a QR or link for the customer to pay, and reports the payment with a signed webhook                                                                                                                  |

## 3. Scope

**Includes:**

- The framework, which automates the payment flows of the three integrations end to end, with positive and negative cases. It validates the most important business rules, checks the effect of each payment on the database and covers basic security. It's built to grow: the flow is written once, each integration only declares its config, and security, concurrency or performance tests can be added later. It leaves evidence of each step, catches the seeded bugs and generates an execution report with results and evidence, plus the Playwright report.
- PayRef, the orchestrator: the payment request and notice, the 8 reference types, two regions (Mexico and South America) with their rules, the three payment methods, its response model and 8 seeded bugs.

**Out of scope for now:** CI/CD, the TestRail connection, settling with the merchant, the adapter, the other optional rules (overpayment, blocking a double payment during the window and notice retries), restricted hours, reconciliation, payouts, frontends, concurrency and performance tests with request limits, and API contract tests, as a separate regression set for when the core changes.

**Out of scope because they aren't PayRef's:** rejections and outages of third parties, like the wallet. They have their own policies, which we don't control, so what gets tested is what PayRef validates.

**Constraints:**

- PayRef lives in the repo as a black box: the framework talks to it over HTTP and reads its database to validate, but never imports its code.
- Everything about PayRef is fictional: its names, contracts and data were made up for this project.

## 4. Epics

| Epic                         | Description                                                                                         | Stories                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------- |
| E1. The automation framework | What we build: automate the payment flows and their validations, with an architecture that can grow | US-01 to US-06, US-12 and US-13 |
| E2. PayRef, the orchestrator | What we test: the merchant, the payment methods and the orchestrator that connects them             | US-07 to US-11                  |

## 5. User stories

Priority uses MoSCoW: **Must** (required), **Should** (important) and **Could** (nice to have). All 13 are Must: without any of them, the project doesn't show what it promises. IDs don't get renumbered: a new story takes the next free number.

### E1. The automation framework

**US-01 Automate the payment flows end to end** · Must

As a QA team, I want the payment flows of each integration to run on their own, end to end, so I know after every change whether everything still works, without redoing the same things by hand: creating the reference, paying it and checking the database.

- The supermarket, the bank and the wallet run their full flows: the reference is created, the request and the notice arrive, the bank can also reverse, and the wallet reports with its webhook.
- Each step says what it expected, what it got and whether it passed.
- The database has the last word: it has to match what the case expected and the API confirmed. A payment the API accepted where the case expected a rejection doesn't count, so if it stayed in the database, it fails there too. Each payment that counts has its movement, in the state it should be in (confirmed, pending while the bank's window runs, or reversed), and a rejection adds none. If it doesn't match, the case fails.
- The database check runs at the end of every case, even if a step failed, and its result shows without changing the main reason.
- Each step leaves real evidence, with no credentials in sight. A step that executes keeps what was sent and what PayRef answered, or the error if there was no response. A step that observes keeps what it read from the database and the call that triggered the action, if there was one.
- A single command, `npm test`, runs the three integrations one by one, each as its own run. All three run even if one fails, and the command ends with an error if any case came out Failed or Inconclusive.
- You can also run a single integration, a case with all its variations or a single variation, and that run stays apart from the others.

**US-02 Validate the business rules** · Must

As a QA team, I want to validate the business rules of each payment, to catch what a 200 hides: a wrong rejection, a repeated payment or a regional rule that isn't met.

- The business code decides, not the 200: a case that expects a rejection only passes if exactly that code arrives. If it expects a technical rejection, like a 400, a 401 or a 403, exactly that one has to arrive too.
- If another code arrives, or a 500, or a response the policy doesn't recognize, the case fails and says what it expected and what it got.
- A repeated notice is rejected, and only one movement stays in the database: with R-106 on a recurring reference, and with R-102 on a single one, because the already-paid check answers first.
- A single reference that's already paid is rejected, whatever sequence comes.
- Each regional rule has its case at the boundary: a code of another length, 23:59 on the day it expires and 00:00 the next day in the region's time, and an amount with one decimal too many.
- The expiry cases and the bank's window cases set the time in the request, so they test the exact boundary without waiting in real time.
- A response that shows a stack trace, SQL or internal paths fails the case, even if it brings the expected code.

**US-03 Connect an integration or add a case without touching the flow** · Must

As a QA team, I want to connect a new integration or add a new case without touching the payment flow, so that adding coverage stays cheap and the code stays clean.

- The bank comes in with just its config and no code of its own: its reversal window is a rule that gets turned on in its JSON.
- Each integration's config brings its payment method and its merchants: the one that creates its references and the others some cases ask for, each one with an alias that says what it's for. A case names the alias, never the id, and if an id changes, only the config changes.
- A new case is a JSON that states its flow, its reference and its objective: the step where it ends and the code it expects.
- A case from the base catalog runs on every integration that can do it, without copying it. What changes by region, like a boundary amount, the code length or the time, the case states by what it is, and the framework fills in each region's number. Those that can't run it show it in the report as Not run, with its reason.
- If an axis of the reference brings a list, there's one test per value.
- A typo in a case or an integration fails at load time: the run doesn't start, and the error says which file and which field are wrong.
- An integration with a different contract only brings its client and its translation. The flows, the judge and the evidence don't change.

**US-04 Show that the tests work** · Must

As a QA team, I want to run the integrations against a version of PayRef with bugs, to show that the tests catch them, the way it would happen with a real release.

- PayRef 1.0 ships with the 8 seeded bugs, and 1.1 comes fixed.
- Against 1.1, every case that applies to each integration comes out Passed.
- Against 1.0, each bug fails at least one case in the check it belongs to, and the report shows it as Failed, with its reason.
- A timeout or a framework error doesn't count as a caught bug.
- The README says which case catches each bug.
- `npm run test:bugs` runs this demo with a single command.

**US-05 Read the report of a run** · Must

As a lead, I want to read the summary of each run and open any case down to its evidence, to know what happened without asking anyone and to be able to audit it.

- The first thing you see is the summary: the context of the run (the integration, the region, the environment and the PayRef version), how many cases ran and how they came out.
- Each variation of a case counts as a case in the report, with its own result and evidence, and it's named with its id, the integration and what varied.
- Each case comes out with one of four results, with its reason:
  - Passed: all the checks were met, also when a rejection was expected.
  - Failed: a check found a difference, also a 500 that PayRef did answer or an unclassified response.
  - Inconclusive: there was no response, like a timeout, a refused connection, a 408, 502, 503 or 504 after its retries, or a database that couldn't be read. Also if the run was interrupted.
  - Not run: the case didn't start, for example because it doesn't apply to that integration.
- Apart from the result, the report says whether the evidence is complete: each step that ran has the minimum for its kind, and each check keeps what was expected and what was found. A Passed case with incomplete evidence shows both facts and doesn't count as approved.
- Each case opens down to its step, its check and its evidence: what was expected, what was found and what was executed.
- Each run is independent and keeps its report in its own folder: repeating a case gives a new report, without mixing with or overwriting the previous one. When it ends, the command says where each report is.
- The report tells what happened: it doesn't recommend releasing and doesn't make up causes. The Playwright report is kept apart.

**US-06 Clone, run and understand the project** · Must

As a technical reviewer, I want to clone the repo and run it in a few steps, to understand how it's built without asking for help.

- With Node 24 and Docker, `npm install` and `npm test` are enough to run everything. Without a `.env`, the test values from `.env.example` are used.
- Before the cases, a quick check confirms that the database, PayRef and the wallet respond. If Docker isn't running, a port is taken or something doesn't respond, the run doesn't start and says what's missing.
- The README explains how to run it, what the version with bugs catches and how it's built, and links to the step by step to add an integration and a case. That step by step gets checked by following it to the letter to add a test integration, with no help.
- `npm run verify` checks formatting, lint, types and the framework's tests, without Docker.

**US-12 Test the notice even if the third party doesn't send it** · Must

As a QA team, I want to test a third party's payment notice both ways, building and signing it as the third party would, or letting its simulator send it, so I don't depend on the third party being ready, without passing a simulated notice off as a tested connection.

- The wallet is tested with both sources of the notice. The simulated wallet sends the webhook normally, repeated, late or with another amount. The framework generates the signature as the wallet would and does those four, plus without a signature, with a bad signature and for a resource that doesn't exist.
- Positive and negative cases run with both sources. If a case asks for something its source can't do, it doesn't run, and the report says why.
- When the wallet sends the notice, the step observes: it waits for PayRef to record the webhook in the bridge log, checks the result there against the expected one, and then the movements. Its evidence is the readings and the call that triggered the wallet.
- The report says where each case's notice came from.

**US-13 Test the framework itself** · Must

As a QA team, I want the framework to have its own tests, so I can trust its verdict: if the judge is wrong, everything else lies.

- The judge and the database checks are tested with controlled responses and rows: they accept the exact result and detect another rejection, an unclassified response, a technical problem, a difference with the database and a leak that brings the expected code. The judge also separates Failed from Inconclusive: a 500 against a timeout or a 503.
- The evidence is tested: it keeps what really happened, preserves the failure, separates the runs, hides the credentials and marks as incomplete a step that's missing the minimum.
- A test integration, made only of config on top of the standard contract, loads and builds its cases without touching code. If it turns on the reversal window, it gets those cases, and if not, it doesn't.
- These tests run with `npm run test:unit`, without PayRef or Docker.

### E2. PayRef, the orchestrator

**US-07 Create and manage references** · Must

As a merchant, I want to create payment references, look them up and cancel them, to collect from my customers wherever they prefer to pay.

- It logs in with its own key and gets a token, which it uses on every call.
- It can create the 8 reference types: single or recurring, with a fixed or open amount, with or without an expiry.
- The code PayRef creates has the length of its region: 14 digits in Mexico and 10 in South America.
- Creating a reference with invalid data, like a zero amount or one with more decimals than its region allows, a fixed amount that's missing or an expiry already past, answers 400, says which field failed and creates nothing.
- It can check the state of its references: active, paid, cancelled or expired. Expired isn't stored: it comes from the date and the time of its region.
- It can cancel an active reference. A paid single reference answers R-102, one already cancelled R-105, an expired one R-103, and one with a payment in progress in the bank's window, R-108.
- It only sees, cancels and asks for the resource of its own references. Another merchant's answers R-101, as if it didn't exist, so as not to reveal that it does.
- A cancelled reference can no longer be paid.

**US-08 Collect a reference** · Must

As a standard payment method, for example a supermarket, I want to look up a reference and report the payment once the customer has paid, so the payment gets recorded in the orchestrator.

- It logs in with its own key and gets a token.
- It can look up the reference before charging, if its integration inquires. The inquiry only informs: it answers with the reference's data and its state, expired included, or R-101 if it doesn't exist, without validating the business and without recording anything.
- It sends the request and the notice, together or separately depending on its config. The request, or the call that joins both, brings its sequence and gets a folio and an authorization if the reference applies. When they're separate, the notice brings the folio of its request.
- The request always validates on its own, whether there was an inquiry or not.
- If the reference doesn't apply (it doesn't exist, it's expired, cancelled or already paid, or the amount isn't valid), it gets the matching rejection code.
- An amount isn't valid if it's zero or negative, if it has more decimals than its region allows, if it's different from the fixed one or if it's outside the payment method's limits, which are inclusive. It's rejected with R-104 and never rounded.
- If it asks for an operation it doesn't have configured, like reversing, it gets a 403.

**US-09 The same rules for everyone** · Must

As a merchant and as a payment method, I want the orchestrator to apply the same rules to everyone, to trust that a payment is worth the same, wherever it comes in.

- Everyone logs in with their key. A bad key, a call without a token or an invalid token answers 401, and the other role's token, like a merchant sending a request, 403. Who's calling always comes from the token, never from the body.
- On the webhook what travels is a signature, and if it's missing or doesn't match it's rejected with 401.
- It always validates in the same order: the credential, that the reference exists, that it isn't cancelled, that it's still valid, the amount, that it isn't paid, that it has no payment in progress and that the sequence isn't repeated.
- A single reference that's already paid is rejected with R-102, whatever sequence comes. A sequence that payment method already used in a payment is rejected with R-106, the same as a second notice of the same folio. A rejection leaves nothing behind, so it doesn't use up its sequence.
- It always answers the same way: a 200 with the business code when the request reaches the business, and a 400, 401, 403 or 5xx when it doesn't.
- It respects the rules of each region. A code of another length doesn't exist in that region (R-101). The expiry is a date: the reference can be paid all that day in its region's time (UTC−6 or UTC−3), and from 00:00 the next day it's rejected with R-103. The decimals of the amount are those of its currency: cents in Mexico and whole units in South America.
- Each region keeps everything in its own database, so a reference from another region doesn't exist (R-101).
- No error shows internal details, not even the 400 of a malformed request.

**US-10 The bank's reversal window** · Must

As a bank that turns on the reversal window in its config, I want to validate before confirming and be able to reverse within the window, to undo a payment if something fails on my side.

- If the reference applies, the request answers OK with a folio and an authorization, but the payment stays pending.
- The window lasts what the bank's config says, 2 minutes by default, and at exactly minute 2 it's already closed.
- While the window runs, another request for the reference is rejected with R-108, single or recurring, and the merchant can't cancel it either.
- The window protects the customer, who paid while the reference was valid and not cancelled: without a reversal, the payment is confirmed without validating again, even if the reference expires while the window runs.
- Within the window, the notice confirms the payment and the reversal leaves it reversed: the reference can be paid again.
- If the bank does nothing, the payment is confirmed on its own when the window ends. It shows on the next request that touches the reference or the payment, and the movement keeps the time the window ended.
- The window closes with whatever happens first: the notice, the reversal or its end. After that, a reversal, or a notice of a reversed payment, is rejected with R-107, and a notice of a payment already confirmed is rejected as repeated.
- The window is a rule in its config: another integration can turn it on the same way, with no code, and a bank that doesn't turn it on behaves like any standard payment method.

**US-11 Pay with a QR or link and report by webhook** · Must

As a wallet, a digital payment method, I want to generate a payment QR or link and report with a signed webhook when the customer pays, so the customer pays from their app and the payment gets recorded in the orchestrator.

- The merchant asks for the QR or link with its token. Before asking the wallet, PayRef validates the same way as a standard request: first what the merchant allows, which is the reference, and then the payment method's limits. If it doesn't apply, it answers with the business rejection.
- The resource is for a single payment and a single amount: while it isn't paid, asking again with the same amount returns the same one, and another amount gets a new one. Once paid, a recurring reference gets a new one, and a single one answers R-102.
- The webhook travels signed. If the signature is missing or doesn't match, it's rejected with 401 and nothing gets recorded.
- When the webhook arrives, PayRef validates everything again, in case something changed: if the reference expired or was cancelled in between, it's rejected and the payment isn't recorded.
- The webhook is tied to the resource by the id the wallet gave it, never by the reference.
- A webhook with another amount is rejected with R-104, one for a resource that doesn't exist with R-101, and a repeated one as a repeated notice. None of them records anything, and it never answers a 500.
- A PayRef rejection never becomes a success on its way through the bridge: if the core rejects the webhook, the bridge answers that rejection.

The extras belong to each integration, not to every bank or every wallet: another integration can turn on the same thing with its config.

## 6. Non-functional requirements

| ID     | Requirement                                                                                                                                                                                                                | How it's validated                                                                                   |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| NFR-01 | It runs on a clean machine: with Node 24 and Docker, `npm install` and `npm test` run everything, with no manual steps, not even copying the `.env`                                                                        | Clone it clean and run it                                                                            |
| NFR-02 | The framework's tests run without PayRef or Docker, in under 30 seconds                                                                                                                                                    | `npm run test:unit`                                                                                  |
| NFR-03 | The judge and the evidence have at least 80% line and branch coverage in the framework's tests                                                                                                                             | Vitest coverage report                                                                               |
| NFR-04 | The code passes strict TypeScript, ESLint and Prettier with no errors                                                                                                                                                      | `npm run verify`                                                                                     |
| NFR-05 | No evidence keeps full credentials: the `Authorization` header, the key and the auth token come out hidden. The webhook's signature stays visible, because it only works for its own request, and the secret never travels | A framework test on the masking                                                                      |
| NFR-06 | The repo's credentials are test ones: they live in `.env.example`, and the `.env` never gets uploaded                                                                                                                      | Review of the repo and `.gitignore`                                                                  |
| NFR-07 | The cases are independent: each one creates its data, and a case on its own comes out the same as in the full run                                                                                                          | Run a case alone and in the full run                                                                 |
| NFR-08 | No test waits in real time: the time cases use the test time                                                                                                                                                               | The ESLint rule in the tests, and the code review for the rest                                       |
| NFR-09 | The full run of an integration takes under 5 minutes, with the MySQL image already downloaded                                                                                                                              | The duration in the report. The first run can take longer, and the README says so                    |
| NFR-10 | Runs don't step on each other: each one keeps its files apart                                                                                                                                                              | Run twice and compare the folders                                                                    |
| NFR-11 | The framework only reads PayRef's database, with a read-only user                                                                                                                                                          | Before each run, the quick check tries to write with that user, and if it can, the run doesn't start |
| NFR-12 | The tests always give the same result: new ones run 3 times in a row and come out the same                                                                                                                                 | Three runs in a row with `CI=1` at the end of each phase                                             |

## 7. Definition of done

A story is done when:

- It meets its acceptance criteria.
- Its tests pass against PayRef 1.1, and the ones that catch bugs fail against 1.0 where they should.
- The framework tests that cover it pass.
- Its new tests always give the same result (NFR-12).
- `npm run verify` is clean.
- Its evidence is complete in the report.
- The docs it touches are up to date: the requirements and the analysis.
