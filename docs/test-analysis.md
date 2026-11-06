# Test analysis

What gets tested, how a test is decided to have passed and where the cases come from. The test basis is the [requirements](requirements.md).

## 1. Review of the requirements

Before writing a single test, the requirements were reviewed. That turned up 44 findings: 18 gaps, 11 ambiguities, 9 contradictions and 6 criteria that couldn't be verified. All of them were resolved there, before any coding. Here are a few:

| Type           | What was found                                                                                                                    | How it ended up                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Contradiction  | "If the API says OK and there's no confirmed movement, the case fails", but the bank leaves its payment pending after the request | The database has to match what the case expected and the API confirmed, in the state it should be in              |
| Gap            | While the window runs, the reference takes no other request, but there was no code for that rejection                             | A new code, R-108                                                                                                 |
| Ambiguity      | It didn't say when a reference expires, or which time zone counts                                                                 | The expiry is a date: it can be paid all that day in its region's time, and from 00:00 the next day it's rejected |
| Not verifiable | It named the four results, but not when each one comes out, and that boundary decides whether a bug counts as caught              | A decision table, 8.5                                                                                             |

## 2. Scope

The stories and requirements are tested on the three integrations, the supermarket and the wallet in Mexico and the bank in South America, against both versions of PayRef. PayRef has no tests of its own: the framework is its test suite, and it tests PayRef as a black box, over HTTP and by reading its database.

| Level        | What it tests                                                                                 | With what                                           | When                                      |
| ------------ | --------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------- |
| Component    | The framework's judge, evidence, catalog and masking, with controlled responses and rows      | Vitest, with `npm run test:unit`                    | On every change, without PayRef or Docker |
| System       | The flows of each integration against PayRef, through its API and in its database             | Playwright, with `npm test` and `npm run test:bugs` | In each phase, one integration per run    |
| Quick check  | That the database, PayRef and the wallet respond, and that the framework's user can only read | The start of each run                               | Before each run                           |
| Code quality | Formatting, lint and types                                                                    | `npm run verify`                                    | On every change                           |

What's not tested: what the requirements leave out, rejections and outages of third parties, and the API contract, which will get its own set.

Everything runs locally, with Node 24 and Docker. The database runs in Docker, and PayRef and the simulated wallet are processes that Playwright starts and stops. One integration runs at a time.

## 3. Assertion strategy

There are two levels, and they don't mix: the cases ask whether PayRef did the right thing, and the framework's tests ask whether the framework notices when PayRef doesn't.

### 3.1 The cases

The result of each case comes from three pieces, each with a single job:

| Piece               | What it does                                                                                                                      | What it doesn't do                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| The judge           | Reads the response of each step and says whether it's the one the case expected                                                   | It doesn't read the database, doesn't decide what gets tested and doesn't check the contract |
| The database checks | Compare the movements with what the case expected and the API confirmed, and run any extra checks the case asks for               | They don't read responses                                                                    |
| The case result     | Puts together what the judge and the checks said, checks whether the evidence is complete and gives one of the four results (8.5) | It doesn't check anything again                                                              |

No case writes assertions, only data. The assertions live in the judge and the checks, and they're written once for all the cases.

#### The case

- It only declares what it expects at its objective: the step where it ends and the exact code or status. The steps before it just have to succeed.
- What's expected never comes from what the system answered. A payment the API accepted where the case expected a rejection doesn't count.
- If the usual caller doesn't call the objective, the case says who does, as in the first column of 8.9.
- What changes by region is written by what it is, like the minimum, the extra decimal or the window's end, and the framework fills in the number.
- Waits ask, they don't sleep, and business time is set with the test time.
- A reference that has already expired at the time of the case gets created the day before it expires, so a bug that expires it a day early can't hide another one.
- On the wallet, a case that ends at a notice runs twice, once per source: the framework signs the webhook, or the simulated wallet sends it on its own and the step observes the bridge log.

#### The judge, on every response

- The business code decides, not the 200.
- It reads the response in this order:
  1. The technical leak, always and on the raw body: a stack trace, SQL or an internal path fails the step even if it brings the expected code. It's checked on every response because it can show up in any of them, depending on what failed.
  2. The transport: the status says whether the request reached the business.
  3. The format: what isn't JSON is a technical error, never a rejection.
  4. The success, with all its conditions: a request is only a success with OK, its folio and its authorization.
  5. The code, translated into PayRef's codes with its API's dictionary. That way a case is written once and runs on all three integrations.
  6. A code that isn't in the dictionary comes out Failed, as an unclassified response.
- What it compares comes from the response's fields: the code, the folio, the authorization and the resource id, according to each API's template. Never by position or by a text.
- Only the transport gets retried. A 408, 502, 503, 504 or a timeout is retried up to a limit, if the operation can be repeated safely, and each attempt stays in the evidence. A business result or a whole case is never retried.

#### The database

- It has the last word. At the end of each case, also after a failure, the movements of its reference are read: how many there are, in which state, with what amount, with what request date when the case sets the time, and what they're tied to.
- The bridge log goes into the evidence as a snapshot and doesn't decide, except on a notice that observes: there, its result is the signal that PayRef has processed the webhook.

#### The evidence and the report

- The evidence decides nothing: it shows what happened. A Passed case with incomplete evidence isn't approved.
- The report presents what the run saved. It never runs anything again or adds another verdict.

### 3.2 The framework's tests

They run with Vitest, without PayRef or Docker. Each test builds just what it needs, like a 200 with a rejection or a 500 with a stack trace, and compares the verdict and its reason, never a log text. They're in [the framework tests](framework-tests.md).

## 4. How the tests are verified

A test that never fails proves nothing, so the tests get tested too.

### 4.1 The cases

- Watching them fail: the expected result in their JSON gets changed, and the case has to fail saying what it expected and what it got.
- Against a version with bugs: the cases run the same against both versions of PayRef, and each bug fails its case. A timeout or a framework error doesn't count as a caught bug.
- Always the same result: in a payment there's no such thing as half right. At the end of each phase, three runs in a row have to come out the same. If one comes out different, the cause gets tracked down, it's never fixed with a retry.
- Nothing hidden: no `test.only` and no tests skipped by accident, and what doesn't apply to an integration comes out Not run, with its reason.

### 4.2 The framework's tests

They get broken on purpose, one piece at a time, and their test has to fail. The list is in [the framework tests](framework-tests.md).

## 5. Risks

These weighed the most on the design, and the build order came from them.

| Risk                                                                                                | How it's covered                                                                        |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| A 200 with a rejection is taken as a success, and the test passes falsely                           | The judge decides on the business code, and the trap of the 200 proves it               |
| The API and the database don't match: an error that did leave the payment, or an OK with no payment | The final check of every case, also after a failure                                     |
| A repeated payment gets recorded twice                                                              | F-05, in the response and in the database                                               |
| A badly calculated time boundary: midnight, the time zone or the window's end                       | F-06 and F-07, with the test time                                                       |
| A webhook without a signature or with a bad one records a payment                                   | F-08, with the signature over the exact bytes                                           |
| Asynchronous tests fail now and then                                                                | Waits that ask, and three identical runs at the end of each phase                       |
| A typo in a JSON runs a different case than intended                                                | The catalog and the config get validated at load time                                   |
| A badly written case gives a false positive                                                         | Each case is seen failing, against the version with bugs or by changing what it expects |
| A bug in the version with bugs hides another one in the same case                                   | What prepares a case is set up far from the boundaries other cases test                 |
| Connecting an integration isn't as easy as the architecture promises                                | The step by step was checked by adding a test integration                               |

## 6. Manual tests

- The code review of each phase. On top of the usual, it checks that PayRef doesn't name the bank, that the time hook only exists in test mode, that it validates before asking the wallet for anything, and the two-call rule without a window, which no integration uses.
- The design of the report: simulated first, then approved with real reports.
- The README from a clean clone, and its step by step by adding a test integration.
- The spelling and wording of everything that gets read.

## 7. Build order

First a complete end-to-end flow, and then the rules, from the riskiest down. Each phase adds to the version with bugs the ones from what it built, so its close already proves the cases catch them.

1. The supermarket end to end.
2. The core rules: the reference types, the amounts, repeated payments and the expiry.
3. The merchant and basic security.
4. The bank and its reversal window.
5. The wallet and the two sources of its webhook.
6. The execution report.
7. The README.

## 8. Test conditions

What has to be tested, with the technique that fits each thing.

### 8.1 Equivalence partitions: the integrations

The three integrations were chosen with partitions by factor and coverage of each option: at least one integration covers each class.

| Factor                                | Classes                                                                                | Who covers it                                                           |
| ------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| How it connects                       | Standard · Adapter · Third-party APIs                                                  | The supermarket and the bank · Nobody, it's left for later · The wallet |
| How the request and the notice arrive | Together · Separately, with the notice by API · Separately, with the notice by webhook | The supermarket · The bank · The wallet                                 |
| Optional rules                        | No rules · With the reversal window                                                    | The supermarket and the wallet · The bank                               |
| Region                                | Mexico · South America                                                                 | The supermarket and the wallet · The bank                               |

They cover 9 of the 10 classes. Only the adapter is missing.

### 8.2 Equivalence partitions: the reference

Three axes, with one rule each, that make 8 types.

| Axis   | Classes                 | What changes                                                                                                                        |
| ------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Type   | Single · Recurring      | A single reference is paid with its first payment. A recurring one stays active and takes more payments, each with its own sequence |
| Amount | Fixed · Open            | A fixed one is paid exactly. An open one takes any valid amount within the payment method's limits                                  |
| Expiry | No expiry · With expiry | Without one, it never expires. With one, it can be paid until 23:59:59 of its day, in its region's time                             |

The happy payment runs with the 8 types on all three integrations. Each negative uses only the classes that matter to it: the expiry ones, the 4 types with an expiry, and the fixed-amount ones, the 4 with a fixed amount.

### 8.3 Boundary values

| What               | Boundary                                                                             | Values                                                                                                                                                                                           | Expected                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Code length        | 14 digits in Mexico and 10 in South America                                          | In Mexico 13, 14 and 15, and in South America 9, 10 and 11. The length of the other region: 10 in Mexico and 14 in South America. And the longest PayRef takes: 30 digits                        | Its region's length finds the reference, and the others give R-101                          |
| Open amount        | The payment method's limits, which are inclusive                                     | One unit below the minimum, the minimum, the maximum, one unit above the maximum and a giant one that doesn't fit in the database. The unit is a cent in Mexico and a whole one in South America | R-104, OK, OK and R-104                                                                     |
| Fixed amount       | The reference's amount                                                               | One unit below, the exact one and one unit above                                                                                                                                                 | R-104, OK and R-104                                                                         |
| Minimum amount     | Zero                                                                                 | Zero and a negative amount                                                                                                                                                                       | R-104 on both                                                                               |
| Decimals           | 2 in Mexico and none in South America                                                | In Mexico, 2 and 3 decimals. In South America, none and 1                                                                                                                                        | OK and R-104                                                                                |
| Expiry             | 23:59:59 on the day it expires, in its region's time                                 | 23:59:59 and 00:00:00 the next day                                                                                                                                                               | OK and R-103                                                                                |
| Time zone          | UTC−6 in Mexico and UTC−3 in South America                                           | A time that's already the next day in UTC but still the expiry day in the region, like 23:30 in Mexico                                                                                           | OK                                                                                          |
| Expiry at creation | Today, in the region's time                                                          | Today and yesterday                                                                                                                                                                              | The reference gets created, and yesterday answers 400                                       |
| The bank's window  | The duration in its config, 2 minutes on the bank, from when the request is approved | One second before it closes and when it closes: 1:59 and 2:00 on the bank                                                                                                                        | The reversal goes through, and at 2:00 it answers R-107, with the payment already confirmed |

### 8.4 Decision table: the validation order

When two rules fail at once, the first one answers, in the order of US-09. It's the order PayRef follows, and it isn't tested by combining rules: each family tests its own rejection. An empty cell doesn't matter.

| Rule | Credential | Exists | Cancelled | Valid | Valid amount | Paid (single) | Payment in progress | Sequence used | Answers |
| ---- | ---------- | ------ | --------- | ----- | ------------ | ------------- | ------------------- | ------------- | ------- |
| 1    | Invalid    |        |           |       |              |               |                     |               | 401     |
| 2    | Valid      | No     |           |       |              |               |                     |               | R-101   |
| 3    | Valid      | Yes    | Yes       | No    | No           |               |                     |               | R-105   |
| 4    | Valid      | Yes    | No        | No    | No           |               |                     |               | R-103   |
| 5    | Valid      | Yes    | No        | Yes   | No           | Yes           |                     |               | R-104   |
| 6    | Valid      | Yes    | No        | Yes   | Yes          | Yes           |                     | Yes           | R-102   |
| 7    | Valid      | Yes    | No        | Yes   | Yes          | No            | Yes                 | Yes           | R-108   |
| 8    | Valid      | Yes    | No        | Yes   | Yes          | No            | No                  | Yes           | R-106   |
| 9    | Valid      | Yes    | No        | Yes   | Yes          | No            | No                  | No            | OK      |

Rule 6 is why a repeated notice on a single reference answers R-102 and not R-106. Rule 7 only happens with the reversal window.

### 8.5 Decision table: the result of a case

| What happened                                                                                      | Result                                          |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| All the checks were met, also an expected rejection                                                | Passed                                          |
| Another code, another status, an unclassified response, a folio nobody asked for or a leak arrived | Failed                                          |
| PayRef answered a 500 the case didn't expect                                                       | Failed                                          |
| The database doesn't match what the case expected and the API confirmed                            | Failed                                          |
| No response: a timeout, a refused connection, or a 408, 502, 503 or 504 after its retries          | Inconclusive                                    |
| The database couldn't be read, or the run was interrupted                                          | Inconclusive                                    |
| The framework itself breaks, for example a bug in the judge                                        | Inconclusive, with the reason "framework error" |
| The case doesn't apply to the integration, its notice source can't do it, or it's blocked          | Not run                                         |
| It had already failed, and then the run was interrupted                                            | Stays Failed                                    |

The evidence is marked apart: a Passed case with incomplete evidence doesn't count as approved.

### 8.6 State transitions: the reference

States: active, paid, cancelled and expired. Expired isn't stored: it comes from the date.

| Current state                      | Event                         | Next state | Expected result                                                  |
| ---------------------------------- | ----------------------------- | ---------- | ---------------------------------------------------------------- |
| Active                             | A payment, if single          | Paid       | OK, with a confirmed movement                                    |
| Active                             | A payment, if recurring       | Active     | OK, with one more movement                                       |
| Active                             | The merchant cancels it       | Cancelled  | OK                                                               |
| Active, with a payment in progress | The merchant cancels it       | Active     | R-108                                                            |
| Active                             | Its expiry date passes        | Expired    | The request answers R-103, and the inquiry reports it as expired |
| Paid                               | Another payment               | Paid       | R-102                                                            |
| Paid                               | The merchant cancels it       | Paid       | R-102                                                            |
| Cancelled                          | A payment                     | Cancelled  | R-105                                                            |
| Cancelled                          | The merchant cancels it again | Cancelled  | R-105                                                            |
| Expired                            | A payment                     | Expired    | R-103                                                            |
| Expired                            | The merchant cancels it       | Expired    | R-103                                                            |

### 8.7 State transitions: the bank's payment

| Current state | Event                                      | Next state | Expected result                                                      |
| ------------- | ------------------------------------------ | ---------- | -------------------------------------------------------------------- |
| Pending       | The notice arrives, within the window      | Confirmed  | OK                                                                   |
| Pending       | The reversal arrives, within the window    | Reversed   | OK, and the reference can be paid again                              |
| Pending       | The window ends with no notice or reversal | Confirmed  | It shows on the next request, with the time the window ended         |
| Pending       | Another request for the reference arrives  | Pending    | R-108                                                                |
| Pending       | The merchant cancels the reference         | Pending    | R-108                                                                |
| Pending       | The reference expires                      | Pending    | The payment still gets confirmed: the expiry no longer applies to it |
| Confirmed     | Another notice arrives                     | Confirmed  | Like a repeated notice: R-106, or R-102 on a single reference        |
| Confirmed     | A reversal arrives                         | Confirmed  | R-107                                                                |
| Reversed      | The notice arrives                         | Reversed   | R-107                                                                |
| Reversed      | Another reversal arrives                   | Reversed   | R-107                                                                |
| Reversed      | Another request for the reference arrives  | Reversed   | OK, with another pending payment and another sequence                |

### 8.8 State transitions: the wallet's resource

| Current state | Event                                                           | Next state         | Expected result                                                   |
| ------------- | --------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------- |
| No resource   | The merchant asks for it, and the reference applies             | Created            | OK, with the QR or link                                           |
| No resource   | The merchant asks for it, and the reference doesn't apply       | No resource        | The reference's rejection, without asking the wallet for anything |
| Created       | It's asked for again, with the same amount                      | Created            | The same resource                                                 |
| Created       | It's asked for again, with another amount                       | Created, a new one | OK, with a new resource                                           |
| Created       | The webhook arrives, and the reference applies                  | Paid               | OK, with a confirmed movement tied to the resource                |
| Created       | The webhook arrives, and the reference expired or was cancelled | Created            | R-103 or R-105, no payment                                        |
| Created       | The webhook arrives with another amount                         | Created            | R-104, no payment                                                 |
| Created       | The webhook arrives without a signature or with a bad one       | Created            | 401, no payment                                                   |
| Paid          | The webhook arrives again                                       | Paid               | Like a repeated notice, no other payment                          |
| Paid          | It's asked for again, if recurring                              | Created, a new one | OK, with a new resource                                           |
| Paid          | It's asked for again, if single                                 | Paid               | R-102                                                             |

### 8.9 Basic security

| Who calls, and with what                                                                 | Expected                                               |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| No token or an invalid token, even with a malformed request                              | 401                                                    |
| A bad key on the auth                                                                    | 401                                                    |
| The other role's token, like a merchant sending a request                                | 403                                                    |
| A payment method asking for an operation it doesn't have, like the supermarket reversing | 403                                                    |
| A merchant with another's reference, to see it, cancel it or ask for its resource        | R-101, as if it didn't exist                           |
| A webhook without a signature or with one that doesn't match, even with a malformed body | 401, no payment                                        |
| A malformed request                                                                      | 400, with no internal details                          |
| Any response                                                                             | No stack trace, SQL or internal paths                  |
| The evidence of any step                                                                 | Without the `Authorization`, the key or the auth token |

### 8.10 Use case: the full journey

It's the first flow that gets automated, because it goes through every piece: paying a single reference with a fixed amount on the supermarket.

1. The runner loads the base catalog and the supermarket's config, and validates them.
2. The case builds its context, with its reference, its sequence and the Mexico region.
3. The merchant gets its token and creates the reference, with a 14-digit code.
4. The supermarket gets its token, looks up the reference and sends the request with the notice in one call, and gets OK, with its folio and its authorization.
5. The judge reads each response with its API's template.
6. The database's final check finds a confirmed movement, tied to the reference and the supermarket and with the reference's amount, and the reference ends up paid.
7. Each step leaves its evidence, and the run keeps its report.

This journey checks that the design comes out simple before adding the rest.

### 8.11 Error guessing

What tends to break in a payments orchestrator and in a framework like this one, split by level.

In PayRef:

- Calculating the expiry in UTC instead of the region's time.
- Counting one too many or too few at the last instant of the day or the window.
- Rounding an amount instead of rejecting it.
- Storing the reference's code as a number and losing the leading zeros. Every run tests this, because codes are random and about one in ten starts with a zero.
- Checking the webhook's signature over the parsed JSON instead of the body that arrived: another field order or an extra space breaks it. The framework sends its webhooks with spaces, so each one tests it.
- Rewriting the date of the request when confirming the payment. The final check compares it when the case sets the time.

In the framework:

- Taking a 200 that brings a rejection as a success.
- Comparing amounts without normalizing them: the database returns them as text and the API as a number, and as floating point numbers, 0.1 plus 0.2 isn't 0.3.
- Two cases of the same run using the same sequence and stepping on each other.
- Checking that there's no movement before PayRef processes the webhook, and passing falsely.
- A step that forgets the test time and uses the server's.
- A case that doesn't apply to the integration vanishing from the report, instead of coming out Not run.
- An error while saving the evidence that hides the original failure.
- Waiting with a sleep instead of asking the database.

## 9. Case families

Scenarios that share a path and checks are grouped in a family, which is written once. Each variation is still its own test, with its result and its evidence. The cases of each one are in [the case matrix](test-matrix.md). There's no F-04: it was removed because each family already tests its own rejection.

| Family                           | Path                                                      | What varies                                                                                                                                                                                                          |
| -------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-01 The happy payment           | The full payment                                          | The 8 reference types                                                                                                                                                                                                |
| F-02 The reference doesn't apply | The payment, up to the request or the resource            | It doesn't exist, it has the other region's length or another length, it's cancelled, expired or already paid                                                                                                        |
| F-03 The amount isn't valid      | The payment, up to the request or the resource            | Different from the fixed one, zero, negative, with extra decimals or outside the limits, with their boundaries (8.3)                                                                                                 |
| F-05 Repeated payments           | The payment, twice                                        | The same sequence or a new one, on a single or a recurring reference, and a second notice of the same folio                                                                                                          |
| F-06 The expiry                  | The payment, with the test time                           | The date and time zone boundaries of each region (8.3), and what the inquiry reports about an expired reference                                                                                                      |
| F-07 The reversal window         | The request, and then the notice, the reversal or nothing | The transitions of 8.7                                                                                                                                                                                               |
| F-08 The webhook                 | The resource, and then the webhook                        | Late, with another amount, without a signature, with a bad one or for a resource that doesn't exist, with each notice source that can do it. F-01 covers the normal one and F-05 the repeated one, with both sources |
| F-09 The resource                | Up to the resource                                        | The same resource and a new one with another amount. F-05 covers a new one on a paid recurring reference and R-102 on a paid single one                                                                              |
| F-10 The merchant                | Create, look up and cancel                                | Invalid data, the states of 8.6 and another merchant's reference                                                                                                                                                     |
| F-11 Access and errors           | Any                                                       | What's in 8.9                                                                                                                                                                                                        |

The merchant's cases need nothing from the payment method, so they run in each integration's run. That way each run is complete on its own.

## 10. Traceability

It goes down to the families. The case ids live in the matrix, and the results, in the report of each run.

| US / NFR | Conditions                                                                                                   | Families or tests                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| US-01    | The full journey, the happy payment, the database's final check and the evidence of each kind of step        | 8.10, F-01                                                          |
| US-02    | The exact code, repeated payments, the region and time boundaries, and the leak                              | F-02, F-03, F-05, F-06, F-11, 8.3                                   |
| US-03    | The catalog crossing, the lists that multiply, the typo at load time and the bank with no code               | Catalog tests, F-01 on the bank                                     |
| US-04    | 1.1 green and 1.0 with each bug caught                                                                       | The bug list in the README                                          |
| US-05    | The summary, the four results, the complete evidence, one folder per run and the report of each one          | 8.5, the evidence and report tests                                  |
| US-06    | The quick check, the sample `.env`, `npm run verify` and the step by step the README links to                | A clean clone, and a test integration added by following the README |
| US-07    | Create, the states, cancel and another merchant's reference                                                  | F-10, 8.6, 8.9                                                      |
| US-08    | The happy payment, the inquiry, the request without an inquiry, the amount and the operation it doesn't have | F-01, F-02, F-03, F-06, F-11                                        |
| US-09    | Access, the validation order, repeated payments, the regions and the leak                                    | F-02, F-05, F-06, F-11, 8.4, 8.9                                    |
| US-10    | The transitions of the bank's payment and the window's boundary                                              | F-07, 8.3, 8.7                                                      |
| US-11    | The happy payment through the bridge, the resource, the webhook, the signature and the revalidation          | F-01, F-08, F-09, 8.8                                               |
| US-12    | The two notice sources and the step that observes                                                            | F-08                                                                |
| US-13    | The judge, the checks, the evidence and the test integration                                                 | The judge, checks, evidence and catalog tests                       |
| NFR-01   | It runs on a clean machine                                                                                   | A clean clone                                                       |
| NFR-02   | The framework's tests, without PayRef and in under 30 seconds                                                | `npm run test:unit`                                                 |
| NFR-03   | 80% of lines and branches in the judge and the evidence                                                      | Vitest coverage                                                     |
| NFR-04   | Formatting, lint and types                                                                                   | `npm run verify`                                                    |
| NFR-05   | No credentials in the evidence                                                                               | The masking tests                                                   |
| NFR-06   | Test credentials, and the `.env` out of the repo                                                             | Review of the repo                                                  |
| NFR-07   | Independent cases                                                                                            | A case alone, against the full run                                  |
| NFR-08   | No fixed waits                                                                                               | The ESLint rule in the tests, and the code review for the rest      |
| NFR-09   | Under 5 minutes per integration                                                                              | The duration in the report                                          |
| NFR-10   | Runs don't step on each other                                                                                | Two runs, and their folders                                         |
| NFR-11   | The framework's user only reads                                                                              | The quick check                                                     |
| NFR-12   | Always the same result                                                                                       | Three runs in a row with `CI=1`                                     |
